// Co-operative boss fights: N players versus one shared boss.
//
// The combat model is the open world's (world/server/combat.ts): every member
// runs their own `processCombatTick` session against a SHARED boss HP record,
// rather than a bespoke N-vs-1 engine. That keeps every authored boss mechanic
// — adds, forms, resistances, specials, prayer, bolt procs — working for free.
//
// Two invariants make the shared boss behave like one monster rather than one
// monster per attacker:
//   1. Only the target member's session is allowed to resolve a boss swing
//      (`monsterAttackTimer` is held off the floor for everyone else), or the
//      boss would attack once per member every tick.
//   2. The boss's add lives on the shared record and only the target member's
//      session advances its spawn countdown, or N members would each spawn one.
//
// State is persisted as JSON per tick, so members store only the mutable engine
// fields; the monster itself is rebuilt from `monstersData` on every tick.

import { createCombatState, processCombatTick } from './combat.js'
import { hardModeDeathLoss, monstersTableFor } from './hardMode.js'
import { getLevelFromXP } from './experience.js'
import { resolveSlayerTaskKill } from './slayerTasks.js'
import { RAID_TASK_META } from './slayerMasters.js'
import { getSlayerTaskReward, getSlayerTaskXpForKill } from './slayerRewards.js'
import { isConsumableFood, isConsumablePotion, isComboConsumable, applyConsumableEffect } from './consumables.js'
import { getCombatType, equipItem, placeUnequippedItems } from './equipment.js'
import { questRequirementMet, completedQuestsFromSave } from './questGates.js'
import { isRoomWideAttacker, advanceRoomWideAttackTimer, advanceAddAttackTimers } from './roomWideAttacks.js'
import { hasMasterRejuvenation, refillSpecialOnEmpty } from './specialRegen.js'
import { bossAddsOf, getAddSpec, rollRespawnDelay } from './bossAdds.js'
import { advanceSharedForm, formChangeAttackTimer, isMultiForm, pinFormToSession } from './bossForms.js'
import { grindmanXP, isGrindmanSave } from './grindman.js'
import {
  COOP_RAID_ADVANCE_TICKS,
  coopRaidData,
  isCoopHost,
  nextHostCharacterId,
  raidBossOrder,
  raidPartyReady,
  raidReadyCount,
  raidTotalHitpoints,
} from './coopRaidEngine.js'

export const COOP_MAX_MEMBERS = 8
export const COOP_TICK_MS = 600
/** Bosses playable co-operatively: every boss in monsters.json except the raid
 * bosses, which stay inside their own instanced raid content, and the four that
 * stay solo: the Ember Pits pair (`ember_tyrant`, `ashen_crucible`),
 * `venomcoil_matriarch` and `blighted_gauntlet`.
 * Still an explicit allowlist rather than a filter over the monster data,
 * so opening a boss to groups is a deliberate edit and both sides gate on one
 * list. Ordered by combat level. */
export const COOP_BOSSES = {
  gravehusk_brute: {},
  boneclaw_revenant: {},
  stonegale_elemental: {},
  gravethorn_drake: {},
  shroudwraith_specter: {},
  cindermaw_serpent: {},
  ironclad_guardian: {},
  thornhide_colossus: {},
  razorwing_harpy: {},
  emberhowl_warlord: {},
  ashen_hydra: {},
  sovrathar_the_ashen_sovereign: {},
  hellbound_gorilla: {},
  king_black_dragon: {},
  deepmaw_kraken: {},
  nagadoth_prime: {},
  nagadoth_rex: {},
  nagadoth_supreme: {},
  threefang_cerberus: {},
  duskmare: {},
  skyrender_kharra: {},
  commander_zephyra: {},
  warlord_grondar: {},
  krylth_the_defiler: {},
  corporeal_horror: {},
  zaryth_the_empty_lord: {},
}
export const COOP_BOSS_IDS = new Set(Object.keys(COOP_BOSSES))
// Re-exported: the open world runs the same mechanic off the same module.
export { isRoomWideAttacker, advanceRoomWideAttackTimer, advanceAddAttackTimers }
/**
 * The wait between kills, for every co-op boss: 8 ticks, the HUD's 5 seconds.
 *
 * This replaced a per-boss curve (`clamp(round(12750 / hitpoints), 10, 100)`)
 * that paced the farm loop off the boss's HP, so a group could not melt a
 * 255 HP boss at the same rate as a 2000 HP one. A flat wait is the deliberate
 * call: predictable for players, and short enough that the wait reads as a
 * breather rather than downtime. It does mean a squishy boss's GP and XP per
 * hour are no longer held back by its respawn — pace those with the drop table
 * or the boss's own HP, not by reintroducing a per-boss delay here.
 *
 * 8 rather than 5s-to-the-millisecond: the countdown renders as
 * `ceil(ticks * 0.6)`, so 8 is the longest wait that still reads "5s".
 */
export const COOP_RESPAWN_TICKS = 8

export function isCoopBossId(bossId) {
  return typeof bossId === 'string' && Object.prototype.hasOwnProperty.call(COOP_BOSSES, bossId)
}

export function coopRespawnTicks() {
  return COOP_RESPAWN_TICKS
}
const COOP_EAT_TICK_COST = 3
const COOP_VALID_STANCES = new Set(['accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'])
const COMBAT_STAT_KEYS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer']
/** Monster fields the engine mutates in place for multi-form bosses; carried on
 * the shared record so a form switch is seen by every member, not just whoever
 * triggered it. */
const MUTABLE_MONSTER_FIELDS = [
  'currentForm', 'formAttackCount', 'formSwitchThreshold', 'attackStyle',
  'attackBonus', 'strengthBonus', 'defenceBonus', 'formMaxHit', 'hitpoints',
  // A form may change what the boss is weak to, and the room's copy has to move
  // with it or every member keeps rolling against the form before last's.
  'weakness',
  // Defence-draining specials (Dragon Warhammer's smash, the Cindermaw Maul's
  // molten crush) lower `stats.defence` on the record they hit. A member's
  // session is rebuilt from monsters.json every tick, so left off here the drain
  // was thrown away at the write-back — it did not reach the rest of the room,
  // and did not even survive for the player who spent the energy. (Warstrike
  // drains `defenceBonus`, already carried above.)
  'stats',
  // Warstrike's running total, which is what survives a form change. The roll
  // happens on the shared record (advanceSharedForm), so that is where the
  // re-apply has to be able to see it.
  'defenceBonusDrain',
  // Smash/molten-crush have no running total of their own — they mutate
  // `stats.defence` in place — so the info panel's "what it was" needs this
  // fight-start stamp (prepareMonster) carried the same way defenceBonusDrain is.
  'baseDefenceLevel',
]

function levelFrom(statValue) {
  if (typeof statValue === 'number') return Number.isFinite(statValue) && statValue > 0 ? Math.floor(statValue) : 1
  const explicit = Number(statValue?.level)
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit)
  const xp = Number(statValue?.xp)
  if (Number.isFinite(xp) && xp >= 0) return getLevelFromXP(xp)
  return 1
}

export function combatStatLevels(savePayload) {
  const stats = savePayload?.stats || {}
  const out = {}
  for (const key of COMBAT_STAT_KEYS) out[key] = levelFrom(stats[key])
  return out
}

/** Every skill as a level, not just the combat ones: gear gates on Slayer,
 * Dungeoneering and the rest too, and the session state is the only thing the
 * tick has to check an equip against. */
export function allStatLevels(savePayload) {
  const stats = savePayload?.stats || {}
  const out = {}
  for (const key of Object.keys(stats)) out[key] = levelFrom(stats[key])
  return out
}

/** Player-facing reason an equip was refused. Lives here so the screen never
 * has to leave a failed tap silent. */
export function describeCoopEquipRefusal(event) {
  if (event?.reason === 'quest') return `Complete quest to equip: ${String(event.questUnlock || '').replace(/_/g, ' ')}`
  if (event?.reason === 'skill') return `Need ${event.skill} level ${event.required} to equip`
  if (event?.reason === 'inventory_full') return 'Inventory full — no room for the gear you are wearing'
  return 'Could not equip that'
}

/** Player-facing reason a spell or prayer was refused. Separate from the equip
 * describer so each message stays accurate about what was rejected. */
export function describeCoopActionRefusal(event) {
  if (event?.reason === 'spell_level') return `Need Magic level ${event.required} to cast ${event.name || 'that spell'}`
  if (event?.reason === 'prayer_level') return `Need Prayer level ${event.required} to use ${event.name || 'that prayer'}`
  if (event?.reason === 'party_not_ready') {
    const waiting = Math.max(0, (event.total ?? 0) - (event.ready ?? 0))
    return `The party is not ready — ${waiting} ${waiting === 1 ? 'raider is' : 'raiders are'} still getting set`
  }
  if (event?.reason === 'not_host') return 'Only the host can start the raid'
  return 'Could not do that'
}

/** Mirrors checkEquipRequirements, but against the level map the session
 * carries rather than an xp-keyed stats blob. Fails CLOSED: a member whose
 * session predates `levels` cannot equip anything gated, rather than being
 * waved through. */
export function coopEquipRequirementFailure(item, member) {
  const questUnlock = item?.questUnlock
  if (!questRequirementMet(member?.completedQuests || [], questUnlock)) {
    return { reason: 'quest', questUnlock }
  }
  const requirements = item?.requirements
  if (requirements) {
    const levels = member?.levels || {}
    for (const [skill, required] of Object.entries(requirements)) {
      const have = Number(levels[skill]) || 1
      if (have < required) return { reason: 'skill', skill, required, current: have }
    }
  }
  return null
}

function cloneCoopInventory(inventory) {
  return Array.isArray(inventory) ? inventory.map((s) => (s ? { ...s } : null)) : []
}

function cloneCoopEquipment(equipment) {
  return Object.fromEntries(Object.entries(equipment || {}).map(([slot, item]) => [slot, item ? { ...item } : null]))
}

export function cloneCoopState(state) {
  const members = {}
  for (const [id, m] of Object.entries(state.members || {})) {
    members[id] = {
      ...m,
      stats: { ...m.stats },
      equipment: cloneCoopEquipment(m.equipment),
      inventory: cloneCoopInventory(m.inventory),
      combat: { ...m.combat, activePotions: { ...(m.combat?.activePotions || {}) } },
      xpGained: { ...(m.xpGained || {}) },
      ...(Array.isArray(m.quickPrayers) ? { quickPrayers: [...m.quickPrayers] } : {}),
    }
  }
  return {
    ...state,
    boss: { ...state.boss, adds: bossAddsOf(state.boss).map((add) => ({ ...add })), monster: { ...(state.boss?.monster || {}) } },
    ...(state.raid ? { raid: { ...state.raid, bosses: [...(state.raid.bosses || [])] } } : {}),
    members,
    recentEvents: Array.isArray(state.recentEvents) ? [...state.recentEvents] : [],
  }
}

/** A fresh, empty instance of a boss. Members join into it afterwards. */
export function createCoopBossState(bossId, monstersData, now = Date.now(), { hardMode = false } = {}) {
  // The room's difficulty is decided once, here, and rides state_json from then
  // on: every member of a room fights the same boss off one health bar, so it
  // can never be a per-member preference.
  const table = monstersTableFor(monstersData, hardMode)
  const monster = table?.[bossId]
  if (!monster) return null
  const seed = createCombatState(monster, 'melee', 'accurate', null, table)
  return {
    tick: 0,
    bossId,
    hardMode: !!hardMode,
    startedAt: now,
    boss: {
      currentHP: seed.monster.currentHP,
      maxHP: seed.monster.currentHP,
      attackSpeed: seed.monster.attackSpeed || 4,
      attackTimer: seed.monster.attackSpeed || 4,
      monster: pickMutableMonsterFields(seed.monster),
      add: null,
      addSpawnCountdown: seed.addSpawnCountdown,
      addsDefeated: 0,
      // Shared, because a double-kill boss's first death is the ROOM's progress,
      // not the progress of whichever member happened to land the last hit — a
      // member's engine is rebuilt from scratch every tick.
      doubleKillCount: 0,
      killedAt: null,
      respawnCountdown: 0,
    },
    members: {},
    targetCharId: null,
    recentEvents: [],
    // A boss room is drop-in, so it is live from the moment it exists. Raids
    // override this with a lobby (createCoopRaidState).
    phase: 'active',
    hostCharacterId: null,
  }
}

/**
 * A raid party, waiting in its lobby.
 *
 * The boss record is seeded with the raid's FIRST boss so every reader that
 * already understands a co-op session — the projection, the checkpoint, the
 * fight HUD — works before anyone presses Start. `raid.maxHP` is the whole
 * run's hitpoints, because the loot gate measures a member's share of the raid
 * rather than of whichever boss happened to be last.
 */
export function createCoopRaidState(raidId, monstersData, { hostCharacterId = null, now = Date.now(), hardMode = false } = {}) {
  const raid = coopRaidData(raidId)
  if (!raid) return null
  const bosses = raidBossOrder(raidId)
  const seed = createCoopBossState(bosses[0], monstersData, now, { hardMode })
  if (!seed) return null
  // The loot gate measures a member's damage against the WHOLE run, so the
  // basis has to be the run the party is actually fighting — read off the
  // normal table it would be halved, and every raider would clear 10% twice over.
  const table = monstersTableFor(monstersData, hardMode)
  return {
    ...seed,
    phase: 'lobby',
    hostCharacterId: hostCharacterId == null ? null : Number(hostCharacterId),
    raid: {
      raidId,
      name: raid.name,
      bosses,
      currentBossIndex: 0,
      maxHP: raidTotalHitpoints(raidId, table),
      completions: 0,
    },
  }
}

/**
 * The room's boss as a WHOLE monster: the authored data with whatever the room
 * has since decided about it written over the top. `boss.monster` alone is only
 * the mutable subset, so it carries `currentForm` but not `forms` — enough to
 * pin a session, not enough to roll the next form off.
 */
function sharedMonsterOf(state, monstersData) {
  return { ...(monstersData?.[state.bossId] || {}), ...(state.boss?.monster || {}) }
}

// Nested fields (`stats`, `defenceBonus`) are copied, never aliased: the seed
// for a fresh instance comes straight off the monsters.json row, and a room
// holding a reference into the content table is one careless in-place mutation
// away from re-balancing that boss for every fight in the process.
function pickMutableMonsterFields(monster) {
  const out = {}
  for (const field of MUTABLE_MONSTER_FIELDS) {
    const value = monster?.[field]
    if (value === undefined) continue
    out[field] = (value && typeof value === 'object' && !Array.isArray(value)) ? { ...value } : value
  }
  return out
}

/** Slayer progress a member has banked in this session but not yet had written
 * to their save. A DELTA, like xpGained — the write-back adds it and clears it,
 * so a member who is written back twice is not paid twice. */
export function emptySlayerCredit() {
  return { pointsEarned: 0, tasksCompleted: 0, masterCompletions: {} }
}

/**
 * Folds a hard-mode death's tally into the member's banked declaration. Also a
 * DELTA cleared by the write-back, so a member written back twice declares the
 * loss once — over-declaring on the second write would let a genuine loss in
 * that window pass unflagged.
 */
export function bankMemberItemsLost(banked, lost) {
  const out = { ...(banked || {}) }
  for (const entry of Array.isArray(lost) ? lost : []) {
    const itemId = entry?.itemId
    if (typeof itemId !== 'string' || !itemId) continue
    out[itemId] = (out[itemId] || 0) + (Math.floor(Number(entry.quantity) || 0) || 1)
  }
  return out
}

/**
 * Credits one boss kill against a member's own slayer task.
 *
 * Deliberately independent of damage: a group kill counts for everyone who was
 * in the fight for it, not just the top-damage member who takes the loot. The
 * one thing it is gated on is being ALIVE at the kill — otherwise dying on
 * purpose in an eight-player room is the cheapest slayer task in the game.
 *
 * Mutates the member (task, accrued XP, banked credit) and returns what
 * happened so the caller can tell the player.
 */
export function creditSlayerKill(member, bossId, monstersData, { fromRaidCompletion = false } = {}) {
  if (!member || member.status !== 'alive') return null
  const task = member.slayerTask
  if (!task) return null
  // A raid-completion proxy task is paid by the CLEAR and by nothing else — the
  // same defence-in-depth solo has (CombatScreen's raidTaskCreditBlocked).
  const raidMeta = RAID_TASK_META[task.monsterId]
  if (raidMeta && !fromRaidCompletion) return null
  const result = resolveSlayerTaskKill(task, bossId, 1)
  if (!result.onTask) return null

  const monster = monstersData?.[bossId] || null
  const xp = getSlayerTaskXpForKill(monster, monster, monstersData, {
    doubleXp: member.doubleSlayerXp,
    // A raid clear is a whole run, not a boss kill: it pays the authored flat
    // rate, never the final boss's HP through the boss multiplier. Read off the
    // final boss, the four raid tasks paid between 400 and 8000 instead of the
    // 2500–10000 they are worth — solo has always passed this.
    flatXp: raidMeta?.flatSlayerXp,
  })
  const bankedXp = grindmanXP(xp, member.isGrindman === true)
  if (bankedXp > 0) member.xpGained.slayer = (member.xpGained.slayer || 0) + bankedXp

  if (!member.slayerCredit) member.slayerCredit = emptySlayerCredit()
  if (!result.completed) {
    member.slayerTask = result.task
    return {
      characterId: member.characterId,
      completed: false,
      slayerXp: bankedXp,
      monstersRemaining: result.task?.monstersRemaining ?? 0,
    }
  }

  const reward = getSlayerTaskReward(result.pointsAwarded, member.slayerTasksCompleted)
  member.slayerTask = null
  member.slayerTasksCompleted = reward.totalTasks
  member.slayerCredit.pointsEarned += reward.pointsEarned
  member.slayerCredit.tasksCompleted += 1
  if (task.masterId) {
    member.slayerCredit.masterCompletions[task.masterId] =
      (member.slayerCredit.masterCompletions[task.masterId] || 0) + 1
  }
  return {
    characterId: member.characterId,
    completed: true,
    slayerXp: bankedXp,
    pointsEarned: reward.pointsEarned,
    totalTasks: reward.totalTasks,
  }
}

/** Seeds a member's compact combat record from their save snapshot. */
export function createCoopMember({ characterId, username, savePayload, itemsData, now = Date.now() }) {
  const stats = combatStatLevels(savePayload)
  const equipment = cloneCoopEquipment(savePayload?.equipment)
  const inventory = cloneCoopInventory(savePayload?.inventory)
  const maxHP = stats.hitpoints
  const savedHP = Number(savePayload?.player?.currentHP)
  const hp = Number.isFinite(savedHP) && savedHP > 0 ? Math.min(savedHP, maxHP) : maxHP
  const stance = savePayload?.settings?.combatStance
  const savedSpell = savePayload?.settings?.activeCombatSpell ?? savePayload?.activeCombatSpell
  const settings = savePayload?.settings || {}
  return {
    characterId,
    username,
    hp,
    maxHP,
    stats,
    levels: allStatLevels(savePayload),
    // Half XP for this member only — a room holds a mix of account types, and
    // the flag rides the member the same way every other save-derived field
    // does. Their tripled drops are rolled server-side off characters.is_grindman.
    isGrindman: isGrindmanSave(savePayload),
    completedQuests: [...completedQuestsFromSave(savePayload)],
    equipment,
    inventory,
    status: 'alive',
    damage: 0,
    damageTick: 0,
    xpGained: {},
    // Deliberate removals awaiting a save write-back, itemId -> units. Banked
    // like xpGained (and cleared at the same points) because the room takes the
    // pack in the Durable Object, several ticks before anything reaches the
    // save — and the client ledger that explains a solo hard-mode death to the
    // item-loss detector cannot see a loss it never made.
    itemsLost: {},
    // Slayer state rides the session so a group kill credits the member's own
    // task. The running completion total comes along because the task-reward
    // multiplier keys off it (every 5th task ×10, every 50th ×50) — snapshotting
    // it once and reusing it would pay the same milestone twice in one session.
    slayerTask: settings.slayerTask || null,
    slayerTasksCompleted: Math.max(0, Math.floor(Number(settings.slayerTasksCompleted) || 0)),
    doubleSlayerXp: !!settings.characterUnlocks?.doubleSlayerXp,
    // The construction perk rides the member because the room owns the save for
    // the length of the fight: it is read once from the join snapshot, exactly
    // as the slayer and quick-prayer state above is.
    masterRejuvenation: hasMasterRejuvenation(settings.unlockedFeatures),
    slayerCredit: emptySlayerCredit(),
    // Carried through the fight because the room owns the save while it lives:
    // a quick-prayer edit made mid-fight cannot reach /api/save (the co-op lock
    // refuses it), so without this it survives only until the exit pull.
    quickPrayers: Array.isArray(settings.quickPrayers) ? settings.quickPrayers.filter((id) => typeof id === 'string') : [],
    // Raid lobby only: the party's own signal that they have finished eating,
    // banking and re-gearing. It gates nothing — the host can always set off —
    // because a party must never be stranded by one member who walked away.
    ready: false,
    joinedAt: now,
    combat: {
      combatType: getCombatType(equipment, itemsData),
      stance: COOP_VALID_STANCES.has(stance) ? stance : 'accurate',
      spellId: typeof savedSpell === 'string' ? savedSpell : (savedSpell?.id ?? null),
      playerAttackTimer: 0,
      monsterAttackTimer: 0,
      eatCooldown: 0,
      potionCooldown: 0,
      comboCooldown: 0,
      specialAttackEnergy: 100,
      specialAttackQueued: false,
      activeProtectionPrayer: null,
      activeCombatPrayer: null,
      prayerPoints: stats.prayer,
      maxPrayerPoints: stats.prayer,
      prayerDrainAccumulator: 0,
      activePotions: {},
      addTargetIndex: null,
    },
  }
}

export function addCoopMember(state, member) {
  const next = cloneCoopState(state)
  // One attack delay before the boss can swing at a new arrival, matching the
  // live game's first-hit rule (createCombatState seeds the same way).
  member.combat.monsterAttackTimer = next.boss.attackSpeed || 4
  next.members[String(member.characterId)] = member
  if (!next.targetCharId) next.targetCharId = String(member.characterId)
  // First through the door owns the Start button. Set explicitly by the raid
  // join path; this is the fallback for a room whose host has been swept.
  if (next.hostCharacterId == null) next.hostCharacterId = Number(member.characterId)
  return next
}

export function removeCoopMember(state, characterId) {
  const next = cloneCoopState(state)
  delete next.members[String(characterId)]
  if (next.targetCharId === String(characterId)) next.targetCharId = null
  // A party whose host closed their tab must not be left with a Start button
  // nobody can press.
  if (next.hostCharacterId != null && Number(next.hostCharacterId) === Number(characterId)) {
    next.hostCharacterId = nextHostCharacterId(next)
  }
  reselectTarget(next)
  return next
}

export function livingMembers(state) {
  return Object.values(state.members || {}).filter((m) => m.status === 'alive')
}

export function memberCount(state) {
  return Object.keys(state.members || {}).length
}

/** Share of the boss's max HP a member has to deal PERSONALLY to earn a loot
 * roll. Everyone past the line rolls the drop table independently — a group kill
 * is not one prize handed to the top attacker. */
export const COOP_LOOT_DAMAGE_SHARE = 0.1

/**
 * Damage that qualifies a member for loot on this boss instance.
 *
 * Ceil, against the §4 house rule, for two reasons: the HUD advertises "10%" and
 * must not pay out at 9.6%, and a boss small enough to floor to 0 would
 * otherwise hand a drop to a member who never swung. The floor of 1 is what
 * makes `damage >= required` imply `damage > 0`.
 */
export function coopLootDamageRequired(maxHP) {
  const hp = Math.max(0, Math.floor(Number(maxHP) || 0))
  return Math.max(1, Math.ceil(hp * COOP_LOOT_DAMAGE_SHARE))
}

/**
 * The health pool the 10% gate is measured against.
 *
 * A boss room pays per kill, so it is that boss's max HP. A raid pays once, at
 * the end, so it is every boss in the run added together — every phase and every
 * kill of them (raidTotalHitpoints) — and member damage is never reset between
 * them, otherwise a member could carry five bosses and still be dry because they
 * were low on supplies for the sixth.
 */
export function coopLootBasisHP(state) {
  const raidHP = Number(state?.raid?.maxHP)
  if (Number.isFinite(raidHP) && raidHP > 0) return raidHP
  return Number(state?.boss?.maxHP) || 0
}

/** Everyone owed a loot roll for the kill, biggest contributor first. Damage —
 * not survival: a member who earned their share and then died is still paid, the
 * same way the top-damage owner used to be. */
export function lootEligibleCharacterIds(state) {
  const required = coopLootDamageRequired(coopLootBasisHP(state))
  return Object.values(state?.members || {})
    .filter((m) => (m.damage || 0) >= required)
    .sort((a, b) => b.damage - a.damage || (a.damageTick || 0) - (b.damageTick || 0))
    .map((m) => Number(m.characterId))
}

/** One member's progress toward their loot roll, for the fight HUD. Lives here
 * rather than in the screen so the bar and the server's gate cannot drift. */
export function coopLootProgress(member, maxHP) {
  const required = coopLootDamageRequired(maxHP)
  const damage = Math.max(0, Math.floor(Number(member?.damage) || 0))
  return {
    damage,
    required,
    qualified: damage >= required,
    remaining: Math.max(0, required - damage),
    // Against the threshold, not the boss's whole health bar: the bar answers
    // "am I getting a drop", so a full bar has to mean exactly that.
    pct: Math.max(0, Math.min(100, (damage / required) * 100)),
  }
}

/**
 * What a `killSettled` event means for ONE member — the whole decision behind
 * "do I show the loot modal".
 *
 * Pure, and here rather than in the screen, because this is the branch that
 * decides whether a player sees their drop: buried in JSX it could not be
 * tested, and every shape below is one that reached a real player.
 *
 *   loot     — their own roll, modal.
 *   diverged — the server refused to grant; a modal would read as a dry kill.
 *   failed   — the grant threw; likewise, and it is an outage, not bad luck.
 *   missed   — under the damage threshold, so nothing was owed.
 *
 * `settlements` is absent only when the room is older than the multi-winner
 * build; the legacy single-winner fields are read in that case rather than
 * showing every member a dry kill through a deploy.
 */
export function coopKillOutcome(event, characterId) {
  const settlements = Array.isArray(event?.settlements)
    ? event.settlements
    : (event?.ownerCharacterId != null
      ? [{
        characterId: event.ownerCharacterId,
        granted: event.granted,
        killCount: event.killCount,
        diverged: event.diverged,
        failed: event.failed,
      }]
      : [])
  const winners = settlements.length
  const mine = settlements.find((s) => Number(s?.characterId) === Number(characterId))
  if (!mine) return { kind: 'missed', winners }
  if (mine.diverged) return { kind: 'diverged', winners }
  if (mine.failed) return { kind: 'failed', winners }
  return {
    kind: 'loot',
    winners,
    loot: Array.isArray(mine.granted) ? mine.granted : [],
    killCount: Number.isFinite(Number(mine.killCount)) ? Number(mine.killCount) : null,
  }
}

/** Loot owner: most damage dealt to the boss; equal totals resolve to whoever
 * reached the total first. Same rule the open world uses (npc.ts). */
export function topDamageCharacterId(state) {
  let best = null
  for (const m of Object.values(state.members || {})) {
    if (!(m.damage > 0)) continue
    if (!best || m.damage > best.damage || (m.damage === best.damage && m.damageTick < best.damageTick)) best = m
  }
  return best ? String(best.characterId) : null
}

export function damageTable(state) {
  return Object.values(state.members || {})
    .map((m) => ({ characterId: m.characterId, username: m.username, damage: m.damage, hp: m.hp, maxHP: m.maxHP, status: m.status }))
    .sort((a, b) => b.damage - a.damage)
}

/** Points the boss at the living member who has dealt the most damage, so it
 * focuses the biggest threat instead of whoever engaged first. The current
 * target is kept on a tie so the indicator does not flicker. */
export function reselectTarget(state) {
  const alive = livingMembers(state)
  if (alive.length === 0) {
    state.targetCharId = null
    return
  }
  const current = alive.find((m) => String(m.characterId) === state.targetCharId)
  let best = current || alive[0]
  for (const m of alive) if (m.damage > best.damage) best = m
  state.targetCharId = String(best.characterId)
}

function hydrateCombatState(state, member, monstersData, spellsData) {
  const monster = monstersData?.[state.bossId]
  if (!monster) return null
  const spell = member.combat.spellId ? spellsData?.[member.combat.spellId] ?? null : null
  const engine = createCombatState(monster, member.combat.combatType, member.combat.stance, spell, monstersData)
  Object.assign(engine.monster, state.boss.monster || {})
  engine.monster.currentHP = state.boss.currentHP
  engine.doubleKillCount = state.boss.doubleKillCount || 0
  engine.playerAttackTimer = member.combat.playerAttackTimer
  engine.monsterAttackTimer = member.combat.monsterAttackTimer
  engine.eatCooldown = member.combat.eatCooldown
  engine.potionCooldown = member.combat.potionCooldown
  engine.comboCooldown = member.combat.comboCooldown
  engine.specialAttackEnergy = member.combat.specialAttackEnergy
  engine.specialAttackQueued = member.combat.specialAttackQueued
  engine.activeProtectionPrayer = member.combat.activeProtectionPrayer
  engine.activeCombatPrayer = member.combat.activeCombatPrayer
  engine.prayerPoints = member.combat.prayerPoints
  engine.maxPrayerPoints = member.combat.maxPrayerPoints
  engine.prayerDrainAccumulator = member.combat.prayerDrainAccumulator
  engine.activePotions = { ...(member.combat.activePotions || {}) }
  engine.adds = bossAddsOf(state.boss).map((add) => ({ ...add }))
  engine.addSpawnCountdown = state.boss.addSpawnCountdown
  engine.addsSpawned = state.boss.addsSpawned || 0
  engine.addsDefeated = state.boss.addsDefeated
  const wanted = member.combat.addTargetIndex
  engine.addTargetIndex = typeof wanted === 'number' && engine.adds[wanted]?.currentHP > 0 ? wanted : null
  return engine
}

function dehydrateCombatState(engine, member) {
  member.combat.playerAttackTimer = engine.playerAttackTimer
  member.combat.monsterAttackTimer = engine.monsterAttackTimer
  member.combat.eatCooldown = engine.eatCooldown
  member.combat.potionCooldown = engine.potionCooldown
  member.combat.comboCooldown = engine.comboCooldown
  member.combat.specialAttackEnergy = engine.specialAttackEnergy
  member.combat.specialAttackQueued = engine.specialAttackQueued
  member.combat.activeProtectionPrayer = engine.activeProtectionPrayer
  member.combat.activeCombatPrayer = engine.activeCombatPrayer
  member.combat.prayerPoints = engine.prayerPoints
  member.combat.maxPrayerPoints = engine.maxPrayerPoints
  member.combat.prayerDrainAccumulator = engine.prayerDrainAccumulator
  member.combat.activePotions = { ...(engine.activePotions || {}) }
  member.combat.addTargetIndex = engine.addTargetIndex ?? null
}

/** An event that means the boss itself took a swing — not one of its minions. */
function isBossSwing(ev) {
  if (!ev || ev.fromAdd) return false
  return ev.type === 'monsterHit' || ev.type === 'monsterMiss'
    || ev.type === 'dragonfireHit' || ev.type === 'dragonfireBlocked'
}

function playerStatsFor(member) {
  return {
    attack: member.stats.attack,
    strength: member.stats.strength,
    defence: member.stats.defence,
    ranged: member.stats.ranged,
    magic: member.stats.magic,
    currentHP: member.hp,
  }
}

function removeFromInventory(inventory, itemId, qty) {
  let remaining = Math.max(0, Math.floor(Number(qty) || 0))
  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    const slot = inventory[i]
    if (!slot || slot.itemId !== itemId) continue
    const take = Math.min(slot.quantity || 1, remaining)
    slot.quantity = (slot.quantity || 1) - take
    remaining -= take
    if (slot.quantity <= 0) inventory[i] = null
  }
  return remaining === 0
}

/** A member's level in one skill. Both maps are seeded by createCoopMember;
 * missing means an old session blob, and the caller fails closed on 1. */
function memberLevel(member, skill) {
  const level = Number(member?.levels?.[skill] ?? member?.stats?.[skill])
  return Number.isFinite(level) && level > 0 ? Math.floor(level) : 1
}

/** Which of a member's two prayer slots a prayer belongs in. Data, not caller
 * intent: `bonusType: 'protection'` is what makes combat.js mitigate with it. */
export function coopPrayerSlot(prayerId, prayersData) {
  return prayersData?.[prayerId]?.bonusType === 'protection' ? 'activeProtectionPrayer' : 'activeCombatPrayer'
}

/**
 * What a tap SHOULD do to the member's combat record, worked out on the client
 * so the button answers immediately.
 *
 * A co-op action is a round trip plus a wait for the room's next 600ms beat plus
 * the poll that reports it — up to about a second and a half before a prayer
 * lights up. That is long enough that players tap again, which is how a flick
 * ends up flicked twice. The screen renders this over its own record until the
 * tick the room stamped the intent for arrives, then drops it: the server is
 * still the only thing that decides, and a refusal simply un-does the echo.
 *
 * Returns null for actions with no instant local meaning (eat, equip, drink —
 * those change the pack, which is the server's to say). Only the toggles are
 * echoed, and each mirrors its case in applyCoopIntent above.
 */
export function coopIntentEcho(combat, action, prayersData) {
  if (!combat || !action) return null
  switch (action.type) {
    case 'toggle_prayer': {
      const key = coopPrayerSlot(action.prayerId, prayersData)
      const turningOn = combat[key] !== action.prayerId
      if (turningOn && (combat.prayerPoints || 0) <= 0) return null
      return { [key]: turningOn ? action.prayerId : null }
    }
    case 'queue_special':
      return { specialAttackQueued: !combat.specialAttackQueued }
    case 'target_add':
      return { addTargetIndex: typeof action.value === 'number' ? action.value : action.value ? 0 : null }
    case 'change_combat_spell':
      return { spellId: action.spellId ?? null }
    default:
      return null
  }
}

function applyCoopIntent(state, member, action, itemsData, spellsData, prayersData, monstersData, events) {
  if (!action || typeof action !== 'object') return
  switch (action.type) {
    case 'start_raid':
      // The one intent that is not a combat action: it ends the lobby. Host
      // only, and only from a lobby — a member who taps a stale button while
      // the run is already going gets told why rather than nothing happening.
      if (!state.raid || state.phase !== 'lobby') {
        events.push({ type: 'actionRefused', characterId: member.characterId, reason: 'raid_in_progress' })
        return
      }
      if (!isCoopHost(state, member.characterId)) {
        events.push({ type: 'actionRefused', characterId: member.characterId, reason: 'not_host' })
        return
      }
      // The party sets off together: nobody is left mid-restock by a host who
      // pressed Start while they were still in the bank. Enforced here rather
      // than by disabling the button, because the button is not the authority.
      if (!raidPartyReady(state)) {
        const { ready, total } = raidReadyCount(state)
        events.push({
          type: 'actionRefused', characterId: member.characterId, reason: 'party_not_ready', ready, total,
        })
        return
      }
      startCoopRaid(state, monstersData, events)
      return
    case 'set_ready':
      // Lobby-only, and silent outside one: a stale button from a party that has
      // already set off is not worth a refusal toast mid-fight.
      if (state.phase === 'lobby') member.ready = !!action.value
      return
    case 'change_stance':
      if (COOP_VALID_STANCES.has(action.stance)) member.combat.stance = action.stance
      return
    case 'change_combat_spell': {
      const spell = action.spellId ? spellsData?.[action.spellId] : null
      if (!spell) {
        member.combat.spellId = null
        return
      }
      // The server grants this damage and its XP, so the level gate has to be
      // enforced here — the engine itself only ever checked runes, and the
      // client's spellbook filter is not a gate. Mirrors the PvP intent check.
      const required = Math.max(1, Math.floor(Number(spell.levelReq) || 1))
      if (memberLevel(member, 'magic') < required) {
        events.push({
          type: 'actionRefused', characterId: member.characterId, reason: 'spell_level',
          spellId: action.spellId, name: spell.name, required,
        })
        return
      }
      member.combat.spellId = action.spellId
      return
    }
    case 'queue_special':
      member.combat.specialAttackQueued = !member.combat.specialAttackQueued
      return
    case 'set_quick_prayers':
      // Loadout, not a combat action — no level gate here. Toggling one ON still
      // goes through the gate in `toggle_prayer` below.
      member.quickPrayers = Array.isArray(action.prayerIds)
        ? action.prayerIds.filter((id) => typeof id === 'string')
        : []
      return
    case 'target_add': {
      // `value` is an add INDEX; false/null means back to the boss.
      const index = typeof action.value === 'number' ? action.value : action.value ? 0 : -1
      const add = index >= 0 ? bossAddsOf(state.boss)[index] : null
      member.combat.addTargetIndex = add && add.currentHP > 0 ? index : null
      return
    }
    case 'toggle_prayer': {
      // The prayer's own type decides its slot, exactly as the solo screen does
      // it. Taking the slot from the caller meant every protection prayer landed
      // in the offensive slot — combat.js mitigates from activeProtectionPrayer,
      // so protect-from-X blocked nothing and quietly cancelled your offensive
      // prayer as well. Flicking a boss in a group could not work at all.
      const key = coopPrayerSlot(action.prayerId, prayersData)
      const turningOn = member.combat[key] !== action.prayerId
      if (turningOn && (member.combat.prayerPoints || 0) <= 0) return
      // applyPrayerBonuses applies the boost with no level check of its own, so
      // the unlock gate lives here or not at all. Turning a prayer OFF is always
      // allowed — never strand a member with a prayer they cannot disable.
      if (turningOn) {
        const prayer = prayersData?.[action.prayerId]
        if (!prayer) return
        const required = Math.max(1, Math.floor(Number(prayer.level) || 1))
        if (memberLevel(member, 'prayer') < required) {
          events.push({
            type: 'actionRefused', characterId: member.characterId, reason: 'prayer_level',
            prayerId: action.prayerId, name: prayer.name, required,
          })
          return
        }
      }
      member.combat[key] = turningOn ? action.prayerId : null
      return
    }
    case 'equip': {
      const i = action.inventorySlot
      if (typeof i !== 'number' || i < 0 || i >= member.inventory.length) return
      const slot = member.inventory[i]
      const item = slot ? itemsData?.[slot.itemId] : null
      if (!slot || !item?.slot) return
      const failure = coopEquipRequirementFailure(item, member)
      if (failure) {
        events.push({ type: 'equipRefused', characterId: member.characterId, itemId: slot.itemId, ...failure })
        return
      }
      const nextEquipment = { ...member.equipment }
      const result = equipItem(nextEquipment, item, itemsData, slot)
      if (!result?.equipped) return
      const nextInventory = [...member.inventory]
      // Ammo equips as a whole stack (equipItem carries the quantity across), so
      // the source slot clears; everything else moves a single unit.
      if (item.slot === 'ammo' || (slot.quantity || 1) <= 1) {
        nextInventory[i] = null
      } else {
        nextInventory[i] = { ...slot, quantity: slot.quantity - 1 }
      }
      // A two-hander displaces a weapon AND a shield but only frees one slot;
      // rather than silently dropping the piece that doesn't fit, abort.
      const placed = placeUnequippedItems(result.unequipped, nextInventory, itemsData)
      if (!placed.ok) {
        events.push({ type: 'equipRefused', characterId: member.characterId, itemId: slot.itemId, reason: 'inventory_full' })
        return
      }
      member.equipment = nextEquipment
      member.inventory = placed.inventory
      if (item.slot === 'weapon') {
        member.combat.combatType = getCombatType(member.equipment, itemsData)
        // A weapon swap re-arms the attack timer, so switching gear mid-fight
        // costs a beat instead of landing a free instant hit.
        member.combat.playerAttackTimer = Math.max(member.combat.playerAttackTimer, 1)
      }
      events.push({ type: 'equip', characterId: member.characterId, itemId: slot.itemId, slot: item.slot })
      return
    }
    case 'eat': {
      const i = action.inventorySlot
      if (typeof i !== 'number') return
      const slot = member.inventory[i]
      const item = slot ? itemsData?.[slot.itemId] : null
      if (!slot || !isConsumableFood(item)) return
      const combo = isComboConsumable(item)
      if (combo ? member.combat.comboCooldown > 0 : member.combat.eatCooldown > 0) return
      // activePotions has to be the member's real map, not a throwaway: a
      // Lumira brew wipes every active buff (§4 combo food), and handing
      // applyConsumableEffect a fresh object meant the brew silently wiped
      // nothing here while it worked in solo and PvP.
      const target = {
        hp: member.hp, maxHP: member.maxHP, currentHP: member.hp, stats: member.stats,
        activePotions: member.combat.activePotions,
      }
      const res = applyConsumableEffect(target, item, slot.itemId, 'eat')
      member.hp = Math.min(member.maxHP, target.hp ?? target.currentHP ?? member.hp)
      member.combat.activePotions = { ...(target.activePotions || {}) }
      if (combo) {
        member.combat.comboCooldown = COOP_EAT_TICK_COST
      } else {
        member.combat.eatCooldown = COOP_EAT_TICK_COST
        member.combat.playerAttackTimer = Math.max(member.combat.playerAttackTimer, COOP_EAT_TICK_COST)
      }
      slot.quantity -= 1
      if (slot.quantity <= 0) member.inventory[i] = null
      events.push({ type: 'eat', characterId: member.characterId, itemId: item.id, heal: res?.healed ?? 0, hp: member.hp })
      return
    }
    case 'drink_potion': {
      const i = action.inventorySlot
      if (typeof i !== 'number' || member.combat.comboCooldown > 0) return
      const slot = member.inventory[i]
      const item = slot ? itemsData?.[slot.itemId] : null
      if (!slot || !isConsumablePotion(item)) return
      const target = {
        hp: member.hp, maxHP: member.maxHP, currentHP: member.hp, stats: member.stats,
        activePotions: member.combat.activePotions,
        prayerPoints: member.combat.prayerPoints, maxPrayerPoints: member.combat.maxPrayerPoints,
      }
      const res = applyConsumableEffect(target, item, slot.itemId, 'drink')
      member.hp = Math.min(member.maxHP, target.hp ?? target.currentHP ?? member.hp)
      member.combat.activePotions = { ...(target.activePotions || {}) }
      member.combat.prayerPoints = Math.min(member.combat.maxPrayerPoints, target.prayerPoints ?? member.combat.prayerPoints)
      member.combat.comboCooldown = COOP_EAT_TICK_COST
      if (!item.unlimited) {
        slot.quantity -= 1
        if (slot.quantity <= 0) member.inventory[i] = null
      }
      events.push({ type: 'drink', characterId: member.characterId, itemId: item.id, hp: member.hp, prayerPoints: member.combat.prayerPoints })
      return
    }
    default:
  }
}

function applyConsumptionEvents(member, engineEvents, engine, itemsData) {
  for (const ev of engineEvents) {
    if (ev.type === 'consumeAmmo') {
      const ammo = member.equipment.ammo
      if (!ammo) continue
      const currentQty = Number.isFinite(Number(ammo.quantity)) ? Number(ammo.quantity) : 1
      const nextQty = Math.max(0, currentQty - (ev.qty || 1))
      member.equipment.ammo = nextQty <= 0 ? null : { ...ammo, quantity: nextQty }
    } else if (ev.type === 'consumeCharge') {
      const weapon = member.equipment.weapon
      if (weapon?.charges > 0) member.equipment.weapon = { ...weapon, charges: Math.max(0, weapon.charges - (ev.qty || 1)) }
    } else if (ev.type === 'consumeArmourCharge') {
      for (const slot of ev.slots || []) {
        const piece = member.equipment[slot]
        if (piece?.charges > 0) member.equipment[slot] = { ...piece, charges: Math.max(0, piece.charges - (ev.qty || 1)) }
      }
    } else if (ev.type === 'consumeScroll' && ev.itemId) {
      removeFromInventory(member.inventory, ev.itemId, ev.qty || 1)
    } else if (ev.type === 'xp' && ev.xpSkills) {
      // The room's XP funnel — Grindman's cut lands here, on the member, because
      // a room can hold a mix of account types against one boss.
      //
      // The event is rewritten to the banked figure rather than left carrying
      // the engine's roll, because this same object is published to the member
      // (processCoopTick spreads it) and drives their floating XP drop. Left
      // raw, a Grindman watched +4 Attack float up for XP the room banked 2 of.
      // The slayer credit below reports `bankedXp` for the same reason.
      for (const [skill, amount] of Object.entries(ev.xpSkills)) {
        const banked = grindmanXP(Number(amount) || 0, member.isGrindman === true)
        member.xpGained[skill] = (member.xpGained[skill] || 0) + banked
        ev.xpSkills[skill] = banked
      }
    }
  }
  // Runes are charged on a landed hit and then cleared, mirroring the live game.
  if (engine.runesConsumed) {
    const landed = engineEvents.some((ev) => (ev.type === 'playerHit' || ev.type === 'specialHit') && ((ev.damage ?? ev.totalDamage ?? 0) > 0))
    if (landed) {
      for (const [runeId, qty] of Object.entries(engine.runesConsumed)) removeFromInventory(member.inventory, runeId, qty)
    }
    engine.runesConsumed = null
  }
}

/**
 * Advances the shared fight one tick.
 *
 * Members tick in ascending character id so concurrent damage serializes
 * deterministically. Returns the next state plus this tick's events, and a
 * `kill` record when the boss died (the caller settles loot from it).
 */
export function processCoopTick(state, intents, { itemsData, monstersData: monstersTable, prayersData, spellsData }, now = Date.now()) {
  const next = cloneCoopState(state)
  // One swap at the door is what carries hard mode through every monster lookup
  // this tick makes — the next raid boss, a respawn, the boss's adds — without
  // any of those call sites knowing hard mode exists (src/engine/hardMode.js).
  const monstersData = monstersTableFor(monstersTable, next.hardMode)
  const events = []
  next.tick = (next.tick || 0) + 1

  const orderedIntents = [...(intents || [])].sort(
    (a, b) => (a.tick_number || 0) - (b.tick_number || 0) || (a.characterId || 0) - (b.characterId || 0) || (a.characterSeq || 0) - (b.characterSeq || 0),
  )
  for (const intent of orderedIntents) {
    const member = next.members[String(intent?.characterId)]
    if (!member || member.status !== 'alive') continue
    applyCoopIntent(next, member, intent.action || {}, itemsData, spellsData, prayersData, monstersData, events)
  }

  // Master Rejuvenation refills a spent bar for the member who owns the perk,
  // in every phase — the lobby and the respawn wait are prep time. Before the
  // fight loop below, whose hydrate copies this value onto the engine state and
  // dehydrate writes it back.
  for (const member of Object.values(next.members)) refillMemberSpecial(member)

  // A raid lobby is prep time in the same sense the respawn wait is: nothing
  // fights, but the intents above have already run, so the party gears up, eats
  // and drinks while they wait for the host. The cooldowns still have to be
  // walked down by hand — no combat tick is doing it.
  if (next.phase === 'lobby') {
    for (const member of Object.values(next.members)) tickIdleCooldowns(member)
    return finishTick(next, events, null)
  }

  // The respawn wait is prep time, not dead time: intents are applied above
  // before this returns, so the group can eat, drink and swap gear for the next
  // pull. Nothing else about the wait changes — no combat resolves, so the
  // consumable cooldowns have to be walked down here or one bite would block
  // the rest of the wait.
  if (next.boss.respawnCountdown > 0) {
    for (const member of Object.values(next.members)) tickIdleCooldowns(member)
    next.boss.respawnCountdown -= 1
    if (next.boss.respawnCountdown === 0) {
      if (next.raid) advanceRaidBoss(next, monstersData, events)
      else respawnBoss(next, monstersData, events)
    }
    return finishTick(next, events, null)
  }

  reselectTarget(next)
  const memberIds = Object.keys(next.members).sort((a, b) => Number(a) - Number(b))
  let kill = null
  // One boss, one swing per tick. Killing the target retargets mid-loop, so
  // without this the newly-picked target's session would resolve a SECOND boss
  // attack on the same tick — the boss getting a free extra hit for every
  // player it drops.
  let bossSwungThisTick = false
  const roomWide = isRoomWideAttacker(monstersData?.[next.bossId])
  const roomWideSwing = roomWide && advanceRoomWideAttackTimer(next.boss)
  const roomWideAddSwings = roomWide ? advanceAddAttackTimers(next.boss) : []
  // The room's minion clocks, taken straight after they were advanced. A
  // session's copy of an add is PINNED to 0-or-full and then run down by the
  // engine, so writing the session's copy back over the room's would overwrite
  // the countdown with the pinned value every single tick — the clock then
  // oscillates between full and full-minus-one, never reaches zero, and the
  // minions stand there swinging at nobody for the whole fight.
  const roomAddTimers = roomWide
    ? new Map(bossAddsOf(next.boss).map((add) => [add.instanceId, add.attackTimer]))
    : null
  // A form change is a per-SWING decision, so the ROOM owns it: every session is
  // pinned below and the single roll happens after the loop, mirroring solo,
  // where the boss swings with the form it is in and then switches. Left to the
  // sessions, each member fought a differently-formed boss off one health bar —
  // their own max hit, their own defences to roll against, and a HUD showing
  // whichever member ticked last, so there was no prayer to read off the screen.
  const formPinned = isMultiForm(sharedMonsterOf(next, monstersData))
  // Whether the boss actually swung this tick, which is what a form change
  // counts. A room-wide boss has the room's clock; any other only swings in its
  // target's session.
  let bossSwung = roomWide && roomWideSwing

  for (const id of memberIds) {
    const member = next.members[id]
    if (member.status !== 'alive') continue
    if (next.boss.currentHP <= 0) break

    const isTarget = next.targetCharId === id && !bossSwungThisTick
    const engine = hydrateCombatState(next, member, monstersData, spellsData)
    if (!engine) continue
    // Invariant 1: a non-target member's session must never resolve a boss
    // swing, or the boss attacks once per member per tick. A room-wide attacker
    // is the deliberate exception — the ROOM owns its clock (above), so every
    // session resolves the same swing and each member rolls their own accuracy
    // and protection prayer against it.
    if (roomWide) engine.monsterAttackTimer = roomWideSwing ? 0 : Math.max(2, engine.monster.attackSpeed || 4)
    else if (!isTarget) engine.monsterAttackTimer = Math.max(2, engine.monster.attackSpeed || 4)
    // The room owns the form; this session only wears it.
    engine.formPinned = formPinned
    // Its minions run off the room's clock for the same reason (see
    // advanceAddAttackTimer) — one swing resolved, landing on everybody.
    if (roomWide) {
      engine.adds.forEach((add, i) => {
        add.attackTimer = roomWideAddSwings[i] ? 0 : Math.max(2, add.attackSpeed || 4)
      })
    }

    const hpBefore = engine.monster.currentHP
    const addHpBefore = engine.adds.map((add) => add.currentHP)
    const { combatState, events: engineEvents } = processCombatTick(
      engine, playerStatsFor(member), member.equipment, itemsData, prayersData, member.inventory, null,
    )

    dehydrateCombatState(combatState, member)
    applyConsumptionEvents(member, engineEvents, combatState, itemsData)
    // A non-room-wide boss only swings inside its target's session, so that is
    // the only place the room can learn it swung at all.
    if (isTarget && !roomWide && engineEvents.some(isBossSwing)) bossSwung = true

    // Attribution is the boss's HP delta across this member's tick, so every
    // damage source (specials, summons, bolt procs) counts without this having
    // to know each event shape.
    const dealt = Math.max(0, hpBefore - combatState.monster.currentHP)
    if (dealt > 0) {
      member.damage += dealt
      member.damageTick = next.tick
    }
    next.boss.currentHP = Math.max(0, combatState.monster.currentHP)
    Object.assign(next.boss.monster, pickMutableMonsterFields(combatState.monster))
    // A phase change hands the boss a new bar (Verzik's second form is bigger
    // than her first), and its first death is progress the room owns — the
    // member sessions are rebuilt each tick and would each ask for their own.
    const phaseHP = Math.floor(Number(combatState.monster.hitpoints) || 0)
    if (phaseHP > 0) next.boss.maxHP = phaseHP
    next.boss.doubleKillCount = combatState.doubleKillCount || 0

    // Invariant 2: only the target advances the add's spawn countdown, but any
    // member's damage to a live add sticks.
    if (isTarget) {
      next.boss.adds = (combatState.adds || []).map((add) => ({
        ...add,
        // The room owns a room-wide boss's minion clocks (roomAddTimers) — an
        // add the session did not have yet keeps its own full wind-up.
        ...(roomAddTimers?.has(add.instanceId) ? { attackTimer: roomAddTimers.get(add.instanceId) } : {}),
      }))
      next.boss.addSpawnCountdown = combatState.addSpawnCountdown
      next.boss.addsSpawned = combatState.addsSpawned
      next.boss.addsDefeated = combatState.addsDefeated
    } else {
      // A non-target member neither spawns adds nor advances the wait — the
      // target owns both — but everything they did to an add on the field
      // sticks, including finishing it off.
      //
      // Matched by `instanceId` on BOTH sides, never by list position: the
      // engine splices a killed add out of its own list, so on exactly the tick
      // that matters every add behind it shifts down a slot. Read by index, the
      // kill was invisible (the corpse is simply absent) and the survivors'
      // health was compared against the wrong add's — so a member the boss did
      // not happen to be facing could never clear a sentinel, and the room told
      // every client it had died while it went on swinging.
      const before = new Map(engine.adds.map((add, i) => [add.instanceId, addHpBefore[i]]))
      const after = new Map((combatState.adds || []).map((add) => [add.instanceId, add.currentHP]))
      let killedOne = false
      const survivors = []
      for (const add of bossAddsOf(next.boss)) {
        const hp = after.get(add.instanceId)
        if (hp == null) {
          // Absent from a list it started the tick in = this member killed it.
          if (!before.has(add.instanceId)) { survivors.push(add); continue }
          killedOne = true
          next.boss.addsDefeated = (next.boss.addsDefeated || 0) + 1
          continue
        }
        add.currentHP = Math.min(add.currentHP, hp)
        if (add.currentHP > 0) survivors.push(add)
        else killedOne = true
      }
      next.boss.adds = survivors
      // A kill always restarts the wait, from a full field as much as an empty
      // one — the countdown is parked at null while the field is at its cap, so
      // without this a boss at its cap never summons again for the rest of the
      // fight.
      if (killedOne) next.boss.addSpawnCountdown = rollRespawnDelay(getAddSpec(monstersData?.[next.bossId]))
    }

    for (const ev of engineEvents) {
      // Incoming from the boss — only the member it is actually facing, unless
      // the boss attacks the whole room, in which case its minions do too: they
      // are its reach, not separate duellists. Only the target's session
      // resolves either swing, so one event still means one swing at everybody.
      if (ev.type === 'monsterHit' || ev.type === 'dragonfireHit') {
        if (roomWide || isTarget) {
          member.hp = Math.max(0, member.hp - (ev.damage || 0))
          if (!roomWide) bossSwungThisTick = true
        }
      } else if (ev.type === 'monsterMiss' && isTarget && !roomWide) {
        bossSwungThisTick = true
      // Self-inflicted (blood-forfeit bolts): costs the shooter regardless of
      // who the boss happens to be facing.
      } else if (ev.type === 'boltProc' && ev.selfDamage) {
        member.hp = Math.max(0, member.hp - ev.selfDamage)
      } else if (ev.type === 'guthanHeal' || ev.type === 'sangHeal') {
        member.hp = Math.min(member.maxHP, member.hp + (ev.healAmount || 0))
      // Life-stealing specials (Zaryth Godsword, Healing Blade, Toxic Siphon,
      // Soul Leech) heal in the solo engine by returning this field; the room
      // has to apply it or the same weapon silently stops healing in a group.
      } else if (ev.type === 'specialHit' && ev.healAmount > 0) {
        member.hp = Math.min(member.maxHP, member.hp + ev.healAmount)
      }
      if (ev.type === 'monsterDeath') {
        kill = { bossId: next.bossId, monster: ev.monster, xpGained: { ...(ev.xpGained || {}) } }
      }
      events.push({ ...ev, characterId: member.characterId, isTarget })
    }

    if (member.hp <= 0) {
      member.status = 'dead'
      member.hp = 0
      // Hard mode takes the pack. Applied to the MEMBER record because that is
      // the authority on their inventory until the write-back (§20) — clearing
      // the save instead would be overwritten by the next flush.
      let itemsLost = null
      if (next.hardMode) {
        const loss = hardModeDeathLoss(member.inventory, member.equipment, itemsData)
        member.inventory = loss.inventory
        member.equipment = loss.equipment
        itemsLost = loss.lost
        member.itemsLost = bankMemberItemsLost(member.itemsLost, loss.lost)
      }
      events.push({ type: 'memberDeath', characterId: member.characterId, itemsLost })
      reselectTarget(next)
    }
  }

  if (next.boss.currentHP <= 0 && !next.boss.killedAt && next.raid) {
    next.boss.killedAt = now
    kill = resolveRaidBossDeath(next, monstersData, events, now)
  } else if (next.boss.currentHP <= 0 && !next.boss.killedAt) {
    next.boss.killedAt = now
    next.boss.respawnCountdown = coopRespawnTicks(next.bossId)
    const ownerCharId = topDamageCharacterId(next)
    // Slayer credit is per member and independent of damage, so it is settled
    // here rather than in the loot path — the loot goes to one player, the task
    // progress goes to everyone still standing.
    const onTaskCharacterIds = []
    for (const member of Object.values(next.members)) {
      const credited = creditSlayerKill(member, next.bossId, monstersData)
      if (!credited) continue
      onTaskCharacterIds.push(Number(member.characterId))
      events.push({ type: 'slayerCredit', ...credited })
    }
    kill = {
      ...(kill || { bossId: next.bossId }),
      ownerCharacterId: ownerCharId ? Number(ownerCharId) : null,
      lootCharacterIds: lootEligibleCharacterIds(next),
      lootDamageRequired: coopLootDamageRequired(next.boss.maxHP),
      contributors: damageTable(next),
      onTaskCharacterIds,
    }
    events.push({
      type: 'bossDefeated',
      bossId: next.bossId,
      ownerCharacterId: kill.ownerCharacterId,
      lootCharacterIds: kill.lootCharacterIds,
    })
  } else if (next.boss.currentHP > 0) {
    kill = null
  }

  // A raid that kills the whole party is over — the boss keeps its health and
  // the party goes back to the lobby. Without this the room sits forever with a
  // live boss and nobody able to swing at it.
  if (next.raid && next.phase === 'active' && memberCount(next) > 0 && livingMembers(next).length === 0) {
    events.push({ type: 'raidWiped', raidId: next.raid.raidId, bossId: next.bossId })
    returnPartyToLobby(next, monstersData, events, 'wipe')
  }

  // After every session, so they all swung with the form the room was in and the
  // change takes effect on the next one — the order solo already has.
  if (formPinned && bossSwung) {
    const shared = sharedMonsterOf(next, monstersData)
    const change = advanceSharedForm(shared)
    if (change) {
      Object.assign(next.boss.monster, pickMutableMonsterFields(shared))
      // Same beat solo gives the player to answer the new style. The room owns
      // this boss's clock, so BOTH copies restart: the shared one a room-wide
      // boss swings off, and each member's session timer, which is the clock a
      // boss that faces one player at a time actually counts down.
      const restart = formChangeAttackTimer(shared)
      next.boss.attackTimer = restart
      for (const member of Object.values(next.members)) member.combat.monsterAttackTimer = restart
      events.push(change)
    }
  }

  return finishTick(next, events, kill)
}

/** Ends the lobby and puts the first boss on the field. */
function startCoopRaid(state, monstersData, events) {
  const bosses = state.raid.bosses || []
  const fresh = createCoopBossState(bosses[0], monstersData, Date.now(), { hardMode: state.hardMode })
  if (!fresh) return
  state.phase = 'active'
  state.bossId = bosses[0]
  state.boss = fresh.boss
  state.raid = { ...state.raid, currentBossIndex: 0 }
  for (const member of Object.values(state.members)) {
    member.damage = 0
    member.damageTick = 0
    member.ready = false
    member.combat.playerAttackTimer = 0
    member.combat.monsterAttackTimer = state.boss.attackSpeed || 4
    member.combat.addTargetIndex = null
  }
  reselectTarget(state)
  events.push({
    type: 'raidStarted',
    raidId: state.raid.raidId,
    bossId: bosses[0],
    bossName: monstersData?.[bosses[0]]?.name || bosses[0],
    totalBosses: bosses.length,
  })
}

/**
 * One raid boss down.
 *
 * Only the LAST one settles anything: a raid pays out of its own reward table,
 * once, exactly as the solo raid does (combat.js emits loot on `raidComplete`
 * and nothing on the bosses before it). Returning a kill record for an
 * intermediate boss would hand the party a full monster drop table per boss.
 */
function resolveRaidBossDeath(state, monstersData, events, now) {
  const raid = state.raid
  const index = Math.max(0, Number(raid.currentBossIndex) || 0)
  const bosses = raid.bosses || []
  events.push({
    type: 'raidBossDefeated',
    raidId: raid.raidId,
    bossId: state.bossId,
    bossName: monstersData?.[state.bossId]?.name || state.bossId,
    bossIndex: index,
    totalBosses: bosses.length,
  })

  if (index < bosses.length - 1) {
    state.boss.respawnCountdown = COOP_RAID_ADVANCE_TICKS
    return null
  }

  // Slayer credit lands on the final boss only, mirroring the solo raid's
  // `fromRaidCompletion` gate — a raid-task boss must not be creditable by
  // walking into the raid and killing the first thing in it.
  const onTaskCharacterIds = []
  for (const member of Object.values(state.members)) {
    const credited = creditSlayerKill(member, state.bossId, monstersData, { fromRaidCompletion: true })
    if (!credited) continue
    onTaskCharacterIds.push(Number(member.characterId))
    events.push({ type: 'slayerCredit', ...credited })
  }

  const ownerCharId = topDamageCharacterId(state)
  const kill = {
    sourceType: 'raids',
    raidId: raid.raidId,
    bossId: state.bossId,
    completedAt: now,
    ownerCharacterId: ownerCharId ? Number(ownerCharId) : null,
    lootCharacterIds: lootEligibleCharacterIds(state),
    lootDamageRequired: coopLootDamageRequired(coopLootBasisHP(state)),
    contributors: damageTable(state),
    onTaskCharacterIds,
  }
  events.push({
    type: 'raidComplete',
    raidId: raid.raidId,
    raidName: raid.name || raid.raidId,
    lootCharacterIds: kill.lootCharacterIds,
  })
  // Eligibility is read above, before the reset below clears the damage it is
  // measured from.
  returnPartyToLobby(state, monstersData, events, 'complete')
  return kill
}

/** Swaps in the next boss of the run. */
function advanceRaidBoss(state, monstersData, events) {
  const raid = state.raid
  const nextIndex = (Math.max(0, Number(raid.currentBossIndex) || 0)) + 1
  const bossId = (raid.bosses || [])[nextIndex]
  const fresh = bossId ? createCoopBossState(bossId, monstersData, Date.now(), { hardMode: state.hardMode }) : null
  if (!fresh) {
    returnPartyToLobby(state, monstersData, events, 'aborted')
    return
  }
  state.bossId = bossId
  state.boss = fresh.boss
  state.raid = { ...raid, currentBossIndex: nextIndex }
  for (const member of Object.values(state.members)) {
    // Damage is deliberately NOT reset: the loot gate measures a member's share
    // of the whole raid (coopLootBasisHP), not of the boss in front of them.
    member.combat.playerAttackTimer = 0
    member.combat.monsterAttackTimer = state.boss.attackSpeed || 4
    member.combat.addTargetIndex = null
  }
  reselectTarget(state)
  events.push({
    type: 'raidBossAdvance',
    raidId: raid.raidId,
    bossId,
    bossName: monstersData?.[bossId]?.name || bossId,
    bossIndex: nextIndex,
    totalBosses: (raid.bosses || []).length,
  })
}

/**
 * Puts the party back in its lobby, run reset, for the host to start again.
 *
 * Dead members are deliberately NOT revived. Death in a group has to cost what
 * death costs solo — reviving here would make the last boss of a raid the
 * safest fight in the game, and it would also hide the death from the client,
 * which is what reverts one-life mode.
 */
function returnPartyToLobby(state, monstersData, events, reason) {
  const raid = state.raid
  const bosses = raid.bosses || []
  const fresh = createCoopBossState(bosses[0], monstersData, Date.now(), { hardMode: state.hardMode })
  state.phase = 'lobby'
  if (fresh) {
    state.bossId = bosses[0]
    state.boss = fresh.boss
  }
  state.raid = {
    ...raid,
    currentBossIndex: 0,
    completions: (Number(raid.completions) || 0) + (reason === 'complete' ? 1 : 0),
  }
  state.targetCharId = null
  for (const member of Object.values(state.members)) {
    member.damage = 0
    member.damageTick = 0
    // A party back from a run has restocking to do, so nobody is ready until
    // they say so again — a roster still reading "Ready" from the last run is
    // worse than no signal at all.
    member.ready = false
    member.combat.addTargetIndex = null
  }
  events.push({ type: 'raidEnded', raidId: raid.raidId, reason })
}

/** Master Rejuvenation, member-side. The value is projected to every client
 * every tick and the frame is skipped when nothing moved (§20), so the refill
 * has to leave an already-full bar untouched — which it does. */
function refillMemberSpecial(member) {
  if (!member?.combat || !member.masterRejuvenation) return
  member.combat.specialAttackEnergy = refillSpecialOnEmpty(member.combat.specialAttackEnergy, true)
}

/** Walks down the timers processCombatTick would have advanced. Only the
 * consumable cooldowns and the attack timer: prayer does not drain and no potion
 * expires while there is nothing to fight. */
function tickIdleCooldowns(member) {
  const c = member.combat
  if (!c) return
  c.eatCooldown = Math.max(0, (c.eatCooldown || 0) - 1)
  c.potionCooldown = Math.max(0, (c.potionCooldown || 0) - 1)
  c.comboCooldown = Math.max(0, (c.comboCooldown || 0) - 1)
  c.playerAttackTimer = Math.max(0, (c.playerAttackTimer || 0) - 1)
}

function respawnBoss(state, monstersData, events) {
  const fresh = createCoopBossState(state.bossId, monstersData, Date.now(), { hardMode: state.hardMode })
  if (!fresh) return
  state.boss = fresh.boss
  for (const member of Object.values(state.members)) {
    member.damage = 0
    member.damageTick = 0
    member.combat.playerAttackTimer = 0
    member.combat.monsterAttackTimer = 0
    member.combat.addTargetIndex = null
  }
  events.push({ type: 'bossRespawned', bossId: state.bossId })
}

function finishTick(state, events, kill) {
  for (const ev of events) ev.tick = state.tick
  state.recentEvents = [...state.recentEvents, ...events].slice(-40)
  return { stateNext: state, events, kill }
}
