# Contributing to super-dev-mcp

Thanks for your interest in contributing! This is an MCP server that gives AI coding agents superpowers — spec-driven workflows, thread history, voice mode, and more. We'd love your help making it better.

## Quick Start

```bash
git clone https://github.com/inkbitco/super-dev-mcp.git
cd super-dev-mcp
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

2. Register it in `src/index.ts` by importing your tools array and adding a registration loop.

**Key conventions:**
- Use `ok()` and `err()` helpers for consistent tool results
- Schema is a plain object of `zod` types (not wrapped in `z.object()`)
- Keep tool names `snake_case`

## Adding a New Prompt

Prompts are slash commands exposed to the AI agent. Just drop a `.md` file in the `prompts/` directory. The filename becomes the prompt name.

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

There's no test suite yet (contributions welcome!). For now:

```bash
npm run build   # type-check + compile — must pass cleanly
```

If you're adding a tool, manually verify it works by running `npm run dev` and calling it through an MCP client.

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes — keep commits focused and conventional
3. Run `npm run build` to make sure everything compiles
4. Open a PR against `main` with a clear description of what and why
5. Link any related issues

Small PRs are easier to review. If you're planning something big, open an issue first so we can discuss the approach.

## Reporting Bugs & Requesting Features

Use [GitHub Issues](https://github.com/inkbitco/super-dev-mcp/issues). Include:

- **Bugs**: what happened, what you expected, steps to reproduce, and your Node/npm versions
- **Feature requests**: the problem you're solving and any ideas for the approach

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

Questions? Open an issue or start a discussion. We're happy to help you get started. 🚀
