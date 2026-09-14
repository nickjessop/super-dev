import { execSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  rmSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

import type { ToolDef, ToolResult } from "../types.js";
import { ok, err } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SKILLS_SRC = join(REPO_ROOT, "skills");
const GLOBAL_SKILLS_DIR = join(process.env.HOME!, ".agents", "skills");

interface SkillSyncResult {
  name: string;
  action: "created" | "updated" | "ok" | "error";
  detail?: string;
}

function syncSkills(): SkillSyncResult[] {
  const results: SkillSyncResult[] = [];

  if (!existsSync(SKILLS_SRC)) {
    return [{ name: "*", action: "error", detail: "skills/ directory not found in repo" }];
  }

  mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });

  const skillDirs = readdirSync(SKILLS_SRC).filter((name) => {
    const skillMd = join(SKILLS_SRC, name, "SKILL.md");
    return existsSync(skillMd);
  });

  for (const name of skillDirs) {
    const src = join(SKILLS_SRC, name);
    const dest = join(GLOBAL_SKILLS_DIR, name);

    try {
      if (existsSync(dest) || lstatSync(dest).isSymbolicLink?.()) {
        // Check if it's already a correct symlink
        if (lstatSync(dest).isSymbolicLink()) {
          const target = readlinkSync(dest);
          if (resolve(dirname(dest), target) === src) {
            results.push({ name, action: "ok" });
            continue;
          }
          // Wrong target — remove and recreate
          unlinkSync(dest);
        } else {
          // It's a real directory — remove it
          rmSync(dest, { recursive: true });
        }
        symlinkSync(src, dest);
        results.push({ name, action: "updated", detail: "symlink target updated" });
      } else {
        symlinkSync(src, dest);
        results.push({ name, action: "created" });
      }
    } catch (e: unknown) {
      // dest doesn't exist at all (lstatSync threw)
      try {
        symlinkSync(src, dest);
        results.push({ name, action: "created" });
      } catch (e2: unknown) {
        const msg = e2 instanceof Error ? e2.message : String(e2);
        results.push({ name, action: "error", detail: msg });
      }
    }
  }

  return results;
}

function gitPull(): { success: boolean; output: string } {
  try {
    const output = execSync("git pull --ff-only", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();
    return { success: true, output };
  } catch (e: unknown) {
    const msg = e instanceof Error ? (e as any).stderr || e.message : String(e);
    return { success: false, output: msg };
  }
}

function rebuild(): { success: boolean; output: string } {
  try {
    const output = execSync("npm install", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 60_000,
    }).trim();
    return { success: true, output };
  } catch (e: unknown) {
    const msg = e instanceof Error ? (e as any).stderr || e.message : String(e);
    return { success: false, output: msg };
  }
}

export const updateTools: ToolDef[] = [
  {
    name: "super_dev_update",
    description:
      "Update Super Dev: sync skills to ~/.agents/skills/ (symlinks), pull latest from git, and rebuild. " +
      "Run from any project. After completion, restart the MCP server for tool/prompt changes to take effect.",
    schema: {
      skipPull: z
        .boolean()
        .optional()
        .describe("Skip git pull (only sync skills). Default: false."),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const skipPull = (args.skipPull as boolean) ?? false;
      const lines: string[] = [];

      // 1. Sync skills
      lines.push("## Skills");
      const skillResults = syncSkills();
      for (const r of skillResults) {
        const icon =
          r.action === "created" ? "🆕" :
          r.action === "updated" ? "🔄" :
          r.action === "ok" ? "✅" :
          "❌";
        const detail = r.detail ? ` (${r.detail})` : "";
        lines.push(`${icon} ${r.name}: ${r.action}${detail}`);
      }

      const hasSkillErrors = skillResults.some((r) => r.action === "error");

      if (skipPull) {
        lines.push("", "Skipped git pull and rebuild (skipPull: true).");
        return hasSkillErrors ? err(lines.join("\n")) : ok(lines.join("\n"));
      }

      // 2. Git pull
      lines.push("", "## Git Pull");
      const pull = gitPull();
      lines.push(pull.output);
      if (!pull.success) {
        lines.push("", "⚠️ Git pull failed. Skills were synced but code was not updated.");
        return err(lines.join("\n"));
      }

      // 3. Rebuild
      lines.push("", "## Rebuild");
      const build = rebuild();
      if (build.success) {
        lines.push("Build succeeded.");
      } else {
        lines.push(build.output);
        lines.push("", "⚠️ Build failed. Skills and code were updated but the build needs fixing.");
        return err(lines.join("\n"));
      }

      // 4. Re-sync skills (in case git pull brought new ones)
      const postPullResults = syncSkills();
      const newSkills = postPullResults.filter((r) => r.action === "created" || r.action === "updated");
      if (newSkills.length > 0) {
        lines.push("", "## New skills from update");
        for (const r of newSkills) {
          lines.push(`🆕 ${r.name}`);
        }
      }

      lines.push("", "---", "✅ Update complete. Restart the MCP server for tool/prompt changes to take effect.");
      lines.push("Skills are symlinked and take effect immediately.");

      return ok(lines.join("\n"));
    },
  },
];
