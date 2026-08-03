# Subber

Subber is a local-first subscription tracker for the web, iOS, and Android. The web application is the source of truth; native packages will be produced from it with Capacitor in a later phase.

## Requirements

- Node.js 24 or newer
- pnpm 11.10.0

## Local development

Install the pinned dependency graph and start Vite:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Vite serves the application at <http://127.0.0.1:5173>. To exercise a production build locally:

```sh
pnpm build
pnpm preview
```

The preview is available at <http://127.0.0.1:4173>.

## Quality and tests

```sh
pnpm quality          # lint, HTML validation, formatting, types, dead code, environment
pnpm test:unit        # non-interactive Vitest suite
pnpm test:e2e         # non-interactive Chromium acceptance and accessibility suite
pnpm test             # unit and browser suites
```

Install the browser used by the end-to-end suite once on a development machine:

```sh
pnpm exec playwright install chromium
```

The browser suite starts a production preview automatically. On failure, Playwright retains screenshots and video; a trace is recorded on the first retry in CI. CI uploads `playwright-report/` and `test-results/` for seven days when the browser suite fails.

The Phase 0 browser smoke uses semantic locators, an ARIA snapshot, an axe scan targeting WCAG 2.2 AA, and a scoped application-shell screenshot. Visual assertions run with a fixed Chromium viewport, light color scheme, locale, timezone, bundled font, and disabled animations/caret to keep the shared baseline stable in local and CI runs.

## Dependency policy

The project requires pnpm 11.10.0 and pins that version in CI. It also commits `pnpm-lock.yaml`, and CI uses frozen installs. pnpm explicitly denies esbuild's install script because the platform binary is supplied as an optional package. Any new dependency that requires an install script must be reviewed and explicitly allowed rather than silently executing it.
