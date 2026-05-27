# Design Build

**Before doing anything, ask me: "What do you want to build?"** Wait for my response before reading files or planning.

Plan and implement a new UI surface end-to-end. Real working code, committed design choices, exceptional craft. Match implementation complexity to the aesthetic vision — minimalism needs precision, maximalism needs elaborate code.

## Setup (non-optional)

### 1. Read the design memory

Before doing anything else, read `PRODUCT.md` and `DESIGN.md` from the project root if they exist.

Also call `load_rules({ filePath: "<the file you're working on>" })` to pull in any project rules that apply (UI conventions, accessibility standards, design system rules). If you're not working on a specific file yet, call `load_rules()` to get the always-included rules.

- **Both missing or sparse** → tell the user "I'll work better with project context. Want to run `/design-setup` first?" If they say no, proceed with general best practices.
- **Both exist** → load them. Quote relevant lines as you make decisions so the user sees their own strategic language carry through.

### 2. Identify the register

Every UI is either **brand** (marketing, landing, campaign, long-form) or **product** (app UI, dashboards, settings, tools). Priority:

1. Cue in the user's request ("landing page" vs "settings panel")
2. The route or surface in focus
3. PRODUCT.md's `Register` field

### 3. Plan before building

Before writing code, walk through:

- **Who uses this and what's their context?** Pull from PRODUCT.md if available.
- **What's the primary task on this screen?** What action should be most prominent?
- **Theme** — dark vs light. Don't reflex to either. Write one sentence describing the physical scene of use ("SRE glancing at incident severity on a 27-inch monitor at 2am in a dim room"). The sentence should force the answer.
- **Color strategy** — Restrained / Committed / Full palette / Drenched. Pick one explicitly. Don't reflex to Restrained.
- **Layout shape** — what's the dominant rhythm? Vary spacing for cadence; don't apply identical padding everywhere.

Sketch this in 3–5 bullets and confirm with the user before writing code.

## Shared Design Laws

These apply to every implementation. Match-and-refuse the absolute bans.

### Color

- Use **OKLCH**. Reduce chroma as lightness approaches 0 or 100 — high chroma at extremes looks garish.
- **Never use `#000` or `#fff`.** Tint every neutral toward the brand hue (chroma 0.005–0.01 is enough).
- The "one accent ≤10%" rule applies only to Restrained color strategy. Don't collapse every design to it by reflex.

### Theme

- Dark vs. light is never a default. Write the physical-scene sentence. Run the sentence, not the category.

### Typography

- Cap body line length at 65–75ch.
- Hierarchy through scale + weight contrast (≥1.25 ratio between steps). Avoid flat scales.

### Layout

- Vary spacing for rhythm. Same padding everywhere is monotony.
- **Cards are the lazy answer.** Use them only when they're truly the best affordance. Nested cards are always wrong.
- Don't wrap everything in a container. Most things don't need one.

### Motion

- Don't animate CSS layout properties (use transform and opacity).
- Ease out with exponential curves (ease-out-quart / quint / expo). No bounce, no elastic — they feel dated.

### Absolute bans

If you're about to write any of these, rewrite with different structure:

- **Side-stripe borders.** `border-left` or `border-right` greater than 1px as a colored accent on cards, list items, callouts, alerts. Rewrite with full borders, background tints, leading numbers/icons, or nothing.
- **Gradient text.** `background-clip: text` with a gradient. Decorative, never meaningful. Use a single solid color; emphasize via weight or size.
- **Glassmorphism as default.** Blurs and glass cards used decoratively. Rare and purposeful, or nothing.
- **The hero-metric template.** Big number, small label, supporting stats, gradient accent. SaaS cliché.
- **Identical card grids.** Same-sized cards with icon + heading + text, repeated endlessly.
- **Modal as first thought.** Modals are usually laziness. Exhaust inline / progressive alternatives first.

### Copy

- Every word earns its place. No restated headings, no intros that repeat the title.
- **No em dashes.** Use commas, colons, semicolons, periods, parentheses. Also not `--`.

### The AI slop test

If someone could look at this interface and say "AI made that" without doubt, it's failed.

**Category-reflex check.** If someone could guess the theme and palette from the category name alone — "observability → dark blue", "healthcare → white + teal", "finance → navy + gold", "crypto → neon on black" — it's the training-data reflex. Rework until the answer isn't obvious from the domain.

## Implementation

Once the plan is confirmed:

1. **Use the design system.** If `DESIGN.md` defines tokens or components, use them. Don't introduce new one-offs when shared primitives exist.
2. **Read existing code first.** Match the project's conventions for component structure, styling approach, file organization.
3. **Build all states.** Default, hover, focus, active, disabled, loading, error, success. Missing states create broken experiences.
4. **Build all edge cases.** Empty state, long content, no content, error recovery.
5. **Accessibility.** Semantic HTML, ARIA where needed, keyboard navigation, visible focus indicators, contrast meets WCAG AA, respects `prefers-reduced-motion`.
6. **Responsive.** Test at mobile / tablet / desktop. Touch targets ≥44px. Body text ≥14px on mobile. No horizontal scroll.

## Hand-off

After implementation:

- Show the user what you built and which design choices you committed to (color strategy, theme reasoning, layout approach)
- Cite the PRODUCT.md / DESIGN.md lines that informed key decisions
- Suggest `/design-review` for a critical pass, or `/design-polish` to refine details

Begin by reading PRODUCT.md and DESIGN.md, then ask the user what they want to build.
