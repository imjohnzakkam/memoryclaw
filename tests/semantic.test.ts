import { describe, it, expect } from "vitest";
import { join } from "path";
import { loadSemanticFiles, lookupSemantic } from "../src/semantic.ts";

const SEMANTIC_DIR = join(import.meta.dirname!, "..", "memoryclaw", "semantic");

describe("loadSemanticFiles", () => {
  it("loads specified semantic files", () => {
    const data = loadSemanticFiles(SEMANTIC_DIR, ["contacts.md", "projects.md"]);
    expect(data.size).toBe(2);
    expect(data.has("contacts.md")).toBe(true);
    expect(data.has("projects.md")).toBe(true);
  });
});

describe("lookupSemantic", () => {
  it("finds facts matching query entities", () => {
    const data = loadSemanticFiles(SEMANTIC_DIR, ["contacts.md"]);
    const facts = lookupSemantic(data, "email John");

    expect(Object.keys(facts).length).toBeGreaterThanOrEqual(1);
    expect(facts["contacts.md:John"]).toBe("john@example.com");
  });

  it("finds project facts", () => {
    const data = loadSemanticFiles(SEMANTIC_DIR, ["projects.md"]);
    const facts = lookupSemantic(data, "projectX deadline");

    expect(Object.keys(facts).length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for unmatched queries", () => {
    const data = loadSemanticFiles(SEMANTIC_DIR, ["contacts.md"]);
    const facts = lookupSemantic(data, "zzzznonexistent");

    expect(Object.keys(facts).length).toBe(0);
  });

  it("matches case-insensitively", () => {
    const data = loadSemanticFiles(SEMANTIC_DIR, ["contacts.md"]);
    const facts = lookupSemantic(data, "JOHN");

    expect(facts["contacts.md:John"]).toBe("john@example.com");
  });
});
