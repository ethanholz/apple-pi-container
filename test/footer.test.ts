import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

test("footer shows the configured Dockerfile value verbatim", async () => {
  const originalCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(tmpdir(), "apple-container-footer-"));
  fs.mkdirSync(path.join(root, ".pi"));
  try {
    process.chdir(root);
    let onStart: (event: unknown, ctx: ExtensionContext) => Promise<void>;
    let status: string | undefined;
    let imageFlag: string | undefined;
    extension({
      registerFlag() {},
      registerCommand() {},
      registerTool() {},
      getFlag: () => imageFlag,
      on(event: string, handler: typeof onStart) {
        if (event === "session_start") onStart = handler;
      },
    } as unknown as ExtensionAPI);
    const ctx = {
      cwd: process.cwd(),
      isProjectTrusted: () => true,
      ui: {
        theme: { fg: (_color: string, text: string) => text },
        setStatus: (_key: string, text: string | undefined) => (status = text),
      },
    } as unknown as ExtensionContext;

    for (const dockerfile of [
      "../Dockerfile",
      "../docker/Dockerfile",
      "./nested/../Dockerfile.dev",
    ]) {
      fs.writeFileSync(
        path.join(root, ".pi", "apple-container.json"),
        JSON.stringify({ dockerfile, enabled: false, volumes: [] }),
      );
      await onStart!({}, ctx);
      assert.equal(status, `🍎 π: disabled (${dockerfile})`);
    }

    imageFlag = "registry.example.com/team/image:latest";
    await onStart!({}, ctx);
    assert.equal(status, `🍎 π: disabled (${imageFlag})`);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
