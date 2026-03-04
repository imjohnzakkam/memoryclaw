import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import type { ActionSequence, SkillTemplate, SkillParameter, SkillStep } from "./types.ts";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

function inferParameters(actions: string[]): SkillParameter[] {
  const params: SkillParameter[] = [];
  const seen = new Set<string>();

  for (const action of actions) {
    // Common parameter patterns based on action tags
    if (
      (action === "email" || action === "mail" || action === "message") &&
      !seen.has("recipient")
    ) {
      params.push({
        name: "recipient",
        type: "email",
        source: "semantic or user",
        optional: false,
      });
      seen.add("recipient");
    }
    if (
      (action === "meeting" || action === "standup" || action === "call") &&
      !seen.has("time")
    ) {
      params.push({
        name: "time",
        type: "datetime",
        source: "user",
        optional: false,
      });
      seen.add("time");
    }
    if (
      (action === "travel" || action === "flight" || action === "booking") &&
      !seen.has("destination")
    ) {
      params.push({
        name: "destination",
        type: "string",
        source: "user",
        optional: false,
      });
      seen.add("destination");
    }
  }

  // Always include a generic "subject" param if nothing specific was found
  if (params.length === 0) {
    params.push({
      name: "subject",
      type: "string",
      source: "user",
      optional: false,
    });
  }

  return params;
}

function inferSteps(actions: string[]): SkillStep[] {
  return actions.map((action) => ({
    action: `call_tool`,
    params: { tool: `${action}_api`, input: `$${action}_input` },
  }));
}

export function compileSkill(pattern: ActionSequence): SkillTemplate {
  const name = slugify(pattern.actions.join(" "));
  const parameters = inferParameters(pattern.actions);
  const steps = inferSteps(pattern.actions);

  return {
    name,
    triggers: pattern.actions,
    status: "draft",
    parameters,
    steps,
    source: `Detected from ${pattern.count} occurrences in: ${pattern.sources.join(", ")}`,
    createdAt: new Date().toISOString(),
  };
}

function skillToJson(skill: SkillTemplate): string {
  return JSON.stringify(
    {
      name: skill.name,
      status: skill.status,
      triggers: skill.triggers,
      // TODO: Review and customize these parameters
      preconditions: Object.fromEntries(
        skill.parameters.map((p) => [
          p.name,
          { type: p.type, source: p.source, optional: p.optional },
        ]),
      ),
      // TODO: Review and customize these steps
      steps: skill.steps,
      _meta: {
        source: skill.source,
        createdAt: skill.createdAt,
        note: "AUTO-GENERATED DRAFT — Review before approving",
      },
    },
    null,
    2,
  );
}

export function writeSkillDraft(
  skillsDir: string,
  skill: SkillTemplate,
): string {
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }

  const filename = `${skill.name}.draft.json`;
  const filePath = join(skillsDir, filename);
  writeFileSync(filePath, skillToJson(skill), { mode: 0o600 });
  return filePath;
}

export function listSkills(
  skillsDir: string,
): { file: string; name: string; status: string }[] {
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const content = JSON.parse(readFileSync(join(skillsDir, f), "utf-8"));
        return {
          file: f,
          name: content.name ?? f,
          status: content.status ?? "unknown",
        };
      } catch {
        return { file: f, name: f, status: "error" };
      }
    });
}

export function approveSkill(skillsDir: string, draftFile: string): boolean {
  const draftPath = join(skillsDir, draftFile);
  if (!existsSync(draftPath)) return false;

  const content = JSON.parse(readFileSync(draftPath, "utf-8"));
  content.status = "approved";

  const approvedFile = draftFile.replace(".draft.json", ".json");
  const approvedPath = join(skillsDir, approvedFile);

  writeFileSync(approvedPath, JSON.stringify(content, null, 2), {
    mode: 0o600,
  });

  unlinkSync(draftPath);

  return true;
}

export function rejectSkill(skillsDir: string, draftFile: string): boolean {
  const draftPath = join(skillsDir, draftFile);
  if (!existsSync(draftPath)) return false;

  const content = JSON.parse(readFileSync(draftPath, "utf-8"));
  content.status = "rejected";
  writeFileSync(draftPath, JSON.stringify(content, null, 2));

  return true;
}
