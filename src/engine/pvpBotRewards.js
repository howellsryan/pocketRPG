// Server-side loot box rolling for PvP bot wins.
//
// Pure function — no I/O, no Date.now. Pass a deterministic rng for tests.
// Called by settlePvpMatch (functions/_lib/pvpSettle.js) when the human wins vs a bot.
//
// Drop table (per product spec):
//   ~70% common  — 1 000–10 000 coins
//   ~28% uncommon — 10 000–50 000 coins
//   ~2%  rare     — one Zesta unique (equal split: ~0.667% each)
//
// Returns an array of { itemId, quantity } loot entries ready for fillBank.

const ZESTA_ITEMS = ['zesta_longsword', 'zesta_vest', 'zesta_skirt']

export function rollBotLootBox(rng = Math.random) {
  const roll = rng()

  // Rare: 2% split equally across three Zesta items
  if (roll < 0.02) {
    const itemIndex = Math.floor(rng() * ZESTA_ITEMS.length)
    return [{ itemId: ZESTA_ITEMS[itemIndex], quantity: 1 }]
  }

  // Uncommon: 28% (0.02–0.30)
  if (roll < 0.30) {
    const coins = 10_000 + Math.floor(rng() * 40_001)  // 10k–50k
    return [{ itemId: 'coins', quantity: coins }]
  }

  // Common: 70% (0.30–1.00)
  const coins = 1_000 + Math.floor(rng() * 9_001)  // 1k–10k
  return [{ itemId: 'coins', quantity: coins }]
}

// Convenience: check if a loot entry is a Zesta unique (for collection log).
export function isZestaUnique(itemId) {
  return ZESTA_ITEMS.includes(itemId)
}
