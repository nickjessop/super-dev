---
name: code-review
description: "Adversarial dual-track code review: parallel architecture audit + adversarial security/logic hunt with consensus synthesis. Use when asked to review code, audit a diff, or critique an implementation."
---

# Adversarial Dual-Track Code Review

## Step 1 — Collect the diff

Run these to capture what changed. Use whichever produces meaningful output:

```sh
git --no-pager diff HEAD
git --no-optional-locks status
git --no-pager show HEAD --stat
```

If the user pointed at specific files or a PR, scope to those instead.

## Step 2 — Gather project standards

Check for project-specific conventions before reviewing. Read any that exist:

- `AGENTS.md`, `CLAUDE.md` — AI/agent coding instructions
- `.rules/` directory — rule files with glob-scoped guidance
- `CONTRIBUTING.md`, `README.md` — project conventions, architecture notes

These define the baseline for "correct" in this project. Flag deviations as findings.

## Step 3 — Operating stance

Default to **skepticism**. Bias toward finding real problems. Do not hand-wave concerns.
Every finding must clear this bar:

1. **What** can go wrong
2. **Why** this code path is vulnerable
3. **Impact** — what happens when it fails
4. **Fix** — a concrete remediation

If you cannot fill all four, demote to ⚠️ WARNING or drop entirely.

## Step 4 — Launch two parallel review tracks

### Track A — Code Quality & Architecture Audit

Spawn a sub-agent. Its mandate:

- **Anti-patterns & unnecessary complexity** — over-abstraction, premature generalization, dead code, copy-paste duplication
- **Wrong abstractions** — responsibilities in the wrong layer, leaky boundaries, god objects/functions
- **Missed simplification** — simpler standard-library or idiomatic alternatives, redundant wrappers
- **Convention violations** — deviations from standards found in Step 2
- **Naming, readability, testability** — unclear intent, untestable coupling, missing error context

Also produce a **Simplification & Architecture Opportunities** section listing concrete refactors.

### Track B — Adversarial Logic & Security Review

Spawn a sub-agent. If the `/bug-hunt-diff` skill is available, delegate to it. Otherwise run inline:

**Inline adversarial protocol:**
1. Spawn 2–4 "hunter" perspectives, each attacking a different surface
2. Hunters produce candidate vulnerabilities with exploitation scenarios
3. A separate "disprove" pass attempts to refute each finding with evidence from the code
4. Only findings that **survive disproof** are reported

**Attack surface priorities (in order):**

1. Auth, permissions, tenant isolation, trust boundaries
2. Data loss, corruption, duplication, irreversible state changes
3. Rollback safety, retries, partial failure, idempotency gaps
4. Race conditions, ordering assumptions, stale state, re-entrancy
5. Empty-state, null, timeout, degraded dependency behavior
6. Version skew, schema drift, migration hazards, compatibility regressions
7. Observability gaps that would hide failure in production

### Web research (both tracks)

Search the web for:
- Official docs validating (or contradicting) the patterns used
- Known CVEs or footguns in the specific libraries/versions touched
- Similar implementations to compare approaches

Cite sources inline next to relevant findings.

## Step 5 — Synthesize unified report

Merge both tracks. Where Track A and Track B independently flag the same issue, mark it **[CONSENSUS]**.

### Per-file findings

For every file in the diff, emit one or more:

- ✅ **PASS** — brief evidence why it's correct
- ⚠️ **WARNING** `file:line` — issue + recommendation
- ❌ **FAIL** `file:line` — full 4-part finding (what / why / impact / fix)

### Simplification & Architecture Opportunities

_(From Track A)_ — list concrete refactors, removals, or restructurings with rationale.

### Verdict Summary

| Category | Status | Notes |
|---|---|---|
| Correctness | | |
| Security | | |
| Reliability / Idempotency | | |
| Architecture | | |
| Observability | | |
| Test Coverage | | |
| Performance | | |

Status values: ✅ Good · ⚠️ Concern · ❌ Blocking

### Overall Verdict

One of:

- **SHIP** — no blocking issues, warnings are acceptable risk
- **NEEDS FIXES** — blocking issues exist but are fixable; list them
- **DO NOT SHIP** — fundamental problems with safety, correctness, or architecture
