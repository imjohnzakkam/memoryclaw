import { describe, it, expect } from "vitest";
import { extractKeywords } from "../src/keywords.ts";

describe("extractKeywords", () => {
  it("extracts meaningful words and removes stop words", () => {
    const result = extractKeywords("send an email to John about the project");
    expect(result).toContain("send");
    expect(result).toContain("email");
    expect(result).toContain("john");
    expect(result).toContain("project");
    expect(result).not.toContain("an");
    expect(result).not.toContain("to");
    expect(result).not.toContain("the");
  });

  it("normalizes to lowercase", () => {
    const result = extractKeywords("Email John");
    expect(result).toEqual(["email", "john"]);
  });

  it("strips punctuation", () => {
    const result = extractKeywords("what's John's email?");
    expect(result).toContain("john");
    expect(result).toContain("email");
  });

  it("filters out single-character words", () => {
    const result = extractKeywords("a b c hello world");
    expect(result).toEqual(["hello", "world"]);
  });

  it("returns empty array for empty input", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("returns empty array for stop-words-only input", () => {
    expect(extractKeywords("the a is are")).toEqual([]);
  });

  it("handles hyphenated words", () => {
    const result = extractKeywords("Q3-review budget");
    expect(result).toContain("q3-review");
    expect(result).toContain("budget");
  });
});
