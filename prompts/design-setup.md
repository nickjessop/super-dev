# Design Setup

You are setting up the design memory for this project. The goal is to produce two files at the project root:

- **PRODUCT.md** — strategic: who uses this, what problem it solves, brand personality, anti-references, design principles
- **DESIGN.md** — visual: color palette, typography, components, named rules

Every other `/design-*` command reads these files. Treat them as the project's design source of truth.

## Flow

### 1. Inspect what already exists

Check the project root for `PRODUCT.md` and `DESIGN.md`. Then decide:

- **Neither file exists** → run the full setup below
- **Only PRODUCT.md exists** → offer to also generate DESIGN.md from the code, or ask if they want to skip it for now
- **Only DESIGN.md exists** → unusual, but generate PRODUCT.md
- **Both exist** → ask which one to refresh; never silently overwrite

### 2. Explore the codebase first

Before asking the user anything, scan the repo to gather what you can infer:

- README, package.json, AGENTS.md — project purpose, audience, tech stack
- Existing components — current patterns, spacing, typography
- CSS tokens, Tailwind config, theme files — colors, fonts, spacing scales
- Brand assets, logos, favicons
- Routes — `/` and `/blog/*` suggest brand surfaces; `/app/*`, `/dashboard`, `/settings` suggest product surfaces

Form a hypothesis about the **register**:

- **Brand** — marketing, landing pages, campaigns, long-form content. Design IS the product.
- **Product** — app UI, dashboards, internal tools, settings. Design SERVES the product.

### 3. Ask strategic questions for PRODUCT.md

Lead with your register hypothesis. Then ask only what you couldn't infer:

- **Users** — Who actually uses this? What's their context? What job are they doing?
- **Purpose** — What does the product do? What does success look like?
- **Brand personality** — 3 words that capture the feel. References sites that match (push for specifics like Linear, Stripe, Klim Type Foundry — not "modern" or "clean"). Anti-references — what it should NOT look like.
- **Accessibility** — WCAG level, known user needs, reduced motion considerations.

Skip anything obvious from the code. Don't ask about colors or fonts here — those go in DESIGN.md.

### 4. Write PRODUCT.md

```markdown
# Product

## Register

[brand or product — bare value, no prose]

## Users

[Who they are, their context, the job to be done]

## Product Purpose

[What this does, why it exists, what success looks like]

## Brand Personality

[Voice, tone, 3-word personality, emotional goals]

## Anti-references

[What this should NOT look like. Specific bad-example sites or patterns to avoid by name.]

## Design Principles

[3–5 strategic principles. Things like "show, don't tell", "expert confidence", "calm under pressure". NOT visual rules like "use OKLCH" — those belong in DESIGN.md.]

## Accessibility

[WCAG level, known user needs, considerations]
```

### 5. Decide on DESIGN.md

After PRODUCT.md is done, offer DESIGN.md:

- **If code exists** — "I can extract a DESIGN.md from your existing tokens, components, and styles. Want me to do that now?"
- **If pre-implementation** — "I can seed a starter DESIGN.md from a few quick visual questions. You can re-run this command later to capture real tokens once you've built things. Want to do that?"

If they agree, continue. If they want to skip, mention they can run `/design-setup` again later.

### 6. Generate DESIGN.md

**Scan mode** (code exists):

1. Find tokens — CSS custom properties, Tailwind config, theme files, design token JSON
2. Find components — main button, card, input, nav. Note variants and states
3. Sample computed styles from rendered pages if browser tooling is available
4. Group colors into roles (Primary / Neutral always; Secondary / Tertiary only if real)
5. Map typography to roles (display / headline / title / body / label)
6. Catalog elevation (shadows or tonal layering — don't fake either)

Then ask 2–3 questions only for things you can't auto-extract:

- **Creative North Star** — a named metaphor for the whole system ("The Editorial Sanctuary", "The Lab Notebook"). Offer 2–3 options that match PRODUCT.md's brand personality.
- **Color names** — descriptive, not technical. "Deep Muted Teal-Navy" beats "blue-800".
- **Component philosophy** — one phrase ("tactile and confident" vs "refined and restrained").

**Seed mode** (no code yet):

Ask only these:

1. **Color strategy** — Restrained (tinted neutrals + one accent ≤10%) | Committed (one saturated color carries 30–60%) | Full palette (3–4 named roles) | Drenched (the surface IS the color). Plus an anchor hue or reference.
2. **Typography direction** — Serif display + sans body | Single sans (warm/technical/geometric) | Display + mono | Mono-forward | Editorial script
3. **Motion energy** — Restrained (state changes only) | Responsive (transitions + feedback) | Choreographed (entrances, scroll-driven)
4. **Three named references** — brands, products, printed objects. Not adjectives.
5. **One anti-reference** — by name.

Lead the seed file with `<!-- SEED — re-run /design-setup once there's code to capture real tokens. -->`.

### 7. Write DESIGN.md

Use this structure (six sections, fixed order, exact headers):

```markdown
# Design System: [Project Title]

## 1. Overview

**Creative North Star: "[Named metaphor]"**

[2–3 paragraphs: personality, density, philosophy. Start from the North Star. State what this system explicitly rejects (pull from PRODUCT.md's anti-references).]

**Key Characteristics:**

- [bullet]
- [bullet]

## 2. Colors

[One sentence on palette character.]

### Primary

- **[Descriptive Name]** (OKLCH or hex): [Where and why used.]

### Neutral

- **[Descriptive Name]** (OKLCH or hex): [Role.]

### Secondary / Tertiary (only if real)

### Named Rules

**The [Rule Name] Rule.** [Forceful prohibition or doctrine.]

## 3. Typography

**Display Font:** [Family] (with [fallback])
**Body Font:** [Family]
**Label/Mono Font:** [Family, if distinct]

**Character:** [1–2 sentences on the pairing's personality.]

### Hierarchy

- **Display** ([weight], [size], [line-height]): [Where it appears.]
- **Headline** / **Title** / **Body** / **Label** — same format

### Named Rules

**The [Rule Name] Rule.** [Doctrine about type use.]

## 4. Elevation

[One paragraph: shadows, tonal layering, or hybrid? If flat, say so explicitly and describe how depth is conveyed.]

### Shadow Vocabulary (if applicable)

- **[Role]** (`box-shadow: [value]`): [When to use it.]

### Named Rules

**The [Rule Name] Rule.** [Doctrine.]

## 5. Components

### Buttons

- **Shape:** [radius]
- **Primary:** [color assignment + padding]
- **Hover / Focus:** [transitions, treatments]
- **Secondary / Ghost:** [if applicable]

### Cards / Containers

- **Corner Style:** [radius]
- **Background, Shadow Strategy, Border, Padding**

### Inputs / Fields

- **Style, Focus, Error, Disabled**

### Navigation

- **Style, typography, states, mobile treatment**

### [Signature Component] (if there's a distinctive custom one)

## 6. Do's and Don'ts

Concrete, forceful guardrails. Lead each with "Do" or "Don't". Include exact values and named anti-patterns. Every anti-reference in PRODUCT.md should appear here as a "Don't" with the same language.

### Do:

- **Do** [specific prescription with exact values].

### Don't:

- **Don't** [specific prohibition with the exact pattern named].
```

### 8. Confirm

Show the user what you wrote. Highlight non-obvious creative choices (descriptive color names, atmosphere language, named rules). Offer to refine any section.

## Style guidelines

- **Descriptive over technical** — "Gently curved edges (8px radius)" beats "rounded-lg". Lead with description, include the value in parens.
- **Functional over decorative** — explain WHERE and WHY a token is used, not just WHAT it is.
- **Forceful voice** — "never", "always", "prohibited" — not "consider" or "prefer". Voice of a design director.
- **Use Named Rules** — `**The [Name] Rule.** [doctrine]`. Memorable and citable. Aim for 1–3 per section.
- **Cite PRODUCT.md anti-references by name** in Do's and Don'ts.
- **Don't invent components** that don't exist. If the project only has buttons and cards, only document those.
- **Don't duplicate content** between PRODUCT.md and DESIGN.md. PRODUCT is strategic. DESIGN is visual.

Begin by inspecting the project root and the codebase.
