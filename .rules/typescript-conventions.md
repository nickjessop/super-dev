---
inclusion: auto
fileMatchPattern: "src/**/*.ts"
description: TypeScript conventions and strict mode patterns for this project
---

# TypeScript Conventions

## Strict Mode

This project uses `"strict": true`. Key implications:

- No implicit `any` — every function parameter and return type must be annotated
- `catch` blocks receive `unknown` — use `err instanceof Error ? err.message : String(err)`
- `process.env` values are `string | undefined` — use `!` assertion or fallback for known vars like `HOME`
- `.json` extension required in all imports for NodeNext module resolution (e.g., `"./types.js"`)

## Shared Types

Import from `src/types.ts` — never redefine these locally:

```ts
import { ok, err } from "../types.js";
import type { ToolDef, ToolResult, AppContext } from "../types.js";
```

- `ok(text)` — success result: `{ content: [{ type: "text", text }] }`
- `err(text)` — error result: `{ content: [{ type: "text", text }], isError: true }`
- `ToolDef` — tool definition shape (name, description, schema, handler)
- `AppContext` — `{ readonly projectRoot: string }`

## Do NOT

- Add `any` types except when interfacing with untyped SDK internals
- Use `require()` — this is an ESM project (`"type": "module"`)
- Add runtime dependencies without justification — keep the dependency footprint minimal
- Remove or weaken the `strict` tsconfig setting
