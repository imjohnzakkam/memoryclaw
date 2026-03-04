import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { LogEntry, LogMessage } from "./types.ts";

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}-${min}-${s}`;
}

function formatReadableTimestamp(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    if (Number.isNaN(date.getTime())) return isoTimestamp;
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${formatDate(date)} ${h}:${min}`;
  } catch {
    return isoTimestamp;
  }
}

/**
 * Defensively serialize message content to a string.
 * Handles: plain strings, objects with .text/.content/.parts fields,
 * arrays of content blocks, and falls back to JSON.stringify.
 * Never produces [object Object].
 */
function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);

  if (Array.isArray(content)) {
    return content.map(contentToString).filter(Boolean).join("\n");
  }

  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (obj.content !== undefined) return contentToString(obj.content);
    if (Array.isArray(obj.parts)) return contentToString(obj.parts);
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return "[unserializable content]";
    }
  }

  return "";
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
    const text = contentToString(msg.content);
    const time = formatReadableTimestamp(msg.timestamp);
    lines.push(`### ${msg.role} (${time})`, "", text, "");
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

  // Human-readable filename: 2025-04-08_14-32-10_telegram_raw.md
  const filename = `${formatDate(now)}_${formatTime(now)}_${channel}_raw.md`;
  const filePath = join(logsDir, filename);

  writeFileSync(filePath, toMarkdown(entry), { mode: 0o600 });

  return filePath;
}
