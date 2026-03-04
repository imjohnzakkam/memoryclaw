import { describe, it, expect } from "vitest";
import {
  createWorkingMemory,
  updateWorkingMemory,
  addObservation,
  addFact,
  clearWorkingMemory,
  workingMemoryToPrompt,
  onBeforeLLM,
} from "../src/working-memory.ts";

describe("createWorkingMemory", () => {
  it("creates working memory with a goal", () => {
    const wm = createWorkingMemory("send email to John");
    expect(wm.goal).toBe("send email to John");
    expect(wm.plan).toEqual([]);
    expect(wm.facts).toEqual({});
    expect(wm.activeSkill).toBeNull();
  });
});

describe("updateWorkingMemory", () => {
  it("updates specific fields while preserving others", () => {
    const wm = createWorkingMemory("test");
    const updated = updateWorkingMemory(wm, {
      plan: ["step1", "step2"],
      activeSkill: "send_email",
    });

    expect(updated.goal).toBe("test");
    expect(updated.plan).toEqual(["step1", "step2"]);
    expect(updated.activeSkill).toBe("send_email");
  });
});

describe("addObservation", () => {
  it("appends observations", () => {
    let wm = createWorkingMemory("test");
    wm = addObservation(wm, "draft created");
    wm = addObservation(wm, "email sent");

    expect(wm.recentObservations).toEqual(["draft created", "email sent"]);
  });

  it("caps observations at max limit", () => {
    let wm = createWorkingMemory("test");
    for (let i = 0; i < 10; i++) {
      wm = addObservation(wm, `obs ${i}`, 3);
    }
    expect(wm.recentObservations.length).toBe(3);
    expect(wm.recentObservations[0]).toBe("obs 7");
  });
});

describe("addFact", () => {
  it("adds a fact to working memory", () => {
    let wm = createWorkingMemory("test");
    wm = addFact(wm, "recipient_email", "john@example.com");

    expect(wm.facts["recipient_email"]).toBe("john@example.com");
  });
});

describe("clearWorkingMemory", () => {
  it("resets all fields", () => {
    const wm = clearWorkingMemory();
    expect(wm.goal).toBe("");
    expect(wm.plan).toEqual([]);
    expect(wm.facts).toEqual({});
  });
});

describe("workingMemoryToPrompt", () => {
  it("generates a formatted prompt string", () => {
    let wm = createWorkingMemory("send email to John");
    wm = updateWorkingMemory(wm, {
      plan: ["get_recipient", "compose", "send"],
      activeSkill: "send_email",
      facts: { recipient_email: "john@example.com" },
      retrievedEpisodes: ["Previously sent project update to John"],
      retrievedFacts: { "contacts.md:John": "john@example.com" },
    });
    wm = addObservation(wm, "draft created");

    const prompt = workingMemoryToPrompt(wm);

    expect(prompt).toContain("send email to John");
    expect(prompt).toContain("get_recipient");
    expect(prompt).toContain("send_email");
    expect(prompt).toContain("john@example.com");
    expect(prompt).toContain("Previously sent project update");
    expect(prompt).toContain("draft created");
  });

  it("returns empty string for empty memory", () => {
    const wm = clearWorkingMemory();
    const prompt = workingMemoryToPrompt(wm);
    expect(prompt).toBe("");
  });
});

describe("onBeforeLLM", () => {
  it("injects working memory into system prompt", () => {
    const wm = createWorkingMemory("test goal");
    const result = onBeforeLLM(wm, "You are a helpful assistant.");

    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain("[MemoryClaw Working Memory]");
    expect(result).toContain("test goal");
  });

  it("returns original prompt when memory is empty", () => {
    const wm = clearWorkingMemory();
    const result = onBeforeLLM(wm, "You are a helpful assistant.");

    expect(result).toBe("You are a helpful assistant.");
  });
});
