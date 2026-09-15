// Spec workflow tools — Kiro-style requirements → design → tasks gating.
//
// Spec layout:
//   .specs/<spec-name>/
//     requirements.md
//     design.md
//     tasks.md
//     state.json              # { phase, approved: { requirements, design, tasks } }

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { z } from "zod";

import {
  type AppContext,
  type SpecPhase,
  type SpecState,
  type ToolDef,
  type ToolResult,
  ok,
  err,
} from "../types.js";

const PHASES = [
  "requirements",
  "design",
  "tasks",
  "implementation",
  "done",
] as const satisfies readonly SpecPhase[];

interface ParsedTask {
  indent: string;
  completed: boolean;
  id: string;
  description: string;
  raw: string;
  manual: boolean;
}

type GitCommitResult =
  | { committed: true; sha: string; message: string }
  | { committed: false; reason: string };

interface ValidationError {
  rule: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function specsRoot(projectRoot: string): string {
  return join(projectRoot, ".specs");
}

function specPath(projectRoot: string, name: string): string {
  return join(specsRoot(projectRoot), name);
}

function loadState(projectRoot: string, name: string): SpecState | null {
  const dir = specPath(projectRoot, name);
  const file = join(dir, "state.json");
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf-8")) as SpecState;
  }

  if (!existsSync(dir)) return null;

  const hasReqs = existsSync(join(dir, "requirements.md"));
  const hasDesign = existsSync(join(dir, "design.md"));
  const hasTasks = existsSync(join(dir, "tasks.md"));

  if (!hasReqs && !hasDesign && !hasTasks) return null;

  let phase: SpecPhase = "requirements";
  if (hasReqs && hasDesign && hasTasks) {
    const tasksContent = readFileSync(join(dir, "tasks.md"), "utf-8");
    const hasRealTasks = tasksContent.split("\n").some((l) => parseTask(l));
    if (hasRealTasks) {
      phase = "implementation";
    } else {
      const designContent = readFileSync(join(dir, "design.md"), "utf-8");
      const designIsScaffold = designContent.includes(
        "Fill this in after requirements are approved",
      );
      phase = designIsScaffold ? "design" : "tasks";
    }
  } else if (hasReqs && hasDesign) {
    phase = "tasks";
  } else if (hasReqs) {
    phase = "design";
  }

  const approved = {
    requirements: PHASES.indexOf(phase) > PHASES.indexOf("requirements"),
    design: PHASES.indexOf(phase) > PHASES.indexOf("design"),
    tasks: PHASES.indexOf(phase) > PHASES.indexOf("tasks"),
  };

  let description = "(adopted from manually created spec)";
  if (hasReqs) {
    const reqContent = readFileSync(join(dir, "requirements.md"), "utf-8");
    const lines = reqContent.split("\n").filter((l) => l.trim());
    const descLine = lines.find(
      (l) => !l.startsWith("#") && !l.startsWith("-") && l.trim().length > 10,
    );
    if (descLine) description = descLine.trim();
  }

  const state: SpecState = {
    phase,
    approved,
    description,
    createdAt: new Date().toISOString(),
    adoptedAt: new Date().toISOString(),
  };

  saveState(projectRoot, name, state);

  process.stderr.write(
    `[super-dev] Adopted orphaned spec '${name}' — inferred phase: ${phase}\n`,
  );

  return state;
}

function saveState(projectRoot: string, name: string, state: SpecState): void {
  const file = join(specPath(projectRoot, name), "state.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

function buildCommitMessage(specName: string, taskDescription: string): string {
  const prefix = `feat(${specName}): `;
  const maxLen = 72;
  const desc =
    taskDescription.length + prefix.length > maxLen
      ? taskDescription.slice(0, maxLen - prefix.length - 3) + "..."
      : taskDescription;
  return `${prefix}${desc}`;
}

function gitCommit(
  projectRoot: string,
  specName: string,
  taskDescription: string,
): GitCommitResult {
  try {
    execSync("git add -A", { cwd: projectRoot, stdio: "pipe" });
    const status = execSync("git status --porcelain", {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    if (!status.trim()) {
      return { committed: false, reason: "nothing staged" };
    }

    const message = buildCommitMessage(specName, taskDescription);

    execSync(`git commit -m ${JSON.stringify(message)}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
    const sha = execSync("git rev-parse --short HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
    }).trim();
    return { committed: true, sha, message };
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    return { committed: false, reason };
  }
}

function parseTask(line: string): ParsedTask | null {
  // Checkbox format: - [ ] 1. Description or - [x] 1.1 Description or - [ ] U1. Description
  const match = line.match(
    /^(\s*)-\s*\[([\sx])\]\s+([Uu]?\d+(?:\.\d+)*)\.?\s+(.+)$/,
  );
  if (match) {
    const description = match[4];
    const manual = /\[manual\]/i.test(description);
    return {
      indent: match[1],
      completed: match[2] === "x",
      id: match[3],
      description,
      raw: line,
      manual,
    };
  }
  // Header format: ## Task N: Description (treated as parent task) where N is numeric or U-prefixed
  const headerMatch = line.match(/^##\s+Task\s+([Uu]?\d+)[:.]\s+(.+)$/);
  if (headerMatch) {
    return {
      indent: "",
      completed: false, // headers have no checkbox; derive from children
      id: headerMatch[1],
      description: headerMatch[2],
      raw: line,
      manual: /\[manual\]/i.test(headerMatch[2]),
    };
  }
  return null;
}

function findTask(
  tasksContent: string,
  id: string,
): (ParsedTask & { lineIndex: number }) | null {
  const normalizedId = id.replace(/\.$/, "");
  const lines = tasksContent.split("\n");
  let headerMatch: (ParsedTask & { lineIndex: number }) | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = parseTask(lines[i]);
    if (t && t.id === normalizedId) {
      // Prefer checkbox-format lines over header-format lines
      if (!t.raw.startsWith("##")) return { ...t, lineIndex: i };
      if (!headerMatch) headerMatch = { ...t, lineIndex: i };
    }
  }
  return headerMatch;
}

function isParentTask(id: string): boolean {
  return !id.includes(".");
}

function getChildTasks(
  tasksContent: string,
  parentId: string,
): (ParsedTask & { lineIndex: number })[] {
  const lines = tasksContent.split("\n");
  const children: (ParsedTask & { lineIndex: number })[] = [];
  const prefix = parentId + ".";
  for (let i = 0; i < lines.length; i++) {
    const t = parseTask(lines[i]);
    if (
      t &&
      t.id.startsWith(prefix) &&
      !t.id.slice(prefix.length).includes(".")
    ) {
      children.push({ ...t, lineIndex: i });
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// Tool schemas & handlers
// ---------------------------------------------------------------------------

export const specCreateSchema = {
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  description: z.string().describe("One-line summary of the feature"),
  autoCommit: z
    .boolean()
    .optional()
    .describe(
      "Enable automatic git commits when parent tasks complete (default: true). Set to false to disable auto-commits.",
    ),
  specType: z
    .enum(["feature", "bugfix"])
    .optional()
    .describe('Spec type: "feature" (default) or "bugfix". Bugfix specs use a different requirements template.'),
};

export async function specCreate(
  {
    name,
    description,
    autoCommit,
    specType,
  }: { name: string; description: string; autoCommit?: boolean; specType?: "feature" | "bugfix" },
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const dir = specPath(projectRoot, name);
  if (existsSync(dir)) {
    return specStatus({ name }, { projectRoot });
  }
  mkdirSync(dir, { recursive: true });

  if (specType === "bugfix") {
    writeFileSync(
      join(dir, "requirements.md"),
      `# Bugfix: ${name}\n\n${description}\n\n<!-- Criterion numbers are immutable and append-only. New criteria go at the end. -->\n\n## Bug Condition\n\nDescribe what is broken, how to reproduce it, and what the expected behavior should be.\n\n## Preservation Checks\n\nWhat must continue working after the fix is applied. Each check uses EARS notation.\n\n- [ ] P1. WHILE [normal operation], THE [system] SHALL [continue expected behavior]\n- [ ] P2. WHEN [related trigger], THE [system] SHALL [maintain existing behavior]\n\n## Fix Checks\n\nHow we know the fix works. Each check uses EARS notation with dotted IDs.\n\n- [ ] 1.1 WHEN [trigger that caused the bug], THE [system] SHALL [corrected response]\n- [ ] 1.2 IF [edge case related to the bug], THEN THE [system] SHALL [handle correctly]\n\n<!-- EARS Pattern Reference:\n  Event-driven:   WHEN [trigger], THE [system] SHALL [response]\n  Unwanted:       IF [condition], THEN THE [system] SHALL [response]\n  State-driven:   WHILE [state], THE [system] SHALL [response]\n-->\n`,
    );
  } else {
    writeFileSync(
      join(dir, "requirements.md"),
      `# Requirements: ${name}\n\n${description}\n\n<!-- Criterion numbers are immutable and append-only. New criteria go at the end. -->\n\n## Functional Requirements\n\n### Story 1: As a [role], I want [goal], so that [benefit]\n\n**Acceptance Criteria:**\n- [ ] 1.1 WHEN [trigger], THE [system] SHALL [response]\n- [ ] 1.2 IF [condition], THEN THE [system] SHALL [response]\n\n<!-- EARS Pattern Reference:\n  Ubiquitous:     THE [system] SHALL [response]\n  Event-driven:   WHEN [trigger], THE [system] SHALL [response]\n  State-driven:   WHILE [state], THE [system] SHALL [response]\n  Unwanted:       IF [condition], THEN THE [system] SHALL [response]\n  Optional:       WHERE [feature], THE [system] SHALL [response]\n  Complex:        WHILE [state], WHEN [trigger], THE [system] SHALL [response]\n-->\n\n## Non-Functional Requirements\n\n- [ ] NF1. THE [system] SHALL [requirement]\n\n## Out of Scope\n\n- (what we're not doing)\n`,
    );
  }

  writeFileSync(
    join(dir, "design.md"),
    `# Design: ${name}\n\nFill this in after requirements are approved.\n\n## Architecture\n\n## Data Model\n\n## API Design\n\n## Components\n\n## Error Handling\n\n## Security\n\n## Correctness Properties\n\nProperties are named, testable claims. Each must cite the criteria it satisfies.\n\n### Property 1: [Name]\n\n[What the property asserts, in plain language.]\n\n**Validates:** [criterion IDs, e.g. 1.1, 1.3, NF2]\n\n## Decision Records\n\nRecord non-obvious design decisions. Skip this section if all choices follow directly from the requirements.\n\n### D1 — [Title]\n\n**Choice.** What was decided.\n**Alternatives.** What else was considered, and why each was rejected.\n**Why.** The reasoning.\n**Consequence.** What this costs, including what it makes worse.\n\n## Sources & References\n`,
  );

  const tasksDependencyGraph = [
    '```json',
    '{',
    '  "waves": [',
    '    {',
    '      "wave": 1,',
    '      "name": "Wave name",',
    '      "tasks": ["1.1", "1.2"],',
    '      "dependsOn": [],',
    '      "notes": ""',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');

  writeFileSync(
    join(dir, "tasks.md"),
    `# Implementation Tasks: ${name}\n\nFill this in after design is approved.\n\n## Task Dependency Graph\n\n${tasksDependencyGraph}\n\n## Task Tiers\n\n- **[T1] Mechanical** — rename, config wiring, simple plumbing. Narrow check only, no test required.\n- **[T2] Implementation** (default if no marker) — new logic or changed behavior. Targeted tests + compile + lint.\n- **[T3] Gate** — full verification pipeline. Run all tests, typecheck, lint. Must pass before done.\n\n## Agent Tasks\n\nEach task must include: target file(s), constraints, failure modes, and which criteria it satisfies.\n\n- [ ] 1. Parent task name\n  - [ ] 1.1 Subtask description [T2]\n    - **Files:** \`path/to/file.ts\`\n    - **Constraint:** What must not break\n    - **Failure mode:** What goes wrong if this is done incorrectly\n    - _Requirements: 1.1, 1.2_\n  - [ ] 1.2 Another subtask [T1]\n    - **Files:** \`path/to/other.ts\`\n    - _Requirements: 1.3_\n\n## User Actions\n\nManual steps for the user (reference notes, not tracked tasks).\n\n- Action description\n- Another action\n`,
  );

  saveState(projectRoot, name, {
    phase: "requirements",
    approved: { requirements: false, design: false, tasks: false },
    description,
    createdAt: new Date().toISOString(),
    specVersion: 2,
    ...(autoCommit === false ? { autoCommit: false } : {}),
    ...(specType === "bugfix" ? { specType: "bugfix" as const } : {}),
  });

  return ok(
    `Created spec '${name}' at ${dir}\n\nFiles:\n  - requirements.md (current phase)\n  - design.md\n  - tasks.md\n  - state.json\n\nNext: fill out requirements.md, then call spec_approve to advance.`,
  );
}

export const specStatusSchema = {
  name: z
    .string()
    .optional()
    .describe("Spec name. If omitted, lists all specs."),
};

export async function specStatus(
  { name }: { name?: string },
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  if (!name) {
    const root = specsRoot(projectRoot);
    if (!existsSync(root)) return ok("No specs yet. Use spec_create to start.");
    const specs = readdirSync(root).filter((d) => {
      return loadState(projectRoot, d) !== null;
    });
    if (specs.length === 0) return ok("No specs yet.");
    const lines = specs.map((s) => {
      const state = loadState(projectRoot, s)!;
      const nextAction: string =
        (
          {
            requirements: "fill out requirements.md, then approve",
            design: "fill out design.md, then approve",
            tasks: "fill out tasks.md, then approve",
            implementation: "implement tasks",
            done: "✓ complete",
          } as Record<SpecPhase, string>
        )[state.phase] || state.phase;
      const typeLabel = state.specType === "bugfix" ? " [bugfix]" : "";
      return `  - ${s}${typeLabel} [phase: ${state.phase}] — ${state.description || "no description"}\n    Next: ${nextAction}`;
    });
    return ok(`Specs:\n${lines.join("\n")}`);
  }

  const state = loadState(projectRoot, name);
  if (!state) return err(`Spec '${name}' not found.`);

  const phaseInstructions: Record<SpecPhase, string[]> = {
    requirements: [
      `## Next Steps`,
      `1. Edit .specs/${name}/requirements.md — define functional requirements, non-functional requirements, and out-of-scope items`,
      `2. Show the user the requirements and ask "ready to approve?"`,
      `3. When confirmed, call spec_approve(name: "${name}", phase: "requirements")`,
      ``,
      `Do NOT advance without explicit user approval.`,
    ],
    design: [
      `## Next Steps`,
      `1. Look up a minimum of 5 web resources (official docs, existing solutions, best practices)`,
      `2. Read only the project files you'll modify or extend — do NOT scan the full codebase`,
      `3. Edit .specs/${name}/design.md — cover architecture, data model, API design, components, error handling, security`,
      `4. Include a Sources & References section citing the resources you consulted`,
      `5. Show the user the design and ask "ready to approve?"`,
      `6. When confirmed, call spec_approve(name: "${name}", phase: "design")`,
      ``,
      `Do NOT advance without explicit user approval.`,
    ],
    tasks: [
      `## Next Steps`,
      `1. Edit .specs/${name}/tasks.md — break the design into two sections:`,
      `   - **Agent Tasks**: tasks an LLM/agent can complete autonomously (code, tests, docs)`,
      `   - **User Actions**: manual steps for the user (reference notes, not tracked tasks)`,
      `2. Use hierarchical IDs for Agent Tasks: "- [ ] 1. Parent" / "  - [ ] 1.1 Subtask"`,
      `3. Format User Actions as bullet list: "- Action description"`,
      `4. Reference requirement numbers for traceability`,
      `5. Show the user the tasks and ask "ready to approve?"`,
      `6. When confirmed, call spec_approve(name: "${name}", phase: "tasks")`,
      ``,
      `Do NOT advance without explicit user approval.`,
    ],
    implementation: [
      `## Next Steps`,
      ``,
      `### 1. Load context first`,
      `Before implementing anything, call spec_read(name: "${name}", file: "design") and spec_read(name: "${name}", file: "requirements") to understand the full blueprint. The design document defines HOW to implement; the requirements define WHAT success looks like.`,
      ``,
      `### 2. Execute tasks using sub-agents`,
      `Use sub-agents (spawn_agent / delegate) for each task or small group of related subtasks. This keeps the main thread clean for orchestration and prevents context exhaustion.`,
      ``,
      `For each sub-agent task, include in the delegation message:`,
      `- The specific task description and ID`,
      `- Relevant sections from design.md (architecture, data model, API shape — whatever the task needs)`,
      `- Relevant requirement numbers and their acceptance criteria`,
      `- The project's file paths and conventions the task will touch`,
      ``,
      `### 3. Task completion rules`,
      `- After a sub-agent finishes, verify the work, then call spec_task_complete(name: "${name}", taskId: "<id>")`,
      `- NEVER skip any tasks. Complete every task in order, including commit-related tasks.`,
      `- For parent tasks: complete all subtasks first, then complete the parent`,
      `- When auto-commit is enabled (default), completing a parent task automatically creates a git commit`,
      `- **User Actions section** — ignore this section; it contains reference notes for the user, not tasks`,
      ``,
      `### 4. Orchestration pattern`,
      `- Find the next incomplete task(s) below`,
      `- Identify which tasks are independent (no dependency on each other) — these can be delegated in parallel`,
      `- Delegate implementation to sub-agents`,
      `- Review results, mark tasks complete, move to the next group`,
    ],
    done: [
      `## Spec Complete ✅`,
      `All tasks have been implemented and the spec is finished.`,
    ],
  };

  const instructions = phaseInstructions[state.phase] || [];

  const lines: string[] = [
    `Spec: ${name}`,
    `Description: ${state.description}`,
    `Phase: ${state.phase}`,
    `Approved:`,
    `  - requirements: ${state.approved.requirements ? "✓" : "✗"}`,
    `  - design: ${state.approved.design ? "✓" : "✗"}`,
    `  - tasks: ${state.approved.tasks ? "✓" : "✗"}`,
    `  - autoCommit: ${state.autoCommit !== false ? "✓ (enabled)" : "✗ (disabled)"}`,
  ];

  if (state.specType) {
    lines.push(`  - type: ${state.specType}`);
  }

  if (state.phase === "implementation" || state.phase === "done") {
    const tasksFile = join(specPath(projectRoot, name), "tasks.md");
    if (existsSync(tasksFile)) {
      const content = readFileSync(tasksFile, "utf-8");
      const tasks = content
        .split("\n")
        .map(parseTask)
        .filter((t): t is ParsedTask => t !== null);

      const total = tasks.length;
      const done = tasks.filter((t) => t.completed).length;

      if (total > 0) {
        lines.push(``, `Tasks: ${done}/${total} complete`);
      }
    }
  }

  if (instructions.length > 0) {
    lines.push(``, ...instructions);
  }

  const phaseFile =
    state.phase === "implementation" ? "tasks.md" : `${state.phase}.md`;
  const phaseFilePath = join(specPath(projectRoot, name), phaseFile);
  if (existsSync(phaseFilePath)) {
    const content = readFileSync(phaseFilePath, "utf-8");
    lines.push(``, `--- ${phaseFile} ---`, content);
  }

  return ok(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function parseCriterionIds(reqContent: string): Set<string> {
  const ids = new Set<string>();
  for (const line of reqContent.split("\n")) {
    // Dotted IDs: "- [ ] 1.1 ..." or "- [x] 1.1 ..."
    const dotted = line.match(/^- \[[ x]\] (\d+\.\d+)\b/);
    if (dotted) { ids.add(dotted[1]); continue; }
    // NF IDs: "- [ ] NF1. ..."
    const nf = line.match(/^- \[[ x]\] (NF\d+)\./);
    if (nf) { ids.add(nf[1]); continue; }
    // Preservation IDs (bugfix): "- [ ] P1. ..."
    const pres = line.match(/^- \[[ x]\] (P\d+)\./);
    if (pres) { ids.add(pres[1]); }
  }
  return ids;
}

function parseTaskReferences(tasksContent: string): { taskId: string; refs: string[]; isLeaf: boolean }[] {
  const lines = tasksContent.split("\n");
  const results: { taskId: string; refs: string[]; isLeaf: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const task = parseTask(lines[i]);
    if (!task) continue;

    const isLeaf = !isParentTask(task.id);
    const refs: string[] = [];

    // Check inline on the same line
    const inlineMatch = task.raw.match(/(?:_Requirements?:|Requirements?:)\s*([^_)]+)/i);
    if (inlineMatch) {
      refs.push(...inlineMatch[1].split(",").map(r => r.trim()).filter(Boolean));
    }

    // Check body lines below (indented further than this task, until next task line)
    if (!inlineMatch) {
      for (let j = i + 1; j < lines.length; j++) {
        const nextTask = parseTask(lines[j]);
        if (nextTask) break;
        const bodyMatch = lines[j].match(/(?:_Requirements?:|Requirements?:)\s*([^_)]+)/i);
        if (bodyMatch) {
          refs.push(...bodyMatch[1].split(",").map(r => r.trim()).filter(Boolean));
          break;
        }
      }
    }

    results.push({ taskId: task.id, refs, isLeaf });
  }

  return results;
}

function validateRequirementsFormat(content: string, specType: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (specType === "bugfix") {
    const requiredSections = ["## Bug Condition", "## Preservation Checks", "## Fix Checks"];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        errors.push({
          rule: "format/missing-section",
          message: `requirements.md is missing required section "${section}"`,
        });
      }
    }
  } else {
    // Feature: need at least one Story heading
    const storyHeadings = content.match(/^### Story \d+:/gm);
    if (!storyHeadings || storyHeadings.length === 0) {
      errors.push({
        rule: "format/missing-story",
        message: 'requirements.md has no "### Story N:" headings',
      });
    } else {
      // Check each story has at least one criterion
      const sections = content.split(/^### Story \d+:/gm);
      sections.shift(); // remove content before first story
      for (let i = 0; i < sections.length; i++) {
        const hasCriterion = /^- \[[ x]\] \d+\.\d+\b/m.test(sections[i]);
        if (!hasCriterion) {
          errors.push({
            rule: "format/empty-story",
            message: `Story ${i + 1} has no acceptance criteria (expected "- [ ] N.M ..." lines)`,
          });
        }
      }
    }
  }

  return errors;
}

function validateDesignFormat(content: string, reqContent: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required sections
  const requiredSections = ["## Architecture", "## Error Handling", "## Security"];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      errors.push({
        rule: "format/missing-section",
        message: `design.md is missing required section "${section}"`,
      });
    }
  }

  // Need at least one of Data Model or API Design
  if (!content.includes("## Data Model") && !content.includes("## API Design")) {
    errors.push({
      rule: "format/missing-section",
      message: 'design.md is missing "## Data Model" or "## API Design" (at least one required)',
    });
  }

  // If Correctness Properties section exists, check for Validates: lines
  if (content.includes("## Correctness Properties")) {
    const propsSection = content.split("## Correctness Properties")[1]?.split(/\n## /)[0] || "";
    const hasValidates = /\*\*Validates:\*\*/i.test(propsSection);
    if (!hasValidates) {
      errors.push({
        rule: "format/empty-properties",
        message: "Correctness Properties section exists but has no **Validates:** lines",
      });
    }

    // Cross-check Validates: IDs against requirements
    const criterionIds = parseCriterionIds(reqContent);
    const validatesMatches = propsSection.matchAll(/\*\*Validates:\*\*\s*([^\n]+)/gi);
    for (const match of validatesMatches) {
      const ids = match[1].split(",").map(id => id.trim()).filter(Boolean);
      for (const id of ids) {
        if (!criterionIds.has(id)) {
          errors.push({
            rule: "format/invalid-validates-ref",
            message: `Correctness property references criterion ${id} which does not exist in requirements.md`,
          });
        }
      }
    }
  }

  return errors;
}

function validateTasksFormat(content: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // At least one task with checkbox
  const hasTask = /^- \[[ x]\] \d+/m.test(content);
  if (!hasTask) {
    errors.push({
      rule: "format/no-tasks",
      message: "tasks.md has no tasks (expected checkbox lines like '- [ ] 1.1 ...')",
    });
  }

  // At least one Requirements: reference
  const hasRef = /Requirements?:/i.test(content);
  if (!hasRef) {
    errors.push({
      rule: "format/no-requirements-refs",
      message: "tasks.md has no Requirements: references",
    });
  }

  // Task Dependency Graph section with parseable JSON
  const graphMatch = content.match(/## Task Dependency Graph\s*\n[\s\S]*?```json\s*\n([\s\S]*?)```/);
  if (!graphMatch) {
    errors.push({
      rule: "format/missing-section",
      message: 'tasks.md is missing "## Task Dependency Graph" section with a fenced JSON block',
    });
    return errors; // Can't validate waves without the graph
  }

  let waves: { wave: number; name: string; tasks: string[]; dependsOn: number[]; notes?: string }[];
  try {
    const parsed = JSON.parse(graphMatch[1]);
    waves = parsed.waves;
    if (!Array.isArray(waves)) {
      errors.push({ rule: "format/invalid-wave-json", message: "Wave JSON 'waves' is not an array" });
      return errors;
    }
  } catch (e: any) {
    errors.push({ rule: "format/invalid-wave-json", message: `Wave JSON does not parse: ${e.message}` });
    return errors;
  }

  // Extract all task IDs from the file body
  const allTasks = content.split("\n")
    .map(parseTask)
    .filter((t): t is ParsedTask => t !== null && !t.manual);
  const taskIdsInFile = new Set(allTasks.map(t => t.id));
  const leafTaskIds = new Set(allTasks.filter(t => !isParentTask(t.id)).map(t => t.id));

  // Every leaf task in exactly one wave
  const taskToWave = new Map<string, number>();
  for (const w of waves) {
    for (const tid of w.tasks) {
      if (taskToWave.has(tid)) {
        errors.push({
          rule: "format/duplicate-wave-task",
          message: `Task ${tid} appears in wave ${taskToWave.get(tid)} and wave ${w.wave}`,
        });
      } else {
        taskToWave.set(tid, w.wave);
      }
    }
  }

  // Check all leaf tasks are in a wave
  for (const tid of leafTaskIds) {
    if (!taskToWave.has(tid)) {
      errors.push({
        rule: "format/task-not-in-wave",
        message: `Task ${tid} is not in any wave in the dependency graph`,
      });
    }
  }

  // No phantom tasks (in wave but not in file)
  for (const [tid, waveNum] of taskToWave) {
    if (!taskIdsInFile.has(tid)) {
      errors.push({
        rule: "format/phantom-task",
        message: `Wave ${waveNum} references task ${tid} which does not exist in the file`,
      });
    }
  }

  // No forward dependencies
  for (const w of waves) {
    for (const dep of w.dependsOn) {
      if (dep >= w.wave) {
        errors.push({
          rule: "format/forward-dependency",
          message: `Wave ${w.wave} depends on wave ${dep} (forward or self dependency)`,
        });
      }
    }
  }

  return errors;
}

function validateCoverage(reqContent: string, tasksContent: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const criterionIds = parseCriterionIds(reqContent);
  const taskRefs = parseTaskReferences(tasksContent);

  // Collect all referenced criterion IDs from tasks
  const referencedIds = new Set<string>();
  for (const { refs } of taskRefs) {
    for (const ref of refs) {
      referencedIds.add(ref);
    }
  }

  // Every criterion must be cited by at least one task
  const uncovered: string[] = [];
  for (const id of criterionIds) {
    if (!referencedIds.has(id)) {
      uncovered.push(id);
    }
  }
  if (uncovered.length > 0) {
    errors.push({
      rule: "coverage/uncovered-criterion",
      message: `Criteria not cited by any task: ${uncovered.join(", ")}`,
    });
  }

  // Every task reference must resolve to a real criterion
  const unresolvable: string[] = [];
  for (const { taskId, refs } of taskRefs) {
    for (const ref of refs) {
      if (!criterionIds.has(ref)) {
        unresolvable.push(`${taskId} \u2192 ${ref}`);
      }
    }
  }
  if (unresolvable.length > 0) {
    errors.push({
      rule: "coverage/unresolvable-ref",
      message: `Tasks reference non-existent criteria: ${unresolvable.join(", ")}`,
    });
  }

  // Every leaf task must have at least one reference
  const missingRef: string[] = [];
  for (const { taskId, refs, isLeaf } of taskRefs) {
    if (isLeaf && refs.length === 0) {
      missingRef.push(taskId);
    }
  }
  if (missingRef.length > 0) {
    errors.push({
      rule: "coverage/missing-ref",
      message: `Leaf tasks with no Requirements: reference: ${missingRef.join(", ")}`,
    });
  }

  return errors;
}

export const specApproveSchema = {
  name: z.string(),
  phase: z
    .enum(["requirements", "design", "tasks"])
    .describe("Phase to mark approved"),
};

type ApprovablePhase = "requirements" | "design" | "tasks";

const NEXT_PHASE: Record<ApprovablePhase, SpecPhase> = {
  requirements: "design",
  design: "tasks",
  tasks: "implementation",
};

const PHASE_GUIDANCE: Record<SpecPhase, string> = {
  requirements: "",
  design: `Next: read and fill out design.md, then call spec_approve(name: "<name>", phase: "design") when ready.`,
  tasks: `Next: read and fill out tasks.md with implementation tasks, then call spec_approve(name: "<name>", phase: "tasks") when ready.`,
  implementation: `Next: implement the tasks. Use spec_task_complete to mark tasks done as you go.`,
  done: `Spec is complete. No further action needed.`,
};

export async function specApprove(
  { name, phase }: { name: string; phase: ApprovablePhase },
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const state = loadState(projectRoot, name);
  if (!state) return err(`Spec '${name}' not found.`);

  if (state.phase !== phase) {
    return err(
      `Cannot approve '${phase}' — current phase is '${state.phase}'. Approve in order.`,
    );
  }

  // --- Validation gate (v2 specs only) ---
  if (state.specVersion && state.specVersion >= 2) {
    const dir = specPath(projectRoot, name);
    const allErrors: ValidationError[] = [];
    const specType = state.specType || "feature";

    if (phase === "requirements") {
      const reqFile = join(dir, "requirements.md");
      if (existsSync(reqFile)) {
        const content = readFileSync(reqFile, "utf-8");
        allErrors.push(...validateRequirementsFormat(content, specType));
      }
    } else if (phase === "design") {
      const designFile = join(dir, "design.md");
      const reqFile = join(dir, "requirements.md");
      if (existsSync(designFile)) {
        const content = readFileSync(designFile, "utf-8");
        const reqContent = existsSync(reqFile) ? readFileSync(reqFile, "utf-8") : "";
        allErrors.push(...validateDesignFormat(content, reqContent));
      }
    } else if (phase === "tasks") {
      const tasksFile = join(dir, "tasks.md");
      const reqFile = join(dir, "requirements.md");
      if (existsSync(tasksFile) && existsSync(reqFile)) {
        const tasksContent = readFileSync(tasksFile, "utf-8");
        const reqContent = readFileSync(reqFile, "utf-8");
        allErrors.push(...validateTasksFormat(tasksContent));
        allErrors.push(...validateCoverage(reqContent, tasksContent));
      }
    }

    if (allErrors.length > 0) {
      const errorList = allErrors
        .map((e) => `  ${e.rule}: ${e.message}`)
        .join("\n");
      return err(
        `Cannot approve '${phase}' — ${allErrors.length} validation error(s):\n\n${errorList}`,
      );
    }
  }
  // --- End validation gate ---

  state.approved[phase] = true;

  const next = NEXT_PHASE[phase];
  state.phase = next;

  saveState(projectRoot, name, state);

  const guidance = PHASE_GUIDANCE[next].replace("<name>", name);

  return ok(
    `Approved '${phase}' for spec '${name}'. Phase advanced to '${next}'.\n\n${guidance}`,
  );
}

export const specTaskCompleteSchema = {
  name: z.string(),
  taskId: z.string().describe("Task ID like '1' or '1.2'"),
};

export async function specTaskComplete(
  { name, taskId: rawTaskId }: { name: string; taskId: string },
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const taskId = rawTaskId.replace(/\.$/, "");
  const state = loadState(projectRoot, name);
  if (!state) return err(`Spec '${name}' not found.`);
  if (state.phase !== "implementation") {
    return err(
      `Cannot complete tasks — spec is in '${state.phase}' phase. Approve tasks first.`,
    );
  }

  const tasksFile = join(specPath(projectRoot, name), "tasks.md");
  if (!existsSync(tasksFile)) return err(`tasks.md not found.`);

  let content = readFileSync(tasksFile, "utf-8");
  const task = findTask(content, taskId);
  if (!task) return err(`Task '${taskId}' not found in tasks.md.`);
  if (task.completed) {
    // Even if the task is already complete, check whether all top-level tasks
    // are done and the phase should transition (fixes stuck "implementation" phase)
    if (isParentTask(taskId) && state.phase === "implementation") {
      const allTasks = content
        .split("\n")
        .map(parseTask)
        .filter((t): t is ParsedTask => t !== null);
      const topLevel = allTasks.filter((t) => isParentTask(t.id));
      const allDone = topLevel.every((t) => t.completed || t.manual);
      if (allDone && topLevel.length > 0) {
        state.phase = "done";
        saveState(projectRoot, name, state);
        return ok(
          `Task ${taskId} was already complete.\n\n🎉 All tasks complete — spec '${name}' moved to phase: done.`,
        );
      }
    }
    return ok(`Task ${taskId} was already complete.`);
  }

  if (isParentTask(taskId)) {
    const children = getChildTasks(content, taskId);
    // Filter out manual tasks — they don't block parent completion
    const incomplete = children.filter((c) => !c.completed && !c.manual);
    if (incomplete.length > 0) {
      return err(
        `Cannot complete parent task '${taskId}' — ${incomplete.length} child task(s) still incomplete: ${incomplete.map((c) => c.id).join(", ")}`,
      );
    }
  }

  const lines = content.split("\n");
  // Header-format tasks (## Task N:) have no checkbox to mark — they're
  // implicitly complete when all children are done. We insert a checked
  // checkbox line right after the header so the file reflects completion.
  if (task.raw.startsWith("##")) {
    lines.splice(
      task.lineIndex + 1,
      0,
      `- [x] ${task.id}. ${task.description}`,
    );
  } else {
    lines[task.lineIndex] = task.raw.replace(/\[ \]/, "[x]");
  }
  writeFileSync(tasksFile, lines.join("\n"));

  let commitInfo = "";
  if (isParentTask(taskId) && state.autoCommit !== false) {
    const result = gitCommit(projectRoot, name, task.description);
    if (result.committed) {
      commitInfo = `\nAuto-committed: ${result.sha} — "${result.message}"`;
    } else {
      commitInfo = `\nNo commit created (${result.reason})`;
    }
  }

  // Check if all top-level tasks are now complete → transition to "done"
  let phaseInfo = "";
  if (isParentTask(taskId)) {
    const updatedContent = readFileSync(tasksFile, "utf-8");
    const allTasks = updatedContent
      .split("\n")
      .map(parseTask)
      .filter((t): t is ParsedTask => t !== null);
    const topLevel = allTasks.filter((t) => isParentTask(t.id));
    const allDone = topLevel.every((t) => t.completed || t.manual);
    if (allDone && topLevel.length > 0) {
      state.phase = "done";
      saveState(projectRoot, name, state);
      phaseInfo = `\n\n🎉 All tasks complete — spec '${name}' moved to phase: done.`;
    }
  }

  return ok(
    `Marked task ${taskId} complete: ${task.description}${commitInfo}${phaseInfo}`,
  );
}

export const specReadSchema = {
  name: z.string().describe("Spec name"),
  file: z
    .enum(["requirements", "design", "tasks"])
    .describe("Which spec file to read"),
};

export async function specRead(
  { name, file }: { name: string; file: "requirements" | "design" | "tasks" },
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const state = loadState(projectRoot, name);
  if (!state) return err(`Spec '${name}' not found.`);

  const filePath = join(specPath(projectRoot, name), `${file}.md`);
  if (!existsSync(filePath))
    return err(`${file}.md not found for spec '${name}'.`);

  const content = readFileSync(filePath, "utf-8");
  return ok(`Phase: ${state.phase}\n\n--- ${file}.md ---\n${content}`);
}

// ---------------------------------------------------------------------------
// Requirements analysis
// ---------------------------------------------------------------------------

const ANALYSIS_RUBRIC = `
## Requirements Analysis Rubric

You are analyzing a requirements document. Perform the following five checks in order.
For each finding, present a binary A/B question to the user.

### Check 1: Ambiguity
Scan each acceptance criterion for words or phrases with 2+ plausible interpretations.

Common ambiguity triggers: "remove", "handle", "process", "manage", "appropriate", "ensure",
"support", "properly", "relevant", "necessary", "as needed", "efficient", "flexible"

For each ambiguous term: state the criterion, explain the two interpretations, and ask:
- **A)** Keep as-is: [what the current wording implies]
- **B)** Change to: [specific revised wording that resolves the ambiguity]

### Check 2: Conflicts
Compare pairs of criteria whose triggers (WHEN/WHILE/IF conditions) can co-activate.
Look for cases where the required responses contradict each other.

Pay special attention to ubiquitous criteria (bare SHALL with no WHEN/WHILE/IF) —
they apply in ALL situations and can conflict with any event-driven or state-driven criterion.

For each conflict: state both criteria, explain the scenario where they conflict, and ask:
- **A)** Keep as-is: [which criterion wins by default]
- **B)** Change to: [how to narrow one criterion to resolve the conflict]

### Check 3: Completeness
For each WHEN trigger, ask: what happens when the opposite condition is true?
Is there a criterion covering that case?

Look for missing paths:
- Invalid or malformed input
- Entity not found / does not exist
- Unauthorized access
- Empty states (no items, no data)
- Concurrent modifications
- User cancellation or interruption
- Boundary values (zero, empty string, maximum)

For each gap: describe the uncovered scenario and ask:
- **A)** Keep as-is: silence is intentional (no behavior needed for this case)
- **B)** Add criterion: [specific new EARS criterion to cover the gap]

### Check 4: Solution Leakage
Scan for implementation details masquerading as requirements.

Red flags: specific technologies ("use JWT", "store in Redis"), algorithms
("implement soft deletion"), internal mechanisms ("retry with exponential backoff"),
data structures ("use a hash map"), architecture choices ("use a microservice")

Requirements should describe observable behavior, not mechanism.

For each finding: state the criterion, explain what's prescriptive, and ask:
- **A)** Keep as-is: the implementation detail is an intentional constraint
- **B)** Change to: [rewritten criterion describing observable behavior only]

### Check 5: Testability
Scan for vague qualifiers with no measurable threshold.

Red flags: "quickly", "efficiently", "user-friendly", "securely", "appropriately",
"reasonable", "performant", "scalable", "robust", "intuitive", "seamless"

Also check for criteria that don't name an observable output or measurable condition.

For each finding: state the criterion, explain what's unmeasurable, and ask:
- **A)** Keep as-is: the vague qualifier is acceptable for this context
- **B)** Change to: [rewritten criterion with a specific threshold or observable condition]

### Output Format

Present your findings as:

## Requirements Analysis Findings

### Finding 1: [Category] — [short description]
**Criterion:** [quote the affected criterion]
**Issue:** [explain the problem]

**A)** Keep as-is: [what this means]
**B)** Change to: [specific proposed revision]

### Finding 2: ...
(continue for all findings)

---

If no findings across all five checks, output:
"✅ No issues found. Requirements are ready for approval."

Then proceed to show the user the requirements and ask "ready to approve?"
`.trim();

export const specAnalyzeSchema = {
  name: z.string().describe("Spec name to analyze"),
};

export async function specAnalyze(
  { name }: { name: string },
  { projectRoot }: AppContext,
): Promise<ToolResult> {
  const state = loadState(projectRoot, name);
  if (!state) return err(`Spec '${name}' not found.`);

  const reqFile = join(specPath(projectRoot, name), "requirements.md");
  if (!existsSync(reqFile)) {
    return err(`requirements.md not found for spec '${name}'.`);
  }

  const content = readFileSync(reqFile, "utf-8");

  return ok(
    `--- requirements.md ---\n${content}\n\n--- Analysis Rubric ---\n${ANALYSIS_RUBRIC}`,
  );
}

export function anySpecInPhase(projectRoot: string, phase: SpecPhase): boolean {
  const root = specsRoot(projectRoot);
  if (!existsSync(root)) return false;
  return readdirSync(root).some((d) => {
    const state = loadState(projectRoot, d);
    return state?.phase === phase;
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const specTools: ToolDef[] = [
  {
    name: "spec_create",
    description:
      "Create a new feature spec with requirements/design/tasks scaffolding. Initializes in 'requirements' phase. NOTE: Calling this tool will dynamically expose the hidden `spec_analyze` tool.",
    schema: specCreateSchema,
    handler: specCreate as ToolDef["handler"],
  },
  {
    name: "spec_status",
    description:
      "Get status of a spec (phase, approvals, task progress) or list all specs if no name given. NOTE: Calling this tool will dynamically expose the hidden `spec_analyze` tool if a spec is in the requirements phase.",
    schema: specStatusSchema,
    handler: specStatus as ToolDef["handler"],
  },
  {
    name: "spec_approve",
    description:
      "Approve the current phase and advance to the next. Phases are gated: requirements → design → tasks → implementation. NOTE: This may hide the `spec_analyze` tool once requirements are approved.",
    schema: specApproveSchema,
    handler: specApprove as ToolDef["handler"],
  },
  {
    name: "spec_read",
    description:
      "Read a spec file (requirements.md, design.md, or tasks.md). Returns the file content along with current phase.",
    schema: specReadSchema,
    handler: specRead as ToolDef["handler"],
  },
  {
    name: "spec_task_complete",
    description:
      "Mark a task complete in tasks.md. Parent tasks auto-commit (and require all children done first).",
    schema: specTaskCompleteSchema,
    handler: specTaskComplete as ToolDef["handler"],
  },
  {
    name: "spec_analyze",
    description:
      "Analyze requirements for ambiguity, conflicts, completeness gaps, solution leakage, and testability. Returns requirements content with an analysis rubric for the agent to follow. Use during requirements phase before approval.",
    schema: specAnalyzeSchema,
    handler: specAnalyze as ToolDef["handler"],
  },
];
