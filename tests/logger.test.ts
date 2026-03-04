import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { existsSync, readFileSync, rmSync } from "fs";
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

  it("uses human-readable filename format (no ISO T separator)", () => {
    const messages: LogMessage[] = [
      { role: "user", content: "Test", timestamp: "2025-04-08T14:30:00Z" },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "telegram", messages);

    const filename = filePath.split("/").pop()!;
    // Format: 2025-04-08_14-30-00_telegram_raw.md
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_telegram_raw\.md$/);
    expect(filename).not.toContain("T");
  });

  it("serializes object content instead of producing [object Object]", () => {
    // Simulate OpenClaw passing object content (the root cause of the bug)
    const messages: LogMessage[] = [
      {
        role: "assistant",
        content: { type: "text", text: "Hello from assistant" } as unknown as string,
        timestamp: "2025-04-08T14:30:05Z",
      },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "test", messages);
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("[object Object]");
    expect(content).toContain("Hello from assistant");
  });

  it("serializes array content blocks", () => {
    const messages: LogMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "First block" },
          { type: "text", text: "Second block" },
        ] as unknown as string,
        timestamp: "2025-04-08T14:30:05Z",
      },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "test", messages);
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("[object Object]");
    expect(content).toContain("First block");
    expect(content).toContain("Second block");
  });

  it("uses human-readable timestamps in message headers", () => {
    const messages: LogMessage[] = [
      { role: "user", content: "Test", timestamp: "2025-04-08T14:30:00Z" },
    ];

    const filePath = logInteraction(TEST_LOGS_DIR, "test", messages);
    const content = readFileSync(filePath, "utf-8");

    // Should show "2025-04-08 HH:MM" not raw ISO
    expect(content).toMatch(/### user \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/);
  });
});
