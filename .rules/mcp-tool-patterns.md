---
inclusion: auto
fileMatchPattern: "src/lib/*.ts"
description: How to add or modify MCP tools — patterns, schemas, and registration
---

# MCP Tool Patterns

## Adding a New Tool

1. Create or edit a file in `src/lib/`
2. Export a `ToolDef[]` array (e.g., `export const myTools: ToolDef[] = [...]`)
3. Register in `src/index.ts` by spreading into the appropriate registration loop

### Tool Definition Shape

```ts
import { z } from "zod";
import { ok, err } from "../types.js";
import type { ToolDef, AppContext } from "../types.js";

const mySchema = {
  name: z.string().describe("Human-readable description for the agent"),
  verbose: z.boolean().optional(),
};

async function myHandler(
  args: Record<string, unknown>,
  { projectRoot }: AppContext
): Promise<ToolResult> {
  const name = args.name as string;
  // ... logic ...
  return ok(`Result: ${name}`);
}

export const myTools: ToolDef[] = [
  {
    name: "my_tool",
    description: "What this tool does — shown to the AI agent.",
    schema: mySchema,
    handler: myHandler,
  },
];
```

## Registration Categories (in index.ts)

Tools are registered in three groups based on their needs:

1. **Project-root tools** (spec, rules) — `await resolveProjectRoot()` before handler
2. **Standalone tools** (thread history, TTS) — no project root needed, skip resolution
3. **Upstream tools** — project root + dynamic enable/disable for merge-only tools

## Conventions

- Schema values are bare Zod types, NOT wrapped in `z.object()`
- Handler args are `Record<string, unknown>` — cast individual fields with `as`
- Always return `ToolResult` via `ok()` or `err()` — never construct the shape manually
- Tool names use `snake_case` (e.g., `spec_create`, `upstream_status`)
- Descriptions should be concise but include enough context for the AI agent to know when to use the tool
