---
name: bug-hunt
description: "Multi-stage adversarial vulnerability discovery. Use when asked to hunt bugs, find vulnerabilities, run a security audit, or do a thorough proactive security sweep. Stack-agnostic. Supports quick/standard/deep scan modes."
---

# Bug-Hunt Harness

A proactive, multi-stage vulnerability discovery workflow. The orchestrator coordinates narrowly-scoped sub-agents through eight stages. Based on the Cloudflare adversarial harness pattern.

**Core principles (in priority order):**

1. **Narrow scope beats exhaustive analysis** — one attack class + one code region + architecture context
2. **Adversarial redundancy** — findings validated by a separate agent whose only job is to disprove them
3. **Separation of concerns** — discovery, validation, dedup, reachability, reporting are distinct passes
4. **Parallelism with bounded batches** — many small hunts in parallel, not one mega-hunt

---

## Inputs

- **Scope** (optional): path, package, or `"all"`. Default: entire repo.
- **Attack class filter** (optional): comma-separated from the attack-class menu, or `"all"`.
- **Mode** (`--mode=quick|standard|deep`): Default `standard`.

If no scope is given, infer from recent git activity.

---

## Scan modes

| Dimension | `quick` | `standard` | `deep` |
|---|---|---|---|
| Recon scope | git diff + entry points only | full attack-surface map | full map + dependency/config audit |
| Static triage | scoped to changed files | full repo | full repo + history |
| Tasks dispatched | 4–10, all high priority | 15–40, mixed priority | 30–80, all priorities, gapfill loops twice |
| Hunter batch size | 4–6 parallel | 6–8 parallel | 8–12 parallel |
| Trace stage | only critical/high confirmed | all confirmed | all confirmed |
| Chain stage | skip | top 5 by severity | all confirmed |

**Heuristic:** single PR → `quick`; full package → `standard`; audit before launch → `deep`.

---

## Working directory

`.bug-hunt/<run-id>/` where `run-id` is `YYYYMMDD-HHMM`.

```
.bug-hunt/<run-id>/
├── recon.md
├── wiki-deltas/
│   └── <task-id>.md
├── tasks.jsonl
├── findings/
│   └── <task-id>.jsonl
├── validations/
│   └── <finding-id>.md
├── confirmed.jsonl
└── report.md
```

---

## Stage 1 — Reconnaissance (single agent)

Produce `.bug-hunt/<run-id>/recon.md` containing:

1. **Build & run commands** — how to build, test, and start the project locally.
2. **Trust boundaries** — where user input crosses into trusted context (HTTP handlers, message consumers, IPC, CLI args, file parsers, etc.).
3. **Entry points** — every externally reachable handler/route/consumer with `file:line`.
4. **Identity & permission model** — how authn and authz are implemented, what roles/scopes exist, where checks happen.
5. **Data layer** — databases, caches, queues, object stores, and how queries are constructed.
6. **External surfaces** — third-party APIs, webhooks, OAuth flows, payment integrations.
7. **Likely attack surface** — ranked list of areas most likely to contain vulnerabilities, with reasoning.

### Living document

`recon.md` is a living document. Hunters write discoveries (new entry points, undocumented API routes, hidden config) to `.bug-hunt/<run-id>/wiki-deltas/<task-id>.md`. The orchestrator merges wiki-deltas into `recon.md` between batches.

---

## Stage 2 — Task generation (orchestrator)

From `recon.md`, build tasks as **one attack class × one narrow scope**. Write to `.bug-hunt/<run-id>/tasks.jsonl`.

Each task line:

```json
{
  "id": "T-001",
  "class": "sqli",
  "scope": "src/api/users.ts:45-120",
  "priority": "high",
  "context": "ORM raw-query escape hatch used with user-supplied sort column"
}
```

### Attack-class menu

- **Authn bypass** — including JWT-specific: `alg:none`, asymmetric→symmetric confusion, `kid` traversal/SQLi, weak HMAC secrets, missing `exp`/`nbf`/`iss`/`aud` validation
- **Authz bypass / IDOR / BFLA** — broken function-level authorization, direct object reference with guessable IDs
- **Privilege escalation** — role elevation, self-grant, admin impersonation
- **Row-level / tenant authorization bypass** — missing tenant scoping on queries, cross-tenant data access
- **SQL injection** — ORM escape hatches, dynamic identifiers, raw query interpolation
- **RCE** — `exec`/`spawn`/`eval`, template injection, deserialization chains, media-pipeline gadgets, SSRF→internal as pivot
- **SSRF** — no host allowlist, redirect following, DNS rebinding, cloud metadata endpoint access
- **Path traversal / arbitrary file** — zip-slip, symlink following, signed-URL key smuggling
- **Insecure file uploads** — extension/Content-Type/magic-byte mismatch, SVG/HTML XSS, archive zip-slip, ImageMagick gadgets, presigned URL abuse, resumable upload metadata mutation
- **XXE / XML parser abuse** — external entity expansion, billion-laughs DoS, XInclude, XSLT `document()`, SVG/Office/SOAP/SAML attack surfaces
- **Deserialization** — prototype pollution, `__proto__` / `constructor` injection, state-corruption outcomes
- **XSS** — `dangerouslySetInnerHTML`, unescaped templating, DOM clobbering, mutation-XSS
- **CSRF** — state-changing GETs, missing SameSite/origin/token checks
- **Race conditions / TOCTOU** — check-then-act, missing DB locks, parallel bypass of single-use tokens
- **Business logic / workflow bypass** — step-skipping, replay attacks, negative quantities, idempotency-key reuse, currency rounding exploits
- **Information disclosure** — stack traces, source maps, `.git` exposure, GraphQL introspection, debug endpoints, verbose response headers
- **Secrets exposure** — keys in client bundles, logged tokens, env vars in error pages, hardcoded credentials
- **Audit-log evasion** — actions that bypass audit logging, log injection, timestamp manipulation
- **Client/server boundary violation** — server-only modules in client bundles, secret leakage across the boundary
- **Mass assignment / over-posting** — unfiltered request bodies bound directly to models
- **Open redirect / phishing** — unvalidated redirect targets, URL parameter injection
- **Rate limit / abuse** — missing rate limiting on sensitive endpoints, enumeration attacks
- **Cryptography misuse** — homemade signing, weak randomness, missing constant-time compares, IV/nonce reuse
- **Subdomain takeover / dangling DNS** — only if scope includes DNS config or IaC

### Stack-derived hints

Before generating tasks, surface stack signals from:

- Dependency manifests (`package.json`, `requirements.txt`, `Gemfile`, `go.mod`, `Cargo.toml`, etc.)
- Runtime and deploy config (Dockerfiles, CI pipelines, serverless configs)
- Project instructions (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `.rules/`)
- Test fixtures and migration history

Translate signals into scope hints. For example: a dependency on `jsonwebtoken` + no test covering `alg` validation → high-priority authn-bypass task targeting that code.

---

## Stage 3 — Hunt (parallel batches of 6–8)

Each hunter receives **one task** and produces findings on disk.

### Hunter system prompt

> You are a security researcher. Your job is to find ONE specific class of vulnerability in ONE narrow region of code.
>
> **Your task:**
> - Attack class: `{task.class}`
> - Scope: `{task.scope}`
> - Architecture context: (excerpt from recon.md relevant to this scope)
>
> **Rules:**
> 1. Read the code in your scope thoroughly. Follow data flow from entry point to sink.
> 2. Cite every claim with `file:line`. No vague references.
> 3. If your confidence is below 70%, mark severity as `low` regardless of potential impact.
> 4. You are **read-only** on source code. Do not modify any project files.
> 5. Write all findings to `.bug-hunt/<run-id>/findings/<task-id>.jsonl`.
> 6. If you discover new entry points or undocumented behavior, write a delta to `.bug-hunt/<run-id>/wiki-deltas/<task-id>.md`.
> 7. Produce at least one finding (even if it's "no vulnerability found" with class `clear`).

### Finding schema

```json
{
  "id": "F-<task-id>-001",
  "class": "sqli",
  "severity": "critical|high|medium|low|info",
  "status": "unvalidated",
  "confidence": 0.85,
  "locations": ["src/api/users.ts:67", "src/api/users.ts:82"],
  "title": "SQL injection via dynamic ORDER BY column",
  "what": "User-supplied `sortBy` parameter is interpolated directly into a raw SQL query without sanitization.",
  "where": "src/api/users.ts:67 — the `listUsers` handler passes `req.query.sortBy` into a template literal inside `db.raw()`.",
  "trigger": "GET /api/users?sortBy=name;DROP TABLE users-- returns 200 and executes injected SQL.",
  "impact": "Full database compromise. Attacker can read, modify, or delete any data.",
  "hypothesized_fix": "Use a column allowlist or parameterized ORDER BY. Never interpolate user input into raw SQL."
}
```

---

## Stage 4 — Validate (parallel, adversarial)

Each validator receives **one finding** and tries to disprove it. Validators run in separate agents from hunters — never the same agent for both.

### Validator system prompt

> You are an adversarial reviewer. Your ONLY job is to determine whether this finding is real.
>
> **Bias: toward refutation.** Assume the finding is wrong until the code proves otherwise.
>
> **Finding to validate:**
> ```json
> {finding}
> ```
>
> **Your process:**
> 1. Read the cited code locations. Verify the code actually does what the finding claims.
> 2. Trace the data flow. Can attacker-controlled input actually reach the vulnerable sink?
> 3. Check for guards: input validation, middleware, type systems, ORM protections, framework defaults.
> 4. Consider the runtime context: is this code actually reachable in production? Is there a WAF, reverse proxy, or other mitigation?
> 5. If the finding describes a trigger, mentally execute it. Does the described behavior actually occur?
>
> **Write your verdict to** `.bug-hunt/<run-id>/validations/<finding-id>.md`

### Verdict schema

```json
{
  "id": "F-T001-001",
  "verdict": "confirmed|refuted|needs-more-info",
  "confidence": 0.92,
  "reasoning": "The raw SQL interpolation at users.ts:67 is real. No parameterization or allowlist exists between the HTTP handler and the query builder.",
  "evidence": "users.ts:67 uses template literal with db.raw(). The handler at users.ts:45 reads req.query.sortBy with no validation. No middleware sanitizes query params for this route.",
  "if_confirmed": {
    "severity_revision": null,
    "notes": "Original severity of critical is accurate."
  },
  "if_refuted": {
    "reason": null
  }
}
```

---

## Stage 5 — Gapfill

After validation, scan for under-covered areas:

1. **Untasked attack classes** — classes from the menu not yet assigned to any task.
2. **Zero-finding, zero-refutation scopes** — code regions that were scoped but produced neither findings nor explicit "clear" results.
3. **Untouched trust boundaries** — trust boundaries from `recon.md` with no associated tasks.
4. **Newly discovered surfaces** — entry points or behaviors added to `recon.md` via wiki-deltas that were not in the original task set.

Dispatch **3–8 more targeted hunters** to fill gaps. In `deep` mode, run gapfill twice (second pass covers gaps from the first gapfill round). In `quick` mode, skip gapfill entirely.

---

## Stage 6 — Deduplicate

Collapse findings that share the **same root cause**, even if they manifest in different files or endpoints.

- Deduplicate by **cause**, not by file. Two findings in different handlers that both stem from missing tenant scoping on the same query builder are one finding.
- Preserve the highest severity and most complete description from the duplicates.
- Record which findings were merged and why.

Write deduplicated results to `.bug-hunt/<run-id>/confirmed.jsonl`.

---

## Stage 7 — Trace (for shared helpers)

For each confirmed finding, determine whether attacker-controlled input can reach the vulnerable code from an external entry point.

### Tracer system prompt

> You are tracing data flow for a confirmed vulnerability.
>
> **Finding:**
> ```json
> {finding}
> ```
>
> **Your job:**
> 1. Start from every external entry point in `recon.md` that could reach the vulnerable code.
> 2. Trace the data flow forward: HTTP parameter → middleware → handler → service → vulnerable sink.
> 3. At each step, note transformations, validations, or sanitizations that occur.
> 4. Determine: can attacker-controlled input reach the sink in a form that triggers the vulnerability?
>
> **Append a `reachability` section to the finding:**
> ```json
> {
>   "reachability": {
>     "reachable": true,
>     "entry_points": ["POST /api/users — body.sortBy"],
>     "path": "req.body.sortBy → usersHandler:34 → userService.list:67 → db.raw():82",
>     "transformations": "none — raw string passed through unchanged",
>     "mitigations_in_path": "none"
>   }
> }
> ```

In `quick` mode, only trace findings with severity `critical` or `high`.

---

## Stage 7.5 — Chain (optional, gated by mode)

In `standard` mode, analyze the **top 5 confirmed findings by severity**. In `deep` mode, analyze **all confirmed findings**. In `quick` mode, skip this stage.

### Chain system prompt

> You are analyzing exploit chains. Given the full set of confirmed findings, determine whether combining multiple vulnerabilities produces a higher-impact attack path.
>
> **Confirmed findings:**
> ```json
> {all confirmed findings}
> ```
>
> **Look for:**
> 1. **Escalation chains** — a low-severity finding that enables a critical one (e.g., info disclosure reveals an admin endpoint → IDOR on that endpoint → privilege escalation).
> 2. **Defense bypass chains** — a finding that disables a mitigation relied upon by other code (e.g., CSRF token leak + state-changing endpoint without secondary checks).
> 3. **Multi-step business logic exploits** — combining workflow bypasses for compound impact.
>
> **Append a `chains` section to each involved finding:**
> ```json
> {
>   "chains": [
>     {
>       "chain_id": "C-001",
>       "findings": ["F-T001-001", "F-T015-002"],
>       "combined_severity": "critical",
>       "narrative": "Information disclosure at /debug/routes reveals internal admin API. Combined with IDOR on admin user endpoint, attacker can elevate any account to admin.",
>       "preconditions": "Attacker must be authenticated with any valid session."
>     }
>   ]
> }
> ```

---

## Stage 8 — Report

Write `.bug-hunt/<run-id>/report.md` with the following structure:

```markdown
# Bug-Hunt Report — <run-id>

## Summary
- **Scope:** <what was scanned>
- **Mode:** quick|standard|deep
- **Attack classes tested:** <count> of <total>
- **Tasks dispatched:** <count>
- **Findings discovered:** <count>
- **Confirmed:** <count> | **Refuted:** <count> | **Needs more info:** <count>

## Confirmed Findings by Severity

### Critical
<detailed findings with full schema>

### High
...

### Medium
...

### Low
...

## Exploit Chains
<chain narratives, if any>

## Refuted Findings (one-liners)
| ID | Class | Title | Refutation reason |
|---|---|---|---|

## Coverage Gaps
- Attack classes not tested: ...
- Trust boundaries not covered: ...
- Code regions with no tasks: ...

## Recommendations
<prioritized remediation guidance>
```

---

## Operational rules

1. **Never run hunts and validations in the same agent.** A hunter must not validate its own findings. The adversarial property requires separation.
2. **Findings live on disk, not in chat.** All findings, validations, and the report are written to `.bug-hunt/<run-id>/`. Chat is for orchestration, status, and summaries only.
3. **Cap context blowup.** Each hunter/validator gets only the code in its scope + relevant `recon.md` excerpt. Do not feed entire codebases into a single agent context.
4. **Read-only on source.** Hunting agents must never modify project source code, tests, or configuration. They write only to `.bug-hunt/`.
5. **Stop conditions.** Stop dispatching if: all tasks are complete, gapfill limit reached (2 passes max), or user requests stop.
6. **Resumability.** On start, check for existing `.bug-hunt/<run-id>/` artifacts. If found, offer to resume from the last completed stage rather than restarting.

---

## Anti-patterns

| Anti-pattern | Why it's bad | What to do instead |
|---|---|---|
| Letting one agent both discover and validate | Confirmation bias — the discoverer is motivated to confirm | Separate hunter and validator agents always |
| Wide-scope hunters ("find all vulns in src/") | Context overload, shallow coverage | One attack class × one code region per hunter |
| Collapsing findings into chat | Findings get lost in conversation, can't be resumed | Write everything to disk in `.bug-hunt/` |
| Editing source from hunting agents | Hunting and fixing are different workflows with different risk profiles | Hunting agents are strictly read-only on source |
| Skipping trust-boundary check in recon | Findings without trust-boundary context lack exploitability assessment | Always map trust boundaries in Stage 1 |
| Looping gapfill forever | Diminishing returns, runaway cost | 2 passes max, then report coverage gaps |
| Adding stack-specific advice to this skill | This skill must remain stack-agnostic; stack patterns change per project | Project patterns live in project docs (`CLAUDE.md`, `AGENTS.md`, `.rules/`), not here |

---

## When NOT to use this skill

| Situation | Use instead |
|---|---|
| Single-PR / diff review | `/code-review` or `/bug-hunt-diff` |
| "Is this one function safe?" | Just read the function and analyze it directly |
| Vague "make my app secure" with no defined scope | Ask the user to define scope first, then use this skill |
