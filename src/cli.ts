#!/usr/bin/env bun
import { join, resolve } from "path";
import { loadConfig } from "./config.ts";
import { retrieve } from "./retrieve.ts";
import { consolidate } from "./consolidate.ts";
import { auditMemories, searchMemories, deleteMemory, deleteFact } from "./memories.ts";
import { detectPatterns } from "./patterns.ts";
import { compileSkill, writeSkillDraft, listSkills, approveSkill, rejectSkill } from "./skill-compiler.ts";
import { EpisodeIndex } from "./indexer.ts";

const args = process.argv.slice(2);
const command = args[0];

const HOME = process.env.HOME ?? "/tmp";
const configPath = resolve(
  process.env.MEMORYCLAW_CONFIG ??
  join(HOME, ".openclaw", "memoryclaw", "config.yaml"),
);
let config: ReturnType<typeof loadConfig>;

try {
  config = loadConfig(configPath);
} catch (err) {
  console.error(`Failed to load config from ${configPath}`);
  process.exit(1);
}

const memoryclawDir = resolve(config.path);

async function main() {
  switch (command) {
    case "retrieve": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: memoryclaw retrieve <query>");
        process.exit(1);
      }
      const result = await retrieve(query, config);
      console.log("\n📋 Episodes:");
      for (const ep of result.episodes) {
        console.log(`  [${ep.confidence}] ${ep.summary}`);
        console.log(`    tags: ${ep.tags.join(", ")}`);
      }
      console.log("\n📌 Facts:");
      for (const [key, value] of Object.entries(result.facts)) {
        console.log(`  ${key}: ${value}`);
      }
      break;
    }

    case "consolidate": {
      console.log("Running consolidation...");
      const report = await consolidate({
        logsDir: join(memoryclawDir, "logs"),
        episodesDir: join(memoryclawDir, "episodes"),
        semanticDir: join(memoryclawDir, "semantic"),
        llmConfig: config.llm,
        consolidationConfig: config.consolidation,
        semanticFiles: config.semantic.files,
      });
      console.log(`Processed: ${report.processed}, Skipped: ${report.skipped}, Failed: ${report.failed}`);
      if (report.conflicts.length > 0) {
        console.log("\n⚠️  Conflicts:");
        for (const c of report.conflicts) {
          console.log(`  ${c.entity} ${c.field}: "${c.existingValue}" vs "${c.newValue}"`);
        }
      }
      break;
    }

    case "audit": {
      const limit = parseInt(args[1] ?? "10");
      const entries = auditMemories(memoryclawDir, limit);
      console.log("\nRecent memories:");
      for (const entry of entries) {
        const badge = entry.type === "episode" ? "📝" : "📌";
        console.log(`  ${badge} [${entry.confidence}] ${entry.content}`);
      }
      break;
    }

    case "search": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: memoryclaw search <query>");
        process.exit(1);
      }
      const results = searchMemories(memoryclawDir, query);
      if (results.length === 0) {
        console.log("No memories found.");
      } else {
        for (const ep of results) {
          console.log(`  [${ep.confidence}] ${ep.summary}`);
          console.log(`    tags: ${ep.tags.join(", ")}\n`);
        }
      }
      break;
    }

    case "delete": {
      const target = args[1];
      if (!target) {
        console.error("Usage: memoryclaw delete <episode-filename>");
        process.exit(1);
      }
      const deleted = deleteMemory(memoryclawDir, target);
      console.log(deleted ? `Deleted: ${target}` : `Not found: ${target}`);
      break;
    }

    case "delete-fact": {
      const file = args[1];
      const key = args[2];
      if (!file || !key) {
        console.error("Usage: memoryclaw delete-fact <semantic-file> <fact-key>");
        process.exit(1);
      }
      const deleted = deleteFact(memoryclawDir, file, key);
      console.log(deleted ? `Deleted fact: ${key} from ${file}` : `Not found: ${key} in ${file}`);
      break;
    }

    case "patterns": {
      const threshold = parseInt(args[1] ?? String(config.consolidation.skillThreshold));
      const patterns = detectPatterns(join(memoryclawDir, "episodes"), threshold);
      if (patterns.length === 0) {
        console.log(`No patterns found (threshold: ${threshold}).`);
      } else {
        console.log(`Patterns (threshold: ${threshold}):\n`);
        for (const p of patterns) {
          console.log(`  [${p.count}x] ${p.actions.join(" → ")}`);
        }
      }
      break;
    }

    case "compile": {
      const threshold = parseInt(args[1] ?? String(config.consolidation.skillThreshold));
      const patterns = detectPatterns(join(memoryclawDir, "episodes"), threshold);
      const skillsDir = join(memoryclawDir, "skills");
      let compiled = 0;
      for (const pattern of patterns) {
        const skill = compileSkill(pattern);
        const path = writeSkillDraft(skillsDir, skill);
        console.log(`Draft skill: ${path}`);
        compiled++;
      }
      console.log(`\n${compiled} draft skill(s) generated. Review before approving.`);
      break;
    }

    case "skills": {
      const skills = listSkills(join(memoryclawDir, "skills"));
      if (skills.length === 0) {
        console.log("No skills found.");
      } else {
        for (const s of skills) {
          const badge = s.status === "approved" ? "✅" : s.status === "draft" ? "📝" : "❌";
          console.log(`  ${badge} ${s.name} (${s.status}) — ${s.file}`);
        }
      }
      break;
    }

    case "approve-skill": {
      const file = args[1];
      if (!file) {
        console.error("Usage: memoryclaw approve-skill <draft-file>");
        process.exit(1);
      }
      const ok = approveSkill(join(memoryclawDir, "skills"), file);
      console.log(ok ? `Approved: ${file}` : `Not found: ${file}`);
      break;
    }

    case "reject-skill": {
      const file = args[1];
      if (!file) {
        console.error("Usage: memoryclaw reject-skill <draft-file>");
        process.exit(1);
      }
      const ok = rejectSkill(join(memoryclawDir, "skills"), file);
      console.log(ok ? `Rejected: ${file}` : `Not found: ${file}`);
      break;
    }

    case "index": {
      console.log("Building search index...");
      const indexDir = join(memoryclawDir, "index");
      const index = new EpisodeIndex(indexDir);
      const count = index.buildIndex(join(memoryclawDir, "episodes"));
      const stats = index.getStats();
      index.close();
      console.log(`Indexed ${count} episodes (${stats.tags} tags).`);
      break;
    }

    case "index-search": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: memoryclaw index-search <query>");
        process.exit(1);
      }
      const indexDir = join(memoryclawDir, "index");
      const index = new EpisodeIndex(indexDir);
      const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      const results = index.search(keywords, query, 10);
      index.close();
      if (results.length === 0) {
        console.log("No results.");
      } else {
        for (const file of results) {
          console.log(`  ${file}`);
        }
      }
      break;
    }

    default:
      console.log(`MemoryClaw CLI

Usage: memoryclaw <command> [args]

Commands:
  retrieve <query>          Search episodes + facts for a query
  search <query>            Search memories by keyword
  audit [limit]             Show recent episodes and pending facts
  delete <filename>         Delete an episode
  delete-fact <file> <key>  Delete a fact from a semantic file
  consolidate               Process raw logs into episodes
  patterns [threshold]      Detect repeated action patterns
  compile [threshold]       Generate draft skills from patterns
  skills                    List all skills
  approve-skill <file>      Approve a draft skill
  reject-skill <file>       Reject a draft skill
  index                     Build/rebuild SQLite search index
  index-search <query>      Search using the SQLite index
`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
