// Shared constants for the Slayer Task Block List (§14 purchase) — the single
// source both the client (display) and the server
// (functions/_lib/game/slayerTaskBlocks.js, which enforces them) import, so
// the price and cap shown to the player can never drift from what the server
// actually charges/refuses.
export const SLAYER_TASK_BLOCK_COST = 10
export const SLAYER_TASK_BLOCK_MAX = 10
