import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { LogEntry, LogMessage } from "./types.ts";

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function toMarkdown(entry: LogEntry): string {
  const lines: string[] = [
    "---",
    `timestamp: ${entry.timestamp}`,
    `channel: ${entry.channel}`,
    `message_count: ${entry.messages.length}`,
  ];

  if (Object.keys(entry.metadata).length > 0) {
    lines.push("metadata:");
    for (const [key, value] of Object.entries(entry.metadata)) {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push("processed: false", "---", "");

  for (const msg of entry.messages) {
    lines.push(`### ${msg.role} (${msg.timestamp})`, "", msg.content, "");
  }

  return lines.join("\n");
}

export function logInteraction(
  logsDir: string,
  channel: string,
  messages: LogMessage[],
  metadata: Record<string, unknown> = {},
): string {
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  const now = new Date();
  const entry: LogEntry = {
    timestamp: now.toISOString(),
    channel,
    messages,
    metadata,
  };

  const filename = `${formatTimestamp(now)}_${channel}_raw.md`;
  const filePath = join(logsDir, filename);

  writeFileSync(filePath, toMarkdown(entry), { mode: 0o600 });

  return filePath;
}
