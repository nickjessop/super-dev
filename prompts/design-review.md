# Design Review

**Before starting, ask me: "What would you like me to review?"** I might point you at a route, component, file, or the whole app. Wait for my response.

Honest design director critique of an existing UI surface. Find the problems, name them clearly, prioritize ruthlessly. The user needs honest feedback to ship great design — don't soften it.

## Setup

### 1. Read the design memory

Read `PRODUCT.md` and `DESIGN.md` from the project root if they exist. Quote them when calling out drift. If they're missing, do the review against general best practices and note that running `/design-setup` would let future reviews check against the project's intent.

### 2. Identify the target

Ask the user what to review (a route, a component, a file, or "the whole app"). Read the source files. If browser tooling is available, also visually inspect the rendered surface.

### 3. Identify the register

**Brand** (marketing, landing) or **product** (app UI, dashboards). The bar and the tells are different.

## The Review

Work through this systematically. Don't skip sections. Don't pad sections that are genuinely fine.

### A. AI Slop Verdict

**Start here.** Does this look AI-generated?

Check against these tells. Each one is a "Don't" — if any are present, name them by file/line:

- **Side-stripe borders** — `border-left` or `border-right` > 1px as a colored accent. Always wrong.
- **Gradient text** — `background-clip: text` with a gradient. Decorative, not meaningful.
- **Glassmorphism as default** — blurs and glass cards used decoratively.
- **Hero-metric template** — big number, small label, supporting stats, gradient accent. SaaS cliché.
- **Identical card grids** — same-sized cards with icon + heading + text, repeated endlessly.
- **Pure `#000` or `#fff`** — neutrals should be tinted toward the brand hue.
- **Modal as first thought** — used where inline / progressive disclosure would work.
- **Em dashes in copy** — use commas, colons, semicolons, periods, parentheses.
- **Generic fonts** — Inter on a generic dark blue background says "AI made this".

**Category-reflex check.** Could someone guess the theme and palette from the category name alone? "Observability → dark blue", "healthcare → white + teal", "finance → navy + gold", "crypto → neon on black". If yes, the design is reflexing to training data instead of the actual product.

**Verdict:** If someone said "AI made this," would you believe them? Yes / No / Borderline. Explain.

### B. Heuristic Scoring

Score Nielsen's 10 heuristics 0–4. Be honest. Most real interfaces score 20–32 / 40.

| #         | Heuristic                       | Score     | Key Issue                   |
| --------- | ------------------------------- | --------- | --------------------------- |
| 1         | Visibility of System Status     | ?/4       | [specific finding or "n/a"] |
| 2         | Match System / Real World       | ?/4       |                             |
| 3         | User Control and Freedom        | ?/4       |                             |
| 4         | Consistency and Standards       | ?/4       |                             |
| 5         | Error Prevention                | ?/4       |                             |
| 6         | Recognition Rather Than Recall  | ?/4       |                             |
| 7         | Flexibility and Efficiency      | ?/4       |                             |
| 8         | Aesthetic and Minimalist Design | ?/4       |                             |
| 9         | Error Recovery                  | ?/4       |                             |
| 10        | Help and Documentation          | ?/4       |                             |
| **Total** |                                 | **??/40** |                             |

A 4 means genuinely excellent. Don't inflate.

### C. Cognitive Load

Run an 8-item check. Report failure count: 0–1 = low (good), 2–3 = moderate, 4+ = critical.

1. **Decision points** — count visible options at each one. >4 is too many.
2. **Progressive disclosure** — is complexity revealed only when needed?
3. **Visual noise** — competing focal points, decorative elements that don't aid the task
4. **Reading load** — copy density, jargon, untranslated technical terms
5. **Memory load** — does the user have to remember things across screens?
6. **Inconsistent patterns** — same action looks different in different places
7. **Hidden affordances** — interactive elements that don't look interactive
8. **Misleading signifiers** — things that look interactive but aren't

### D. Design System Drift

If `DESIGN.md` exists, check the implementation against it:

- **Token usage** — are colors, spacing, typography pulled from tokens, or hard-coded?
- **Component usage** — when shared components exist, are they used? Or were one-offs built?
- **Named rules** — does the implementation honor the rules in DESIGN.md? Quote any violations.
- **Anti-references** — does the implementation drift toward anything PRODUCT.md says it should NOT look like?

If no DESIGN.md, check internal consistency: same elements styled differently, inconsistent spacing scales, mixed typography hierarchies.

### E. Accessibility & Responsive

- Contrast ratios meet WCAG AA (4.5:1 body, 3:1 large text)
- All interactive elements have focus indicators
- Keyboard navigation works (tab order, focus traps in modals)
- Touch targets ≥44px on mobile
- No horizontal scroll at any breakpoint
- Body text ≥14px on mobile
- Respects `prefers-reduced-motion`
- Semantic HTML, proper ARIA where needed

### F. Persona Red Flags

Pick 2–3 personas relevant to this surface. If `PRODUCT.md` describes specific users, generate one project-specific persona. For each, walk through the primary action and list specific red flags found:

> **Alex (Power User)**: No keyboard shortcuts. Form requires 8 clicks for the primary action. Forced modal onboarding. High abandonment risk.
>
> **Jordan (First-Timer)**: Icon-only nav in sidebar. "404 Not Found" in error messages. No visible help. Will abandon at step 2.

Be specific. Name exact elements that fail each persona. Don't write generic persona descriptions.

## The Report

Synthesize into a single review. Structure:

### Overall Impression

A brief gut reaction. What works, what doesn't, and the **single biggest opportunity**. 2–3 sentences.

### What's Working

2–3 things done well. Be specific about why they work.

### Priority Issues

The 3–5 most impactful problems, ordered by severity. For each:

- **[P0–P3] What** — name the problem clearly
- **Why it matters** — how this hurts users or undermines goals
- **Fix** — what to do about it (be concrete)
- **Suggested next step** — `/design-polish` direction, or specific code change

P0 = blocks shipping. P1 = significant. P2 = noticeable. P3 = minor.

### Persona Red Flags

(From section F above.)

### Minor Observations

Quick notes on smaller issues worth addressing.

### Questions to Consider

Provocative questions that might unlock better solutions:

- "What if the primary action were more prominent?"
- "Does this need to feel this complex?"
- "What would a more confident version of this look like?"

## After the Report

Ask the user 2–4 targeted questions based on what was actually found:

1. **Priority direction** — "I found problems with X, Y, and Z. Which area should we tackle first?" Offer the top 2–3 issue categories as options.
2. **Design intent** — if there's a tonal mismatch, ask if it was intentional. Offer 2–3 directions to fix it.
3. **Scope** — "Want to address everything, or focus on the top 3?"
4. **Constraints** — "Anything off-limits or already considered done?"

Every question must reference specific findings. Skip questions if findings are obvious.

After their answers, suggest concrete next steps: `/design-polish` with specific direction, or specific code changes. End with: "Re-run `/design-review` after fixes to see your scores improve."

## Rules

- Be direct. Vague feedback wastes time.
- Be specific. "The submit button," not "some elements."
- Say what's wrong AND why it matters to users.
- Don't soften criticism. Developers need honest feedback to ship great design.
- Don't recommend everything. Prioritize ruthlessly. If everything is important, nothing is.

Begin by asking the user what they want reviewed.
