#!/usr/bin/env node
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import type { AppContext } from "./types.js";
import { createDeprecationWatch } from "./lib/deprecation-watch.js";
import { listAllRules, readRule, rulesTools } from "./lib/rules.js";
import {
  specTools,
  specAnalyze,
  specAnalyzeSchema,
  anySpecInPhase,
} from "./lib/spec-tools.js";
import { threadHistoryTools } from "./lib/thread-history.js";
import { ttsTools } from "./lib/tts-tools.js";
import { upstreamTools } from "./lib/upstream-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, "..", "prompts");

// --- Feature groups (SUPER_DEV_DISABLE) ---
const disabledGroups = new Set(
  (process.env.SUPER_DEV_DISABLE || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const TOOL_GROUPS: Record<string, string> = {
  spec_create: "spec",
  spec_read: "spec",
  spec_status: "spec",
  spec_approve: "spec",
  spec_task_complete: "spec",
  spec_analyze: "spec",
  load_rules: "rules",
  thread_list: "threads",
  thread_read: "threads",
  thread_search: "threads",
  voice_mode: "voice",
  upstream_status: "upstream",
  upstream_categorize_changes: "upstream",
  upstream_resolve_file: "upstream",
  upstream_resolve_batch: "upstream",
  upstream_diff_file: "upstream",
  upstream_verify: "upstream",
  upstream_complete: "upstream",
  upstream_abort: "upstream",
};

const PROMPT_GROUPS: Record<string, string> = {
  "spec-plan": "spec",
  "spec-execute": "spec",
  "code-review": "review",
  design: "design",
  "design-review": "design",
  "toggle-voice-mode": "voice",
  "upstream-merge": "upstream",
};

function isToolEnabled(toolName: string): boolean {
  const group = TOOL_GROUPS[toolName];
  return !group || !disabledGroups.has(group);
}

function isPromptEnabled(promptName: string): boolean {
  const group = PROMPT_GROUPS[promptName];
  return !group || !disabledGroups.has(group);
}

if (disabledGroups.size > 0) {
  process.stderr.write(
    `[super-dev] disabled feature groups: ${[...disabledGroups].join(", ")}\n`,
  );
}

const server = new McpServer({
  name: "super-dev",
  version: "0.2.0",
});

let _resolvedProjectRoot: string | null = null;

/**
 * Whether we've successfully resolved a "good" project root (env var or
 * roots/list). When false, resolveProjectRoot() will keep retrying
 * roots/list on every tool call rather than caching a bad cwd fallback.
 */
let _rootIsConfirmed = false;

function looksLikeProjectRoot(p: string): boolean {
  const markers = [
    ".git",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "Makefile",
    ".specs",
    ".rules",
  ];
  return markers.some((m) => existsSync(join(p, m)));
}

function isUselessCwd(p: string): boolean {
  return p === "/" || p === process.env.HOME;
}

async function resolveProjectRoot(): Promise<string> {
  // If we have a confirmed-good root, return immediately.
  if (_resolvedProjectRoot && _rootIsConfirmed) return _resolvedProjectRoot;

  // 1. Env var — always trusted.
  if (process.env.SUPER_DEV_PROJECT_ROOT) {
    _resolvedProjectRoot = process.env.SUPER_DEV_PROJECT_ROOT;
    _rootIsConfirmed = true;
    return _resolvedProjectRoot;
  }

  // 2. MCP roots/list — retry on every call until it succeeds, because
  //    the client may not be ready on the first attempt.
  try {
    const result = await server.server.listRoots();
    if (result?.roots?.length > 0) {
      const rootUri = result.roots[0].uri;
      const rootPath = fileURLToPath(rootUri);
      if (existsSync(rootPath)) {
        _resolvedProjectRoot = rootPath;
        _rootIsConfirmed = true;
        process.stderr.write(
          `[super-dev] project root resolved via MCP roots/list: ${rootPath}\n`,
        );
        return _resolvedProjectRoot;
      }
    }
  } catch {
    // Client doesn't support roots/list (yet) — will retry next call.
  }

  // 3. Fallback to cwd — but refuse to use "/" or $HOME.
  const cwd = process.cwd();
  if (isUselessCwd(cwd)) {
    // Don't cache this — we want to retry roots/list on the next call.
    throw new Error(
      `Cannot determine project root. ` +
        `cwd is '${cwd}' which is not a project directory. ` +
        `Set SUPER_DEV_PROJECT_ROOT env var in your MCP server config ` +
        `to the absolute path of your project.`,
    );
  }

  if (!looksLikeProjectRoot(cwd)) {
    process.stderr.write(
      `[super-dev] WARNING: cwd '${cwd}' does not look like a project root ` +
        `(no .git, package.json, etc.). Tools may write files in the wrong location.\n` +
        `  Set SUPER_DEV_PROJECT_ROOT to override.\n`,
    );
  }

  _resolvedProjectRoot = cwd;
  _rootIsConfirmed = true;
  return _resolvedProjectRoot;
}

if (process.env.SUPER_DEV_PROJECT_ROOT) {
  _resolvedProjectRoot = process.env.SUPER_DEV_PROJECT_ROOT;
  _rootIsConfirmed = true;
}

/** Try to resolve the project root; returns an error ToolResult on failure, or null on success. */
async function ensureProjectRoot(): Promise<{
  content: [{ type: "text"; text: string }];
  isError: true;
} | null> {
  try {
    await resolveProjectRoot();
    return null;
  } catch (e: any) {
    return {
      content: [{ type: "text" as const, text: e.message }],
      isError: true,
    };
  }
}

const ctx: AppContext = {
  get projectRoot(): string {
    return _resolvedProjectRoot || process.cwd();
  },
};

const deprecationWatch = createDeprecationWatch({
  get projectRoot() {
    return ctx.projectRoot;
  },
  getClientInfo: () => (server.server as any).getClientVersion?.() ?? null,
});

// --- Prompts (slash commands) ---
const promptFiles = readdirSync(promptsDir).filter((f: string) =>
  f.endsWith(".md"),
);

for (const file of promptFiles) {
  const name = file.replace(".md", "");
  if (!isPromptEnabled(name)) continue;

  const content = readFileSync(join(promptsDir, file), "utf-8");
  const firstLine = content.split("\n")[0];
  const description = firstLine.startsWith("# ")
    ? firstLine.slice(2).trim()
    : name;

  server.registerPrompt(
    name,
    {
      title: description,
      description,
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: content },
        },
      ],
    }),
  );
}

// --- Tools ---
const UPSTREAM_ALWAYS_VISIBLE = new Set(["upstream_status"]);
const mergeToolHandles: Array<{ enable(): void; disable(): void }> = [];
let _mergeToolsEnabled = false;

function enableMergeTools(): void {
  if (_mergeToolsEnabled) return;
  _mergeToolsEnabled = true;
  for (const handle of mergeToolHandles) handle.enable();
}

function disableMergeTools(): void {
  if (!_mergeToolsEnabled) return;
  _mergeToolsEnabled = false;
  for (const handle of mergeToolHandles) handle.disable();
}

function syncMergeToolVisibility(): void {
  // Check new location first
  const newStateFile = join(ctx.projectRoot, ".upstream", "merge-state.json");
  // Also check legacy location for backward compatibility
  const legacyStateFile = join(ctx.projectRoot, ".upstream-merge-state.json");
  
  if (existsSync(newStateFile) || existsSync(legacyStateFile)) {
    enableMergeTools();
  }
}

// --- spec_analyze: dynamic visibility (hidden until a spec is in requirements phase) ---
const PHASE_CHANGING_SPEC_TOOLS = new Set([
  "spec_create",
  "spec_status",
  "spec_approve",
]);

let _analyzeHandle: { enable(): void; disable(): void } | null = null;
let _analyzeEnabled = false;

function syncAnalyzeVisibility(): void {
  if (!_analyzeHandle) return;
  const shouldEnable = anySpecInPhase(ctx.projectRoot, "requirements");
  if (shouldEnable && !_analyzeEnabled) {
    _analyzeHandle.enable();
    _analyzeEnabled = true;
  } else if (!shouldEnable && _analyzeEnabled) {
    _analyzeHandle.disable();
    _analyzeEnabled = false;
  }
}

// Tools that need the project root resolved before running.
for (const tool of [...specTools, ...rulesTools]) {
  if (!isToolEnabled(tool.name)) continue;

  // spec_analyze is registered separately with dynamic visibility
  if (tool.name === "spec_analyze") continue;

  const needsVisibilitySync = PHASE_CHANGING_SPEC_TOOLS.has(tool.name);

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args) => {
      const rootErr = await ensureProjectRoot();
      if (rootErr) return rootErr;
      const result = await tool.handler(args as Record<string, unknown>, ctx);
      if (needsVisibilitySync) syncAnalyzeVisibility();
      return result as any;
    },
  );
}

// Register spec_analyze as disabled-by-default
if (isToolEnabled("spec_analyze")) {
  const handle = server.registerTool(
    "spec_analyze",
    {
      description:
        "Analyze requirements for ambiguity, conflicts, completeness gaps, solution leakage, and testability. Returns requirements content with an analysis rubric for the agent to follow. Use during requirements phase before approval.",
      inputSchema: specAnalyzeSchema,
    },
    async (args) => {
      const rootErr = await ensureProjectRoot();
      if (rootErr) return rootErr;
      return specAnalyze(args as { name: string }, ctx) as any;
    },
  );
  handle.disable();
  _analyzeHandle = handle;
}

// Tools that do NOT need the project root.
for (const tool of [...threadHistoryTools, ...ttsTools]) {
  if (!isToolEnabled(tool.name)) continue;

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args) => tool.handler(args as Record<string, unknown>, ctx) as any,
  );
}

for (const tool of upstreamTools) {
  if (!isToolEnabled(tool.name)) continue;

  const isMergeOnly = !UPSTREAM_ALWAYS_VISIBLE.has(tool.name);

  let wrappedHandler: (args: Record<string, unknown>) => Promise<any>;
  if (tool.name === "upstream_status") {
    wrappedHandler = async (args) => {
      const rootErr = await ensureProjectRoot();
      if (rootErr) return rootErr;
      syncMergeToolVisibility();
      const result = await tool.handler(args as Record<string, unknown>, ctx);
      // If start_merge was used, enable merge tools
      if (args.start_merge) enableMergeTools();
      return result;
    };
  } else if (
    tool.name === "upstream_complete" ||
    tool.name === "upstream_abort"
  ) {
    wrappedHandler = async (args) => {
      const rootErr = await ensureProjectRoot();
      if (rootErr) return rootErr;
      const result = await tool.handler(args, ctx);
      disableMergeTools();
      return result;
    };
  } else {
    wrappedHandler = async (args) => {
      const rootErr = await ensureProjectRoot();
      if (rootErr) return rootErr;
      return tool.handler(args, ctx);
    };
  }

  const handle = server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
    },
    wrappedHandler,
  );

  if (isMergeOnly) {
    handle.disable();
    mergeToolHandles.push(handle);
  }
}

// --- Resources ---
if (!disabledGroups.has("rules")) {
  server.registerResource(
    "rule",
    new ResourceTemplate("rule://{name}", {
      list: async () => {
        deprecationWatch.onResourcesUsed();
        await resolveProjectRoot();
        return {
          resources: listAllRules(ctx.projectRoot).map((rule) => ({
            uri: `rule://${rule.name}`,
            name: rule.name,
            description:
              rule.description ||
              `Project rule: ${rule.name} (inclusion: ${rule.inclusion})`,
            mimeType: "text/markdown" as const,
          })),
        };
      },
    }),
    {
      title: "Project rule",
      description: "A rule loaded from .rules/ in the consuming project",
      mimeType: "text/markdown",
    },
    async (uri, { name }) => {
      deprecationWatch.onResourcesUsed();
      await resolveProjectRoot();
      const rule = readRule(ctx.projectRoot, name as string);
      if (!rule) {
        throw new Error(`Rule not found: ${name}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown" as const,
            text: rule.body,
          },
        ],
      };
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
