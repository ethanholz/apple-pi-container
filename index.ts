// Route pi's built-in tools through an Apple Container Linux VM.
//
// Usage:
//   cd /path/to/project
//   pi -e /Users/ethan/apple-container-pi-extension --apple-container-image ubuntu:24.04
//
// Requires Apple Container: https://github.com/apple/container

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  DEFAULT_MAX_BYTES,
  type EditOperations,
  type FindOperations,
  formatSize,
  type GrepToolDetails,
  type GrepToolInput,
  type LsOperations,
  type ReadOperations,
  truncateHead,
  truncateLine,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";

const GUEST_WORKSPACE = "/workspace";
const DEFAULT_IMAGE = "docker.io/library/ubuntu:24.04";
const DEFAULT_GREP_LIMIT = 100;

type TextToolResult<TDetails> = {
  content: Array<{ type: "text"; text: string }>;
  details: TDetails | undefined;
};

type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  onData?: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  allowFailure?: boolean;
};

type ExecResult = { stdout: Buffer; stderr: Buffer; exitCode: number | null };

function run(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("aborted"));

    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => child.kill("SIGKILL");
    const timer = options.timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeout * 1000)
      : undefined;

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (data: Buffer) => {
      stdout.push(data);
      options.onData?.(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr.push(data);
      options.onData?.(data);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode) =>
      finish(() => {
        if (options.signal?.aborted) return reject(new Error("aborted"));
        if (timedOut) return reject(new Error(`timeout:${options.timeout}`));
        const result = {
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          exitCode,
        };
        if (exitCode !== 0 && !options.allowFailure) {
          const message =
            result.stderr.toString().trim() || result.stdout.toString().trim();
          return reject(
            new Error(
              `${command} exited with ${exitCode}${message ? `: ${message}` : ""}`,
            ),
          );
        }
        resolve(result);
      }),
    );
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

class AppleContainer {
  constructor(readonly id: string) {}

  exec(args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const execArgs = ["exec"];
    if (options.cwd) execArgs.push("--workdir", options.cwd);
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (typeof value === "string") execArgs.push("--env", `${key}=${value}`);
    }
    if (options.input !== undefined) execArgs.push("--interactive");
    execArgs.push(this.id, ...args);
    return run("container", execArgs, options);
  }

  async close(): Promise<void> {
    await run("container", ["delete", "--force", this.id], {
      allowFailure: true,
    });
  }
}

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function isInsideHostPath(root: string, value: string): boolean {
  const relativePath = path.relative(root, value);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function toGuestPath(localCwd: string, inputPath: string): string {
  const trimmed = stripAtPrefix(inputPath.trim());
  if (!trimmed) return GUEST_WORKSPACE;
  if (path.isAbsolute(trimmed)) {
    if (isInsideHostPath(localCwd, trimmed)) {
      const relativePath = path.relative(localCwd, trimmed);
      return relativePath
        ? path.posix.join(GUEST_WORKSPACE, toPosix(relativePath))
        : GUEST_WORKSPACE;
    }
    return path.posix.resolve("/", toPosix(trimmed));
  }
  return path.posix.resolve(GUEST_WORKSPACE, toPosix(trimmed));
}

async function testPath(
  container: AppleContainer,
  operator: "-e" | "-d" | "-r",
  guestPath: string,
): Promise<boolean> {
  const result = await container.exec(
    ["/bin/sh", "-c", `test ${operator} "$1"`, "--", guestPath],
    {
      allowFailure: true,
    },
  );
  return result.exitCode === 0;
}

function createContainerReadOps(
  container: AppleContainer,
  localCwd: string,
): ReadOperations {
  return {
    readFile: async (filePath) =>
      (await container.exec(["cat", "--", toGuestPath(localCwd, filePath)]))
        .stdout,
    access: async (filePath) => {
      if (!(await testPath(container, "-r", toGuestPath(localCwd, filePath))))
        throw new Error(`Cannot read ${filePath}`);
    },
    detectImageMimeType: async (filePath) => {
      const ext = path.posix
        .extname(toGuestPath(localCwd, filePath))
        .toLowerCase();
      if (ext === ".png") return "image/png";
      if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
      if (ext === ".gif") return "image/gif";
      if (ext === ".webp") return "image/webp";
      return null;
    },
  };
}

function createContainerWriteOps(
  container: AppleContainer,
  localCwd: string,
): WriteOperations {
  return {
    writeFile: async (filePath, content) => {
      await container.exec(
        ["/bin/sh", "-c", 'cat > "$1"', "--", toGuestPath(localCwd, filePath)],
        { input: content },
      );
    },
    mkdir: async (dirPath) => {
      await container.exec([
        "mkdir",
        "-p",
        "--",
        toGuestPath(localCwd, dirPath),
      ]);
    },
  };
}

function createContainerEditOps(
  container: AppleContainer,
  localCwd: string,
): EditOperations {
  const read = createContainerReadOps(container, localCwd);
  const write = createContainerWriteOps(container, localCwd);
  return {
    readFile: read.readFile,
    access: read.access,
    writeFile: write.writeFile,
  };
}

function createContainerLsOps(
  container: AppleContainer,
  localCwd: string,
): LsOperations {
  return {
    exists: (filePath) =>
      testPath(container, "-e", toGuestPath(localCwd, filePath)),
    stat: async (filePath) => {
      const guestPath = toGuestPath(localCwd, filePath);
      if (!(await testPath(container, "-e", guestPath)))
        throw new Error(`Path not found: ${filePath}`);
      const directory = await testPath(container, "-d", guestPath);
      return { isDirectory: () => directory };
    },
    readdir: async (dirPath) => {
      const result = await container.exec([
        "find",
        toGuestPath(localCwd, dirPath),
        "-mindepth",
        "1",
        "-maxdepth",
        "1",
        "-printf",
        "%f\\0",
      ]);
      return result.stdout.toString().split("\0").filter(Boolean);
    },
  };
}

async function listGuestFiles(
  container: AppleContainer,
  root: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await container.exec(
    [
      "find",
      root,
      "-type",
      "d",
      "(",
      "-name",
      ".git",
      "-o",
      "-name",
      "node_modules",
      ")",
      "-prune",
      "-o",
      "-type",
      "f",
      "-print0",
    ],
    { signal },
  );
  return result.stdout.toString().split("\0").filter(Boolean);
}

function matchesToolGlob(relativePath: string, pattern: string): boolean {
  const normalizedPattern = toPosix(pattern);
  if (normalizedPattern.includes("/")) {
    return (
      path.posix.matchesGlob(relativePath, normalizedPattern) ||
      path.posix.matchesGlob(relativePath, `**/${normalizedPattern}`)
    );
  }
  return path.posix.matchesGlob(
    path.posix.basename(relativePath),
    normalizedPattern,
  );
}

function createContainerFindOps(
  container: AppleContainer,
  localCwd: string,
): FindOperations {
  return {
    exists: (filePath) =>
      testPath(container, "-e", toGuestPath(localCwd, filePath)),
    glob: async (pattern, cwd, options) => {
      const root = toGuestPath(localCwd, cwd);
      const results: string[] = [];
      for (const guestPath of await listGuestFiles(container, root)) {
        const relativePath = path.posix.relative(root, guestPath);
        if (matchesToolGlob(relativePath, pattern)) results.push(guestPath);
        if (results.length >= options.limit) break;
      }
      return results;
    },
  };
}

function createLineMatcher(
  pattern: string,
  literal: boolean | undefined,
  ignoreCase: boolean | undefined,
) {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    return (line: string) =>
      (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
  const regex = new RegExp(pattern, ignoreCase ? "i" : undefined);
  return (line: string) => regex.test(line);
}

function appendGrepBlock(params: {
  outputLines: string[];
  lines: string[];
  relativePath: string;
  lineIndex: number;
  contextLines: number;
}): boolean {
  let linesTruncated = false;
  const start =
    params.contextLines > 0
      ? Math.max(0, params.lineIndex - params.contextLines)
      : params.lineIndex;
  const end =
    params.contextLines > 0
      ? Math.min(
          params.lines.length - 1,
          params.lineIndex + params.contextLines,
        )
      : params.lineIndex;
  for (let index = start; index <= end; index++) {
    const { text, wasTruncated } = truncateLine(
      (params.lines[index] ?? "").replace(/\r/g, ""),
    );
    if (wasTruncated) linesTruncated = true;
    const separator = index === params.lineIndex ? ":" : "-";
    params.outputLines.push(
      `${params.relativePath}${separator}${index + 1}${separator} ${text}`,
    );
  }
  return linesTruncated;
}

async function executeContainerGrep(
  container: AppleContainer,
  localCwd: string,
  params: GrepToolInput,
  signal?: AbortSignal,
): Promise<TextToolResult<GrepToolDetails>> {
  const root = toGuestPath(localCwd, params.path ?? ".");
  const rootIsDirectory = await testPath(container, "-d", root);
  if (!rootIsDirectory && !(await testPath(container, "-e", root)))
    throw new Error(`Path not found: ${params.path ?? "."}`);
  const files = rootIsDirectory
    ? await listGuestFiles(container, root, signal)
    : [root];
  const matcher = createLineMatcher(
    params.pattern,
    params.literal,
    params.ignoreCase,
  );
  const contextLines =
    params.context && params.context > 0 ? params.context : 0;
  const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
  const outputLines: string[] = [];
  const details: GrepToolDetails = {};
  let matchCount = 0;
  let linesTruncated = false;

  for (const guestPath of files) {
    if (signal?.aborted) throw new Error("Operation aborted");
    const relativePath = rootIsDirectory
      ? path.posix.relative(root, guestPath)
      : path.posix.basename(guestPath);
    if (params.glob && !matchesToolGlob(relativePath, params.glob)) continue;
    const result = await container.exec(["cat", "--", guestPath], {
      signal,
      allowFailure: true,
    });
    if (result.exitCode !== 0) continue;
    const lines = result.stdout
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!matcher(lines[index] ?? "")) continue;
      matchCount++;
      if (
        appendGrepBlock({
          outputLines,
          lines,
          relativePath,
          lineIndex: index,
          contextLines,
        })
      )
        linesTruncated = true;
      if (matchCount >= effectiveLimit) break;
    }
    if (matchCount >= effectiveLimit) break;
  }

  if (matchCount === 0)
    return {
      content: [{ type: "text", text: "No matches found" }],
      details: undefined,
    };
  const truncation = truncateHead(outputLines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  const notices: string[] = [];
  let output = truncation.content;
  if (matchCount >= effectiveLimit) {
    details.matchLimitReached = effectiveLimit;
    notices.push(`${effectiveLimit} matches limit reached`);
  }
  if (linesTruncated) {
    details.linesTruncated = true;
    notices.push("long lines truncated");
  }
  if (truncation.truncated) {
    details.truncation = truncation;
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  }
  if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
  return {
    content: [{ type: "text", text: output }],
    details: Object.keys(details).length ? details : undefined,
  };
}

function createContainerBashOps(
  container: AppleContainer,
  localCwd: string,
  shellPath: string,
): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      const result = await container.exec([shellPath, "-lc", command], {
        cwd: toGuestPath(localCwd, cwd),
        env: options.env,
        onData: options.onData,
        signal: options.signal,
        timeout: options.timeout,
        allowFailure: true,
      });
      return { exitCode: result.exitCode };
    },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("apple-container-image", {
    description: `Apple Container image (default: ${DEFAULT_IMAGE})`,
    type: "string",
  });

  const localCwd = process.cwd();
  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);
  const localGrep = createGrepTool(localCwd);
  const localFind = createFindTool(localCwd);
  const localLs = createLsTool(localCwd);
  let container: AppleContainer | undefined;
  let starting: Promise<AppleContainer> | undefined;
  let shellPath = "/bin/sh";
  let image = DEFAULT_IMAGE;

  async function startContainer(
    ctx?: ExtensionContext,
  ): Promise<AppleContainer> {
    if (process.platform !== "darwin")
      throw new Error("Apple Container requires macOS");
    image =
      (pi.getFlag("apple-container-image") as string | undefined) ||
      DEFAULT_IMAGE;
    ctx?.ui.setStatus(
      "apple-container",
      ctx.ui.theme.fg("accent", "Apple Container: starting"),
    );
    const id = `pi-${randomUUID().slice(0, 12)}`;
    try {
      const skillsDir = path.join(homedir(), ".pi", "agent", "skills");
      const args = [
        "run",
        "--detach",
        "--name",
        id,
        "--mount",
        `type=bind,source=${localCwd},target=${GUEST_WORKSPACE}`,
      ];
      if (existsSync(skillsDir)) {
        args.push(
          "--mount",
          `type=bind,source=${skillsDir},target=${toPosix(skillsDir)},readonly`,
        );
      }
      args.push("--workdir", GUEST_WORKSPACE, image, "sleep", "infinity");
      await run("container", args);
      const created = new AppleContainer(id);
      const probe = await created.exec([
        "/bin/sh",
        "-lc",
        "command -v bash || true",
      ]);
      shellPath = probe.stdout.toString().trim() || "/bin/sh";
      container = created;
      ctx?.ui.setStatus(
        "apple-container",
        ctx.ui.theme.fg(
          "accent",
          `Apple Container: ${id} (${GUEST_WORKSPACE})`,
        ),
      );
      ctx?.ui.notify(
        `Apple Container ready. ${localCwd} is mounted at ${GUEST_WORKSPACE}.`,
        "info",
      );
      return created;
    } catch (error) {
      await run("container", ["delete", "--force", id], { allowFailure: true });
      ctx?.ui.setStatus("apple-container", undefined);
      throw error;
    }
  }

  async function ensureContainer(
    ctx?: ExtensionContext,
  ): Promise<AppleContainer> {
    if (container) return container;
    if (!starting)
      starting = startContainer(ctx).finally(() => (starting = undefined));
    return starting;
  }

  pi.on("session_start", async (_event, ctx) => {
    await ensureContainer(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const active = container ?? (await starting?.catch(() => undefined));
    container = undefined;
    starting = undefined;
    if (!active) return;
    ctx.ui.setStatus(
      "apple-container",
      ctx.ui.theme.fg("muted", "Apple Container: stopping"),
    );
    try {
      await active.close();
    } finally {
      ctx.ui.setStatus("apple-container", undefined);
    }
  });

  pi.registerCommand("apple-container", {
    description: "Show Apple Container status",
    handler: async (_args, ctx) => {
      const active = await ensureContainer(ctx);
      ctx.ui.notify(
        [
          `Apple Container: ${active.id}`,
          `Image: ${image}`,
          `Host workspace: ${localCwd}`,
          `Guest workspace: ${GUEST_WORKSPACE}`,
          `Shell: ${shellPath}`,
        ].join("\n"),
        "info",
      );
    },
  });

  pi.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await ensureContainer(ctx);
      return createReadTool(GUEST_WORKSPACE, {
        operations: createContainerReadOps(active, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });
  pi.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await ensureContainer(ctx);
      return createWriteTool(GUEST_WORKSPACE, {
        operations: createContainerWriteOps(active, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });
  pi.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await ensureContainer(ctx);
      return createEditTool(GUEST_WORKSPACE, {
        operations: createContainerEditOps(active, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });
  pi.registerTool({
    ...localBash,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await ensureContainer(ctx);
      return createBashTool(GUEST_WORKSPACE, {
        operations: createContainerBashOps(active, localCwd, shellPath),
      }).execute(id, params, signal, onUpdate);
    },
  });
  pi.registerTool({
    ...localLs,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await ensureContainer(ctx);
      return createLsTool(GUEST_WORKSPACE, {
        operations: createContainerLsOps(active, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });
  pi.registerTool({
    ...localFind,
    async execute(id, params, signal, onUpdate, ctx) {
      const active = await ensureContainer(ctx);
      return createFindTool(GUEST_WORKSPACE, {
        operations: createContainerFindOps(active, localCwd),
      }).execute(id, params, signal, onUpdate);
    },
  });
  pi.registerTool({
    ...localGrep,
    async execute(_id, params, signal, _onUpdate, ctx) {
      return executeContainerGrep(
        await ensureContainer(ctx),
        localCwd,
        params,
        signal,
      );
    },
  });

  pi.on("user_bash", async (_event, ctx) => {
    const active = await ensureContainer(ctx);
    return { operations: createContainerBashOps(active, localCwd, shellPath) };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    await ensureContainer(ctx);
    const localLine = `Current working directory: ${localCwd}`;
    const guestLine = `Current working directory: ${GUEST_WORKSPACE} (Apple Container; host workspace mounted from ${localCwd})`;
    return {
      systemPrompt: event.systemPrompt.includes(localLine)
        ? event.systemPrompt.replace(localLine, guestLine)
        : `${event.systemPrompt}\n\n${guestLine}`,
    };
  });
}
