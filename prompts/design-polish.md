# Design Polish

**Before starting, ask me two things:**

1. **"What do you want me to polish?"** (a route, component, file, or area)
2. **"Which direction should I push it?"** (bolder, quieter, refined, distill, more delightful, better hierarchy, better layout, sharper copy, or production-ready)

Wait for my answers before reading any code.

## Setup

### 1. Read the design memory

Read `PRODUCT.md` and `DESIGN.md` from the project root if they exist. Quote relevant lines as you make decisions. Polish that drifts away from these files isn't polish — it's decoration on drift.

### 2. Identify the target and the direction

Ask the user two things if unclear:

- **What** to polish (a route, component, file, or area)
- **Which direction** to push it. Offer these as options:

| Direction            | When to use                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Bolder**           | Design feels safe, generic, or bland. Push for more conviction, larger scale, more contrast, more personality. |
| **Quieter**          | Design feels overstimulating, loud, or busy. Reduce visual noise, lower contrast, simplify.                    |
| **Refined**          | Design is mostly right but has rough edges. Tighten alignment, spacing, typography, transitions.               |
| **Distill**          | Design has too much. Strip to essence; remove anything that doesn't earn its place.                            |
| **More delightful**  | Design is correct but lifeless. Add purposeful personality (micro-copy, motion, small flourishes).             |
| **Better hierarchy** | Visual weight doesn't match information weight. Re-rank by scale, weight, position, color.                     |
| **Better layout**    | Spacing, alignment, or rhythm is off. Vary cadence; fix grid; remove unnecessary containers.                   |
| **Sharper copy**     | UX writing is wordy, vague, or off-tone. Tighten labels, error messages, empty states.                         |
| **Production-ready** | Edge cases, error states, loading states, accessibility, i18n. The "ship it" pass.                             |

The user can pick one or several. Confirm the direction before making changes.

### 3. Read the code

Before editing, understand:

- What design system / tokens / components are already in use
- What the project's conventions are (file structure, styling approach, component API)
- What states are already implemented vs missing

## Shared Design Laws

These apply to every change. Match-and-refuse the absolute bans.

### Color

- Use **OKLCH**. Reduce chroma as lightness approaches 0 or 100.
- **Never `#000` or `#fff`.** Tint neutrals toward the brand hue (chroma 0.005–0.01).

### Typography

- Cap body line length at 65–75ch.
- Hierarchy through scale + weight contrast (≥1.25 ratio between steps).

### Layout

- Vary spacing for rhythm. Same padding everywhere is monotony.
- **Cards are the lazy answer.** Nested cards are always wrong.
- Don't wrap everything in a container.

### Motion

- Don't animate CSS layout properties.
- Ease out with exponential curves (ease-out-quart / quint / expo). No bounce, no elastic.

### Absolute bans (rewrite if you encounter them)

- **Side-stripe borders** > 1px as a colored accent
- **Gradient text** (`background-clip: text` with a gradient)
- **Glassmorphism as default**
- **Hero-metric template** (big number, small label, gradient)
- **Identical card grids**
- **Modal as first thought**

### Copy

- Every word earns its place. No restated headings.
- **No em dashes.** Use commas, colons, semicolons, periods, parentheses.

## Direction-specific guidance

### Bolder

- Push scale: bigger headlines, more dramatic type contrast
- Commit to color: switch from Restrained to Committed, or pick a single saturated hue and let it carry 30–60% of the surface
- Increase weight contrast (300/700 instead of 400/600)
- Add intentional asymmetry; break the grid where it earns drama
- Replace neutral CTAs with confident, branded ones

### Quieter

- Drop chroma; lower saturation across the board
- Reduce weight contrast; flatten dramatic scales
- Increase whitespace; let elements breathe
- Remove decorative elements that don't aid the task
- Soften transitions and animations

### Refined

- Pixel-perfect alignment to grid
- Consistent spacing using design tokens (no random 13px gaps)
- Optical alignment (icons may need offset for visual centering)
- Tight kerning on headlines
- 60fps transitions; only animate transform and opacity
- All interactive states present (default, hover, focus, active, disabled, loading)

### Distill

- Remove anything that doesn't earn its place
- Replace icon + heading + text combos with text alone where the icon adds nothing
- Collapse redundant labels
- Cut decorative containers, borders, separators
- One thing per screen — find the primary action and let it dominate

### More delightful

- Add one or two purposeful micro-interactions (a hover state with personality, a satisfying success transition)
- Refine UX copy with character (without losing clarity)
- Consider a small unexpected detail that rewards attention
- **Restraint is the rule.** Delight comes from one perfect moment, not from sprinkling personality everywhere.

### Better hierarchy

- Identify the primary action and let it dominate (size, color, position)
- Re-rank everything else relative to it
- Use scale + weight + color in concert, not as substitutes
- Reduce competing focal points

### Better layout

- Vary spacing for rhythm
- Snap to a baseline grid
- Remove unnecessary wrappers and containers
- Fix optical alignment (visual weight, not just bounding boxes)
- Test at multiple viewport sizes

### Sharper copy

- Cut adjectives; verbs do the work
- Match tone to PRODUCT.md (quote it)
- Error messages: say what happened, why, and what to do
- Empty states: name the state, suggest the next action
- Labels: shorter is better, until shorter loses meaning

### Production-ready

- All states implemented (loading, error, empty, success)
- All edge cases (long content, no content, slow network, offline)
- Accessibility (contrast WCAG AA, focus indicators, keyboard nav, ARIA, semantic HTML)
- Reduced motion respected
- Touch targets ≥44px on mobile
- No console errors or warnings
- No layout shift on load
- i18n-ready if applicable

## Make the changes

1. **Work through the direction systematically.** Don't jump around. Don't change scope mid-flight.
2. **Use design system tokens** when they exist. Don't hard-code values that should reference DESIGN.md.
3. **Preserve what's working.** Polish is surgical, not a rewrite.
4. **Match the project's existing patterns.** If the codebase uses tailwind, use tailwind. If it uses CSS-in-JS, use that.

## Hand-off

After polish:

- Show the user the changes and quote the design choices you made
- Cite PRODUCT.md / DESIGN.md lines that informed key decisions
- Suggest `/design-review` to score the result, or another `/design-polish` round in a different direction

## Rules

- **Polish is the last step, not the first.** If the work isn't functionally complete, say so and decline.
- **Polish without alignment to the design system is decoration on drift.** When in doubt, ask before guessing at design system principles.
- **Triage cosmetic vs functional.** Functional issues ship first. Cosmetic ones can land in a follow-up.
- **Consistent quality.** Don't perfect one corner while leaving another rough.
- **Don't introduce new patterns.** Use what exists.

Begin by asking the user what to polish and in which direction.
