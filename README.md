# Super Dev MCP

Give your dev workflow super powers.

An [MCP server](https://modelcontextprotocol.io/) that plugs into **Zed**, **Claude Desktop**, **Cursor**, or any MCP client — adding structured planning, deep code review, and design workflows on top of your AI coding agent.

🔨 **Spec-driven development** — go from idea to implementation with structured requirements → design → tasks phases

🔍 **Code review** — senior-engineer-style review with web validation

🎨 **Design workflows** — setup, build, review, and polish UI surfaces

🧵 **Conversation history** — search and reference past coding sessions

🔊 **Voice mode** — hands-free TTS feedback with Siri neural voices (macOS)

🔀 **Upstream merges** — policy-based conflict resolution for forks

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Quick Start

```bash
git clone https://github.com/inkbitco/super-dev-mcp.git
cd super-dev-mcp
npm install
```

That's it — `npm install` automatically builds the project.

## Setup

### Zed Editor

Add to your project's `.zed/settings.json`:

```json
{
  "context_servers": {
    "super-dev": {
      "command": "/path/to/super-dev-mcp/run.sh",
      "args": []
    }
  }
}
```

### Claude Desktop / Other MCP Clients

Point the client at `run.sh`, or directly at `node /path/to/super-dev-mcp/dist/index.js`.

> **Why `run.sh`?** GUI-launched editors don't inherit your shell's nvm/fnm setup. The wrapper sources your shell profile so Node resolves correctly.

### Project Root Resolution

The server determines which project it's operating on (in priority order):

1. `SUPER_DEV_PROJECT_ROOT` env var
2. MCP `roots/list` — asks the client for workspace roots
3. `process.cwd()` fallback

## Slash Commands

Markdown files in `prompts/` — each becomes a slash command in your agent panel.

| Command | Purpose |
|---------|---------|
| `/spec-plan` | Drive a requirements → design → tasks workflow with idea pressure-testing and web research |
| `/spec-execute` | Orchestrate implementation using sub-agents for each task |
| `/code-review` | Senior-engineer-style code review |
| `/design-setup` | Generate or refresh `PRODUCT.md` and `DESIGN.md` |
| `/design-build` | Plan and implement a new UI surface |
| `/design-review` | Design director critique with heuristic scoring |
| `/design-polish` | Refine existing UI |
| `/toggle-voice-mode` | Enable/disable TTS voice feedback |
| `/upstream-merge` | Guided upstream merge workflow |

## Tools

**Spec workflow** — `spec_create` · `spec_read` · `spec_status` · `spec_approve` · `spec_task_complete`

**Rules** — `load_rules` — loads project rules from `.rules/` with glob-based auto-matching

**Thread history** — `thread_list` · `thread_read` · `thread_search`

**Voice mode** — `voice_mode` — toggle TTS with macOS speech synthesis

**Upstream merge** — `upstream_init` · `upstream_status` · `upstream_merge_start` (+ merge-resolution tools that appear during active merges)

## Resources

Every rule in `.rules/` is exposed as a `rule://<name>` MCP Resource for clients that support it. Clients without resource support can use the `load_rules` tool instead.

## Spec Workflow

1. Run `/spec-plan` and describe your feature
2. Agent calls `spec_create` to scaffold the spec
3. Iterate through **requirements → design → tasks** with approval gates
4. Run `/spec-execute` to implement — delegates to sub-agents per task
5. Specs live in `.specs/<feature>/` in the consuming project

## Extending

**Add a slash command** — drop a `.md` file in `prompts/`. The first `# Heading` becomes the description.

**Add a tool** — create a module in `src/lib/`, export a `ToolDef[]` array, register in `src/index.ts`.

**Add a rule** — create a `.md` file in your project's `.rules/` with YAML front-matter:

```yaml
---
inclusion: always              # loaded every time
inclusion: auto                # loaded when a matching file is in context
fileMatchPattern: "**/*.tsx"
---
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run directly via tsx |
| `npm start` | Run the compiled server |

## License

[MIT](LICENSE)
