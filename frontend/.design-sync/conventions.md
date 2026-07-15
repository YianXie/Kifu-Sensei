## Kifu-Sensei components — how to build with them

These six components come from Kifu-Sensei, a Go-game commentary tool. They are
**Material UI (MUI v9) components** built with `@mui/material` + Emotion. Style and
theme therefore follow MUI conventions, not a custom token/utility system.

**Components (all default-imported from the library global):**

- `GoBoard` — full interactive Go board on a `<canvas>` (coordinates, stones, last-move
  marker). Props: `boardSize`, `moves`, `currentMoveIndex`, `onMoveChange`, `comments`.
- `Controls` — move-navigation bar (first/prev/next/last, ±5, jump-to-commented-move).
- `CommentPanel` — outlined panel showing the current move number and its commentary text.
- `HistoryCard` — summary card for a completed game (thumbnail, metadata, download/open).
- `MiniBoardThumb` — small static board thumbnail on a `<canvas>` (used inside cards).
- `CommentaryConfig` — the MUI form for choosing model / language / comment count / tokens.

See each component's `<Name>.d.ts` for the exact prop contract and `<Name>.prompt.md` for
usage — read those before composing. `GoBoard`/`MiniBoardThumb` render to canvas, so their
look is driven entirely by the `moves` data (each move is `["B" | "W", [row, col] | null]`).

### Styling idiom — MUI, not utility classes

- **No CSS class vocabulary.** These components expose behavior through **typed props**
  (above) and are styled internally. There are no `bg-*`/`gap-*` utility classes to apply.
- **Your own layout glue uses MUI.** Reach for MUI primitives (`Box`, `Stack`, `Paper`,
  `Grid`) and the **`sx` prop** for spacing/color, e.g. `<Box sx={{ display: "flex", gap: 2 }}>`.
  `Controls` accepts MUI style overrides via an `sx` prop.
- **Theme.** Kifu-Sensei's app theme is intentionally minimal: `createTheme({ palette: { mode },
  typography: { fontFamily: "Inter, ..." } })` — i.e. MUI defaults plus the **Inter** font and a
  light/dark `palette.mode` toggle. There are no custom brand tokens beyond that.

### Wrapping / setup

The components render correctly on MUI's default theme with **no provider required**. To match
Kifu-Sensei's exact look (Inter font, light/dark mode), wrap your tree once at the root:

```tsx
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { GoBoard, Controls, CommentPanel } from "<library>";

const theme = createTheme({
    palette: { mode: "light" }, // or "dark"
    typography: { fontFamily: ["Inter", "-apple-system", "sans-serif"].join(",") },
});

function Reviewer() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div>
                    <GoBoard boardSize={9} boardCanvasSize={360} moves={moves}
                             comments={{}} currentMoveIndex={idx} onMoveChange={setIdxDelta} />
                    <Controls maxMove={moves.length} currentMoveIndex={idx} onMoveChange={setIdxDelta} />
                </div>
                <CommentPanel boardCanvasSize={360} moves={moves}
                              currentMoveIndex={idx} currentComment={comments[idx] ?? ""} />
            </div>
        </ThemeProvider>
    );
}
```

`GoBoard` + `Controls` + `CommentPanel` are designed to compose as a game reviewer: keep a
shared `currentMoveIndex` in state and let `onMoveChange(delta)` advance it. Inter must be
loaded by the host page (webfont) for the theme's font to apply; otherwise MUI's default
sans-serif is used.
