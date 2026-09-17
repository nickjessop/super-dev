---
name: agent-collab
description: "Autonomous multi-turn collaboration and debate between two sub-agents to resolve architectural, design, or implementation questions using Zed's native spawn_agent."
---

# Autonomous Multi-Turn Agent Collaboration & Debate

Conduct an autonomous multi-turn debate or working session between two sub-agents using Zed's native `spawn_agent`. The hosting agent acts as the **Moderator & Synthesizer**, orchestrating back-and-forth rounds between two specialized perspectives until convergence, with zero copy-pasting required from the user.

## Core Principles

1. **Evidence-Grounded Disagreement**: No unsubstantiated opinions or polite yielding. Every critique and every agreement must be anchored in concrete codebase evidence (exact file paths, code snippets, type definitions, or test results).
2. **Anti-False-Consensus**: When two LLMs are asked to agree, they naturally exhibit a social bias to conform. If Sub-Agent A gives a confident rebuttal, Sub-Agent B must NOT politely yield without verification. Sub-Agent B must either verify with code proof or maintain its objection.
3. **Scope Creep Guardrail**: Adversarial scrutiny must not inflate scope. Distinguish **Blockers** (data corruption, security flaws, race conditions, broken contracts) from **Advisory Notes** (future optimizations, cosmetic preferences). Advisory notes cannot block consensus.
4. **Radical Simplicity Check**: Before adopting a complex solution, both agents must evaluate if a simpler, standard-library or idiomatic pattern solves 90% of the problem with 10% of the complexity.

## When to Use

Use this skill when:
- The user asks two agents to "work something out", "debate an approach", or "collaborate on a solution".
- Exploring complex architectural decisions with competing trade-offs (e.g., speed vs. consistency, simplicity vs. extensibility).
- Stress-testing a proposal before writing code (e.g., proposer vs. adversarial challenger).
- Cross-discipline review (e.g., backend vs. frontend API contracts, developer vs. reliability engineer).
- Resolving tough bugs or performance mysteries where multiple plausible hypotheses exist.

## Step 1 — Scope the Question & Collect Context

Before launching the debate, clarify the problem and gather necessary codebase facts:

1. **State the Core Dilemma**: Formulate a crisp, 1-2 sentence technical question or trade-off to resolve.
2. **Collect Codebase Ground Truth**:
   - Inspect relevant existing code, schemas, or configurations with `grep` and `read_file`.
   - If the user referenced another active conversation, retrieve it using `thread_list(active_only: true)` and `thread_read`.
3. **Define Success Criteria**: What constitutes a finished decision? (e.g., selected approach, agreed interface, migration strategy, risk mitigation).

## Step 2 — Select Agent Personas

Choose two complementary or adversarial personas. If the user specified roles, respect them. Otherwise, select the most relevant archetype:

| Archetype | Sub-Agent A (Proposer) | Sub-Agent B (Challenger) | Primary Goal |
|---|---|---|---|
| **Architecture / ADR** | **Systems Architect** (simplicity, velocity, idiomatic design) | **Reliability / SRE** (failure modes, race conditions, edge cases, cold starts) | Resilient, pragmatically scoped architecture |
| **API / Contract** | **Backend / DB Engineer** (query performance, transaction safety) | **Frontend / Consumer** (payload ergonomics, UI latency, batching) | Clean, robust client-server contract |
| **Refactoring** | **Builder / Refactorer** (clean abstractions, DRY, readability) | **Security / Auditor** (backward compatibility, regressions, auth boundaries) | Safe, non-breaking refactor |
| **Bug Investigation** | **Hypothesis A Champion** | **Hypothesis B Champion** | Falsifiable proof and root-cause certainty |

## Step 3 — Autonomous Debate Protocol

Run the debate across **2 to 3 structured rounds** using `spawn_agent`.

> ⚠️ **CRITICAL: Context Continuity via `session_id`**
> - The initial `spawn_agent` call creates a new session and returns a `session_id`.
> - **Always pass this `session_id` on follow-up calls** to the same sub-agent.
> - When continuing a session, do not repeat earlier messages; send only the new critique or counter-proposal.

### Round 1: Proposal & Adversarial Critique

1. **Spawn Sub-Agent A (Proposal v1)**:
   Call `spawn_agent` with:
   - `label`: `[Role A] Proposal v1`
   - `message`: Provide the problem statement, relevant code snippets/file paths, and instructions:
     - Propose a concrete solution or architecture.
     - Cite relevant files and existing patterns in the codebase.
     - State key assumptions and trade-offs.
     - Keep the output structured and concise (< 500 words).
   - Capture Sub-Agent A's response and save its `session_id` as `session_id_A`.

2. **Spawn Sub-Agent B (Critique & Counter-Proposal)**:
   Call `spawn_agent` with:
   - `label`: `[Role B] Critique & Counter`
   - `message`: Provide the original problem statement, codebase context, and Sub-Agent A's Proposal v1:
     - **Simplicity Check First**: Does this proposal introduce unnecessary abstraction or dependencies? Can it be done in fewer lines with standard patterns?
     - **Evidence-Grounded Stress-Testing**: Test against your mandate (failure modes, edge cases, scalability).
     - **Structured Feedback**: Classify every point into:
       - ❌ `BLOCKER`: Must be resolved before shipping (cite exact code/failure scenario).
       - ⚠️ `ADVISORY`: A valid consideration or future optimization, but does not block moving forward.
     - Propose concrete amendments or a simpler alternative.
   - Capture Sub-Agent B's response and save its `session_id` as `session_id_B`.

### Round 2: Defense, Concessions & Revision

3. **Resume Sub-Agent A (Rebuttal & Proposal v2)**:
   Call `spawn_agent` with:
   - `session_id`: `session_id_A`
   - `label`: `[Role A] Rebuttal & Proposal v2`
   - `message`:
     - Pass Sub-Agent B's critique.
     - Instruct Sub-Agent A:
       - **Concede Valid Points**: Accept justified critiques and adapt the proposal.
       - **Rebut with Evidence**: If Sub-Agent B's critique is incorrect, refute it by citing specific code, types, or tests. Do not make unverified assertions.
       - **Produce Proposal v2**: An updated, battle-hardened design incorporating concessions.

4. **Resume Sub-Agent B (Convergence Review)**:
   Call `spawn_agent` with:
   - `session_id`: `session_id_B`
   - `label`: `[Role B] Convergence Review`
   - `message`:
     - Pass Sub-Agent A's revised Proposal v2.
     - **Anti-False-Consensus Directive**: Do NOT politely agree just because Sub-Agent A wrote a confident rebuttal.
     - Must issue one of three structured verdicts for each previous blocker:
       - `AGREE_GROUNDED`: Resolved. Cite specifically why Proposal v2 mitigates the risk.
       - `DISAGREE_EVIDENCE`: Still broken. Point to the unresolved code hazard or logic flaw.
       - `CONVERT_TO_ADVISORY`: The risk is mitigated enough that it no longer blocks implementation; log as an accepted trade-off.

### Round 3: Tie-Breaker or Escalation (Only if deadlocked)

If Sub-Agent B still has active `DISAGREE_EVIDENCE` blockers:
- If a quick hybrid compromise exists, run one final turn with Sub-Agent A.
- If the disagreement stems from an irreconcilable philosophical trade-off (e.g. strict consistency vs. eventual consistency; build vs. buy), **do not fake consensus**. The Moderator documents the two viable paths as a **Forked Decision** and escalates the choice to the user.

## Step 4 — Moderation & Consensus Synthesis

Present the final deliverable to the user in this structured format:

```markdown
# 🤝 Agent Collaboration: [Topic / Decision]

## Executive Verdict & Recommendation
[1-2 paragraph summary of the agreed direction and why it was chosen]

## Participants & Perspectives
- **[Role A Name]**: [Core focus / stance]
- **[Role B Name]**: [Core focus / stance]

## Debate Trajectory & Key Shifts
- **Initial Proposal**: [What was first proposed]
- **Major Challenges Raised**: [Key flaws/risks uncovered by Challenger]
- **Concessions & Adaptations**: [How the proposal evolved from v1 to v2]

## Consensus Agreement
- ✅ [Agreed point 1]
- ✅ [Agreed point 2]
- ✅ [Agreed point 3]

## Accepted Trade-offs & Mitigations
| Trade-off | Rationale | Mitigation / Guardrail |
|---|---|---|
| [e.g. In-memory cache vs Redis] | [Lower operational overhead for MVP] | [LRU eviction + size caps to prevent OOM] |

## Concrete Next Steps
1. [Actionable step 1, citing files]
2. [Actionable step 2]
```
