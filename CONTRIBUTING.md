# Contributing to super-dev

Thanks for your interest in contributing! This is an MCP server for Zed that gives your AI coding agent superpowers — spec-driven workflows, code review, bug hunting, design workflows, voice mode, and more. We'd love your help making it better.

## Quick Start

```bash
git clone https://github.com/nickjessop/super-dev.git
cd super-dev
npm install
npm run build   # compiles TypeScript → dist/
npm run dev      # runs with tsx (hot reload)
```

The entry point is `src/index.ts`, which compiles to `dist/index.js`. Run the built server with `npm start`.

## Adding a New Tool

Tools live in `src/lib/`. Each file exports a `ToolDef[]` array.

1. Create `src/lib/my-tool.ts`:

```typescript
import { z } from "zod";
import type { ToolDef, AppContext } from "../types.js";
import { ok, err } from "../types.js";

export const myTools: ToolDef[] = [
  {
    name: "my_tool",
    description: "Does something useful",
    schema: {
      input: z.string().describe("What to process"),
    },
    handler: async (args: Record<string, unknown>, ctx: AppContext) => {
      const input = args.input as string;
      // do the thing
      return ok(`Processed: ${input}`);
    },
  },
];
```

2. Register it in `src/index.ts`:
   - Import your tools array
   - Add a registration loop (see existing examples in the file)
   - If your tool belongs to a feature group, add entries to `TOOL_GROUPS` so users can disable it via `SUPER_DEV_DISABLE`

**Key conventions:**
- Use `ok()` and `err()` helpers for consistent tool results
- Schema is a plain object of `zod` types (not wrapped in `z.object()`)
- Keep tool names `snake_case`
- If your tool should be disableable, register it in `TOOL_GROUPS` with a group name (e.g. `my_tool: "mygroup"`)

## Adding a New Prompt

Prompts are slash commands exposed to the AI agent. Just drop a `.md` file in the `prompts/` directory. The filename becomes the prompt name.

## Adding a Zed Skill

Skills are pure-instruction prompts that live outside the MCP server — they're auto-detected by Zed and don't require a server round-trip.

1. Create a directory in `skills/<name>/` with a `SKILL.md` file
2. The first paragraph of `SKILL.md` becomes the skill's description for auto-detection
3. Run `/super-dev-update` (or call the `super_dev_update` tool) to symlink it into `~/.agents/skills/`

Use skills for instruction-only prompts with no MCP tool dependencies (e.g. code-review, design, bug-hunt). Use MCP prompts in `prompts/` when the prompt needs to orchestrate MCP tools.

## Adding Project Rules

Rules live in `.rules/` as markdown files with YAML front-matter that controls when they're included:

```markdown
---
inclusion: auto
fileMatchPattern: "src/**/*.ts"
---

Your rule content here.
```

## Code Style

- **TypeScript** — strict mode, no `any` unless truly unavoidable
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `chore:`, etc.
- Keep files focused. One tool domain per file in `src/lib/`
- Prefer early returns over deep nesting
- Use `ok()` / `err()` instead of raw `CallToolResult` objects

## Testing

Run the test suite and verify TypeScript compilation:

```bash
npx tsx --test test/*.test.ts
npm run build   # type-check + compile — must pass cleanly
```

If you're adding a tool, manually verify it works by running `npm run dev` and calling it from Zed.

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes — keep commits focused and conventional
3. Run `npm run build` to make sure everything compiles
4. Open a PR against `main` with a clear description of what and why
5. Link any related issues

Small PRs are easier to review. If you're planning something big, open an issue first so we can discuss the approach.

## Reporting Bugs & Requesting Features

Use [GitHub Issues](https://github.com/nickjessop/super-dev/issues).

- **Bugs**: what happened, what you expected, steps to reproduce, and your Node/npm versions
- **Feature requests**: the problem you're solving and any ideas for the approach

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

Questions? Open an issue or start a discussion. We're happy to help you get started. 🚀
