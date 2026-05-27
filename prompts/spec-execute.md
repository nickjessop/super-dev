# Execute Spec Tasks

You are executing the implementation tasks for a spec. Your role is **orchestrator** — you delegate work to sub-agents, review results, and track progress. You do NOT implement tasks directly in this thread.

## Step 1: Identify the spec

If I included a spec name after `/spec-execute` (e.g. "/spec-execute split-sharepoint-onedrive"), use that name and skip straight to Step 2.

Otherwise, call `spec_status()` (no name) to list all specs, then:

- **One or more specs in `implementation` phase** → suggest the most likely one and ask me to confirm (e.g. "I see `split-sharepoint-onedrive` is ready for implementation. Start executing?")
- **No specs in `implementation` phase** → tell me and stop (tasks need to be approved first via `/spec-plan`)

## Step 2: Load full context

Call these in parallel:
- `spec_status({ name })` — get current phase, task progress, and task list
- `spec_read({ name, file: "design" })` — load the implementation blueprint
- `spec_read({ name, file: "requirements" })` — load acceptance criteria

Before proceeding, check:
- **All tasks already complete** → tell me (e.g. "All 12/12 tasks for `xyz` are already done. Did you mean a different spec?") and stop.
- **Not yet in `implementation` phase** → the spec has unapproved phases. Since I'm asking you to execute, that's implicit approval. Call `spec_approve` for each remaining phase to advance to `implementation` (e.g. if in `tasks` phase, call `spec_approve(name, "tasks")`; if in `design`, approve `design` then `tasks`). Then continue.

## Step 3: Assess progress

Review the task list. Identify:
- **Completed tasks** — already marked `[x]`, skip these
- **Next incomplete tasks** — the ones to work on now
- **Independent tasks** — tasks with no dependency on each other (can run in parallel)
- **Dependent tasks** — tasks that must wait for others to finish first

Present a brief summary:
> "Spec `xyz`: 4/12 tasks complete. Next up: tasks 2.1, 2.2 (parallel), then 2.3 (depends on 2.1). Ready to start?"

Wait for my confirmation before executing.

## Step 4: Execute via sub-agents

For each task (or group of independent tasks), delegate to sub-agents.

**Each sub-agent message MUST include:**
1. The specific task ID and description
2. The relevant section(s) from design.md — architecture, data model, API shape, whatever the task needs
3. The relevant requirement numbers and their acceptance criteria from requirements.md
4. The file paths and project conventions the task will touch
5. Any context from previously completed tasks that this task depends on

**Parallel execution:** If tasks 2.1 and 2.2 are independent, delegate both simultaneously. Wait for both to complete before moving to 2.3 if it depends on them.

**Scope each delegation tightly.** A sub-agent should be able to complete its task without reading the entire codebase. Give it exactly the files and context it needs.

## Step 5: Review and complete

After each sub-agent finishes:
1. Briefly review what it did (check the summary it returns)
2. If the work looks correct, call `spec_task_complete({ name, taskId })` for each subtask
3. When all subtasks under a parent are done, call `spec_task_complete({ name, taskId })` for the parent — **this auto-commits with a meaningful message**
4. If something looks wrong, either fix it with a follow-up delegation or flag it for me

## Step 6: Repeat

Move to the next wave of tasks. Continue until all tasks are complete or you hit a blocker.

## Special task types

- **"Run: <command>"** — execute the command yourself, don't delegate
- **"Ask user to run X"** — ask me, wait for confirmation
- **Checkpoints** (e.g. "Checkpoint — verify tests pass") — ask me to verify, wait for my confirmation before marking complete

## Rules

- **Do NOT implement tasks directly in this thread.** Delegate to sub-agents. This thread is for orchestration only.
- **Do NOT skip tasks or reorder them** unless you've verified there are no dependencies.
- **Do NOT manually run git commit.** The `spec_task_complete` tool handles commits automatically on parent task completion.
- **Do NOT mark a task complete without verifying the work.**
- **Do NOT scan the full codebase.** Read only the files relevant to the current task.
- **Stop and ask me** if a task is ambiguous, blocked, or if you discover the design needs revision.

Begin by identifying the spec (Step 1), then load context and assess progress before executing.
