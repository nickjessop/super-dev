import { execSync, ExecSyncOptions } from "child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";
import { z } from "zod";
import {
  ToolDef,
  ToolResult,
  AppContext,
  UpstreamConfig,
  UpstreamPolicies,
  MergeState,
  ok,
  err,
} from "../types.js";

// --- Upstream directory and file paths ---
const UPSTREAM_DIR = ".upstream";
const CONFIG_FILE = "config.json";
const MERGE_STATE_FILE = "merge-state.json";
const GITIGNORE_FILE = ".gitignore";

// --- Legacy paths (for backward compatibility) ---
const LEGACY_CONFIG_FILE = ".upstream.json";
const LEGACY_MERGE_STATE_FILE = ".upstream-merge-state.json";

function getUpstreamDir(projectRoot: string): string {
  return join(projectRoot, UPSTREAM_DIR);
}

function getConfigPath(projectRoot: string): string {
  return join(getUpstreamDir(projectRoot), CONFIG_FILE);
}

function getMergeStatePath(projectRoot: string): string {
  return join(getUpstreamDir(projectRoot), MERGE_STATE_FILE);
}

function ensureUpstreamDir(projectRoot: string): void {
  const dir = getUpstreamDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createUpstreamGitignore(projectRoot: string): void {
  const gitignorePath = join(getUpstreamDir(projectRoot), GITIGNORE_FILE);
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${MERGE_STATE_FILE}\n`);
  }
}

function migrateFromLegacy(projectRoot: string): void {
  // Migrate .upstream.json to .upstream/config.json
  const legacyConfig = join(projectRoot, LEGACY_CONFIG_FILE);
  if (existsSync(legacyConfig)) {
    ensureUpstreamDir(projectRoot);
    const config = JSON.parse(readFileSync(legacyConfig, "utf-8"));
    writeFileSync(getConfigPath(projectRoot), JSON.stringify(config, null, 2) + "\n");
    unlinkSync(legacyConfig);
    console.error(`[upstream] Migrated ${LEGACY_CONFIG_FILE} to ${UPSTREAM_DIR}/${CONFIG_FILE}`);
  }

  // Migrate .upstream-merge-state.json to .upstream/merge-state.json
  const legacyState = join(projectRoot, LEGACY_MERGE_STATE_FILE);
  if (existsSync(legacyState)) {
    ensureUpstreamDir(projectRoot);
    const state = JSON.parse(readFileSync(legacyState, "utf-8"));
    writeFileSync(getMergeStatePath(projectRoot), JSON.stringify(state, null, 2) + "\n");
    unlinkSync(legacyState);
    console.error(`[upstream] Migrated ${LEGACY_MERGE_STATE_FILE} to ${UPSTREAM_DIR}/${MERGE_STATE_FILE}`);
  }
}

function loadConfig(projectRoot: string): UpstreamConfig | null {
  // Try new location first
  const configPath = getConfigPath(projectRoot);
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf-8")) as UpstreamConfig;
  }

  // Check for legacy location and migrate
  const legacyConfig = join(projectRoot, LEGACY_CONFIG_FILE);
  if (existsSync(legacyConfig)) {
    migrateFromLegacy(projectRoot);
    return JSON.parse(readFileSync(configPath, "utf-8")) as UpstreamConfig;
  }

  return null;
}

function saveConfig(projectRoot: string, config: UpstreamConfig): void {
  ensureUpstreamDir(projectRoot);
  createUpstreamGitignore(projectRoot);
  writeFileSync(getConfigPath(projectRoot), JSON.stringify(config, null, 2) + "\n");
}

function loadMergeState(projectRoot: string): MergeState | null {
  // Try new location first
  const statePath = getMergeStatePath(projectRoot);
  if (existsSync(statePath)) {
    return JSON.parse(readFileSync(statePath, "utf-8")) as MergeState;
  }

  // Check for legacy location and migrate
  const legacyState = join(projectRoot, LEGACY_MERGE_STATE_FILE);
  if (existsSync(legacyState)) {
    migrateFromLegacy(projectRoot);
    return JSON.parse(readFileSync(statePath, "utf-8")) as MergeState;
  }

  return null;
}

function saveMergeState(projectRoot: string, state: MergeState): void {
  ensureUpstreamDir(projectRoot);
  writeFileSync(getMergeStatePath(projectRoot), JSON.stringify(state, null, 2) + "\n");
}

function removeMergeState(projectRoot: string): void {
  const statePath = getMergeStatePath(projectRoot);
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

function matchesGlob(filePath: string, pattern: string): boolean {
  let regexStr = "^";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        regexStr += "(?:.+/)?";
        i += 3;
      } else {
        regexStr += ".*";
        i += 2;
      }
    } else if (pattern[i] === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      regexStr += "[^/]";
      i++;
    } else if (pattern[i] === ".") {
      regexStr += "\\.";
      i++;
    } else {
      regexStr += pattern[i];
      i++;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr).test(filePath);
}

function categorizeFile(
  filePath: string,
  categories: Record<string, string[]> | undefined,
): string | null {
  if (!categories) return null;
  for (const [category, patterns] of Object.entries(categories)) {
    for (const pattern of patterns) {
      if (matchesGlob(filePath, pattern)) return category;
    }
  }
  return null;
}

function getPolicyForFile(
  filePath: string,
  policies: UpstreamPolicies | undefined,
): string | null {
  if (!policies) return null;
  if (policies.always_ours) {
    for (const pattern of policies.always_ours) {
      if (matchesGlob(filePath, pattern)) return "ours";
    }
  }
  if (policies.always_theirs) {
    for (const pattern of policies.always_theirs) {
      if (matchesGlob(filePath, pattern)) return "theirs";
    }
  }
  if (policies.manual_review) {
    for (const pattern of policies.manual_review) {
      if (matchesGlob(filePath, pattern)) return "manual";
    }
  }
  return null;
}

function git(
  cmd: string,
  projectRoot: string,
  opts: ExecSyncOptions = {},
): string {
  return (
    execSync(cmd, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000, // 60 second timeout
      ...opts,
    }) as string
  ).trim();
}

const upstreamStatusSchema = {
  // Init params — only needed when setting up for the first time
  remote_url: z
    .string()
    .optional()
    .describe(
      "Git URL of the upstream repository. Provide this to initialize upstream config (.upstream/config.json). Only needed once.",
    ),
  remote: z.string().optional().describe("Git remote name (default: upstream)"),
  branch: z
    .string()
    .optional()
    .describe("Upstream branch to track (default: main)"),
  policies: z.record(z.array(z.string())).optional(),
  categories: z.record(z.array(z.string())).optional(),
  // Status params
  verbose: z.boolean().optional(),
  // Merge params
  start_merge: z
    .boolean()
    .optional()
    .describe("Set to true to start a merge on a new branch"),
  strategy: z
    .enum(["merge", "rebase"])
    .optional()
    .describe("Merge strategy (default: merge). Only used with start_merge."),
};

async function upstreamStatus(
  args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const {
    remote_url,
    remote: remoteArg,
    branch: branchArg,
    policies,
    categories,
    verbose,
    start_merge,
    strategy,
  } = args as {
    remote_url?: string;
    remote?: string;
    branch?: string;
    policies?: Record<string, string[]>;
    categories?: Record<string, string[]>;
    verbose?: boolean;
    start_merge?: boolean;
    strategy?: string;
  };

  // --- Init mode: remote_url provided ---
  if (remote_url) {
    const remote = remoteArg || "upstream";
    const branch = branchArg || "main";

    try {
      let remoteExists = false;
      try {
        git(`git remote get-url ${remote}`, projectRoot);
        remoteExists = true;
      } catch {
        // Remote doesn't exist
      }

      if (!remoteExists) {
        git(`git remote add ${remote} ${remote_url}`, projectRoot);
      }

      console.error(`[upstream_status] Fetching ${remote}/${branch}...`);
      git(`git fetch ${remote} ${branch} --depth=100`, projectRoot);

      const config: UpstreamConfig = {
        remote,
        branch,
        policies: (policies as unknown as UpstreamPolicies) || {
          always_ours: [],
          always_theirs: [],
          manual_review: [],
        },
        categories: categories || {
          dependencies: [
            "package.json",
            "package-lock.json",
            "pnpm-lock.yaml",
            "yarn.lock",
          ],
          ui_components: ["src/components/**"],
          infrastructure: ["*.config.*", "tsconfig.*", ".env*"],
        },
      };

      saveConfig(projectRoot, config);

      return ok(
        `Upstream configured successfully!\n\n` +
          `Remote: ${remote} → ${remote_url}${remoteExists ? " (already existed)" : ""}\n` +
          `Branch: ${branch}\n` +
          `Config written to: .upstream/config.json\n\n` +
          `✅ .upstream/.gitignore created (merge-state.json will be ignored)`,
      );
    } catch (e: unknown) {
      return err(
        `Failed to initialize upstream: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // --- All other modes require existing config ---
  const config = loadConfig(projectRoot);
  if (!config) {
    return err(
      "No upstream config found. Call upstream_status with remote_url to configure your upstream remote.",
    );
  }

  const { remote, branch } = config;

  // --- Merge start mode ---
  if (start_merge) {
    try {
      const status = git("git status --porcelain", projectRoot);
      if (status) {
        return err(
          `Working tree is not clean. Please commit or stash changes first.\n\nDirty files:\n${status}`,
        );
      }

      console.error(`[upstream_status] Fetching latest from ${remote}/${branch}...`);
      git(`git fetch ${remote} ${branch}`, projectRoot);

      const previousBranch = git("git branch --show-current", projectRoot);

      const timestamp = new Date()
        .toISOString()
        .replace(/[T:]/g, "-")
        .replace(/\..+/, "");
      const mergeBranch = `upstream-merge-${timestamp}`;

      console.error(`[upstream_status] Creating merge branch ${mergeBranch}...`);
      git(`git checkout -b ${mergeBranch}`, projectRoot);

      console.error(`[upstream_status] Merging ${remote}/${branch}...`);
      let hasConflicts = false;
      try {
        git(`git merge ${remote}/${branch} --no-commit --no-ff`, projectRoot);
      } catch {
        hasConflicts = true;
      }

      let conflicts: string[] = [];
      try {
        const conflictOutput = git(
          "git diff --name-only --diff-filter=U",
          projectRoot,
        );
        if (conflictOutput) {
          conflicts = conflictOutput.split("\n").filter(Boolean);
        }
      } catch {
        // No conflicts
      }

      let allChangedFiles: string[] = [];
      try {
        const changedOutput = git(
          `git diff --name-only HEAD ${remote}/${branch}`,
          projectRoot,
        );
        if (changedOutput) {
          allChangedFiles = changedOutput.split("\n").filter(Boolean);
        }
      } catch {
        // Fallback
      }

      const mergeState: MergeState = {
        branch: mergeBranch,
        previousBranch,
        remote,
        remoteBranch: branch,
        startedAt: new Date().toISOString(),
        conflicts,
        allChangedFiles,
        resolved: {},
        status: conflicts.length > 0 ? "in_progress" : "no_conflicts",
      };
      saveMergeState(projectRoot, mergeState);

      let output = `## Merge Started\n\n`;
      output += `Branch: ${mergeBranch}\n`;
      output += `Strategy: ${strategy || "merge"}\n`;
      output += `Previous branch: ${previousBranch}\n`;
      output += `Total files changed: ${allChangedFiles.length}\n`;
      output += `Conflicts: ${conflicts.length}\n`;

      if (conflicts.length > 0) {
        output += `\n### Conflicted Files\n\n`;
        for (const file of conflicts) {
          const category = categorizeFile(file, config.categories);
          const policy = getPolicyForFile(file, config.policies);
          output += `  - ${file}`;
          if (category) output += ` [${category}]`;
          if (policy) output += ` (policy: ${policy})`;
          output += `\n`;
        }
        output += `\nUse upstream_categorize_changes for a full breakdown.`;
        output += `\nUse upstream_resolve_batch to auto-resolve files with policies.`;
      } else {
        output += `\n✅ No conflicts! You can run upstream_verify and then upstream_complete.`;
      }

      return ok(output);
    } catch (e: unknown) {
      return err(
        `Failed to start merge: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // --- Default: status mode ---
  try {
    console.error(`[upstream_status] Fetching ${remote}/${branch}...`);
    git(`git fetch ${remote} ${branch}`, projectRoot);

    const behind = parseInt(
      git(`git rev-list --count HEAD..${remote}/${branch}`, projectRoot) || "0",
      10,
    );
    const ahead = parseInt(
      git(`git rev-list --count ${remote}/${branch}..HEAD`, projectRoot) || "0",
      10,
    );

    let commits = "";
    if (behind > 0) {
      commits = git(
        `git log --oneline HEAD..${remote}/${branch} -50`,
        projectRoot,
      );
    }

    let output = `## Upstream Status\n\n`;
    output += `Remote: ${remote}/${branch}\n`;
    output += `Commits behind: ${behind}\n`;
    output += `Commits ahead: ${ahead}\n`;

    if (behind === 0) {
      output += `\n✅ You are up to date with upstream.`;
    } else {
      output += `\n### Upstream Commits (newest first)\n\n`;
      output += commits
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");

      if (verbose) {
        const diffStat = git(
          `git diff --stat HEAD...${remote}/${branch}`,
          projectRoot,
        );
        output += `\n\n### File Changes Summary\n\n`;
        output += diffStat;
      }
    }

    return ok(output);
  } catch (e: unknown) {
    return err(
      `Failed to check upstream status: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const upstreamCategorizeChangesSchema = {
  include_diff_stats: z.boolean().optional().default(false),
};

async function upstreamCategorizeChanges(
  args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const { include_diff_stats } = args as { include_diff_stats?: boolean };

  const state = loadMergeState(projectRoot);
  if (!state) {
    return err("No active merge. Call upstream_status with start_merge first.");
  }

  const config = loadConfig(projectRoot);
  if (!config) {
    return err("No upstream config found.");
  }

  const { allChangedFiles, conflicts } = state;
  const conflictSet = new Set(conflicts);

  interface ChangeEntry {
    file: string;
    policy: string | null;
    isConflicted: boolean;
    diffStat?: string;
  }

  const grouped: Record<string, ChangeEntry[]> = {};
  const uncategorized: ChangeEntry[] = [];
  let autoResolvable = 0;
  let needManual = 0;

  for (const file of allChangedFiles) {
    const category = categorizeFile(file, config.categories);
    const policy = getPolicyForFile(file, config.policies);
    const isConflicted = conflictSet.has(file);

    const entry: ChangeEntry = { file, policy, isConflicted };

    if (include_diff_stats) {
      try {
        const stat = git(
          `git diff --stat HEAD ${state.remote}/${state.remoteBranch} -- ${file}`,
          projectRoot,
        );
        entry.diffStat = stat;
      } catch {
        entry.diffStat = "(unable to get diff)";
      }
    }

    if (category) {
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(entry);
    } else {
      uncategorized.push(entry);
    }

    if (policy && isConflicted) autoResolvable++;
    if (policy === "manual" && isConflicted) needManual++;
  }

  let output = `## Upstream Changes Report\n\n`;
  output += `- Total files changed: ${allChangedFiles.length}\n`;
  output += `- Conflicted: ${conflicts.length}\n`;
  output += `- Auto-resolvable (have policy): ${autoResolvable}\n`;
  output += `- Need manual review: ${needManual}\n\n`;

  for (const [category, files] of Object.entries(grouped)) {
    output += `## Category: ${category} (${files.length} files)\n\n`;
    output += `| File | Policy | Conflicted |\n`;
    output += `|------|--------|------------|\n`;
    for (const { file, policy, isConflicted } of files) {
      output += `| ${file} | ${policy || "-"} | ${isConflicted ? "⚠️ YES" : "No"} |\n`;
    }
    output += `\n`;
  }

  if (uncategorized.length > 0) {
    output += `## Uncategorized (${uncategorized.length} files)\n\n`;
    output += `| File | Policy | Conflicted |\n`;
    output += `|------|--------|------------|\n`;
    for (const { file, policy, isConflicted } of uncategorized) {
      output += `| ${file} | ${policy || "-"} | ${isConflicted ? "⚠️ YES" : "No"} |\n`;
    }
    output += `\n`;
  }

  return ok(output);
}

const upstreamResolveFileSchema = {
  file: z.string().describe("Path to the conflicted file"),
  strategy: z
    .enum(["ours", "theirs", "manual"])
    .describe("Resolution strategy"),
  manual_content: z
    .string()
    .optional()
    .describe("Content to write if strategy is 'manual'"),
};

async function upstreamResolveFile(
  args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const { file, strategy, manual_content } = args as {
    file: string;
    strategy: "ours" | "theirs" | "manual";
    manual_content?: string;
  };

  const state = loadMergeState(projectRoot);
  if (!state) {
    return err("No active merge. Call upstream_status with start_merge first.");
  }

  try {
    if (strategy === "ours") {
      git(`git checkout --ours -- ${file}`, projectRoot);
      git(`git add ${file}`, projectRoot);
    } else if (strategy === "theirs") {
      git(`git checkout --theirs -- ${file}`, projectRoot);
      git(`git add ${file}`, projectRoot);
    } else if (strategy === "manual") {
      if (!manual_content) {
        return err("manual_content is required when strategy is 'manual'");
      }
      const filePath = join(projectRoot, file);
      const fileDir = join(filePath, "..");
      mkdirSync(fileDir, { recursive: true });
      writeFileSync(filePath, manual_content);
      git(`git add ${file}`, projectRoot);
    }

    state.resolved[file] = true as const;
    saveMergeState(projectRoot, state);

    const remaining = state.conflicts.filter((f) => !state.resolved[f]).length;
    return ok(
      `✅ Resolved: ${file} (strategy: ${strategy})\n\nRemaining unresolved conflicts: ${remaining}`,
    );
  } catch (e: unknown) {
    return err(
      `Failed to resolve ${file}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const upstreamResolveBatchSchema = {
  strategy: z.enum(["ours", "theirs"]),
  files: z
    .array(z.string())
    .optional()
    .describe(
      "Specific files. If omitted, resolves all files matching the strategy's policy.",
    ),
  category: z
    .string()
    .optional()
    .describe("Resolve all conflicted files in this category"),
};

async function upstreamResolveBatch(
  args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const { strategy, files, category } = args as {
    strategy: "ours" | "theirs";
    files?: string[];
    category?: string;
  };

  const state = loadMergeState(projectRoot);
  if (!state) {
    return err("No active merge. Call upstream_status with start_merge first.");
  }

  const config = loadConfig(projectRoot);
  if (!config) {
    return err("No upstream config found.");
  }

  let targetFiles: string[] = [];

  if (files && files.length > 0) {
    targetFiles = files;
  } else if (category) {
    targetFiles = state.conflicts.filter((f) => {
      const cat = categorizeFile(f, config.categories);
      return cat === category && !state.resolved[f];
    });
  } else {
    targetFiles = state.conflicts.filter((f) => {
      const policy = getPolicyForFile(f, config.policies);
      return policy === strategy && !state.resolved[f];
    });
  }

  if (targetFiles.length === 0) {
    return ok("No files matched the criteria for batch resolution.");
  }

  let resolved = 0;
  const errors: string[] = [];

  for (const file of targetFiles) {
    try {
      git(`git checkout --${strategy} -- ${file}`, projectRoot);
      git(`git add ${file}`, projectRoot);
      state.resolved[file] = true as const;
      resolved++;
    } catch (e: unknown) {
      errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  saveMergeState(projectRoot, state);

  const remaining = state.conflicts.filter((f) => !state.resolved[f]).length;
  let output = `## Batch Resolution Complete\n\n`;
  output += `Strategy: ${strategy}\n`;
  output += `Files resolved: ${resolved}\n`;
  output += `Remaining unresolved: ${remaining}\n`;

  if (errors.length > 0) {
    output += `\n### Errors\n\n`;
    for (const e of errors) {
      output += `  - ${e}\n`;
    }
  }

  return ok(output);
}

const upstreamDiffFileSchema = {
  file: z.string(),
  context_lines: z.number().optional().default(5),
};

async function upstreamDiffFile(
  args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const { file, context_lines } = args as {
    file: string;
    context_lines?: number;
  };

  const state = loadMergeState(projectRoot);
  const config = loadConfig(projectRoot);
  if (!config) {
    return err("No upstream config found.");
  }

  const { remote, branch } = config;

  try {
    let diff: string;
    const isConflicted = state && state.conflicts.includes(file);

    if (isConflicted) {
      diff = git(`git diff -- ${file}`, projectRoot);
    } else {
      diff = git(
        `git diff -U${context_lines} HEAD...${remote}/${branch} -- ${file}`,
        projectRoot,
      );
    }

    if (!diff) {
      return ok(`No differences found for ${file}`);
    }

    const lines = diff.split("\n");
    if (lines.length > 500) {
      diff =
        lines.slice(0, 500).join("\n") +
        `\n\n... (truncated, ${lines.length - 500} more lines)`;
    }

    return ok(
      `## Diff: ${file}${isConflicted ? " (CONFLICTED)" : ""}\n\n\`\`\`diff\n${diff}\n\`\`\``,
    );
  } catch (e: unknown) {
    return err(
      `Failed to get diff for ${file}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const upstreamVerifySchema = {
  commands: z
    .array(z.string())
    .optional()
    .describe(
      "Commands to run. Defaults to ['npm run typecheck', 'npm run lint']",
    ),
  fix: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, run fix commands like 'npm run lint -- --fix'"),
};

async function upstreamVerify(
  args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const { commands, fix } = args as {
    commands?: string[];
    fix?: boolean;
  };

  const state = loadMergeState(projectRoot);
  if (!state) {
    // Warn but don't block
  }

  const defaultCommands = ["npm run typecheck", "npm run lint"];
  let cmds = commands || defaultCommands;

  if (fix) {
    cmds = cmds.map((cmd) => {
      if (cmd.includes("lint")) return `${cmd} -- --fix`;
      return cmd;
    });
  }

  let output = `## Verification Results\n\n`;
  let allPassed = true;

  for (const cmd of cmds) {
    output += `### \`${cmd}\`\n\n`;
    try {
      const result = execSync(cmd, {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000,
      }) as string;

      const lines = result.split("\n");
      const truncated =
        lines.length > 200
          ? lines.slice(0, 200).join("\n") +
            `\n... (${lines.length - 200} more lines)`
          : result;

      output += `✅ PASSED\n\n`;
      if (truncated.trim()) {
        output += `\`\`\`\n${truncated.trim()}\n\`\`\`\n\n`;
      }
    } catch (e: unknown) {
      allPassed = false;
      const execErr = e as {
        stderr?: string;
        stdout?: string;
        status?: number;
      };
      const stderr = execErr.stderr || "";
      const stdout = execErr.stdout || "";
      const combined = (stdout + "\n" + stderr).trim();
      const lines = combined.split("\n");
      const truncated =
        lines.length > 200
          ? lines.slice(0, 200).join("\n") +
            `\n... (${lines.length - 200} more lines)`
          : combined;

      output += `❌ FAILED (exit code: ${execErr.status})\n\n`;
      if (truncated) {
        output += `\`\`\`\n${truncated}\n\`\`\`\n\n`;
      }
    }
  }

  output += `---\n\n${allPassed ? "✅ All checks passed!" : "❌ Some checks failed."}`;

  return ok(output);
}

const upstreamCompleteSchema = {
  message: z
    .string()
    .optional()
    .describe(
      "Commit message. Defaults to 'chore: merge upstream {remote}/{branch}'",
    ),
  merge_to: z
    .string()
    .optional()
    .default("main")
    .describe("Branch to merge into"),
  cleanup: z
    .boolean()
    .optional()
    .default(true)
    .describe("Delete merge branch after"),
};

async function upstreamComplete(
  args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const { message, merge_to, cleanup } = args as {
    message?: string;
    merge_to?: string;
    cleanup?: boolean;
  };

  const state = loadMergeState(projectRoot);
  if (!state) {
    return err("No active merge. Call upstream_status with start_merge first.");
  }

  try {
    let unresolvedConflicts: string[] = [];
    try {
      const conflictOutput = git(
        "git diff --name-only --diff-filter=U",
        projectRoot,
      );
      if (conflictOutput) {
        unresolvedConflicts = conflictOutput.split("\n").filter(Boolean);
      }
    } catch {
      // No conflicts
    }

    if (unresolvedConflicts.length > 0) {
      return err(
        `Cannot complete merge — ${unresolvedConflicts.length} unresolved conflict(s):\n\n` +
          unresolvedConflicts.map((f) => `  - ${f}`).join("\n") +
          `\n\nResolve all conflicts first with upstream_resolve_file or upstream_resolve_batch.`,
      );
    }

    const commitMsg =
      message || `chore: merge upstream ${state.remote}/${state.remoteBranch}`;
    git("git add -A", projectRoot);
    try {
      git(`git commit -m ${JSON.stringify(commitMsg)}`, projectRoot);
    } catch {
      // May already be committed
    }

    const mergeBranch = state.branch;
    const targetBranch = merge_to || "main";

    git(`git checkout ${targetBranch}`, projectRoot);

    let mergeMethod = "fast-forward";
    try {
      git(`git merge ${mergeBranch} --ff-only`, projectRoot);
    } catch {
      try {
        git(`git merge ${mergeBranch}`, projectRoot);
        mergeMethod = "merge commit";
      } catch (e: unknown) {
        return err(
          `Failed to merge into ${targetBranch}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const sha = git("git rev-parse --short HEAD", projectRoot);

    if (cleanup) {
      try {
        git(`git branch -d ${mergeBranch}`, projectRoot);
      } catch {
        // Ignore
      }
    }

    removeMergeState(projectRoot);

    return ok(
      `## Merge Complete! 🎉\n\n` +
        `Commit: ${sha}\n` +
        `Message: ${commitMsg}\n` +
        `Merged into: ${targetBranch} (${mergeMethod})\n` +
        `Files changed: ${state.allChangedFiles.length}\n` +
        (cleanup ? `Branch ${mergeBranch} deleted.\n` : ""),
    );
  } catch (e: unknown) {
    return err(
      `Failed to complete merge: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const upstreamAbortSchema = {};

async function upstreamAbort(
  _args: Record<string, unknown>,
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const state = loadMergeState(projectRoot);

  try {
    try {
      git("git merge --abort", projectRoot);
    } catch {
      // Ignore
    }

    if (state && state.previousBranch) {
      try {
        git(`git checkout ${state.previousBranch}`, projectRoot);
      } catch {
        // May already be on it
      }
    }

    if (state && state.branch) {
      try {
        git(`git branch -D ${state.branch}`, projectRoot);
      } catch {
        // Ignore
      }
    }

    removeMergeState(projectRoot);

    return ok(
      `Merge aborted.\n` +
        (state
          ? `Returned to branch: ${state.previousBranch}\nDeleted branch: ${state.branch}`
          : "State cleaned up."),
    );
  } catch (e: unknown) {
    return err(
      `Error during abort: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export const upstreamTools: ToolDef[] = [
  {
    name: "upstream_status",
    description:
      "Check how many commits behind/ahead of upstream, and list pending upstream commits. Pass remote_url to initialize config. Pass start_merge to begin a merge.",
    schema: upstreamStatusSchema,
    handler: upstreamStatus,
  },
  {
    name: "upstream_categorize_changes",
    description:
      "Show all changed files grouped by category with conflict status and applicable policies.",
    schema: upstreamCategorizeChangesSchema,
    handler: upstreamCategorizeChanges,
  },
  {
    name: "upstream_resolve_file",
    description:
      "Resolve a single conflicted file using ours/theirs/manual strategy.",
    schema: upstreamResolveFileSchema,
    handler: upstreamResolveFile,
  },
  {
    name: "upstream_resolve_batch",
    description:
      "Batch-resolve conflicts by policy, category, or explicit file list.",
    schema: upstreamResolveBatchSchema,
    handler: upstreamResolveBatch,
  },
  {
    name: "upstream_diff_file",
    description: "Show the diff or conflict markers for a specific file.",
    schema: upstreamDiffFileSchema,
    handler: upstreamDiffFile,
  },
  {
    name: "upstream_verify",
    description:
      "Run verification commands (typecheck, lint) to validate the merge result.",
    schema: upstreamVerifySchema,
    handler: upstreamVerify,
  },
  {
    name: "upstream_complete",
    description:
      "Commit the merge, merge into target branch, and clean up the merge branch.",
    schema: upstreamCompleteSchema,
    handler: upstreamComplete,
  },
  {
    name: "upstream_abort",
    description:
      "Abort the in-progress merge, return to previous branch, and clean up.",
    schema: upstreamAbortSchema,
    handler: upstreamAbort,
  },
];
