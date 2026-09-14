---
name: bug-hunt-diff
description: "Diff-scoped adversarial bug hunt. Runs on uncommitted changes or the last commit. Use after finishing a feature for a fast security/logic pass, or as Track B of /code-review. For a deep whole-repo sweep use /bug-hunt instead."
---

# Bug-Hunt Diff

A fast, **diff-scoped** adversarial bug hunt meant to run on every finished feature. The lightweight sibling of `/bug-hunt`: same core principle, a fraction of the cost.

**The one principle to preserve: adversarial redundancy.** A finding is only trusted after a *separate* agent — one that never saw the hunter's reasoning — fails to disprove it. Never let the context that produced a finding also confirm it.

Everything else is stripped for speed:
- **Scope = the diff, not the repo.** Only changed files + their immediate blast radius.
- **No disk artifacts.** Findings flow back through messages; nothing is written to `.bug-hunt/`.
- **Few agents.** 2–4 hunters, one batched disprove pass. No recon map, no gapfill loops, no chaining.

If you need whole-repo recon, dependency audits, chaining, or resumable runs, use `/bug-hunt` instead.

---

## Stage 0 — Collect the diff (inline)

```bash
git diff HEAD
git status --short
```

If no uncommitted changes, fall back to last commit:
```bash
git show HEAD
```

Read the changed files. Note for each changed hunk: what trust boundary it sits behind (HTTP route, server action, loader, DB query, auth gate) and what newly-reachable input it introduces.

## Stage 1 — Pick attack classes from the diff (inline)

Pick **3–5 classes that the diff actually exposes**. Don't run classes the change doesn't touch. Order by attack-surface priority:

1. **Auth / permissions / tenant isolation** — missing ownership or org-scope checks, IDOR on object IDs, server-side filters trusting client IDs, admin paths reachable by a normal session, RLS/policy gaps.
2. **Data loss / corruption / irreversible state** — destructive writes without guards, mass-assignment into DB writes, missing idempotency on create/charge/finalize.
3. **Rollback / retry / partial failure** — non-idempotent handlers, check-then-act on shared state, single-use tokens reusable under parallel requests (invites, resets, coupons).
4. **Race / ordering / stale state** — TOCTOU, missing locks on counters/balances, re-entrancy.
5. **Injection & boundary** — SQL via ORM escape hatches or string-built queries, XSS via dangerouslySetInnerHTML/unescaped templating, SSRF on user-controlled fetch URLs, open redirect, path traversal, server-only code/secrets leaking into client bundles.
6. **Empty-state / null / degraded dependency** — unhandled null, timeout, empty-list, or failing-dependency paths that the happy path hides.
7. **Business-logic / workflow bypass** — skipping a step, replaying a stale confirm, negative/zero quantities, validating one field but acting on another.

Check for project-specific conventions in `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, or `.rules/` to inform priorities.

## Stage 2 — Hunt (2–4 parallel agents)

Cluster the chosen classes into **2–4 hunters** (one hunter may own 1–2 related classes). Spawn them in parallel, all reading the **same diff scope**.

**Hunter prompt — fill braces:**

```
You are adversarially hunting bugs in a code change. Try to DISPROVE that it is correct.

Attack classes (only these): {classes}
Changed files / hunks to focus on:
{file:line list from the diff}

What to do:
1. Read the changed code and just enough surrounding code to trace how input reaches it from a trust boundary (route, server action, loader, webhook).
2. Trace bad inputs, retries, concurrent requests, and partially-completed operations through the changed paths.
3. Look ONLY for the listed classes. Ignore style, naming, and cleanup.
4. Stop after your 3 strongest candidates or when you've read the scope, whichever is first.

Return each candidate as:

[CANDIDATE]
class: <class>
severity: critical|high|medium|low
location: path/to/file.ts:LINES
what: 1–2 sentences — the bug and why it's a bug
trigger: how an attacker/bad input reaches this path from outside
impact: concrete — what is gained or broken
confidence: high|medium|low

Rules:
- Every candidate needs a real file:line. No location, no candidate.
- If under 70% confident, mark confidence low — don't drop it, the next stage will judge it.
- Do NOT edit any source file. Read-only.
- If you find nothing, say "no candidates" — do not invent filler.
```

Collect candidates. Deduplicate by **root cause** (same fix closes both = one), not by file.

## Stage 3 — Disprove (1 batched adversarial agent)

Spawn **one** agent whose only job is to refute the candidates. It must not receive the hunters' reasoning — give it only the claim, location, and class.

**Disprove prompt:**

```
Previous agents claimed these bugs exist in a code change. Your job is to DISPROVE each one. Bias toward refutation.

Candidates:
{for each: id, class, severity, location, one-line claim}

For each candidate:
1. Read the cited location and surrounding code independently.
2. Trace whether the trigger path actually exists end-to-end from an external trust boundary.
3. Check for guards the hunter may have missed: middleware, auth/permission helpers, RLS or org-scope filters, type/schema validation, framework escaping, upstream sanitization.

Return one verdict per candidate:

[VERDICT]
id: <id>
verdict: confirmed | refuted | needs-info
why: one concrete sentence — for refuted, name the specific guard that blocks it; for confirmed, the external path that reaches it.
revised_severity: critical|high|medium|low   (only if confirmed)

Rules:
- If you cannot reach the bug from external input, refute it.
- Do not introduce new findings. Do not edit source. Read-only.
```

## Stage 4 — Report (inline)

Keep only `confirmed` (and `needs-info` you judge plausible). Emit findings sorted by severity:

- ❌ **FAIL** `file:line` — what can go wrong / why vulnerable / impact / concrete fix
- ⚠️ **WARNING** `file:line` — issue + recommendation
- ✅ **PASS** — if everything was refuted, say so plainly with one line of evidence.

For each FAIL, give a one-line concrete fix. List refuted candidates as a single line each ("refuted because …") only if it adds signal.

When invoked inside `/code-review`, return findings to the reviewer's synthesis step instead of printing a standalone verdict; the reviewer merges them with Track A.

---

## Operational rules

- **Separate discover and disprove agents — always.** This is the whole point.
- **Diff-scoped.** If you find yourself reading the whole repo, use `/bug-hunt` instead.
- **No filler.** One strong confirmed finding beats five low-confidence guesses. An honest PASS is a valid result.
- **Read-only.** No agent edits source. Fixing is a separate, human-gated step.
- **No disk artifacts.** Findings stay in messages.

## When NOT to use this skill

- Whole-repo audit, launch prep, dependency review → `/bug-hunt`
- "Is this one function safe?" → just read it
