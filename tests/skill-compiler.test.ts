import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { existsSync, readFileSync, mkdirSync, rmSync } from "fs";
import {
  compileSkill,
  writeSkillDraft,
  listSkills,
  approveSkill,
  rejectSkill,
} from "../src/skill-compiler.ts";
import type { ActionSequence } from "../src/types.ts";

const TEST_DIR = join(import.meta.dirname!, "..", "test-skills");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

const testPattern: ActionSequence = {
  actions: ["email", "john"],
  count: 7,
  sources: ["ep1.md", "ep2.md", "ep3.md"],
};

describe("compileSkill", () => {
  it("generates a skill template from an action pattern", () => {
    const skill = compileSkill(testPattern);

    expect(skill.name).toBe("email_john");
    expect(skill.triggers).toEqual(["email", "john"]);
    expect(skill.status).toBe("draft");
    expect(skill.parameters.length).toBeGreaterThan(0);
    expect(skill.steps.length).toBe(2);
    expect(skill.source).toContain("7 occurrences");
  });

  it("infers email-related parameters for email actions", () => {
    const skill = compileSkill(testPattern);
    const recipientParam = skill.parameters.find(
      (p) => p.name === "recipient",
    );
    expect(recipientParam).toBeDefined();
    expect(recipientParam!.type).toBe("email");
  });
});

describe("writeSkillDraft", () => {
  it("writes a draft skill JSON file", () => {
    const skill = compileSkill(testPattern);
    const filePath = writeSkillDraft(TEST_DIR, skill);

    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toContain(".draft.json");

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.status).toBe("draft");
    expect(content._meta.note).toContain("AUTO-GENERATED");
  });
});

describe("listSkills", () => {
  it("lists all skill files with status", () => {
    const skill = compileSkill(testPattern);
    writeSkillDraft(TEST_DIR, skill);

    const skills = listSkills(TEST_DIR);
    expect(skills.length).toBe(1);
    expect(skills[0]!.status).toBe("draft");
  });

  it("returns empty for nonexistent directory", () => {
    expect(listSkills("/nonexistent")).toEqual([]);
  });
});

describe("approveSkill", () => {
  it("promotes a draft to approved and removes draft file", () => {
    const skill = compileSkill(testPattern);
    writeSkillDraft(TEST_DIR, skill);

    const approved = approveSkill(TEST_DIR, "email_john.draft.json");
    expect(approved).toBe(true);

    // Draft should be gone, approved should exist
    expect(existsSync(join(TEST_DIR, "email_john.draft.json"))).toBe(false);
    expect(existsSync(join(TEST_DIR, "email_john.json"))).toBe(true);

    const content = JSON.parse(
      readFileSync(join(TEST_DIR, "email_john.json"), "utf-8"),
    );
    expect(content.status).toBe("approved");
  });

  it("returns false for nonexistent draft", () => {
    expect(approveSkill(TEST_DIR, "nonexistent.draft.json")).toBe(false);
  });
});

describe("rejectSkill", () => {
  it("marks a draft as rejected", () => {
    const skill = compileSkill(testPattern);
    writeSkillDraft(TEST_DIR, skill);

    const rejected = rejectSkill(TEST_DIR, "email_john.draft.json");
    expect(rejected).toBe(true);

    const content = JSON.parse(
      readFileSync(join(TEST_DIR, "email_john.draft.json"), "utf-8"),
    );
    expect(content.status).toBe("rejected");
  });
});
