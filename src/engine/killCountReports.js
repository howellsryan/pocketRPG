// Which kills the idle client is allowed to report a kill count for.
//
// The idle game has no per-kill cloud write and must not grow one (§6: a grind
// cannot cost a round trip per cow), so ordinary kills are tallied locally and
// ride the save push as a side channel. That makes them CLIENT-REPORTED, and
// kill_counts is the table the boss entry gates read (§14) — so the report is
// bounded to monsters that could never answer a gate, and to monsters with no
// server-authoritative path of their own.
//
// Three exclusions, and each one is load-bearing:
//   boss              — already counted by /api/actions/monster/complete, and
//                       bosses are what gates are made of.
//   logged drop       — likewise server-authoritative (the drop is granted
//                       server-side), so reporting it would DOUBLE count.
//   gate prerequisite — the integrity rule: nothing a client says may unlock a
//                       boss door. Derived from the content, not a hand list.
//
// What is left is cows, dragons and the rest of the grind: monsters whose XP
// and loot already ride the trusted save blob from the very same kill.

import monstersData from '../data/monsters.json'
import { monsterHasLoggedDrop } from './collectionLog.js'
import { killCountRequirementsFor } from './combatRequirements.js'

// Lazily built: a top-level initializer reading another module's export lands in
// its temporal dead zone under the single-file build (§12).
let gatePrerequisites = null
function prerequisiteIds() {
  if (gatePrerequisites) return gatePrerequisites
  gatePrerequisites = new Set()
  for (const [id, monster] of Object.entries(monstersData)) {
    for (const requiredId of Object.keys(killCountRequirementsFor({ ...monster, id }))) {
      gatePrerequisites.add(requiredId)
    }
  }
  return gatePrerequisites
}

/**
 * How many distinct monsters one report may carry.
 *
 * ONE number, shared by the client's tally and the server's batch: a client cap
 * above the server's would silently drop the overflow, because the client
 * settles what it SENT rather than what was accepted, and those kills would
 * never be retried.
 */
export const MAX_REPORTED_MONSTERS = 128

/** True when a client-reported kill count for this monster is safe to accept. */
export function isClientReportableMonster(monsterId) {
  if (typeof monsterId !== 'string' || !monsterId) return false
  const monster = monstersData[monsterId]
  if (!monster) return false
  if (monster.boss === true) return false
  if (monsterHasLoggedDrop(monsterId)) return false
  return !prerequisiteIds().has(monsterId)
}

/** The reportable part of a tally, with counts floored and bounded. Returns an
 * empty object rather than null so callers can treat it as a plain map. */
export function filterReportableKills(tally, { maxPerMonster = 100000 } = {}) {
  const out = {}
  if (!tally || typeof tally !== 'object') return out
  for (const [monsterId, raw] of Object.entries(tally)) {
    if (!isClientReportableMonster(monsterId)) continue
    const count = Math.floor(Number(raw) || 0)
    if (count <= 0) continue
    out[monsterId] = Math.min(count, maxPerMonster)
  }
  return out
}
