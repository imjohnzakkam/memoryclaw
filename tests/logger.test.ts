import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { logInteraction } from "../src/logger.ts";
import type { LogMessage } from "../src/types.ts";

const TEST_LOGS_DIR = join(import.meta.dirname!, "..", "test-logs");

afterEach(() => {
  if (existsSync(TEST_LOGS_DIR)) {
    rmSync(TEST_LOGS_DIR, { recursive: true });
  }
});

describe("logInteraction", () => {
  it("creates a log file with correct format", () => {
    const messages: LogMessage[] = [
      { role: "user", content: "Send email to John", timestamp: "2025-04-08T14:30:00Z" },
      { role: "assistant", content: "I'll send the email now.", timestamp: "2025-04-08T14:30:05Z" },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "telegram", messages);

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("channel: telegram");
    expect(content).toContain("message_count: 2");
    expect(content).toContain("### user");
    expect(content).toContain("Send email to John");
    expect(content).toContain("### assistant");
    expect(content).toContain("processed: false");
  });

  it("creates the logs directory if it doesn't exist", () => {
    const messages: LogMessage[] = [
      { role: "user", content: "Hello", timestamp: "2025-04-08T14:30:00Z" },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "cli", messages);

    expect(existsSync(TEST_LOGS_DIR)).toBe(true);
    expect(existsSync(filePath)).toBe(true);
  });

  it("includes metadata in frontmatter", () => {
    const messages: LogMessage[] = [
      { role: "user", content: "Test", timestamp: "2025-04-08T14:30:00Z" },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "whatsapp", messages, {
      agent: "my-agent",
      sessionId: "abc123",
    });

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("agent:");
    expect(content).toContain("sessionId:");
  });

  it("uses correct filename format", () => {
    const messages: LogMessage[] = [
      { role: "user", content: "Test", timestamp: "2025-04-08T14:30:00Z" },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "telegram", messages);

    const filename = filePath.split("/").pop()!;
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_telegram_raw\.md$/);
  });
});
