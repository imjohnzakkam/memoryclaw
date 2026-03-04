import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "fs";
import { updateSemanticMemory } from "../src/semantic-writer.ts";
import type { ExtractedFact } from "../src/types.ts";

const TEST_DIR = join(import.meta.dirname!, "..", "test-semantic");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(
    join(TEST_DIR, "contacts.md"),
    "# Contacts\n- John: john@example.com\n- Sarah: sarah@work.com\n",
  );
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("updateSemanticMemory", () => {
  it("appends new facts to matching semantic file", () => {
    const facts: ExtractedFact[] = [
      { entity: "John", field: "phone", value: "555-1234", confidence: "high" },
    ];

    const result = updateSemanticMemory(
      TEST_DIR,
      ["contacts.md"],
      facts,
      "test-log.md",
      true,
    );

    expect(result.added).toBe(1);
    const content = readFileSync(join(TEST_DIR, "contacts.md"), "utf-8");
    expect(content).toContain("John phone: 555-1234");
  });

  it("detects duplicate facts and skips them", () => {
    const facts: ExtractedFact[] = [
      { entity: "John", field: "", value: "john@example.com", confidence: "high" },
    ];

    const result = updateSemanticMemory(
      TEST_DIR,
      ["contacts.md"],
      facts,
      "test-log.md",
      true,
    );

    // "John" already exists with "john@example.com" — should skip
    expect(result.added).toBe(0);
  });

  it("detects conflicts and writes to _pending.md", () => {
    const facts: ExtractedFact[] = [
      { entity: "John", field: "", value: "john@newaddress.com", confidence: "high" },
    ];

    const result = updateSemanticMemory(
      TEST_DIR,
      ["contacts.md"],
      facts,
      "test-log.md",
      true,
    );

    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0]!.existingValue).toBe("john@example.com");
    expect(result.conflicts[0]!.newValue).toBe("john@newaddress.com");

    const pending = readFileSync(join(TEST_DIR, "_pending.md"), "utf-8");
    expect(pending).toContain("CONFLICT");
    expect(pending).toContain("john@newaddress.com");
  });

  it("sends low-confidence facts to _pending.md", () => {
    const facts: ExtractedFact[] = [
      { entity: "Mike", field: "email", value: "mike@maybe.com", confidence: "low" },
    ];

    const result = updateSemanticMemory(
      TEST_DIR,
      ["contacts.md"],
      facts,
      "test-log.md",
      true,
    );

    expect(result.pending).toBe(1);
    expect(existsSync(join(TEST_DIR, "_pending.md"))).toBe(true);
    const pending = readFileSync(join(TEST_DIR, "_pending.md"), "utf-8");
    expect(pending).toContain("mike@maybe.com");
    expect(pending).toContain("confidence: low");
  });

  it("puts unmatched entity facts into _pending.md", () => {
    const facts: ExtractedFact[] = [
      { entity: "NewPerson", field: "email", value: "new@test.com", confidence: "high" },
    ];

    const result = updateSemanticMemory(
      TEST_DIR,
      ["contacts.md"],
      facts,
      "test-log.md",
      true,
    );

    expect(result.pending).toBe(1);
  });
});
