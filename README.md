<p align="center">
  <img src=".github/logo.png" alt="Super Dev" width="500">
</p>
<p align="center">
  Give your dev workflow super powers.
</p>

Super Dev is an [MCP server](https://modelcontextprotocol.io/) that plugs into **Zed**, **Claude Desktop**, **Cursor**, or any MCP client, adding structured planning, deep code review, and design workflows on top of your AI coding agent.

🔨 **Spec-driven development**: go from idea to implementation with structured requirements → design → tasks phases

🔍 **Code review**: senior-engineer-style review with web validation

🎨 **Design workflows**: build, refine, and review UI surfaces with design system memory

🧵 **Conversation history**: search and reference past coding sessions (Zed only)

🔊 **Voice mode**: hands-free TTS feedback with Siri neural voices (Zed + macOS)

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

## Setup

### Zed Editor

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

### Claude Desktop / Other MCP Clients

Point the client at `run.sh`, or directly at `node /path/to/super-dev/dist/index.js`.

> **Why `run.sh`?** GUI-launched editors don't inherit your shell's nvm/fnm setup. The wrapper sources your shell profile so Node resolves correctly.

### Project Root Resolution

The server determines which project it's operating on (in priority order):

1. `SUPER_DEV_PROJECT_ROOT` env var
2. MCP `roots/list`: asks the client for workspace roots
3. `process.cwd()` fallback

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
| `review` | — | /code-review |
| `design` | — | /design, /design-review |
| `rules` | load_rules + rule:// resources | — |
| `threads` | thread_list, thread_read, thread_search | — |
| `voice` | voice_mode | /toggle-voice-mode |
| `upstream` | upstream_status + all merge tools | /upstream-merge |

## Quick Reference

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/spec-plan` | Drive a requirements → design → tasks workflow with idea pressure-testing and web research |
| `/spec-execute` | Orchestrate implementation using sub-agents for each task |
| `/code-review` | Senior-engineer-style code review |
| `/design` | Build new UI or refine existing, with design system setup built in |
| `/design-review` | Design director critique with heuristic scoring |
| `/toggle-voice-mode` | Enable/disable TTS voice feedback |
| `/upstream-merge` | Guided upstream merge workflow |

### Tools

| Tool | Purpose |
|------|--------|
| `spec_create` | Scaffold a new spec with requirements/design/tasks |
| `spec_read` | Read a spec file (requirements, design, or tasks) |
| `spec_status` | List all specs or get details on one |
| `spec_approve` | Approve current phase and advance to the next |
| `spec_task_complete` | Mark a task complete; parent tasks auto-commit |
| `spec_analyze` | Analyze requirements for quality issues (ambiguity, conflicts, completeness, testability) |
| `load_rules` | Load project rules from `.rules/` with glob-based auto-matching |
| `thread_list` | List recent Zed agent conversation threads |
| `thread_read` | Read a thread by ID with pagination and search |
| `thread_search` | Full-text search across conversation content |
| `voice_mode` | Toggle TTS with macOS speech synthesis |
| `upstream_status` | Check upstream status, initialize config, or start a merge |

Upstream merge-resolution tools (`upstream_categorize_changes`, `upstream_resolve_file`, `upstream_resolve_batch`, `upstream_diff_file`, `upstream_verify`, `upstream_complete`, `upstream_abort`) appear only during active merges.

### Resources

Every rule in `.rules/` is exposed as a `rule://<name>` MCP Resource for clients that support it. Clients without resource support can use the `load_rules` tool instead.

---

## Features

### Spec-Driven Development

Go from a rough idea to shipped code with structured phases and approval gates.

1. **`/spec-plan`**: describe your feature. The agent pressure-tests the idea, does web research, and helps you think through edge cases before any code is written.
2. **`spec_create`**: scaffolds `.specs/<feature>/` in your project with `requirements.md`, `design.md`, `tasks.md`, and `state.json`.
3. **Requirements → Design → Tasks**: each phase must be explicitly approved before the next unlocks. During the requirements phase, `spec_analyze` checks for ambiguity, conflicts, completeness gaps, solution leakage, and testability — surfacing findings as A/B questions you answer before approval.
4. **`/spec-execute`**: orchestrates implementation by delegating tasks to sub-agents. The main thread stays clean for coordination while sub-agents do the coding.
5. **Auto-commit**: when a parent task is marked complete, the agent automatically commits the work with a conventional commit message. Opt out per-spec with `autoCommit: false`.

Specs live in `.specs/<feature>/` in the consuming project (gitignored by default).

### Code Review

Run `/code-review` and point it at specific files, a git diff, unstaged changes, or a particular area of concern. The agent reviews as a senior engineer:

- Identifies bugs, performance issues, and security concerns
- Searches the web for similar implementations and official documentation to validate patterns
- Reports what's done well, what's concerning, and concrete recommendations

### Design Workflows

Two commands for building and evaluating UI:

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

### Project Rules

Rules are markdown files in your project's `.rules/` directory that give the agent project-specific context. Each rule has YAML front-matter controlling when it's loaded:

```yaml
---
inclusion: always              # loaded every time load_rules is called
---
```

```yaml
---
inclusion: auto                # loaded only when working on matching files
fileMatchPattern: "src/**/*.tsx"
---
```

```yaml
---
inclusion: manual              # loaded only when explicitly requested
---
```

The `load_rules` tool uses glob matching so the agent only receives rules relevant to the file it's working on, keeping context focused. For clients that support MCP Resources, rules are also exposed as `rule://<name>` resources.

### Conversation History

Search and read past Zed agent threads directly from the agent panel. Useful for recovering context from previous sessions, finding where a decision was made, or referencing past work.

> **Zed + macOS only.** Reads directly from Zed's `threads.db` SQLite database with zstd decompression.

- **`thread_list`**: browse recent threads with summaries, timestamps, and project folders. Filter by project.
- **`thread_search`**: full-text search across conversation content (not just titles). Decompresses Zed's zstd-compressed thread data and searches the actual messages.
- **`thread_read`**: read a specific thread. Large threads (20+ messages) return a table of contents first; use offset or search to navigate to specific sections. Supports message truncation to manage context usage.

### Voice Mode

Hands-free TTS feedback using macOS speech synthesis. Run `/toggle-voice-mode` or call the `voice_mode` tool directly.

> **Zed + macOS only.** Monitors Zed's conversation database and uses the macOS `say` command.

- Uses the macOS `say` command with support for Siri neural voices (via the "system" voice option)
- Spawns a detached watcher process that monitors Zed's conversation file for new agent responses
- Scoped to the current project to prevent cross-project interference
- Skips reading sub-agent results by default to avoid noise during multi-agent workflows
- Interrupts active speech immediately when you send a new message

Configure via Zed settings env vars: `SUPER_DEV_VOICE` (voice name), `SUPER_DEV_VOICE_RATE` (words per minute), `SUPER_DEV_SPEECH_MODE` (summary or full).

### Upstream Merges

For projects that fork or customize an upstream template repository. Run `/upstream-merge` to start a guided merge workflow.

**Setup**: call `upstream_status` with `remote_url` to configure your upstream remote. Creates `.upstream.json` with:

- **Policies**: files to `always_ours` (keep your version), `always_theirs` (take upstream), or `manual_review` (always stop and ask)
- **Categories**: group files by type (dependencies, UI components, infrastructure) with glob patterns

**Merge workflow:**

1. **Assessment**: check how many commits you're behind, review what changed
2. **Start merge**: creates a dedicated branch, identifies conflicts, categorizes all changed files
3. **Resolution**: batch-resolve files with clear policies, then work through manual conflicts one by one with diffs and recommendations
4. **Verification**: run typecheck, lint, and tests to validate the result
5. **Complete**: commit, merge to target branch, clean up

Merge-resolution tools (`upstream_categorize_changes`, `upstream_resolve_file`, `upstream_resolve_batch`, `upstream_diff_file`, `upstream_verify`, `upstream_complete`, `upstream_abort`) are hidden until a merge is active, then disappear when it completes.

---

## Architecture

A few deliberate design choices:

**Minimal tool surface.** MCP tools consume context window and decision-making overhead for the agent. Every always-visible tool has to justify its presence. Related actions are consolidated into single tools with optional parameters (e.g. `upstream_status` handles init, status checks, and merge starts) rather than exposing three separate tools.

**Progressive tool exposure.** Tools that only make sense during a specific workflow are hidden until needed. The 7 upstream merge-resolution tools only appear after a merge is started, then disappear when it completes or aborts. Similarly, `spec_analyze` only appears when a spec is in the requirements phase. This keeps the agent focused.

**Consolidated prompts.** Slash commands are kept to a minimum by combining related workflows. `/design` handles both building new UI and refining existing surfaces rather than splitting into separate build/polish/setup commands. The agent figures out the mode from context.

**Prompts for orchestration, tools for mechanics.** Multi-step workflows like spec planning, code review, and design are driven by prompts (markdown instructions) that let the agent adapt to context. Tools handle the mechanical parts: creating files, managing state transitions, marking tasks complete, git operations. The spec workflow is the most tool-heavy, with 5 tools for managing the lifecycle, but the actual planning and decision-making happens in the prompt.

## Extending

**Add a slash command**: drop a `.md` file in `prompts/`. The first `# Heading` becomes the description.

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
