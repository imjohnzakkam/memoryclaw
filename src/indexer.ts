import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { Episode } from "./types.ts";
import { loadEpisodes } from "./episodic.ts";

export class EpisodeIndex {
  private db: Database;

  constructor(indexDir: string) {
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }

    this.db = new Database(join(indexDir, "episodes.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        file TEXT PRIMARY KEY,
        timestamp TEXT,
        summary TEXT,
        confidence TEXT,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS tags (
        file TEXT,
        tag TEXT,
        FOREIGN KEY (file) REFERENCES episodes(file) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
      CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file);

      CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
        file, summary, details,
        content='episodes',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
        INSERT INTO episodes_fts(rowid, file, summary, details)
        VALUES (new.rowid, new.file, new.summary, new.details);
      END;

      CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
        INSERT INTO episodes_fts(episodes_fts, rowid, file, summary, details)
        VALUES ('delete', old.rowid, old.file, old.summary, old.details);
      END;

      CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON episodes BEGIN
        INSERT INTO episodes_fts(episodes_fts, rowid, file, summary, details)
        VALUES ('delete', old.rowid, old.file, old.summary, old.details);
        INSERT INTO episodes_fts(rowid, file, summary, details)
        VALUES (new.rowid, new.file, new.summary, new.details);
      END;
    `);
  }

  indexEpisode(episode: Episode): void {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO episodes (file, timestamp, summary, confidence, details)
      VALUES (?, ?, ?, ?, ?)
    `);

    const deleteTags = this.db.prepare(`DELETE FROM tags WHERE file = ?`);
    const insertTag = this.db.prepare(`INSERT INTO tags (file, tag) VALUES (?, ?)`);

    const transaction = this.db.transaction(() => {
      upsert.run(
        episode.file,
        episode.timestamp,
        episode.summary,
        episode.confidence,
        episode.details,
      );
      deleteTags.run(episode.file);
      for (const tag of episode.tags) {
        insertTag.run(episode.file, tag.toLowerCase());
      }
    });

    transaction();
  }

  buildIndex(episodesDir: string): number {
    const episodes = loadEpisodes(episodesDir);
    for (const episode of episodes) {
      this.indexEpisode(episode);
    }
    return episodes.length;
  }

  searchByTags(tags: string[], maxResults: number): string[] {
    if (tags.length === 0) return [];

    const placeholders = tags.map(() => "?").join(", ");
    const stmt = this.db.prepare(`
      SELECT file, COUNT(*) as matches
      FROM tags
      WHERE tag IN (${placeholders})
      GROUP BY file
      ORDER BY matches DESC
      LIMIT ?
    `);

    const rows = stmt.all(...tags.map((t) => t.toLowerCase()), maxResults) as {
      file: string;
      matches: number;
    }[];

    return rows.map((r) => r.file);
  }

  searchFullText(query: string, maxResults: number): string[] {
    const escaped = query.replace(/['"*(){}[\]^~\\:]/g, " ").trim();
    if (!escaped) return [];

    const terms = escaped
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t}"`)
      .join(" OR ");

    if (!terms) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT file, rank
        FROM episodes_fts
        WHERE episodes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const rows = stmt.all(terms, maxResults) as {
        file: string;
        rank: number;
      }[];

      return rows.map((r) => r.file);
    } catch {
      return [];
    }
  }

  search(
    keywords: string[],
    query: string,
    maxResults: number,
  ): string[] {
    const tagResults = this.searchByTags(keywords, maxResults);
    const ftsResults = this.searchFullText(query, maxResults);

    const seen = new Set<string>();
    const combined: string[] = [];

    for (const file of tagResults) {
      if (!seen.has(file)) {
        seen.add(file);
        combined.push(file);
      }
    }
    for (const file of ftsResults) {
      if (!seen.has(file)) {
        seen.add(file);
        combined.push(file);
      }
    }

    return combined.slice(0, maxResults);
  }

  getStats(): { episodes: number; tags: number } {
    const episodes = (
      this.db.prepare("SELECT COUNT(*) as count FROM episodes").get() as {
        count: number;
      }
    ).count;
    const tags = (
      this.db.prepare("SELECT COUNT(*) as count FROM tags").get() as {
        count: number;
      }
    ).count;
    return { episodes, tags };
  }

  close(): void {
    this.db.close();
  }
}
