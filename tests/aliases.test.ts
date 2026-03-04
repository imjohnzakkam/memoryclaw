import { describe, it, expect } from "vitest";
import { join } from "path";
import { loadAliases, expandKeywords } from "../src/aliases.ts";

const ALIAS_PATH = join(
  import.meta.dirname!,
  "..",
  "memoryclaw",
  "semantic",
  "aliases.yaml",
);

describe("loadAliases", () => {
  it("loads alias mappings from YAML file", () => {
    const aliases = loadAliases(ALIAS_PATH);
    expect(aliases.size).toBeGreaterThan(0);
    expect(aliases.get("budget")).toContain("finance");
  });

  it("creates bidirectional mappings", () => {
    const aliases = loadAliases(ALIAS_PATH);
    // finance → budget (reverse mapping)
    expect(aliases.get("finance")).toContain("budget");
  });

  it("returns empty map for nonexistent file", () => {
    const aliases = loadAliases("/nonexistent/aliases.yaml");
    expect(aliases.size).toBe(0);
  });
});

describe("expandKeywords", () => {
  it("expands keywords using alias mappings", () => {
    const aliases = loadAliases(ALIAS_PATH);
    const expanded = expandKeywords(["budget"], aliases);

    expect(expanded).toContain("budget");
    expect(expanded).toContain("finance");
    expect(expanded).toContain("spending");
  });

  it("preserves original keywords when no aliases exist", () => {
    const aliases = loadAliases(ALIAS_PATH);
    const expanded = expandKeywords(["nonexistent"], aliases);

    expect(expanded).toEqual(["nonexistent"]);
  });

  it("deduplicates expanded keywords", () => {
    const aliases = loadAliases(ALIAS_PATH);
    const expanded = expandKeywords(["budget", "finance"], aliases);

    const unique = new Set(expanded);
    expect(expanded.length).toBe(unique.size);
  });

  it("returns empty array for empty input", () => {
    const aliases = loadAliases(ALIAS_PATH);
    expect(expandKeywords([], aliases)).toEqual([]);
  });
});
