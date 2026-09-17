---
name: design
description: "Build new UI or refine existing surfaces with design system memory. Use when asked to design, build UI, improve visual design, or work on styling/layout."
---

# Design

**Ask me: "What do you want to work on?"** Wait for my response before reading files or planning.

I might want to build something new, refine something existing, or describe a direction to push things. Figure out which from my answer.

## Design Memory

Before doing any design work, check for `PRODUCT.md` and `DESIGN.md` at the project root (as well as any design/style conventions in `AGENTS.md`, `CLAUDE.md`, or `.rules/`).

**Both exist** → load them. Quote relevant lines as you make decisions so your design choices trace back to the project's intent.

**Either or both missing** → walk me through creating them before proceeding. Don't skip this — every design decision is better with context.

### PRODUCT.md template

Ask what you can't infer from the codebase (README, package.json, routes, existing components). Skip what's obvious.

```
# Product

## Register
[brand or product — bare value]

## Users
[Who they are, their context, the job to be done]

## Product Purpose
[What this does, why it exists, what success looks like]

## Brand Personality
[Voice, tone, 3-word personality. Named references (Linear, Stripe, Klim Type Foundry — not "modern" or "clean"). Anti-references by name.]

## Design Principles
[3–5 strategic principles. NOT visual rules — those belong in DESIGN.md.]

## Accessibility
[WCAG level, known user needs, considerations]
```

### DESIGN.md template

If code exists, extract tokens from CSS custom properties, Tailwind config, theme files, and existing components. If pre-implementation, ask a few visual questions to seed it.

```
# Design System: [Project Title]

## 1. Overview
**Creative North Star: "[Named metaphor]"**
[Personality, density, philosophy. What this system explicitly rejects.]

## 2. Colors
[Palette character. Group by role: Primary, Neutral, Secondary/Tertiary if real. Descriptive names, OKLCH or hex, where and why used. Named rules.]

## 3. Typography
[Display/body/label fonts, fallbacks, character of the pairing. Hierarchy with weight, size, line-height per level. Named rules.]

## 4. Elevation
[Shadows, tonal layering, or flat? Shadow vocabulary if applicable. Named rules.]

## 5. Components
[Buttons, cards, inputs, navigation. Shape, color, states, hover/focus treatments. Only document what exists.]

## 6. Do's and Don'ts
[Concrete guardrails. Every anti-reference from PRODUCT.md becomes a "Don't".]
```

## Planning

Before writing code, walk through:

- **Who uses this and what's their context?** Pull from PRODUCT.md.
- **What's the primary task?** What action should be most prominent?
- **Register** — brand (marketing, landing, campaign) or product (app UI, dashboards, tools)?
- **Theme** — don't reflex to dark or light. Write one sentence describing the physical scene of use ("SRE glancing at incident severity on a 27-inch monitor at 2am"). The sentence forces the answer.
- **Color strategy** — Restrained (tinted neutrals + one accent ≤10%) / Committed (one saturated color carries 30–60%) / Full palette (3–4 named roles) / Drenched (the surface IS the color).
- **Layout shape** — dominant rhythm, spacing cadence.

Sketch this in 3–5 bullets and confirm before writing code.

**For refinement work**, also identify the direction to push:

| Direction | When to use |
|-----------|-------------|
| **Bolder** | Feels safe, generic, bland. More conviction, scale, contrast, personality. |
| **Quieter** | Overstimulating, loud, busy. Reduce noise, lower contrast, simplify. |
| **Refined** | Mostly right but rough edges. Tighten alignment, spacing, typography, transitions. |
| **Distill** | Too much. Strip to essence; remove anything that doesn't earn its place. |
| **More delightful** | Correct but lifeless. One or two purposeful moments of personality. |
| **Better hierarchy** | Visual weight doesn't match information weight. Re-rank by scale, weight, position, color. |
| **Better layout** | Spacing, alignment, or rhythm is off. Vary cadence; fix grid; remove wrappers. |
| **Sharper copy** | Wordy, vague, or off-tone. Tighten labels, error messages, empty states. |
| **Production-ready** | All states, edge cases, accessibility, i18n. The "ship it" pass. |

## Design Laws

These apply to every implementation.

### Color
- Use **OKLCH**. Reduce chroma as lightness approaches 0 or 100.
- **Never `#000` or `#fff`.** Tint every neutral toward the brand hue (chroma 0.005–0.01).

### Typography
- Cap body line length at 65–75ch.
- Hierarchy through scale + weight contrast (≥1.25 ratio between steps).

### Layout
- Vary spacing for rhythm. Same padding everywhere is monotony.
- **Cards are the lazy answer.** Use only when truly the best affordance. Nested cards are always wrong.
- Don't wrap everything in a container.

### Motion
- Don't animate CSS layout properties (use transform and opacity).
- Ease out with exponential curves (ease-out-quart / quint / expo). No bounce, no elastic.

### Copy
- Every word earns its place. No restated headings.
- **No em dashes.** Use commas, colons, semicolons, periods, parentheses.

### Absolute bans

If you're about to write any of these, rewrite with different structure:

- **Side-stripe borders** — `border-left/right` > 1px as a colored accent on cards, alerts, list items.
- **Gradient text** — `background-clip: text` with a gradient.
- **Glassmorphism as default** — blurs and glass cards used decoratively.
- **Hero-metric template** — big number, small label, supporting stats, gradient accent.
- **Identical card grids** — same-sized cards with icon + heading + text, repeated.
- **Modal as first thought** — exhaust inline / progressive alternatives first.

### AI slop test

If someone could look at this and say "AI made that" without doubt, it's failed. **Category-reflex check:** if someone could guess the theme and palette from the category name alone ("observability → dark blue", "healthcare → white + teal"), rework until the answer isn't obvious from the domain.

## Implementation

1. **Use the design system.** If DESIGN.md defines tokens or components, use them. Don't introduce one-offs when shared primitives exist.
2. **Read existing code first.** Match conventions for component structure, styling approach, file organization.
3. **Build all states.** Default, hover, focus, active, disabled, loading, error, success.
4. **Build edge cases.** Empty state, long content, no content, error recovery.
5. **Accessibility.** Semantic HTML, ARIA where needed, keyboard navigation, visible focus indicators, WCAG AA contrast, `prefers-reduced-motion`.
6. **Responsive.** Mobile / tablet / desktop. Touch targets ≥44px. Body text ≥14px on mobile. No horizontal scroll.

For refinement: **preserve what's working.** Polish is surgical, not a rewrite. Don't introduce new patterns.

## Hand-off

- Show what you built or changed, and the design choices you committed to
- Cite PRODUCT.md / DESIGN.md lines that informed key decisions
- Suggest `/design-review` for a critical pass

Begin by asking the user what they want to work on.
