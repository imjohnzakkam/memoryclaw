import { describe, it, expect, vi, beforeEach } from "vitest";
import register from "../src/plugin.ts";
import type { OpenClawPluginApi, CommandContext } from "../src/plugin.ts";

function createMockApi(): OpenClawPluginApi & {
  _hooks: Map<string, { handler: Function; meta: { name: string; description: string } }>;
  _commands: Map<string, { handler: Function; description: string }>;
  _services: Map<string, { start: Function; stop: Function }>;
} {
  const hooks = new Map();
  const commands = new Map();
  const services = new Map();

  return {
    _hooks: hooks,
    _commands: commands,
    _services: services,
    registerHook(event: string, handler: Function, meta?: { name: string; description: string }) {
      hooks.set(event, { handler, meta: meta! });
    },
    registerCommand(opts: { name: string; description: string; handler: Function }) {
      commands.set(opts.name, { handler: opts.handler, description: opts.description });
    },
    registerService(opts: { id: string; start: Function; stop: Function }) {
      services.set(opts.id, { start: opts.start, stop: opts.stop });
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    config: {
      memoryclaw: {
        path: "/tmp/memoryclaw-test-plugin",
      },
    },
  };
}

function createMockApiWithLifecycle(): ReturnType<typeof createMockApi> & {
  _lifecycleHooks: Map<string, Function>;
} {
  const api = createMockApi() as ReturnType<typeof createMockApi> & {
    _lifecycleHooks: Map<string, Function>;
  };
  api._lifecycleHooks = new Map();
  api.on = (hookName: string, handler: Function) => {
    api._lifecycleHooks.set(hookName, handler);
  };
  return api;
}

describe("MemoryClaw OpenClaw Plugin", () => {
  let api: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    api = createMockApi();
    register(api);
  });

  it("registers the agent:beforeLLM hook", () => {
    expect(api._hooks.has("agent:beforeLLM")).toBe(true);
    expect(api._hooks.get("agent:beforeLLM")!.meta.name).toBe("memoryclaw.before-llm");
  });

  it("registers the agent:afterResponse hook", () => {
    expect(api._hooks.has("agent:afterResponse")).toBe(true);
    expect(api._hooks.get("agent:afterResponse")!.meta.name).toBe("memoryclaw.after-response");
  });

  it("registers the consolidation background service", () => {
    expect(api._services.has("memoryclaw-consolidation")).toBe(true);
  });

  it("registers /mclaw slash command", () => {
    expect(api._commands.has("mclaw")).toBe(true);
    expect(api._commands.get("mclaw")!.description).toContain("MemoryClaw");
  });

  it("registers /mclaw_forget slash command", () => {
    expect(api._commands.has("mclaw_forget")).toBe(true);
  });

  it("registers /mclaw_consolidate slash command", () => {
    expect(api._commands.has("mclaw_consolidate")).toBe(true);
  });

  it("/mclaw returns help for unknown subcommand", async () => {
    const cmd = api._commands.get("mclaw")!;
    const result = await cmd.handler({ args: "unknown" } as CommandContext);
    expect(result.text).toContain("MemoryClaw Commands");
  });

  it("/mclaw search without query returns usage", async () => {
    const cmd = api._commands.get("mclaw")!;
    const result = await cmd.handler({ args: "search" } as CommandContext);
    expect(result.text).toContain("Usage:");
  });

  it("/mclaw_forget without filename returns usage", async () => {
    const cmd = api._commands.get("mclaw_forget")!;
    const result = await cmd.handler({ args: "" } as CommandContext);
    expect(result.text).toContain("Usage:");
  });

  it("logs initialization message", () => {
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[memoryclaw] Initialized"),
    );
  });

  it("logs plugin registered message", () => {
    expect(api.logger.info).toHaveBeenCalledWith(
      "[memoryclaw] Plugin registered successfully",
    );
  });

  it("disables OpenClaw default memory when configured", () => {
    const apiWithCoreMemory = createMockApi();
    apiWithCoreMemory.config = {
      memory: { enabled: true },
      memoryclaw: {
        path: "/tmp/memoryclaw-test-plugin",
        disableDefaultMemory: true,
      },
    };

    register(apiWithCoreMemory);

    expect((apiWithCoreMemory.config!.memory as { enabled: boolean }).enabled).toBe(false);
    expect(apiWithCoreMemory.logger.info).toHaveBeenCalledWith(
      "[memoryclaw] Disabled OpenClaw default memory (memory.enabled=false)",
    );
  });

  it("beforeLLM hook returns params unchanged when no user messages", async () => {
    const hook = api._hooks.get("agent:beforeLLM")!;
    const params = { systemPrompt: "Hello", messages: [] };
    const result = await hook.handler(params);
    expect(result).toEqual(params);
  });

  it("consolidation service can be started and stopped", () => {
    const service = api._services.get("memoryclaw-consolidation")!;
    // Start shouldn't throw
    expect(() => service.start()).not.toThrow();
    // Stop shouldn't throw
    expect(() => service.stop()).not.toThrow();
  });

  it("registers lifecycle hooks when api.on is available", () => {
    const lifecycleApi = createMockApiWithLifecycle();
    register(lifecycleApi);

    expect(lifecycleApi._lifecycleHooks.has("before_agent_start")).toBe(true);
    expect(lifecycleApi._lifecycleHooks.has("agent_end")).toBe(true);
  });
});
