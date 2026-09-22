<p align="center">
  <img src=".github/logo.png" alt="Super Dev" width="500">
</p>
<p align="center">
  Give your dev workflow super powers.
</p>

Super Dev is an [MCP server](https://modelcontextprotocol.io/) for **Zed** that adds structured planning, deep code review, and design workflows on top of your AI coding agent.

🔨 **Spec-driven development**: go from idea to implementation with structured requirements → design → tasks phases

🔍 **Code review**: adversarial dual-track review with architecture audit and security/logic hunt (Zed skills)

🐛 **Bug hunting**: multi-stage vulnerability discovery with parallel hunters and adversarial validation (Zed skills)

🎨 **Design workflows**: build, refine, and review UI surfaces with design system memory (Zed skills)

📊 **Architecture viewer**: interactive multi-diagram canvas with pan/zoom, live reload, and side-by-side node inspector

✅ **Task tracking**: lightweight todo lists for ad-hoc multi-step work outside of specs

🔄 **Self-updating**: sync skills, pull latest, and rebuild from any project with a single command

🧵 **Conversation history**: search and reference past coding sessions

🔊 **Voice mode**: hands-free TTS feedback with Siri neural voices (macOS)

🔀 **Upstream merges**: policy-based conflict resolution for forks

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Quick Start

```bash
git clone https://github.com/nickjessop/super-dev.git
cd super-dev
npm install
```

`npm install` automatically builds the project via the `prepare` script.

Then install the Zed skills:

```bash
# From within Zed, run /super-dev-update
# Or manually symlink skills into ~/.agents/skills/
```

## Setup

Add to your project's `.zed/settings.json`:

```json
{
  "context_servers": {
    "super-dev": {
      "command": "/path/to/super-dev/run.sh",
      "args": []
    }
  }
}
```

> **Why `run.sh`?** GUI-launched editors don't inherit your shell's nvm/fnm setup. The wrapper sources your shell profile so Node resolves correctly. You can also point directly at `node /path/to/super-dev/dist/index.js` if your PATH is set up.

### Project Root Resolution

The server determines which project it's operating on (in priority order):

1. `SUPER_DEV_PROJECT_ROOT` env var
2. MCP `roots/list`: asks Zed for workspace roots
3. `process.cwd()` fallback

When multiple workspace roots are detected (e.g. multiple projects open in the same Zed window), project-scoped tools return a structured error with the detected roots and a ready-to-copy `SUPER_DEV_PROJECT_ROOT` snippet. Set the env var to resolve the ambiguity.

### Disabling Features

All features are enabled by default. Disable what you don't need with the `SUPER_DEV_DISABLE` env var to reduce tool clutter and context overhead:

```json
{
  "context_servers": {
    "super-dev": {
      "command": "/path/to/super-dev/run.sh",
      "env": {
        "SUPER_DEV_DISABLE": "voice,upstream,threads"
      }
    }
  }
}
```

| Group | Tools | Prompts |
|-------|-------|--------|
| `spec` | spec_create, spec_read, spec_status, spec_approve, spec_task_complete, spec_analyze | /spec-plan, /spec-execute |
| `update` | super_dev_update | /super-dev-update |
| `rules` | rule:// resources | — |
| `threads` | thread_active, thread_list, thread_read, thread_search | — |
| `voice` | voice_mode | /toggle-voice-mode |
| `upstream` | upstream_status + all merge tools | /upstream-merge |
| `todo` | todo_write, todo_read, todo_clear | — |
| `arch` | arch_view | — |

## Quick Reference

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/agent-collab` | Orchestrate autonomous multi-turn debate/collaboration between sub-agents |
| `/spec-plan` | Drive a requirements → design → tasks workflow with idea pressure-testing and web research |
| `/spec-execute` | Orchestrate implementation using sub-agents for each task |
| `/super-dev-update` | Sync skills, pull latest, and rebuild |
| `/toggle-voice-mode` | Enable/disable TTS voice feedback |
| `/upstream-merge` | Guided upstream merge workflow |

### Tools

| Tool | Purpose |
|------|--------|
| `spec_create` | Scaffold a new spec (feature or bugfix) with requirements/design/tasks |
| `spec_read` | Read a spec file (requirements, design, or tasks) |
| `spec_status` | List all specs or get details on one |
| `spec_approve` | Approve current phase and advance to the next |
| `spec_task_complete` | Mark a task complete; parent tasks auto-commit |
| `spec_analyze` | Analyze requirements for quality issues (ambiguity, conflicts, completeness, testability) |
| `arch_view` | Launch interactive architecture diagram viewer in browser with multi-diagram sidebar, pan/zoom canvas, live reload, and node inspector |
| `thread_active` | List open/active sidebar threads across all workspaces with live status |
| `thread_list` | List recent Zed agent conversation threads (supports `active_only`) |
| `thread_read` | Read a thread by ID with pagination and search |
| `thread_search` | Full-text search across conversation content |
| `voice_mode` | Toggle TTS with macOS speech synthesis |
| `super_dev_update` | Sync Zed skills, pull latest from git, and rebuild |
| `upstream_status` | Check upstream status, initialize config, or start a merge |
| `todo_write` | Create or update a todo list for ad-hoc multi-step tasks |
| `todo_read` | Read a todo list by ID, or list all todo lists |
| `todo_clear` | Clear todo lists by ID, completed-only, or all |

Upstream merge-resolution tools (`upstream_categorize_changes`, `upstream_resolve_file`, `upstream_resolve_batch`, `upstream_diff_file`, `upstream_verify`, `upstream_complete`, `upstream_abort`) appear only during active merges.

### Resources

Every rule in `.rules/` is exposed as a `rule://<name>` MCP Resource. Agents also read conventions directly using standard file inspection (`AGENTS.md`, `CLAUDE.md`, `.rules/`).

---

## Features

### Spec-Driven Development

Go from a rough idea to shipped code with structured phases and approval gates.

1. **`/spec-plan`**: describe your feature (or bug). The agent pressure-tests the idea, does web research, and helps you think through edge cases before any code is written.
2. **`spec_create`**: scaffolds `.specs/<name>/` in your project with `requirements.md`, `design.md`, `tasks.md`, and `state.json`. Supports two variants:
   - **Feature** (default): functional/non-functional requirements in EARS notation
   - **Bugfix** (`specType: "bugfix"`): Bug Condition / Preservation Checks / Fix Checks template
3. **Requirements → Design → Tasks**: each phase must be explicitly approved before the next unlocks. Approval runs validation checks:
   - **Format validation**: verifies required sections exist per phase and spec type
   - **Coverage validation**: bidirectional check that every requirement criterion is cited by at least one task, and every task reference resolves to a real criterion
   - **`spec_analyze`**: checks for ambiguity, conflicts, completeness gaps, solution leakage, and testability — surfacing findings as A/B questions you answer before approval
4. **`/spec-execute`**: orchestrates implementation by delegating tasks to sub-agents. Tasks are organized into **waves** (dependency graph) with **tiers** (`[T1]`/`[T2]`/`[T3]`) for proportional verification effort. The main thread stays clean for coordination while sub-agents do the coding.
5. **Auto-commit**: when a parent task is marked complete, the agent automatically commits the work with a conventional commit message. Opt out per-spec with `autoCommit: false`.

Specs live in `.specs/<name>/` in the consuming project (gitignored by default).

### Code Review

> **Zed skill** — lives in `skills/code-review/`, auto-detected by the agent or invoked via `/code-review`. No MCP server dependency.

Adversarial dual-track review that runs two independent analysis passes and synthesizes the results:

- **Track A — Quality & Architecture**: senior-engineer review covering correctness, performance, error handling, naming, and maintainability. Searches the web for similar implementations and official documentation to validate patterns.
- **Track B — Hunt & Disprove**: adversarial pass that actively tries to break the code — looking for security vulnerabilities, race conditions, edge cases, and logic flaws. Forms hypotheses and attempts to disprove them.
- **Consensus synthesis**: merges findings from both tracks, resolves disagreements, and delivers a unified report with what's done well, what's concerning, and concrete recommendations.

### Bug Hunting

> **Zed skills** — `skills/bug-hunt/` and `skills/bug-hunt-diff/`, invoked via `/bug-hunt` and `/bug-hunt-diff` or auto-detected. No MCP server dependency.

Two skills for proactive vulnerability discovery:

**`/bug-hunt`**: deep, multi-stage sweep across the codebase. Runs 8 stages with parallel hunters, adversarial validation, and exploit chaining. Supports quick/standard/deep scan modes. Stack-agnostic.

**`/bug-hunt-diff`**: lightweight, diff-scoped variant. Runs on uncommitted changes or the last commit. Use after finishing a feature for a fast security/logic pass. Also used as Track B of `/code-review`.

### Design Workflows

> **Zed skills** — live in `skills/design/` and `skills/design-review/`, invoked via `/design` and `/design-review` or auto-detected. No MCP server dependency.

Two skills for building and evaluating UI:

**`/design`**: the do-er. Tell it what you want to work on and it figures out the mode:

- **Build**: planning and implementing a new UI surface from scratch, with theme reasoning, color strategy, and layout decisions
- **Refine**: push existing UI in a direction (bolder, quieter, refined, distill, better hierarchy, production-ready, and more)
- **Design memory**: if `PRODUCT.md` or `DESIGN.md` don't exist in your project, it walks you through creating them first. These files capture your product's identity, brand personality, color palette, typography, and component patterns. Every subsequent design decision references them.

**`/design-review`**: the critic. Pure feedback, no code changes:

- AI slop detection (side-stripe borders, gradient text, glassmorphism, hero-metric templates, category-reflex palette choices)
- Nielsen's 10 usability heuristics scored 0–4
- Cognitive load assessment
- Design system drift checking against `DESIGN.md`
- Accessibility and responsive audit
- Persona-based red flag analysis

### Project Rules & Convention Cascade

Project standards live in standard files (`AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, or the `.rules/` directory). Agents discover and inspect them directly using standard file reading without requiring extra tool round-trips.

Rules in `.rules/` are also exposed as `rule://<name>` MCP resources for clients that support active resource binding. Each rule can have YAML front-matter:

```yaml
---
description: TypeScript conventions and strict mode patterns
fileMatchPattern: "src/**/*.ts"
---
```

### Conversation History

Search and read past Zed agent threads directly from the agent panel. Useful for recovering context from previous sessions, finding where a decision was made, or referencing past work.

> **macOS only.** Reads from Zed's `threads.db` SQLite database with zstd decompression and `0-stable/db.sqlite` for active sidebar state.

- **`thread_active`**: view currently open, unarchived chats across all Zed workspaces, with titles, projects, and last-interaction times.
- **`thread_list`**: browse recent threads with summaries, timestamps, and project folders. Filter by project, search query, or `active_only: true`.
- **`thread_search`**: full-text search across conversation content (not just titles). Decompresses zstd-compressed thread data and searches the actual messages.
- **`thread_read`**: read a specific thread. Large threads (20+ messages) return a table of contents first; use offset or search to navigate to specific sections. Supports message truncation to manage context usage.

### Multi-Agent Collaboration (`/agent-collab`)

Work out tough architectural decisions, API contracts, refactors, or bug investigations autonomously using Zed's native `spawn_agent`.

- Initiates a 2-to-3 round structured debate between specialized personas (e.g. Systems Architect vs SRE, Backend vs Frontend, Builder vs Adversary).
- Uses `session_id` to maintain stateful context across turns for each sub-agent without human copy-pasting.
- Synthesizes findings into an ADR-style deliverable with agreed direction, accepted trade-offs, and concrete next steps.
- Can ingest context from existing or active threads via `thread_active` and `thread_read`.

### Voice Mode

Hands-free TTS feedback using macOS speech synthesis. Run `/toggle-voice-mode` or call the `voice_mode` tool directly.

> **macOS only.** Monitors the conversation database and uses the macOS `say` command.

- Uses the macOS `say` command with support for Siri neural voices (via the "system" voice option)
- Spawns a detached watcher process that monitors the conversation file for new agent responses
- Scoped to the current project to prevent cross-project interference
- Skips reading sub-agent results by default to avoid noise during multi-agent workflows
- Interrupts active speech immediately when you send a new message

Configure via env vars in your Zed settings: `SUPER_DEV_VOICE` (voice name), `SUPER_DEV_VOICE_RATE` (words per minute), `SUPER_DEV_SPEECH_MODE` (summary or full).

### Upstream Merges

For projects that fork or customize an upstream template repository. Run `/upstream-merge` to start a guided merge workflow.

**Setup**: call `upstream_status` with `remote_url` to configure your upstream remote. Creates `.upstream/config.json` with:

- **Policies**: files to `always_ours` (keep your version), `always_theirs` (take upstream), or `manual_review` (always stop and ask)
- **reTimestampMigrations**: By default (`true`), upstream Supabase database migrations are dynamically re-timestamped to the moment of the merge to prevent chronological execution errors in your CI/CD pipelines. Set to `false` to disable this behavior.
- **Categories**: group files by type (dependencies, UI components, infrastructure) with glob patterns

**Merge workflow:**

1. **Assessment**: check how many commits you're behind, review what changed
2. **Start merge**: creates a dedicated branch, identifies conflicts, categorizes all changed files
3. **Resolution**: batch-resolve files with clear policies, then work through manual conflicts one by one with diffs and recommendations
4. **Verification**: run typecheck, lint, and tests to validate the result
5. **Complete**: commit, merge to target branch, clean up

Merge-resolution tools (`upstream_categorize_changes`, `upstream_resolve_file`, `upstream_resolve_batch`, `upstream_diff_file`, `upstream_verify`, `upstream_complete`, `upstream_abort`) are hidden until a merge is active, then disappear when it completes.

### Architecture Viewer

Interactive multi-diagram canvas for exploring, inspecting, and presenting system architectures. Run the `arch_view` tool to launch the browser viewer.

- **Multi-diagram discovery & sidebar navigation**: Automatically discovers all `*.md` files in `docs/architecture/` (or your configured source directory) and renders them as a clickable sidebar navigation list with diagram titles, filenames, and item counts. Switch between architecture diagrams instantly without page reloads, with active diagrams synced to URL query params (`?doc=...`).
- **Hardware-accelerated pan and zoom canvas**: Fluid navigation via CSS transforms. Hold <kbd>Spacebar</kbd> and drag or middle-click drag to pan; scroll wheel or pinch to zoom centered at your cursor. Floating viewport controls provide Zoom In (`+`), Zoom Out (`-`), Fit to View (`⛶`), and Reset (`100%`).
- **Side-by-side node inspector drawer**: Click any node or subgraph in the active diagram to slide open a dedicated right-side inspector drawer (~400px wide) displaying structured status badges, summary, invariants, and constraints rendered from markdown via Marked.js. Clicked nodes receive an active `.node-selected` highlight ring and drop shadow, and the canvas smoothly auto-pans left if a clicked node is positioned underneath the drawer. Dismiss on `✕`, <kbd>Escape</kbd>, or clicking the canvas background.
- **Ephemeral local HTTP server & debounced live watcher**: Spawns an ephemeral Node.js HTTP server bound strictly to `127.0.0.1` and watches markdown files with `fs.watch` debounced at 150ms. Real-time changes push to connected clients via Server-Sent Events (SSE), updating diagrams in real-time while preserving your active zoom and pan coordinates.
- **Client-side export**: Header controls allow one-click **Export HTML** (a standalone, self-contained portable HTML bundle for offline viewing) and **Export SVG** (vector graphic with embedded styling). Both run entirely in the browser with zero server roundtrips.
- **Zero-config auto-scaffolding**: If called when no architecture documentation exists, `arch_view` automatically scaffolds `docs/architecture/overview.md` with a clean starter Mermaid template and links it under `## Project Reference Docs` in `AGENTS.md`.

#### Configuration Schema (`.super-dev/config.json`)

Super Dev uses a unified configuration file at `.super-dev/config.json`:

```json
{
  "architecture": {
    "source": "docs/architecture",
    "reference": "AGENTS.md"
  },
  "upstream": {
    "remote": "upstream",
    "branch": "main",
    "policies": {
      "always_ours": [],
      "always_theirs": [],
      "manual_review": []
    },
    "categories": {}
  }
}
```

- `architecture.source`: Directory containing architecture markdown files, or a specific file path (defaults to `"docs/architecture"`).
- `architecture.reference`: Markdown documentation file where architecture links are referenced (defaults to `"AGENTS.md"`).

---

## Updating

Run `/super-dev-update` from any project, or call the `super_dev_update` tool directly. It:

1. **Symlinks skills** from the repo's `skills/` into `~/.agents/skills/`
2. **Pulls latest** from git
3. **Rebuilds** the MCP server

Skills update immediately via symlinks — edits to files in `skills/` are reflected in Zed without any restart. MCP tool and prompt changes require an MCP server restart to take effect.

On first run, the tool creates the symlinks. After that, `git pull && npm install` also works since symlinks are already in place.

---

## Architecture

A few deliberate design choices:

**Minimal tool surface.** MCP tools consume context window and decision-making overhead for the agent. Every always-visible tool has to justify its presence. Related actions are consolidated into single tools with optional parameters (e.g. `upstream_status` handles init, status checks, and merge starts) rather than exposing three separate tools.

**Progressive tool exposure.** Tools that only make sense during a specific workflow are hidden until needed. The 7 upstream merge-resolution tools only appear after a merge is started, then disappear when it completes or aborts. Similarly, `spec_analyze` only appears when a spec is in the requirements phase. This keeps the agent focused.

**Consolidated prompts.** Slash commands are kept to a minimum by combining related workflows. `/design` handles both building new UI and refining existing surfaces rather than splitting into separate build/polish/setup commands. The agent figures out the mode from context.

**Skills vs. MCP prompts.** Pure-instruction prompts with no MCP tool dependencies live as Zed skills in `skills/` (code-review, design, design-review). They're symlinked to `~/.agents/skills/` so Zed can auto-invoke them without a server round-trip. Tool-coupled prompts that orchestrate MCP tools stay in `prompts/` as MCP prompts (spec-plan, spec-execute, upstream-merge, etc.).

**Prompts for orchestration, tools for mechanics.** Multi-step workflows like spec planning, code review, and design are driven by prompts (markdown instructions) that let the agent adapt to context. Tools handle the mechanical parts: creating files, managing state transitions, marking tasks complete, git operations. The spec workflow is the most tool-heavy, with 5 tools for managing the lifecycle, but the actual planning and decision-making happens in the prompt.

## Extending

**Add an MCP prompt** (tool-coupled): drop a `.md` file in `prompts/`. The first `# Heading` becomes the description. Use this when the prompt needs to orchestrate MCP tools.

**Add a Zed skill** (pure instructions): create a directory in `skills/<name>/` with a `SKILL.md` file. Run `/super-dev-update` to symlink it into `~/.agents/skills/`. Use this for instruction-only prompts with no MCP tool dependencies — they auto-invoke and don't require the server.

**Add a tool**: create a module in `src/lib/`, export a `ToolDef[]` array, register in `src/index.ts`.

**Add a rule**: create a `.md` file in your project's `.rules/` with YAML front-matter (see [Project Rules](#project-rules)).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run directly via tsx |
| `npm start` | Run the compiled server |

## License

[MIT](LICENSE)
