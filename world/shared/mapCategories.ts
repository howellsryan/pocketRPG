// Static-object → map category → icon tables shared by the big world map
// (worldMap.ts) and the minimap (minimap.ts), so both draw the same bank/
// skilling icons for the same statics instead of maintaining two copies.
// Pure data — no DOM — usable from the client and testable in the node
// vitest env.

/** Normalises a static object's `type` to a map marker category — the
 * furnace and anvil are one "Smithing" pin, matching how players think about
 * a smithing site, not the two separate station objects underneath. */
export const STATIC_CATEGORY: Record<string, string> = {
  bank_chest: 'bank', furnace: 'smithing', anvil: 'smithing', range: 'cooking', rock: 'mining', tree: 'woodcutting',
}

// The game's own art (bespokeIcons.json via uiIconMarkup) for every static
// category. Places and monsters use their own per-entry art (world.json's
// emoji, combatArt.js's MONSTER_ART) and aren't part of this table.
export const CATEGORY_ICON_KEY: Record<string, string> = {
  bank: 'coins', smithing: 'anvil', cooking: 'cooking_pot', mining: 'mining', woodcutting: 'wood_axe', exit: 'door',
}
