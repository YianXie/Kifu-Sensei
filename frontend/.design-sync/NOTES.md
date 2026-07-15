# design-sync notes — Kifu-Sensei

## Context

The synced "design system" is the **`frontend/` app**, not a standalone library. It's
built on MUI (`@mui/material`, emotion) and is a private package (`website-template-frontend`,
no `main`/`module`/`exports`, no library dist). Scope is deliberately narrowed to 6
prop-driven presentational components; the auth/router-coupled `layout/` + `global/`
components were intentionally excluded (they render blank/crash standalone).

Config home is **`frontend/`** — run all converter commands from there.

## Build setup (why the config looks the way it does)

- **Synth-entry avoided.** All 6 components are `export default function`, and synth-entry's
  `export * from` drops default exports. So `cfg.entry` points at a hand-written barrel
  `.design-sync/ds-entry.tsx` that re-exports each default as a named export for the
  `window.KifuSensei` IIFE.
- **`.wav` loader gap.** `Controls` → `@/assets/sounds/placeStoneSoundInstance` imports a
  `.wav`, which esbuild has no loader for. Fixed WITHOUT forking `bundle.mjs`: a dedicated
  `cfg.tsconfig` = `.design-sync/tsconfig.dssync.json` redirects that exact import to a stub
  (`.design-sync/stubs/placeStoneSoundInstance.ts`). The stub is a no-op object with
  `currentTime`/`play()` — audio is runtime-only and never affects rendering.
  - This dedicated tsconfig **inlines** the `@/*` → `../src/*` alias and does NOT follow
    `extends`. If the app adds new path aliases, they must be mirrored here too.
- **`cfg.dtsPropsFor`** supplies real `<Name>Props` bodies for all 6. Auto-extraction returned
  `[key: string]: unknown` because the components are default exports (ts-morph couldn't bind
  props to a named `<Name>Props`). If a component's prop signature changes in source, update
  `dtsPropsFor` by hand.

## CSS / styling

- **CSS-in-JS (MUI/emotion).** `[CSS_RUNTIME]` is expected and non-blocking — the bundle is
  self-styling; there is no static stylesheet to point `cfg.cssEntry` at.
- No `cfg.provider` is set. Previews render on MUI's **default** theme (light, default font).
  The real app wraps in a minimal `createTheme` (mode + Inter font family only) inside
  `App.tsx`'s `ThemedApp` — not exported, so not wired here. Renders look correct without it.

## Known render warns (triaged benign — do NOT chase on re-sync)

- **`[RENDER_THIN]` / `variantsIdentical` on `GoBoard`** — canvas component. The check measures
  DOM, which is identical across variants (same `<canvas>`); the boards DO differ visually
  (Opening ~6 stones vs Midgame ~12, red last-move marker). Confirmed via contact sheet.
- **`[RENDER_THIN]` / `variantsIdentical` on `MiniBoardThumb`** — same: canvas thumbnails
  (9×9 / 19×19 / handicap) differ visually but are DOM-identical.
- **`[GRID_OVERFLOW]` on `CommentaryConfig`** — resolved via `cfg.overrides.CommentaryConfig
  = {cardMode: "column"}` (full-width form).

## Re-sync risks

- **Preview data is inlined** in `.design-sync/previews/*.tsx` (move lists, a `CommentaryResponse`
  fixture). These are frozen sample data, not tied to any upstream fixture — safe, but they
  won't track API/type changes automatically. If `GameMove`/`CommentaryResponse` shapes change,
  update the previews and `dtsPropsFor`.
- **The sound stub / dedicated tsconfig** is tied to the current `@/` alias and the
  `placeStoneSoundInstance` import path. If either moves, update `tsconfig.dssync.json` and the
  stub.
- **`.wav`/asset imports** in any newly-scoped component will re-trip the esbuild loader gap —
  extend the stub-redirect pattern or the tsconfig.
