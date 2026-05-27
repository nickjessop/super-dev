---
inclusion: always
description: Project architecture, build pipeline, and key abstractions
---

# super-dev-mcp

MCP server providing spec-driven development workflow tools, thread history, TTS voice mode, and upstream merge management for AI agents in Zed.

## Architecture

```
src/
  index.ts          — MCP server entry point, tool registration, project root resolution
  types.ts          — Shared types (ToolDef, ToolResult, AppContext) and ok()/err() helpers
  tts-watcher.ts    — Standalone background process for TTS (not imported by server)
  lib/
    spec-tools.ts       — Spec workflow: create → requirements → design → tasks → implementation
    rules.ts            — .rules/ loader with YAML front-matter and glob matching
    thread-history.ts   — Zed threads.db search and reading (sqlite3 + zstd)
    tts-tools.ts        — Voice mode toggle (spawns tts-watcher as detached process)
    upstream-tools.ts   — Upstream merge management with policy-based conflict resolution
    deprecation-watch.ts — Detects when MCP clients gain features that obsolete our tools
```

## Build

- `npm run build` — compiles `src/` → `dist/` via `tsc`
- `npm run dev` — runs directly via `tsx` (no compile step)
- `npm start` — runs compiled `dist/index.js`
- Entry point: `dist/index.js` (referenced by `run.sh`, `package.json` bin)
- `prompts/` directory is at project root, NOT in `src/` — resolved via `import.meta.url`

## Key Patterns

- All tools export a `ToolDef[]` array from their module
- Handlers receive `(args: Record<string, unknown>, ctx: AppContext)` — ctx has `projectRoot`
- Tool results use `ok(text)` / `err(text)` from `src/types.ts`
- Zod schemas are bare objects (`{ name: z.string() }`), not wrapped in `z.object()`
- The MCP SDK wraps schemas at registration time in `index.ts`
