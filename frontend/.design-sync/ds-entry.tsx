// Design-system barrel entry for /design-sync.
// The frontend is a private app (no library dist), and all synced components
// are default exports — synth-entry's `export *` would drop them — so this
// barrel names each one for the window.<globalName> IIFE. Referenced by
// cfg.entry in .design-sync/config.json.
export { default as GoBoard } from "@/components/game/GoBoard";
export { default as Controls } from "@/components/game/Controls";
export { default as CommentPanel } from "@/components/game/CommentPanel";
export { default as HistoryCard } from "@/components/history/HistoryCard";
export { default as MiniBoardThumb } from "@/components/history/MiniBoardThumb";
export { default as CommentaryConfig } from "@/components/commentary/CommentaryConfig";
