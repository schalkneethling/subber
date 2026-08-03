# CSS conventions

Subber's CSS is intentionally native and globally available. Component styles are organised with
cascade layers and BEM class names; CSS-in-JS is not used.

## Tokens and type

Shared colour, spacing, typography, radius, and motion values belong in `src/styles/tokens.css`.
Colours must provide a hexadecimal fallback before their OKLCH equivalent. The type scale uses a
restrained minor-third ratio (`1.2`) and fluid `clamp()` steps so text scales without breakpoint
jumps. Elements displaying money must use the `.currency-amount` utility for tabular figures.

The primary face is wired as `Subber Inter` with a metric-adjusted Arial fallback. The Latin
variable WOFF2 at `public/fonts/inter-latin-variable.woff2` is preloaded from `index.html`; it comes
from `@fontsource-variable/inter@5.3.0`. Keep its `public/fonts/OFL.txt` notice alongside the binary.
The complete bundled font payload must remain below 100 KB.

## Naming and properties

- Use BEM (`.block`, `.block__element`, `.block--modifier`) for component classes.
- Prefer logical properties such as `padding-inline`, `margin-block`, and `min-block-size`.
- Use relative units. Reserve pixels for details that genuinely need device-independent hairlines.
- Keep selectors shallow and specificity low. Components belong in the `components` cascade layer.

## Responsive CSS

Follow Shared First: declarations outside queries must apply at every size. Put size-specific values
inside self-contained, bounded Media Queries Level 4 ranges. Use the same pattern for container
queries. Current viewport ranges are below `45rem`, `45rem` through `80rem`, and `80rem` and above;
add a range only when content demonstrates a need for it.

## User preferences

Light and dark palettes follow `prefers-color-scheme`. Increased-contrast overrides follow
`prefers-contrast: more`. Motion durations collapse under `prefers-reduced-motion`; any future
animation or transition must consume the motion tokens instead of hard-coded durations.
