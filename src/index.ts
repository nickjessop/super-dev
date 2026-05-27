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
import { specTools } from "./lib/spec-tools.js";
import { threadHistoryTools } from "./lib/thread-history.js";
import { ttsTools } from "./lib/tts-tools.js";
import { upstreamTools } from "./lib/upstream-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, "..", "prompts");

const server = new McpServer({
  name: "super-dev",
  version: "0.2.0",
});

let _resolvedProjectRoot: string | null = null;

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

async function resolveProjectRoot(): Promise<string> {
  if (_resolvedProjectRoot) return _resolvedProjectRoot;

  if (process.env.SUPER_DEV_PROJECT_ROOT) {
    _resolvedProjectRoot = process.env.SUPER_DEV_PROJECT_ROOT;
    return _resolvedProjectRoot;
  }

  try {
    const result = await server.server.listRoots();
    if (result?.roots?.length > 0) {
      const rootUri = result.roots[0].uri;
      const rootPath = fileURLToPath(rootUri);
      if (existsSync(rootPath)) {
        _resolvedProjectRoot = rootPath;
        process.stderr.write(
          `[super-dev] project root resolved via MCP roots/list: ${rootPath}\n`,
        );
        return _resolvedProjectRoot;
      }
    }
  } catch {
    // Client doesn't support roots/list
  }

  const cwd = process.cwd();
  if (cwd === "/" || cwd === process.env.HOME) {
    process.stderr.write(
      `[super-dev] WARNING: cwd is '${cwd}' which is unlikely to be a project root.\n` +
        `  Set SUPER_DEV_PROJECT_ROOT or use a client that supports MCP roots/list.\n`,
    );
  } else if (!looksLikeProjectRoot(cwd)) {
    process.stderr.write(
      `[super-dev] WARNING: cwd '${cwd}' does not look like a project root ` +
        `(no .git, package.json, etc.). Tools may write files in the wrong location.\n` +
        `  Set SUPER_DEV_PROJECT_ROOT to override.\n`,
    );
  }

  _resolvedProjectRoot = cwd;
  return _resolvedProjectRoot;
}

if (process.env.SUPER_DEV_PROJECT_ROOT) {
  _resolvedProjectRoot = process.env.SUPER_DEV_PROJECT_ROOT;
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
const UPSTREAM_ALWAYS_VISIBLE = new Set([
  "upstream_init",
  "upstream_status",
  "upstream_merge_start",
]);
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
  const stateFile = join(ctx.projectRoot, ".upstream-merge-state.json");
  if (existsSync(stateFile)) {
    enableMergeTools();
  }
}

// Tools that need the project root resolved before running.
for (const tool of [...specTools, ...rulesTools]) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args) => {
      await resolveProjectRoot();
      return tool.handler(args as Record<string, unknown>, ctx) as any;
    },
  );
}

// Tools that do NOT need the project root.
for (const tool of [...threadHistoryTools, ...ttsTools]) {
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
  const isMergeOnly = !UPSTREAM_ALWAYS_VISIBLE.has(tool.name);

  let wrappedHandler: (args: Record<string, unknown>) => Promise<any>;
  if (tool.name === "upstream_merge_start") {
    wrappedHandler = async (args) => {
      await resolveProjectRoot();
      const result = await tool.handler(args, ctx);
      enableMergeTools();
      return result;
    };
  } else if (
    tool.name === "upstream_complete" ||
    tool.name === "upstream_abort"
  ) {
    wrappedHandler = async (args) => {
      await resolveProjectRoot();
      const result = await tool.handler(args, ctx);
      disableMergeTools();
      return result;
    };
  } else if (UPSTREAM_ALWAYS_VISIBLE.has(tool.name)) {
    wrappedHandler = async (args) => {
      await resolveProjectRoot();
      syncMergeToolVisibility();
      return tool.handler(args, ctx);
    };
  } else {
    wrappedHandler = async (args) => {
      await resolveProjectRoot();
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

const transport = new StdioServerTransport();
await server.connect(transport);
