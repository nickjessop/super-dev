// Deprecation watch — detects when an MCP client gains support for features
// that obsolete parts of this server, and writes a notice to stderr (visible
// in the client's MCP server log).
//
// Currently watching:
//   - "resources" support in Zed. When detected, the `load_rules` tool can be
//     removed (its function is fulfilled by the `rule://` resources we expose).
//
// To remove an entry from this watch, just delete it from CLIENTS_KNOWN_TO_LACK_RESOURCES.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type {
  DeprecationFlags,
  DeprecationWatchOptions,
  DeprecationWatcher,
} from "../types.js";

const CLIENTS_KNOWN_TO_LACK_RESOURCES = new Set(["Zed"]);

function flagFile(projectRoot: string): string {
  return join(projectRoot, ".super-dev-flags.json");
}

function readFlags(projectRoot: string): DeprecationFlags {
  try {
    const f = flagFile(projectRoot);
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf-8")) as DeprecationFlags;
  } catch {
    return {};
  }
}

function writeFlags(projectRoot: string, flags: DeprecationFlags): void {
  try {
    const f = flagFile(projectRoot);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(flags, null, 2) + "\n");
  } catch {
    // best effort; don't crash the server over flag persistence
  }
}

function notice(lines: string[]): void {
  process.stderr.write("\n");
  for (const line of lines) {
    process.stderr.write(`[super-dev] ${line}\n`);
  }
  process.stderr.write("\n");
}

export function createDeprecationWatch(
  opts: DeprecationWatchOptions,
): DeprecationWatcher {
  let flags: DeprecationFlags | null = null;

  function getFlags(): DeprecationFlags {
    if (!flags) flags = readFlags(opts.projectRoot);
    return flags;
  }

  return {
    onResourcesUsed() {
      const client = opts.getClientInfo() as {
        name?: string;
        version?: string;
      } | null;
      if (!client?.name) return;
      if (!CLIENTS_KNOWN_TO_LACK_RESOURCES.has(client.name)) return;

      const f = getFlags();
      const flagKey = `resources-supported:${client.name}`;
      if (f[flagKey]) return;

      notice([
        `🎉 ${client.name} (v${client.version || "?"}) is now using MCP Resources!`,
        ``,
        `The \`load_rules\` tool in super-dev-mcp may now be redundant —`,
        `${client.name} can read rules directly via the \`rule://\` resources we expose.`,
        ``,
        `To clean up:`,
        `  1. Remove the rulesTools spread from index.js`,
        `  2. Delete the load_rules tool definition in lib/rules.js`,
        `  3. Remove "${client.name}" from CLIENTS_KNOWN_TO_LACK_RESOURCES in lib/deprecation-watch.js`,
        ``,
        `(This notice will only appear once per project.)`,
      ]);

      f[flagKey] = {
        firstSeen: new Date().toISOString(),
        clientVersion: client.version || null,
      };
      writeFlags(opts.projectRoot, f);
    },
  };
}
