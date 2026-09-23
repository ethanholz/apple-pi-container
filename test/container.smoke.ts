import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import appleContainer from "../index.ts";

// Exercise the registered tools against a real Apple Container, without a model.
function loadExtension(project: string) {
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const commands = new Map<
    string,
    Parameters<ExtensionAPI["registerCommand"]>[1]
  >();
  const tools = new Map<string, ToolDefinition>();
  const pi = {
    registerFlag() {},
    getFlag: () => undefined,
    on: (name: string, handler: (...args: unknown[]) => unknown) =>
      events.set(name, handler),
    registerCommand: (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) =>
      commands.set(name, command),
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: project,
    isProjectTrusted: () => true,
    waitForIdle: async () => {},
    ui: {
      setStatus() {},
      notify() {},
      theme: { fg: (_color: string, text: string) => text },
    },
  } as unknown as ExtensionCommandContext;

  // The extension captures process.cwd() when it registers its tools.
  const previousCwd = process.cwd();
  try {
    process.chdir(project);
    appleContainer(pi);
  } finally {
    process.chdir(previousCwd);
  }

  return {
    start: async () => {
      await events.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    },
    command: async (args: string) => {
      const command = commands.get("apple-container");
      assert.ok(command);
      await command.handler(args, ctx);
    },
    tool: async (name: string, params: Record<string, unknown>) => {
      const tool = tools.get(name);
      assert.ok(tool, `missing ${name} tool`);
      return tool.execute("smoke", params, undefined, undefined, ctx);
    },
    shutdown: async () => {
      await events.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
    },
  };
}

// Run explicitly with `npm run test:smoke` on macOS with Apple Container installed.
test("tools route to the container when enabled and the host when disabled", async () => {
  assert.equal(process.platform, "darwin", "Apple Container requires macOS");
  const project = fs.mkdtempSync(path.join(tmpdir(), "apple-pi-smoke-"));
  let harness: ReturnType<typeof loadExtension> | undefined;
  try {
    const configDir = path.join(project, ".pi");
    fs.mkdirSync(configDir);
    fs.writeFileSync(
      path.join(configDir, "apple-container.json"),
      JSON.stringify({ image: "ubuntu:24.04", enabled: false, volumes: [] }),
    );
    fs.writeFileSync(path.join(project, "host.txt"), "from host");
    harness = loadExtension(project);
    await harness.start();
    await harness.command("on");

    const pwd = await harness.tool("bash", { command: "pwd" });
    assert.equal(pwd.content[0]?.type, "text");
    assert.equal(pwd.content[0].text.trim(), "/workspace");

    const read = await harness.tool("read", { path: "host.txt" });
    assert.equal(read.content[0]?.type, "text");
    assert.equal(read.content[0].text.trim(), "from host");

    await harness.tool("write", { path: "guest.txt", content: "from container" });
    assert.equal(fs.readFileSync(path.join(project, "guest.txt"), "utf8"), "from container");

    await harness.command("off");
    const hostPwd = await harness.tool("bash", { command: "pwd" });
    assert.equal(hostPwd.content[0]?.type, "text");
    assert.equal(hostPwd.content[0].text.trim(), fs.realpathSync(project));
  } finally {
    try {
      await harness?.shutdown();
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }
});
