import {
  effectiveStrength, wornMeleeMaxHit, effectiveAttack, maxAttackRoll,
  maxDefenceRoll, hitChance, rollDamage, getMeleeStyleBonuses,
  getMeleeXPSkill, effectiveRanged, wornRangedMaxHit, getRangedStyleBonus,
  effectiveMagic, monsterMagicDefenceRoll, magicMaxHit
} from './formulas.js'
import { getEquipmentBonuses, getAttackSpeed, getMeleeAttackStyle, getRangedAmmoRequirementFailure, getEffectiveWornMagicDamage, getSpellRuneMagicDamage, chargedScaleArmourSlots } from './equipment.js'
import { getLevelFromXP } from './experience.js'
import { hasRequiredRunes, getRunesToConsume } from './runes.js'
import { MELEE_XP_PER_DAMAGE, RANGED_XP_PER_DAMAGE, MAGIC_XP_PER_DAMAGE, HP_XP_PER_DAMAGE, EAT_TICK_COST } from '../utils/constants.js'
import { randInt } from '../utils/helpers.js'
import { getSlayerTaskEquipmentBonuses } from './slayerCombatBonuses.js'
import { poweredStaffMagicBaseDamage } from './combatPrimitives.js'
import { getPotionStatBoost, getActivePotionBoosts } from './consumables.js'
import { applyPrayerDrainTick } from './prayerDrain.js'
import { applyMonsterResistance } from './monsterDamageRules.js'
import { getDamageReductionPerk, applyDamageReduction, getPrayerDrainMultiplier } from './damageReduction.js'
import { getCombatSetMultipliers } from './combatSetBonuses.js'
import { getMonsterSeedDrops } from './seedDrops.js'
import { getMonsterCharmDrops, getSummoningCreature, rollSummonAttack, SUMMON_ATTACK_TICKS } from './summoning.js'
import { countItem } from './inventory.js'
import { resolveSpecialEnergyCost, canAffordSpecialAttack } from './specialAttackEnergy.js'
import { doesSlayerTaskMatchMonster } from './slayerTasks.js'
import { isMultiForm, applyForm, advanceSharedForm, formChangeAttackTimer, randomFormSwitchThreshold, recordDefenceBonusDrain, applyDefenceBonusDrain, clearDefenceBonusDrain } from './bossForms.js'
import { getAddSpec, addDefinitionsFor, selectAddDefinition, maxActiveAdds, rollFirstSpawnDelay, rollRespawnDelay, prepareAdd, liveAdds, activeTarget, isAddTarget, addIndexOf } from './bossAdds.js'
import { monsterMaxHit } from './monsterMaxHit.js'
import { grindmanDropChance } from './grindman.js'


function getAvasAmmoSaveChance(equipment) {
  const capeId = equipment?.cape?.itemId
  if (capeId === 'ava_s_assembler') return 0.75
  if (capeId === 'ava_s_accumulator') return 0.5
  return 0
}

// Sunbearer Ring: special-attack energy never drains while worn (PvE only —
// PvP has its own energy model under pvpEngine.js and is deliberately
// untouched). §7: energy still starts each fight at 100 and refills on kill;
// this only skips the per-use drain.
function hasSunbearerRing(equipment) {
  return equipment?.ring?.itemId === 'sunbearer_ring'
}

/**
 * Create a new combat state
 */
export function createCombatState(monster, combatType = 'melee', stance = 'accurate', spell = null, monstersData = null, { grindman = false } = {}) {
  // Apply initial form for multi-form bosses (e.g. Venomcoil Matriarch)
  let preparedMonster = prepareMonster(monster)
  const addSpec = getAddSpec(monster)
  const addDefinitions = addSpec ? addDefinitionsFor(addSpec, monstersData) : null
  const addDefinition = selectAddDefinition(addDefinitions, preparedMonster)
  return {
    active: true,
    monster: preparedMonster,
    combatType,      // 'melee', 'ranged', 'magic'
    stance,          // 'accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'
    spell,           // spell object for magic combat
    playerAttackTimer: 0,
    monsterAttackTimer: preparedMonster.attackSpeed || 4,  // 1-attack delay so player always gets first hit
    eatCooldown: 0,
    potionCooldown: 0,
    comboCooldown: 0,  // combo food / potions — own cooldown, usable on the same tick as normal food
    log: [],         // combat log entries
    tickCount: 0,
    xpGained: {},    // accumulated xp per skill
    loot: null,      // set on monster death
    specialAttackEnergy: 100,  // 0-100; starts at 100 for each new fight, drains on use, refills on kill
    specialAttackQueued: false,  // flag to fire special attack on next available tick
    activeProtectionPrayer: null,  // one protection prayer, reset on each new fight
    activeCombatPrayer: null,      // one combat enhancing prayer, reset on each new fight
    prayerPoints: null,            // prayer-point pool (set by the screen to Prayer level at fight start)
    maxPrayerPoints: null,         // pool cap = Prayer level
    prayerDrainAccumulator: 0,     // fractional carry for sub-1/tick drain
    activePotions: {},             // { potionItemId: durationInTicks } - multiple different potion types allowed
    doubleKillCount: 0,            // tracks how many times a requiresDoubleKill boss has been defeated
    raid: null,                    // raid state: { raidId, bosses[], currentBossIndex, monstersData }
    summon: null,                  // active summoned creature: { creatureId, ticksLeft, attackTimer }
    // Boss adds (e.g. the Dread Core): live monsters alongside the boss, not a
    // form change. A LIST — a boss may field up to maxActiveAdds of them at once.
    addDefinition,                 // monster definition the boss spawns right now, or null
    addDefinitions,                // every add the boss can spawn, keyed by the form that summons it
    adds: [],                      // the spawned adds still standing, in spawn order
    addTargetIndex: null,          // index into adds the player swings at; null = the boss
    maxActiveAdds: maxActiveAdds(addSpec),
    addSpawnCountdown: addDefinition ? rollFirstSpawnDelay(addSpec) : null,
    // Set by a caller that owns the boss record and rolls its form once per
    // swing for every session at once (co-op, the open world) — see bossForms.js.
    formPinned: false,
    addsSpawned: 0,                // lifetime count, so the variant selection can cycle
    addsDefeated: 0,
    // Grindman's tripled drop rates. On the STATE rather than the monster
    // record, because the record is shared (a raid's boss list, a zone's npc)
    // while the account type belongs to whoever is swinging — the open world
    // rebuilds one of these per player against the same npc.
    grindman: grindman === true
  }
}

/**
 * Point the player's attacks at the boss or at one of its adds. Returns a new
 * state; a request to target a dead or absent add falls back to the boss.
 */
export function setCombatTarget(combatState, target) {
  if (!combatState) return combatState
  const adds = Array.isArray(combatState.adds) ? combatState.adds : []
  // 'add' with no index means the front of the stack, which is what a
  // single-add boss has always meant.
  const index = typeof target === 'number' ? target : target === 'add' ? adds.findIndex((a) => a?.currentHP > 0) : -1
  const alive = index >= 0 && adds[index]?.currentHP > 0
  return { ...combatState, addTargetIndex: alive ? index : null }
}

/**
 * Prepare a monster for combat (apply initial form, set currentHP).
 */
function prepareMonster(monster) {
  let preparedMonster = { ...monster, currentHP: monster.hitpoints }
  if (isMultiForm(monster)) {
    const formKey = monster.initialForm || Object.keys(monster.forms)[0]
    const form = applyForm(preparedMonster, formKey)
    if (form) {
      preparedMonster.formAttackCount = 0
      preparedMonster.formSwitchThreshold = monster.randomFormEveryAttack ? 1 : randomFormSwitchThreshold(monster)
      // Verzik phased boss: use first form's phaseHP as starting HP
      if (monster.verzikPhased && form.phaseHP) {
        preparedMonster.hitpoints = form.phaseHP
        preparedMonster.currentHP = form.phaseHP
      }
    }
  }
  return preparedMonster
}

/**
 * Create a combat state for a raid (sequential boss fights).
 */
export function createRaidCombatState(raidData, monstersData, combatType = 'melee', stance = 'accurate', spell = null, { grindman = false } = {}) {
  const firstBossId = raidData.bosses[0]
  const firstBoss = monstersData[firstBossId]
  if (!firstBoss) return null
  const state = createCombatState(firstBoss, combatType, stance, spell, null, { grindman })
  state.raid = {
    raidId: raidData.id,
    name: raidData.name,
    bosses: raidData.bosses,
    currentBossIndex: 0,
    monstersData,
    rewards: raidData.rewards
  }
  return state
}

/**
 * Pick a random number of attacks (within formSwitchMin..formSwitchMax)
 * that a multi-form monster will use before switching forms.
 */
/**
 * If a multi-form boss has an enrage threshold and its HP just dropped below it,
 * switch to the enraged form once and emit a bossEnrage event. No-op otherwise.
 */
function triggerEnrageIfNeeded(state, monster, events) {
  if (!monster || !monster.multiForm || !monster.forms || monster.enraged) return
  const threshold = Number(monster.enrageHpPercent)
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 100) return
  const enragedKey = monster.enrageFormKey || 'enraged'
  const enragedForm = monster.forms[enragedKey]
  if (!enragedForm) return
  const maxHP = monster.hitpoints || 1
  if (monster.currentHP > Math.floor(maxHP * threshold / 100)) return
  monster.enraged = true
  monster.currentForm = enragedKey
  monster.attackStyle = enragedForm.attackStyle ?? monster.attackStyle
  monster.attackBonus = enragedForm.attackBonus ?? monster.attackBonus
  monster.strengthBonus = enragedForm.strengthBonus ?? monster.strengthBonus
  if (enragedForm.defenceBonus) {
    monster.defenceBonus = { ...enragedForm.defenceBonus }
    applyDefenceBonusDrain(monster)
  }
  monster.formMaxHit = enragedForm.maxHit ?? monster.formMaxHit
  if (enragedForm.attackSpeed) monster.attackSpeed = enragedForm.attackSpeed
  events.push({
    type: 'bossEnrage',
    monsterName: monster.name,
    formName: enragedForm.displayName || 'Enraged',
    icon: enragedForm.icon || '🔥',
  })
}

/**
 * Returns the immunity type ('melee', 'ranged', 'magic') of the monster's current form,
 * or null if the current form has no immunity. Used for phase-based bosses like Hellbound Gorilla.
 */
function getFormImmunity(monster) {
  if (!monster.multiForm || !monster.currentForm || !monster.forms) return null
  return monster.forms[monster.currentForm]?.immunity || null
}

/**
 * Handle monster death. Supports double-kill requirement (e.g. Olm), Verzik phased boss, and raid boss advancement.
 * Returns true if the monster truly died (combat ends), false if it regenerated/advanced (combat continues).
 */
/**
 * One enemy swing at the player: accuracy roll, damage roll, then the player's
 * mitigation stack (protection prayer, then the worn damage-reduction perk so
 * the two compound) and any prayer burn the attacker carries. Shared by a boss
 * and its adds so both obey identical rules. Returns the damage dealt and
 * pushes the hit/miss events.
 */
function resolveEnemySwing(attacker, attackStyle, state, boostedPlayerStats, playerStats, bonuses, prayersData, events, extraEventFields = {}) {
  const monsterEffAtk = ((attacker.stats.magic || attacker.stats.attack || 1) + 9)
  const monsterAtkRoll = monsterEffAtk * ((attacker.attackBonus || 0) + 64)
  const playerDefLevel = boostedPlayerStats.defence
  const styleBonuses = getMeleeStyleBonuses(state.stance)
  const effDef = Math.floor(playerDefLevel) + styleBonuses.defenceStyleBonus + 8
  const defRoll = effDef * ((bonuses.defenceBonus[attackStyle] || bonuses.defenceBonus.crush || 0) + 64)
  const acc = hitChance(monsterAtkRoll, defRoll)
  // Per-form maxHit, then the monster's own, then derived from the stat that
  // matches the attack style — monsterMaxHit.js owns that precedence so the
  // info surfaces quote the same number this rolls.
  const monsterMax = monsterMaxHit(attacker, attackStyle)
  let damage = rollDamage(acc, monsterMax)

  // Apply protection prayer damage reduction if active and matches attack style
  if (state.activeProtectionPrayer && prayersData && typeof prayersData === 'object' && prayersData[state.activeProtectionPrayer]) {
    try {
      const prayer = prayersData[state.activeProtectionPrayer]
      if (prayer && prayer.bonusType === 'protection' && typeof prayer.damageReductionPercent === 'number') {
        if (protectionPrayerMatches(prayer.style, attackStyle)) {
          const reduction = Math.floor(damage * prayer.damageReductionPercent / 100)
          damage = Math.max(0, damage - reduction)
        }
      }
    } catch (e) {
      // Silently fail if prayer application fails
    }
  }

  // Worn damage-reduction perk (Aegis Wraithbone Shield) — rolled after
  // protection prayers so the two stack multiplicatively.
  damage = applyDamageReduction(damage, getDamageReductionPerk(bonuses))

  // A landed hit may also burn prayer points (the Dread Core's whole threat).
  if (damage > 0) {
    const perHitDrain = Number(attacker.multiForm && attacker.currentForm
      ? attacker.forms?.[attacker.currentForm]?.prayerDrainPerHit
      : attacker.prayerDrainPerHit) || 0
    if (perHitDrain > 0 && typeof state.prayerPoints === 'number' && state.prayerPoints > 0) {
      const drained = Math.min(state.prayerPoints, perHitDrain)
      state.prayerPoints -= drained
      if (state.prayerPoints <= 0) {
        state.prayerPoints = 0
        state.activeProtectionPrayer = null
        state.activeCombatPrayer = null
      }
      events.push({ type: 'prayerDrained', amount: drained, prayerPoints: state.prayerPoints, monsterName: attacker.name })
    }
  }

  if (damage === 0 && acc < 1.0) {
    events.push({ type: 'monsterMiss', playerHP: playerStats.currentHP, monsterName: attacker.name, ...extraEventFields })
  } else {
    events.push({ type: 'monsterHit', damage, playerHP: playerStats.currentHP - damage, monsterName: attacker.name, ...extraEventFields })
  }
  return damage
}

/**
 * Resolve whichever enemy just hit 0 HP. An add merely despawns — no drops, no
 * kill count, no slayer credit — and the boss queues a replacement, so only the
 * boss reaching 0 can end the fight.
 */
function resolveTargetDeath(state, target, events, isOnTask = false) {
  if (isAddTarget(state, target)) {
    target.currentHP = 0
    const index = addIndexOf(state, target)
    state.adds = state.adds.filter((add) => add !== target)
    // The list shifted under the selection: drop back to the boss rather than
    // silently re-pointing the player at whichever add slid into the slot.
    if (state.addTargetIndex === index) state.addTargetIndex = null
    else if (typeof state.addTargetIndex === 'number' && state.addTargetIndex > index) state.addTargetIndex -= 1
    state.addsDefeated = (state.addsDefeated || 0) + 1
    // A killed add always restarts the wait, even from a full field — that is
    // what makes clearing them a treadmill rather than a one-off.
    state.addSpawnCountdown = rollRespawnDelay(getAddSpec(state.monster))
    events.push({ type: 'addDefeated', monsterName: target.name, bossName: state.monster?.name })
    return false
  }
  return checkMonsterDeath(state, target, events, isOnTask)
}

function checkMonsterDeath(state, monster, events, isOnTask = false) {
  if (monster.currentHP > 0) return false
  monster.currentHP = 0

  // Verzik phased boss: advance to next phase instead of dying
  if (monster.verzikPhased && monster.multiForm && monster.forms) {
    const formOrder = monster.formCycleOrder || Object.keys(monster.forms)
    const currentIdx = formOrder.indexOf(monster.currentForm)
    const nextIdx = currentIdx + 1
    if (nextIdx < formOrder.length) {
      const nextKey = formOrder[nextIdx]
      const nextForm = monster.forms[nextKey]
      if (nextForm) {
        monster.currentForm = nextKey
        monster.attackStyle = nextForm.attackStyle
        monster.attackBonus = nextForm.attackBonus ?? monster.attackBonus
        monster.strengthBonus = nextForm.strengthBonus ?? monster.strengthBonus
        monster.defenceBonus = { ...nextForm.defenceBonus }
        clearDefenceBonusDrain(monster)
        monster.formMaxHit = nextForm.maxHit
        monster.formAttackCount = 0
        monster.formSwitchThreshold = 9999
        // Set HP to this phase's phaseHP
        const phaseHP = nextForm.phaseHP || monster.hitpoints
        monster.currentHP = phaseHP
        monster.hitpoints = phaseHP
        state.playerAttackTimer = 5
        state.monsterAttackTimer = 5
        state.specialAttackEnergy = 100
        events.push({
          type: 'verzikPhaseChange',
          phase: nextKey,
          displayName: nextForm.displayName,
          icon: nextForm.icon,
          monsterName: monster.name
        })
        return false
      }
    }
    // Fell through — final phase dead, continue to true death below
  }

  if (monster.requiresDoubleKill && (state.doubleKillCount || 0) < 1) {
    // First kill — boss regenerates for round 2
    state.doubleKillCount = (state.doubleKillCount || 0) + 1
    monster.currentHP = monster.hitpoints
    // Reset forms to initial state
    if (monster.multiForm && monster.forms) {
      const formKey = monster.initialForm || Object.keys(monster.forms)[0]
      const form = monster.forms[formKey]
      if (form) {
        monster.currentForm = formKey
        monster.formAttackCount = 0
        monster.formSwitchThreshold = monster.randomFormEveryAttack ? 1 : randomFormSwitchThreshold(monster)
        monster.attackStyle = form.attackStyle
        monster.attackBonus = form.attackBonus ?? monster.attackBonus
        monster.strengthBonus = form.strengthBonus ?? monster.strengthBonus
        monster.defenceBonus = { ...form.defenceBonus }
        clearDefenceBonusDrain(monster)
        monster.formMaxHit = form.maxHit
      }
    }
    // 5-tick (~3s at 600ms/tick) pause before either side attacks
    state.playerAttackTimer = 5
    state.monsterAttackTimer = 5
    state.specialAttackEnergy = 100  // Refill spec bar for second phase
    events.push({ type: 'bossPhaseReset', killsCompleted: state.doubleKillCount, killsNeeded: 2, monsterName: monster.name })
    return false
  }

  // ── Raid boss advancement ──
  if (state.raid) {
    const raid = state.raid
    const nextIdx = raid.currentBossIndex + 1
    events.push({
      type: 'raidBossDefeated',
      bossId: monster.id,
      bossName: monster.name,
      bossIndex: raid.currentBossIndex,
      totalBosses: raid.bosses.length
    })
    if (nextIdx < raid.bosses.length) {
      // Advance to next raid boss — carry over HP, potions, prayers, XP
      const nextBossId = raid.bosses[nextIdx]
      const nextBossData = raid.monstersData[nextBossId]
      if (nextBossData) {
        const nextMonster = prepareMonster(nextBossData)
        state.monster = nextMonster
        state.raid = { ...raid, currentBossIndex: nextIdx }
        state.doubleKillCount = 0
        state.playerAttackTimer = 5
        state.monsterAttackTimer = 5
        state.specialAttackEnergy = 100
        events.push({
          type: 'raidBossAdvance',
          nextBossId,
          nextBossName: nextMonster.name,
          bossIndex: nextIdx,
          totalBosses: raid.bosses.length
        })
        return false
      }
    }
    // Final raid boss died — roll raid rewards
    state.active = false
    state.specialAttackEnergy = 100
    state.loot = rollRaidRewards(raid.rewards, state.grindman === true)
    events.push({
      type: 'raidComplete',
      raidId: raid.raidId,
      raidName: raid.name || raid.raidId,
      loot: state.loot,
      xpGained: { ...state.xpGained }
    })
    events.push({
      type: 'monsterDeath',
      monster: { id: monster.id, name: monster.name, boss: monster.boss === true },
      fromRaidCompletion: true,
      loot: state.loot,
      xpGained: { ...state.xpGained }
    })
    return true
  }

  // True death (non-raid)
  state.active = false
  // The boss dying takes its adds off the field with it.
  state.adds = []
  state.addTargetIndex = null
  state.specialAttackEnergy = 100
  state.loot = rollDrops(monster, isOnTask, state.grindman === true)
  events.push({
    type: 'monsterDeath',
    monster: { id: monster.id, name: monster.name, boss: monster.boss === true },
    loot: state.loot,
    xpGained: { ...state.xpGained }
  })
  return true
}

/**
 * Force-kill the current monster immediately, reusing all death/phase/raid semantics.
 * Returns the emitted events array (monsterDeath / raidBossAdvance / raidComplete / etc.).
 */
export function applyInstantKill(state) {
  const events = []
  if (!state || !state.monster) return events
  state.monster.currentHP = 0
  const isOnTask = !!(state.slayerTask && doesSlayerTaskMatchMonster(state.slayerTask.monsterId, state.monster.id))
  checkMonsterDeath(state, state.monster, events, isOnTask)
  return events
}

/**
 * Check if player is wearing full Dharok set
 */
function hasFullDharokSet(equipment, itemsData) {
  if (!equipment || !itemsData) return false
  const dharokItems = ['dravok_s_helm', 'dravok_s_platebody', 'dravok_s_platelegs', 'dravok_s_greataxe']
  return dharokItems.every(itemId => {
    for (const [, slot] of Object.entries(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
    return false
  })
}

/**
 * Check if player is wearing full Guthan set
 */
function hasFullGuthanSet(equipment, itemsData) {
  if (!equipment || !itemsData) return false
  const guthanItems = ['gorath_s_helm', 'gorath_s_platebody', 'gorath_s_chainskirt', 'gorath_s_warspear']
  return guthanItems.every(itemId => {
    for (const [, slot] of Object.entries(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
    return false
  })
}

/**
 * Check if player is wearing full Ahrim set (Morvyn's)
 */
function hasFullAhrimSet(equipment, itemsData) {
  if (!equipment || !itemsData) return false
  const ahrimItems = ['morvyn_s_hood', 'morvyn_s_robetop', 'morvyn_s_robeskirt', 'morvyn_s_staff']
  return ahrimItems.every(itemId => {
    for (const [, slot] of Object.entries(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
    return false
  })
}

/**
 * Check if player is wearing full Karil set (Kaelor's)
 */
function hasFullKarilSet(equipment, itemsData) {
  if (!equipment || !itemsData) return false
  const karilItems = ['kaelor_s_coif', 'kaelor_s_leathertop', 'kaelor_s_leatherskirt', 'kaelor_s_crossbow']
  return karilItems.every(itemId => {
    for (const [, slot] of Object.entries(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
    return false
  })
}

/**
 * Check if player is wearing full Torag set (Torvek's)
 */
function hasFullToragSet(equipment, itemsData) {
  if (!equipment || !itemsData) return false
  const toragItems = ['torvek_s_helm', 'torvek_s_platebody', 'torvek_s_platelegs', 'torvek_s_hammers']
  return toragItems.every(itemId => {
    for (const [, slot] of Object.entries(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
    return false
  })
}

/**
 * Check if player is wearing full Verac set (Verin's)
 */
function hasFullVeracSet(equipment, itemsData) {
  if (!equipment || !itemsData) return false
  const veracItems = ['verin_s_helm', 'verin_s_brassard', 'verin_s_plateskirt', 'verin_s_flail']
  return veracItems.every(itemId => {
    for (const [, slot] of Object.entries(equipment)) {
      if (slot && slot.itemId === itemId) return true
    }
    return false
  })
}

/**
 * Process one combat tick.
 * Returns { combatState, events[] }
 * events: { type: 'playerHit'|'monsterHit'|'monsterDeath'|'playerDeath'|'xp'|'levelUp', ... }
 */
export function processCombatTick(combatState, playerStats, equipment, itemsData, prayersData = {}, inventory = [], slayerTask = null) {
  const state = { ...combatState, slayerTask }
  const events = []
  state.tickCount++

  // Decrement cooldowns
  if (state.playerAttackTimer > 0) state.playerAttackTimer--
  if (state.monsterAttackTimer > 0) state.monsterAttackTimer--
  if (state.eatCooldown > 0) state.eatCooldown--
  if (state.potionCooldown > 0) state.potionCooldown--
  if (state.comboCooldown > 0) state.comboCooldown--

  const bonuses = getEquipmentBonuses(equipment, itemsData)

  // Drain the prayer pool for this tick (higher-tier prayers drain faster). When
  // it empties, active prayers switch off — so their bonuses below are skipped.
  applyPrayerDrainTick(state, prayersData, getPrayerDrainMultiplier(bonuses))

  // Decrement potion durations and remove expired potions
  for (const [potionId, duration] of Object.entries(state.activePotions)) {
    if (duration > 0) {
      state.activePotions[potionId] = duration - 1
    }
    if (state.activePotions[potionId] <= 0) {
      delete state.activePotions[potionId]
    }
  }

  // Apply prayer bonuses to player stats from both active prayers
  let boostedPlayerStats = playerStats
  if (prayersData && typeof prayersData === 'object') {
    if (state.activeProtectionPrayer && prayersData[state.activeProtectionPrayer]) {
      boostedPlayerStats = applyPrayerBonuses(boostedPlayerStats, state.activeProtectionPrayer, prayersData) || boostedPlayerStats
    }
    if (state.activeCombatPrayer && prayersData[state.activeCombatPrayer]) {
      boostedPlayerStats = applyPrayerBonuses(boostedPlayerStats, state.activeCombatPrayer, prayersData) || boostedPlayerStats
    }
  }

  // Apply potion bonuses to player stats from all active potions (max per stat,
  // via the shared consumables engine — same maths PvP uses).
  if (Object.keys(state.activePotions).length > 0 && itemsData && typeof itemsData === 'object') {
    const potBoosts = getActivePotionBoosts(state.activePotions, itemsData)
    boostedPlayerStats = { ...boostedPlayerStats }
    for (const [stat, val] of Object.entries(potBoosts)) {
      if (val && typeof boostedPlayerStats[stat] === 'number') {
        boostedPlayerStats[stat] = Math.floor(boostedPlayerStats[stat] + val)
      }
    }
  }

  const weaponSpeed = getAttackSpeed(equipment, itemsData)
  const weaponStyle = getMeleeAttackStyle(equipment, itemsData)
  const monster = state.monster
  // The enemy the player's swings land on — the boss, unless the player has
  // switched to a live add. Only the boss can be a slayer task.
  const target = activeTarget(state)
  const isOnTask = !!(slayerTask && monster && doesSlayerTaskMatchMonster(slayerTask.monsterId, monster.id))

  // Look up equipped weapon + scale-charge info for this tick
  const equippedWeaponEntry = equipment?.weapon
  const equippedWeapon = equippedWeaponEntry ? itemsData[equippedWeaponEntry.itemId] : null
  const weaponIsScaleCharged = !!equippedWeapon?.scaleCharged
  const weaponIsPoweredStaff = !!equippedWeapon?.poweredStaff
  const weaponCharges = equippedWeaponEntry?.charges || 0

  // ── Force-kill resolution ──
  // A monster that ENTERS a tick already at 0 HP was force-killed out of band
  // (e.g. the boss "skip" instant-kill arms monster.currentHP = 0). Resolve its
  // death deterministically here, before the attack blocks — those can
  // early-return on no ammo / no charges / insufficient runes, which would
  // otherwise strand the kill (death event never fires) and hang the skip's
  // awaitCombatCompletion lock on the "Saving…" overlay. checkMonsterDeath
  // handles phase/double-kill/raid semantics, so a regenerating boss simply
  // continues with combat still active.
  if (monster.currentHP <= 0 && state.active) {
    state.monster = monster
    checkMonsterDeath(state, monster, events, isOnTask)
    return { combatState: state, events }
  }

  // ── Summoned creature ──
  // Runs before the player attack (which can early-return on no ammo/charges),
  // so the creature keeps swinging regardless. Lasts SUMMON_DURATION_TICKS;
  // each swing spends one of the creature's scrolls from the inventory. The UI
  // removes the scroll in response to the consumeScroll event (like consumeCharge).
  if (state.summon && state.active) {
    const creature = getSummoningCreature(state.summon.creatureId)
    if (!creature) {
      state.summon = null
    } else {
      state.summon.ticksLeft--
      if (state.summon.ticksLeft <= 0) {
        events.push({ type: 'summonExpired', creatureId: creature.id })
        state.summon = null
      } else {
        state.summon.attackTimer--
        if (state.summon.attackTimer <= 0) {
          state.summon.attackTimer = SUMMON_ATTACK_TICKS
          if (countItem(inventory, creature.scroll) > 0) {
            const swing = rollSummonAttack(creature, monster)
            const actualDamage = Math.min(swing.damage, Math.max(0, monster.currentHP))
            monster.currentHP -= actualDamage
            triggerEnrageIfNeeded(state, monster, events)
            events.push({ type: 'summonHit', creatureId: creature.id, damage: actualDamage, hits: swing.hits, monsterHP: monster.currentHP })
            events.push({ type: 'consumeScroll', itemId: creature.scroll, qty: 1 })
            if (monster.currentHP <= 0) {
              state.monster = monster
              checkMonsterDeath(state, monster, events, isOnTask)
              return { combatState: state, events }
            }
          } else {
            events.push({ type: 'summonNoScrolls', creatureId: creature.id })
          }
        }
      }
    }
  }

  // ── Player Attack ──
  if (state.playerAttackTimer <= 0 && state.eatCooldown <= 0) {
    // Check if special attack is queued
    if (state.specialAttackQueued) {
      // Fire the special attack instead of normal attack
      const weaponEntry = equipment?.weapon
      if (weaponEntry) {
        const weapon = itemsData[weaponEntry.itemId]
        if (weapon?.specialAttack) {
          if (state.combatType === 'ranged' && !weapon?.scaleCharged) {
            const ammoFailure = getRangedAmmoRequirementFailure(equipment, itemsData)
            if (ammoFailure) {
              events.push({ type: 'noAmmo', ...ammoFailure })
              state.specialAttackQueued = false
              let speed = weaponSpeed
              if (state.stance === 'rapid') speed = Math.max(1, speed - 1)
              state.playerAttackTimer = speed
              state.monster = monster
              return { combatState: state, events }
            }
          }
          // A scale-charged melee weapon pays a charge for its special exactly
          // as for an ordinary swing, checked before the energy drain so an
          // empty weapon costs nothing. Melee-only: ranged spec handlers spend
          // their charge inline (toxic_siphon), so the blowpipe would pay twice.
          if (state.combatType === 'melee' && weapon.scaleCharged && weaponCharges <= 0) {
            events.push({ type: 'noCharges', itemId: weaponEntry.itemId })
            state.specialAttackQueued = false
            state.playerAttackTimer = weaponSpeed
            state.monster = monster
            return { combatState: state, events }
          }
          // Check if we still have enough energy before firing
          const currentEnergy = state.specialAttackEnergy || 0
          if (canAffordSpecialAttack(weapon.specialAttack, currentEnergy)) {
            // Drain energy when special attack actually fires — Sunbearer Ring pins it at 100%
            if (!hasSunbearerRing(equipment)) {
              state.specialAttackEnergy = Math.max(0, currentEnergy - resolveSpecialEnergyCost(weapon.specialAttack, currentEnergy))
            }
            // Check form immunity before firing (e.g. Hellbound Gorilla)
            const specImmunity = getFormImmunity(target)
            if (specImmunity && specImmunity === state.combatType) {
              // Energy drained but attack is fully blocked — consistent with normal spec early-return
              state.specialAttackQueued = false
              events.push({ type: 'immuneHit', immunity: specImmunity, monsterName: target.name })
              let speed = weaponSpeed
              if (state.combatType === 'ranged' && state.stance === 'rapid') speed = Math.max(1, speed - 1)
              state.playerAttackTimer = speed
              state.monster = monster
              return { combatState: state, events }
            }
            const { combatState: newState, events: specEvents } = applySpecialAttack(state, boostedPlayerStats, equipment, itemsData, slayerTask)
            // Merge events from special attack
            for (const ev of specEvents) {
              events.push(ev)
            }
            Object.assign(state, newState)
            state.specialAttackQueued = false
            if (state.combatType === 'melee' && weapon.scaleCharged) {
              events.push({ type: 'consumeCharge', qty: 1 })
            }
            // If a boss phase reset occurred, timers are already set — don't override them
            const hadPhaseReset = specEvents.some(ev => ev.type === 'bossPhaseReset')
            if (!hadPhaseReset) {
              let speed = weaponSpeed
              if (state.combatType === 'ranged' && state.stance === 'rapid') speed = Math.max(1, speed - 1)
              state.playerAttackTimer = speed
            }
            // Don't call checkMonsterDeath again — applySpecialAttack already did it
            if (!state.active) {
              return { combatState: state, events }
            }
            return { combatState: state, events }
          }
        }
      }
      // Clear queued flag if we can't fire for any reason
      state.specialAttackQueued = false
    }

    const slayerEquipmentBonus = getSlayerTaskEquipmentBonuses({ equipment, itemsData, slayerTask, monsterId: target.id })
    const voidMult = getCombatSetMultipliers(equipment)
    let damage = 0
    let xpSkills = {}

    if (state.combatType === 'melee') {
      // Scale-charged melee weapons (Scythe, Saeldor Warblade, shardglass tools)
      // require a charge to swing; out of charges → can't attack.
      if (equippedWeapon?.scaleCharged) {
        if (weaponCharges <= 0) {
          events.push({ type: 'noCharges', itemId: equippedWeaponEntry.itemId })
          state.playerAttackTimer = weaponSpeed
          state.monster = monster
          return { combatState: state, events }
        }
      }

      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(boostedPlayerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      let maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * voidMult.meleeDamage)
      maxHit = Math.floor(maxHit * (1 + slayerEquipmentBonus.damagePercent / 100))
      const effAtk = effectiveAttack(boostedPlayerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = Math.floor(maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0) * voidMult.meleeAccuracy * (1 + slayerEquipmentBonus.accuracyPercent / 100))
      const defRoll = maxDefenceRoll(target.stats.defence, target.defenceBonus[weaponStyle] || 0)
      const veracProc = hasFullVeracSet(equipment, itemsData) && Math.random() < 0.25
      const acc = veracProc ? 1 : hitChance(atkRoll, defRoll)
      damage = rollDamage(acc, maxHit)

      // Scythe of vitur passive: 3 hits at 100%, 50%, 25% max hit
      if (equippedWeapon?.scythePassive && damage > 0) {
        const hit2 = rollDamage(acc, Math.floor(maxHit * 0.5))
        const hit3 = rollDamage(acc, Math.floor(maxHit * 0.25))
        damage += hit2 + hit3
        events.push({ type: 'scythePassive', hits: [damage - hit2 - hit3, hit2, hit3] })
      }

      // Consume one charge per scale-charged melee swing.
      if (equippedWeapon?.scaleCharged) {
        events.push({ type: 'consumeCharge', qty: 1 })
      }

      if (damage > 0) {
        const xpSkill = getMeleeXPSkill(state.stance)
        if (Array.isArray(xpSkill)) {
          const per = Math.floor(damage * MELEE_XP_PER_DAMAGE / 3)
          for (const s of xpSkill) xpSkills[s] = per
        } else {
          xpSkills[xpSkill] = damage * MELEE_XP_PER_DAMAGE
        }
        xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
      }
    } else if (state.combatType === 'ranged') {
      // Scale-charged weapons (e.g. Toxic blowpipe) require charges, not ammo
      if (weaponIsScaleCharged) {
        if (weaponCharges <= 0) {
          events.push({ type: 'noCharges', itemId: equippedWeaponEntry.itemId })
          let speed = weaponSpeed
          if (state.stance === 'rapid') speed = Math.max(1, speed - 1)
          state.playerAttackTimer = speed
          state.monster = monster
          return { combatState: state, events }
        }
      }
      if (!weaponIsScaleCharged) {
        const ammoFailure = getRangedAmmoRequirementFailure(equipment, itemsData)
        if (ammoFailure) {
          events.push({ type: 'noAmmo', ...ammoFailure })
          let speed = weaponSpeed
          if (state.stance === 'rapid') speed = Math.max(1, speed - 1)
          state.playerAttackTimer = speed
          state.monster = monster
          return { combatState: state, events }
        }
      }

      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(boostedPlayerStats.ranged, 0, 1.0, styleBonus)
      let maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * voidMult.rangedDamage)
      let atkRoll = Math.floor(maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0) * voidMult.rangedAccuracy * (1 + slayerEquipmentBonus.accuracyPercent / 100))

      // Dragon Hunter Crossbow: +30% accuracy and damage vs dragon-type monsters
      if (equippedWeapon?.dragonHunter && target.isDragon) {
        atkRoll = Math.floor(atkRoll * 1.3)
        maxHit = Math.floor(maxHit * 1.3)
      }

      // Twisted Bow: scales accuracy and damage with target's magic level (PocketRPG formula, capped at M=250)
      if (equippedWeapon?.scalesWithMagic) {
        const M = Math.min(250, Math.max(1, target.stats?.magic || 1))
        const accInner = Math.floor(3 * M / 10) - 100
        const dmgInner = Math.floor(3 * M / 10) - 140
        const accMult = Math.min(140, Math.max(0, 140 + Math.floor((3 * M - 10) / 100) - Math.floor(accInner * accInner / 100))) / 100
        const dmgMult = Math.min(250, Math.max(0, 250 + Math.floor((3 * M - 14) / 100) - Math.floor(dmgInner * dmgInner / 100))) / 100
        atkRoll = Math.floor(atkRoll * accMult)
        maxHit = Math.floor(maxHit * dmgMult)
      }

      const defRoll = maxDefenceRoll(target.stats.defence, target.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      maxHit = Math.floor(maxHit * (1 + slayerEquipmentBonus.damagePercent / 100))
      damage = rollDamage(acc, maxHit)

      // ── Karil Set Bonus: 25% chance to fire an extra shot for the same damage roll ──
      if (hasFullKarilSet(equipment, itemsData) && Math.random() < 0.25) {
        damage += rollDamage(acc, maxHit)
      }

      const equippedAmmoEntry = equipment && equipment.ammo
      const ammoItem = equippedAmmoEntry ? itemsData[equippedAmmoEntry.itemId] : null
      const canConsumeEquippedAmmo = Boolean(equippedWeapon?.ammoType && equippedAmmoEntry && !getRangedAmmoRequirementFailure(equipment, itemsData))
      const canUseEnchantedBolt = canConsumeEquippedAmmo && ammoItem?.ammoKind === 'bolt'

      // ── Enchanted bolt procs (ruby/diamond/dragonstone/onyx e) ──
      let boltProcEvent = null
      let boltHealAmount = 0
      let boltSelfDamage = 0
      if (!weaponIsScaleCharged && canUseEnchantedBolt) {
        const proc = ammoItem?.boltProc
        if (proc && Math.random() < (proc.chance || 0)) {
          switch (proc.type) {
            case 'blood_forfeit': {
              // Hits 20% of target's current HP, deals 10% of player's current HP to self
              if (target.currentHP > 0) {
                damage = Math.max(1, Math.floor(target.currentHP * 0.2))
                const playerHP = playerStats.currentHP || 0
                boltSelfDamage = Math.floor(playerHP * 0.1)
                boltProcEvent = { type: 'boltProc', procType: 'blood_forfeit', damage, selfDamage: boltSelfDamage }
              }
              break
            }
            case 'armour_piercing': {
              // 115% max hit, ignore all defence (guaranteed accuracy)
              const piercedMax = Math.floor(maxHit * 1.15)
              damage = Math.max(1, Math.floor(Math.random() * (piercedMax + 1)))
              boltProcEvent = { type: 'boltProc', procType: 'armour_piercing', damage }
              break
            }
            case 'dragons_breath': {
              // +45% damage — does not work on dragons / fire-immune targets
              if (target.isDragon || target.fireImmune) {
                boltProcEvent = { type: 'boltProc', procType: 'dragons_breath', damage: 0, blocked: true, monsterName: target.name }
              } else {
                const burnMax = Math.floor(maxHit * 1.45)
                damage = Math.max(damage, Math.floor(Math.random() * (burnMax + 1)))
                boltProcEvent = { type: 'boltProc', procType: 'dragons_breath', damage }
              }
              break
            }
            case 'life_leech': {
              // +20% damage, heal 25% of damage dealt. Undead immune.
              if (target.undead) {
                boltProcEvent = { type: 'boltProc', procType: 'life_leech', damage: 0, blocked: true, monsterName: target.name }
              } else {
                const leechMax = Math.floor(maxHit * 1.20)
                damage = Math.max(damage, Math.floor(Math.random() * (leechMax + 1)))
                boltHealAmount = Math.floor(damage * 0.25)
                boltProcEvent = { type: 'boltProc', procType: 'life_leech', damage, healAmount: boltHealAmount }
              }
              break
            }
          }
        }
      }

      if (weaponIsScaleCharged) {
        // Consume one scale charge per shot
        events.push({ type: 'consumeCharge', qty: 1 })
      } else if (canConsumeEquippedAmmo) {
        const saveChance = getAvasAmmoSaveChance(equipment)
        // Consume one bolt/arrow per shot unless Ava's effect preserves it.
        if (Math.random() >= saveChance) events.push({ type: 'consumeAmmo', itemId: equippedAmmoEntry.itemId, qty: 1 })
      }

      if (boltProcEvent) {
        events.push(boltProcEvent)
      }

      if (damage > 0) {
        if (state.stance === 'longrange') {
          // Longrange splits XP: 2 ranged + 2 defence per damage
          xpSkills.ranged = damage * (RANGED_XP_PER_DAMAGE / 2)
          xpSkills.defence = damage * (RANGED_XP_PER_DAMAGE / 2)
        } else {
          xpSkills.ranged = damage * RANGED_XP_PER_DAMAGE
        }
        xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
      }
    } else if (state.combatType === 'magic' && weaponIsPoweredStaff) {
      // Powered staff path (e.g. Trident of the swamp): no spell, no runes — scale charged.
      if (weaponIsScaleCharged) {
        if (weaponCharges <= 0) {
          events.push({ type: 'noCharges', itemId: equippedWeaponEntry.itemId })
          let speed = weaponSpeed
          state.playerAttackTimer = speed
          state.monster = monster
          return { combatState: state, events }
        }
      }

      const effMag = effectiveMagic(boostedPlayerStats.magic)
      const atkRoll = Math.floor(maxAttackRoll(effMag, bonuses.attackBonus.magic || 0) * voidMult.magicAccuracy * (1 + slayerEquipmentBonus.accuracyPercent / 100))
      const defRoll = monsterMagicDefenceRoll(target.stats.magic, target.stats.defence, target.defenceBonus.magic || 0)
      const acc = hitChance(atkRoll, defRoll)
      const magicLevel = boostedPlayerStats.magic || 1
      const baseDamage = poweredStaffMagicBaseDamage(magicLevel, equippedWeapon)
      const wornMagicDamage = getEffectiveWornMagicDamage(bonuses.otherBonus.magicDamage, equipment, itemsData)
      const maxHit = Math.floor(magicMaxHit(baseDamage, wornMagicDamage + voidMult.magicDamageBonusFlat) * (1 + slayerEquipmentBonus.damagePercent / 100))
      damage = rollDamage(acc, maxHit)

      if (weaponIsScaleCharged) {
        events.push({ type: 'consumeCharge', qty: 1 })
      }

      // Sanguinesti staff passive: 1/6 chance to heal for half damage dealt
      if (equippedWeapon?.sangPassive && damage > 0 && Math.random() < (1 / 6)) {
        const healAmount = Math.max(1, Math.floor(damage / 2))
        events.push({ type: 'sangHeal', healAmount, damage })
      }

      if (damage > 0) {
        xpSkills.magic = damage * MAGIC_XP_PER_DAMAGE
        xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
      }
    } else if (state.combatType === 'magic' && state.spell) {
      // Check if player has required runes (considering equipped staffs)
      const hasRunes = hasRequiredRunes(state.spell.runeReq, inventory, {}, equipment, itemsData)

      // Only cast if runes are available
      if (hasRunes) {
        const effMag = effectiveMagic(boostedPlayerStats.magic)
        const atkRoll = Math.floor(maxAttackRoll(effMag, bonuses.attackBonus.magic || 0) * voidMult.magicAccuracy * (1 + slayerEquipmentBonus.accuracyPercent / 100))
        const defRoll = monsterMagicDefenceRoll(target.stats.magic, target.stats.defence, target.defenceBonus.magic || 0)
        const acc = hitChance(atkRoll, defRoll)
        const wornMagicDamage = getEffectiveWornMagicDamage(bonuses.otherBonus.magicDamage, equipment, itemsData)
        const spellRuneDamage = getSpellRuneMagicDamage(equipment, itemsData, state.spell)
        const maxHit = Math.floor(magicMaxHit(state.spell.baseDamage, wornMagicDamage + voidMult.magicDamageBonusFlat + spellRuneDamage) * (1 + slayerEquipmentBonus.damagePercent / 100))
        damage = rollDamage(acc, maxHit)

        // Track which runes to consume (excluding those provided by staff)
        if (state.spell.runeReq) {
          state.runesConsumed = getRunesToConsume(state.spell.runeReq, equipment, itemsData)
        }

        // Magic always grants base spell XP on cast
        xpSkills.magic = (state.spell.baseXP || 0)
        if (damage > 0) {
          xpSkills.magic += damage * MAGIC_XP_PER_DAMAGE
          xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
        }
      } else {
        // No runes - no damage, no XP
        damage = 0
        events.push({ type: 'noRunesForSpell', spellName: state.spell.name })
      }
    }

    // ── Form Immunity Check (e.g. Hellbound Gorilla) ──
    const formImmunity = getFormImmunity(target)
    const isImmune = !!formImmunity && formImmunity === state.combatType
    if (isImmune) {
      damage = 0
      xpSkills = {}
    }

    // ── Dharok Set Bonus ──
    if (!isImmune && damage > 0 && hasFullDharokSet(equipment, itemsData)) {
      const maxHP = playerStats.maxHP || playerStats.hitpoints || 100
      const currentHP = playerStats.currentHP || maxHP
      const lostHP = maxHP - currentHP
      const dharokMultiplier = 1 + (lostHP / maxHP) * (currentHP / maxHP)
      damage = Math.floor(damage * dharokMultiplier)
    }

    // ── Ahrim Set Bonus: 25% chance on a magic hit to drain the target's Strength ──
    // Clone target.stats (a shallow copy of the shared target template) rather
    // than mutating it in place, so the drain doesn't leak into other fights.
    if (!isImmune && damage > 0 && state.combatType === 'magic' && hasFullAhrimSet(equipment, itemsData) && Math.random() < 0.25) {
      target.stats = { ...monster.stats, strength: Math.max(1, (target.stats.strength || 1) - 5) }
    }

    // ── Torag Set Bonus: 25% chance on a melee hit to stun the target's next attack ──
    if (!isImmune && damage > 0 && state.combatType === 'melee' && hasFullToragSet(equipment, itemsData) && Math.random() < 0.25) {
      state.monsterAttackTimer += 5
    }

    // Monster damage resistance (e.g. the Corporeal Horror halves every hit not
    // dealt with a spear). Applied last so set bonuses and specials are resisted too.
    if (!isImmune && damage > 0) damage = applyMonsterResistance(damage, target, equippedWeapon)

    const actualDamage = Math.min(damage, Math.max(0, target.currentHP))
    target.currentHP -= actualDamage
    triggerEnrageIfNeeded(state, target, events)

    // ── Guthan Set Bonus: 25% chance to heal for 100% of damage dealt ──
    let guthanHealAmount = 0
    if (!isImmune && actualDamage > 0 && hasFullGuthanSet(equipment, itemsData) && Math.random() < 0.25) {
      guthanHealAmount = actualDamage
    }

    if (isImmune) {
      events.push({ type: 'immuneHit', immunity: formImmunity, monsterName: target.name })
    } else {
      events.push({ type: 'playerHit', damage: actualDamage, monsterHP: target.currentHP, toAdd: isAddTarget(state, target) })
      if (guthanHealAmount > 0) {
        events.push({ type: 'guthanHeal', healAmount: guthanHealAmount })
      }
    }

    // Recompute xpSkills based on actualDamage to avoid overkill XP
    if (actualDamage !== damage && actualDamage >= 0) {
      for (const skill of Object.keys(xpSkills)) {
        if (skill === 'magic' && state.combatType === 'magic') {
          // Keep base spell XP, scale only the damage portion
          const baseXP = state.spell?.baseXP || 0
          xpSkills[skill] = baseXP + (actualDamage > 0 ? actualDamage * MAGIC_XP_PER_DAMAGE : 0)
        } else if (skill === 'hitpoints') {
          xpSkills[skill] = Math.floor(actualDamage * HP_XP_PER_DAMAGE)
        } else {
          const ratio = damage > 0 ? actualDamage / damage : 0
          xpSkills[skill] = Math.floor(xpSkills[skill] * ratio)
        }
      }
    }

    // Accumulate XP and emit per-attack
    for (const [skill, xp] of Object.entries(xpSkills)) {
      state.xpGained[skill] = (state.xpGained[skill] || 0) + xp
    }
    if (Object.keys(xpSkills).length > 0) {
      events.push({ type: 'xp', xpSkills })
    }

    // Reset attack timer
    let speed = weaponSpeed
    if (state.combatType === 'ranged' && state.stance === 'rapid') speed = Math.max(1, speed - 1)
    state.playerAttackTimer = speed

    // Check target death (handles double-kill bosses like Olm)
    if (target.currentHP <= 0) {
      const wasAdd = isAddTarget(state, target)
      const died = resolveTargetDeath(state, target, events, isOnTask)
      if (died) return { combatState: state, events }
      // Boss regenerated (double-kill) — skip the monster attack this tick,
      // timers are already set. An add only despawned, so the boss still swings.
      if (!wasAdd) return { combatState: state, events }
    }
  }

  // ── Add Attacks ──
  // Every add fights on its own timer alongside the boss, so one tick can carry
  // a hit from each of them and from the boss. Several monsterHit events in one
  // tick apply cumulatively — the screen subtracts each event's damage rather
  // than reading playerHP.
  if (state.active) {
    let addDamageLanded = false
    const adds = Array.isArray(state.adds) ? state.adds : []
    for (let addIndex = 0; addIndex < adds.length; addIndex++) {
      const add = adds[addIndex]
      if (!add || add.currentHP <= 0) continue
      add.attackTimer = (add.attackTimer || 0) - 1
      if (add.attackTimer > 0) continue
      add.attackTimer = Math.max(1, Math.floor(add.attackSpeed || 4))
      // `addIndex` rides the event because several adds can swing on one tick
      // and a caller may have to gate them separately — the open world checks
      // each minion's own reach to the player it is mirrored onto.
      const addDamage = resolveEnemySwing(
        add, add.attackStyle, state, boostedPlayerStats, playerStats, bonuses, prayersData, events, { fromAdd: true, addIndex }
      )
      if (addDamage > 0) addDamageLanded = true
    }
    // One charge per TICK the wearer was hit, not one per attacker — the armour
    // burns a charge for taking a hit, and three minions landing together is
    // still one exchange.
    if (addDamageLanded) {
      const armourSlots = chargedScaleArmourSlots(equipment, itemsData)
      if (armourSlots.length) events.push({ type: 'consumeArmourCharge', slots: armourSlots, qty: 1 })
    }
  }

  // ── Monster Attack ──
  if (state.monsterAttackTimer <= 0) {
    let damage = 0

    // Determine the effective attack style (handle both single style and multiple styles array)
    let effectiveAttackStyle = monster.attackStyle
    if (monster.attackStyles && Array.isArray(monster.attackStyles)) {
      const selectedStyle = monster.attackStyles[Math.floor(Math.random() * monster.attackStyles.length)]
      // Map 'melee' to a random melee style, keep 'ranged' as-is
      if (selectedStyle === 'melee') {
        const meleeStyles = ['crush', 'stab', 'slash']
        effectiveAttackStyle = meleeStyles[Math.floor(Math.random() * meleeStyles.length)]
      } else {
        effectiveAttackStyle = selectedStyle
      }
    }

    // ── Dragonfire attack ──
    if (monster.specialAttack === 'dragonfire' && Math.random() < 0.33) {
      const maxDragonfire = monster.dragonfireDamage || 50
      // Check if player has anti-dragon shield equipped
      const hasAntiDragon = equipment && Object.values(equipment).some(slot => {
        if (!slot || !slot.itemId) return false
        const item = itemsData[slot.itemId]
        return item && item.otherBonus && item.otherBonus.antiDragon
      })
      if (hasAntiDragon) {
        // Nullified — 0 damage
        damage = 0
        events.push({ type: 'dragonfireBlocked', damage: 0, playerHP: playerStats.currentHP })
      } else {
        // Full dragonfire — up to 50
        damage = Math.floor(Math.random() * (maxDragonfire + 1))
        events.push({ type: 'dragonfireHit', damage, playerHP: playerStats.currentHP - damage })
      }
    } else {
      // For multi-form bosses, use the form's declared attack style
      if (monster.multiForm && monster.currentForm && monster.forms?.[monster.currentForm]) {
        effectiveAttackStyle = monster.forms[monster.currentForm].attackStyle || effectiveAttackStyle
      }
      damage = resolveEnemySwing(monster, effectiveAttackStyle, state, boostedPlayerStats, playerStats, bonuses, prayersData, events)
    }

    // Scale-charged armour (shardglass) burns one charge per worn piece each time
    // the wearer takes a hit; at 0 charges the piece stops giving bonuses.
    if (damage > 0) {
      const armourSlots = chargedScaleArmourSlots(equipment, itemsData)
      if (armourSlots.length) events.push({ type: 'consumeArmourCharge', slots: armourSlots, qty: 1 })
    }

    state.monsterAttackTimer = monster.attackSpeed || 4

    // ── Add spawn ──
    const canSummon = (state.addDefinitions || state.addDefinition)
      && liveAdds(state).length < (state.maxActiveAdds || 1)
    if (canSummon && typeof state.addSpawnCountdown === 'number') {
      state.addSpawnCountdown--
      if (state.addSpawnCountdown <= 0) {
        // Resolved at spawn time, not at fight start: a style-rotating boss
        // summons the minion matching the form it is in when the timer lands.
        state.addsSpawned = (state.addsSpawned || 0) + 1
        const spawned = prepareAdd(
          selectAddDefinition(state.addDefinitions, monster, state.addsSpawned - 1) || state.addDefinition,
          state.addsSpawned,
        )
        if (!Array.isArray(state.adds)) state.adds = []
        state.adds.push(spawned)
        // Straight into the next wait: leaving one alive is what lets the stack
        // grow, so the countdown restarts even while the field is not empty.
        state.addSpawnCountdown = liveAdds(state).length < (state.maxActiveAdds || 1)
          ? rollRespawnDelay(getAddSpec(state.monster))
          : null
        events.push({
          type: 'addSpawned',
          monsterName: spawned.name,
          bossName: monster.name,
          hitpoints: spawned.hitpoints,
          icon: spawned.icon || ''
        })
      }
    }

    // ── Multi-form switch check (e.g. Venomcoil Matriarch) ──
    // Skipped when the form is PINNED: co-op and the open world roll it once on
    // the shared boss record and copy it onto every session, so a session doing
    // its own would give each player a differently-formed boss off one health
    // bar (src/engine/bossForms.js).
    if (!state.formPinned) {
      const change = advanceSharedForm(monster)
      if (change) {
        // Delay next attack by one cycle after a form change so the player can adapt
        state.monsterAttackTimer = formChangeAttackTimer(monster)
        events.push(change)
      }
    }
  }

  state.monster = monster
  return { combatState: state, events }
}

/**
 * Roll monster drops
 */
function rollDrops(monster, isOnTask = false, grindman = false) {
  const loot = []
  const rolls = monster.dropRolls || 1
  for (const drop of (monster.drops || [])) {
    // Task-only drops (e.g. Imbued Crown/Brain) never roll off-task.
    if (drop.taskOnly && !isOnTask) continue
    // Always drops (chance === 1.0) are rolled once regardless of dropRolls.
    // Grindman's tripling never changes the roll COUNT — a chance it lifts to 1
    // must not also collapse the table's extra rolls (same rule as hard mode).
    const timesToRoll = (drop.chance >= 1.0) ? 1 : rolls
    const chance = grindmanDropChance(drop.chance, grindman)
    for (let r = 0; r < timesToRoll; r++) {
      if (Math.random() < chance) {
        const qty = Array.isArray(drop.quantity)
          ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
          : drop.quantity
        loot.push({ itemId: drop.itemId, quantity: qty, ...(drop.noted ? { noted: true } : {}) })
      }
    }
  }
  // Seeds / saplings — universal bonus drop scaled by combat level. Rolled once
  // each (independent of dropRolls) so high-multi-roll monsters don't inflate it.
  for (const drop of getMonsterSeedDrops(monster)) {
    if (Math.random() < grindmanDropChance(drop.chance, grindman)) loot.push({ itemId: drop.itemId, quantity: drop.quantity })
  }
  // Summoning charms — universal, combat-level tiered. Rolled once, independent
  // of dropRolls, same as seeds.
  for (const drop of getMonsterCharmDrops(monster)) {
    if (Math.random() < grindmanDropChance(drop.chance, grindman)) loot.push({ itemId: drop.itemId, quantity: drop.quantity })
  }
  return loot
}

/**
 * Roll raid rewards (always drops + unique chance with weighted selection).
 */
function rollRaidRewards(rewards, grindman = false) {
  if (!rewards) return []
  const loot = []
  // Roll always/standard drops
  if (rewards.always) {
    for (const drop of rewards.always) {
      if (Math.random() < grindmanDropChance(drop.chance, grindman)) {
        const qty = Array.isArray(drop.quantity)
          ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
          : drop.quantity
        loot.push({ itemId: drop.itemId, quantity: qty })
      }
    }
  }
  // Roll for a unique item
  if (rewards.unique && Math.random() < grindmanDropChance(rewards.unique.chance, grindman)) {
    const items = rewards.unique.items
    const totalWeight = items.reduce((sum, i) => sum + i.weight, 0)
    let roll = Math.random() * totalWeight
    for (const item of items) {
      roll -= item.weight
      if (roll <= 0) {
        loot.push({ itemId: item.itemId, quantity: 1 })
        break
      }
    }
  }
  return loot
}

/**
 * Apply eat action — delays player attack by EAT_TICK_COST
 */
export function applyEat(combatState) {
  return { ...combatState, eatCooldown: EAT_TICK_COST, playerAttackTimer: Math.max(combatState.playerAttackTimer, EAT_TICK_COST) }
}

/**
 * Apply a combo consumable (combo food like Karam, brews, or potions). Uses its
 * own cooldown so it can be used on the SAME tick as a normal food, and — unlike
 * eating — does NOT delay the next attack.
 */
export function applyCombo(combatState) {
  return { ...combatState, comboCooldown: EAT_TICK_COST }
}

/**
 * Check if a protection prayer protects against a given attack style
 */
function protectionPrayerMatches(prayerStyle, attackStyle) {
  if (!prayerStyle || !attackStyle) return false

  // Map attack styles to protection prayer types
  const meleeStyles = ['crush', 'stab', 'slash']

  if (prayerStyle === 'melee') {
    return meleeStyles.includes(attackStyle)
  }
  return prayerStyle === attackStyle
}

/**
 * Apply prayer bonuses to player stats based on active prayer
 */
export function applyPrayerBonuses(playerStats, activePrayer, prayersData = {}) {
  // If no active prayer or no prayers data, return unmodified stats
  if (!activePrayer || !prayersData || typeof prayersData !== 'object' || !prayersData[activePrayer]) {
    return playerStats
  }

  try {
    const prayer = prayersData[activePrayer]
    if (!prayer) return playerStats

    const boostedStats = { ...playerStats }

    if (prayer.bonusType === 'stat' && prayer.stat && prayer.boostPercent) {
      const statValue = boostedStats[prayer.stat]
      if (typeof statValue === 'number') {
        boostedStats[prayer.stat] = Math.floor(statValue * (1 + prayer.boostPercent / 100))
      }
    } else if (prayer.bonusType === 'multi_stat' && prayer.stats) {
      for (const [stat, boostPercent] of Object.entries(prayer.stats)) {
        const statValue = boostedStats[stat]
        if (typeof statValue === 'number') {
          boostedStats[stat] = Math.floor(statValue * (1 + boostPercent / 100))
        }
      }
    }

    return boostedStats
  } catch (e) {
    // Silently return unmodified stats if anything goes wrong
    return playerStats
  }
}

/**
 * Apply potion bonuses to player stats based on active potion
 */
export function applyPotionBonuses(playerStats, potionItem) {
  // Delegates the per-effect boost map to the shared consumables engine so PvE,
  // PvP and the idle sim all read identical flat `item.boost` values.
  try {
    const boost = getPotionStatBoost(potionItem)
    if (!boost || Object.keys(boost).length === 0) return playerStats
    const boostedStats = { ...playerStats }
    for (const [stat, val] of Object.entries(boost)) {
      if (typeof boostedStats[stat] === 'number') {
        boostedStats[stat] = Math.floor(boostedStats[stat] + val)
      }
    }
    return boostedStats
  } catch (e) {
    // Silently return unmodified stats if anything goes wrong
    return playerStats
  }
}

/**
 * Apply a special attack — manually triggered by the player.
 * Returns { combatState, events[] }
 * Consumes specialAttackEnergy per the weapon's energyCost.
 * Regenerates to 100 automatically in processCombatTick on monster death.
 */
export function applySpecialAttack(combatState, playerStats, equipment, itemsData, slayerTask = null) {
  const weaponEntry = equipment?.weapon
  if (!weaponEntry) return { combatState, events: [] }
  const weapon = itemsData[weaponEntry.itemId]
  if (!weapon?.specialAttack) return { combatState, events: [] }
  const spec = weapon.specialAttack

  // Specials land on whichever enemy the player has targeted, so a queued spec
  // is not silently redirected to the boss when the add is selected.
  const source = activeTarget(combatState)
  const addIndex = addIndexOf(combatState, source)
  const targetsAdd = addIndex >= 0
  const monster = { ...source, defenceBonus: { ...source.defenceBonus }, stats: { ...source.stats } }
  // The clone has to sit in the list, not beside it: isAddTarget is identity-
  // based, so an add resolved off a copy the list does not hold would be read as
  // the boss and its death would end the fight.
  const state = targetsAdd
    ? { ...combatState, adds: combatState.adds.map((add, i) => (i === addIndex ? monster : add)) }
    : { ...combatState, monster }
  const events = []
  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const weaponStyle = getMeleeAttackStyle(equipment, itemsData)
  // Monster damage resistance applies to specials exactly as it does to normal
  // swings, per hit, so reported hits still sum to the damage that landed.
  const resist = (dmg) => applyMonsterResistance(dmg, monster, weapon)
  const isOnTask = !!(slayerTask && monster && doesSlayerTaskMatchMonster(slayerTask.monsterId, monster.id))

  switch (spec.type) {
    case 'double_hit': {
      // Dragon Dagger — two hits at 115% max hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * 1.15)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const hits = [rollDamage(acc, maxHit), rollDamage(acc, maxHit)]
      for (let i = 0; i < hits.length; i++) hits[i] = resist(hits[i])
      const rawTotal = hits[0] + hits[1]
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits, totalDamage: actual, specType: 'double_hit', monsterHP: monster.currentHP })
      break
    }

    case 'zero_defence': {
      // Dragon Scimitar — ignores all monster defence bonuses
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(0, 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'zero_defence', monsterHP: monster.currentHP })
      break
    }

    case 'disrupt': {
      // Zul-Kaar's Blade — guaranteed Magic damage, 50-150% of max melee hit, nullified by magic immunity
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxMelee = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const magicImmune = monster.magicImmune === true || getFormImmunity(monster) === 'magic'
      if (magicImmune) {
        events.push({ type: 'immuneHit', immunity: 'magic', monsterName: monster.name })
        break
      }
      const damage = Math.floor(maxMelee * (0.5 + Math.random()))
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = actual > 0 ? { magic: actual * 2 } : {}
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'disrupt', monsterHP: monster.currentHP })
      break
    }

    case 'fang': {
      // Fang of Osmun — rolls accuracy twice (hit if either succeeds) and, on a
      // hit, the damage range is compressed to 15%–85% of max (no low rolls).
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      // Two independent accuracy rolls; the attack lands if either connects.
      const hit = Math.random() < acc || Math.random() < acc
      const minHit = Math.floor(maxHit * 0.15)
      const cappedMax = Math.floor(maxHit * 0.85)
      const damage = hit ? minHit + Math.floor(Math.random() * (cappedMax - minHit + 1)) : 0
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'fang', monsterHP: monster.currentHP })
      break
    }

    case 'stun': {
      // Abyssal Whip — hit + if not miss, delay monster's next attack by 1 attack cycle
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const stunned = damage > 0
      if (stunned) state.monsterAttackTimer += (monster.attackSpeed || 4)
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'stun', stunned, monsterHP: monster.currentHP })
      break
    }

    case 'judgement': {
      // Zephyra Godsword — 125% accuracy + 125% max hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * 1.25)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = Math.floor(maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0) * 1.25)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'judgement', monsterHP: monster.currentHP })
      break
    }

    case 'healing_blade': {
      // Lumira Godsword — hit + heal 50% of damage (min 10 HP)
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const minHeal = spec.minHeal || 10
      const healAmount = Math.max(minHeal, Math.floor(actual / 2))
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'healing_blade', healAmount, monsterHP: monster.currentHP })
      break
    }

    case 'freeze': {
      // Krylth Godsword — hit + freeze monster for stunTicks ticks
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      state.monsterAttackTimer += (spec.stunTicks || 33)
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'freeze', monsterHP: monster.currentHP })
      break
    }

    case 'warstrike': {
      // Grondar Godsword — hit + reduce monster defenceBonus by damage dealt
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      recordDefenceBonusDrain(monster, actual)
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'warstrike', monsterHP: monster.currentHP })
      break
    }

    case 'smash': {
      // Dragon Warhammer — 150% max hit; on hit, reduce target Defence level by 30% (floor of reduction)
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * 1.5)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      let defenceReducedBy = 0
      if (actual > 0) {
        const currentDefence = Math.max(0, monster.stats.defence || 0)
        defenceReducedBy = Math.floor(currentDefence * 0.3)
        monster.stats.defence = currentDefence - defenceReducedBy
      }
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'smash', defenceReducedBy, monsterHP: monster.currentHP })
      break
    }

    case 'lightning': {
      // Lumira Sword — normal melee hit + guaranteed magic lightning hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const meleeDmg = resist(rollDamage(acc, maxHit))
      const lightningDmg = resist(randInt(1, spec.lightningMax || 16))
      const rawTotal = meleeDmg + lightningDmg
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, meleeDmg > actual ? actual : meleeDmg)
      if (actual > meleeDmg) {
        xpSkills.magic = (xpSkills.magic || 0) + Math.floor((actual - meleeDmg) * MAGIC_XP_PER_DAMAGE)
      }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [meleeDmg, lightningDmg], totalDamage: actual, specType: 'lightning', monsterHP: monster.currentHP })
      break
    }

    case 'snapshot': {
      // Magic Shortbow — two ranged hits at 75% max hit
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * 0.75)
      const atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      const hits = [rollDamage(acc, maxHit), rollDamage(acc, maxHit)]
      for (let i = 0; i < hits.length; i++) hits[i] = resist(hits[i])
      const rawTotal = hits[0] + hits[1]
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits, totalDamage: actual, specType: 'snapshot', monsterHP: monster.currentHP })
      break
    }

    case 'pebble_shot': {
      // Zephyra Crossbow — guaranteed hit at 125% max hit
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * 1.25)
      const damage = randInt(1, Math.max(1, maxHit))
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'pebble_shot', monsterHP: monster.currentHP })
      break
    }

    case 'empty_bolt': {
      // Zaryth Crossbow — guaranteed hit at 150% max hit. No accuracy roll at
      // all, so the floor is 1: this special can never be a zero.
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * 1.5)
      const damage = randInt(1, Math.max(1, maxHit))
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'empty_bolt', monsterHP: monster.currentHP })
      break
    }

    case 'empty_lord_cleave': {
      // Zaryth Godsword — 150% max hit, healing for half the damage that lands.
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * 1.5)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const healAmount = Math.floor(actual / 2)
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'empty_lord_cleave', healAmount, monsterHP: monster.currentHP })
      break
    }

    case 'toxic_siphon': {
      // Venom Blowpipe — guaranteed 150% max hit ranged attack, heals for half damage dealt.
      // Also consumes one scale charge (like a normal blowpipe shot).
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * 1.5)
      const damage = randInt(1, Math.max(1, maxHit))
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const healAmount = Math.floor(actual / 2)
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'toxic_siphon', healAmount, monsterHP: monster.currentHP })
      // Consume one scale charge on spec — emit so the UI decrements charges.
      events.push({ type: 'consumeCharge', qty: 1 })
      break
    }

    case 'shove': {
      // Krylth Spear — 175% accuracy + stun 2 monster attacks
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = Math.floor(maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0) * 1.75)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      state.monsterAttackTimer += (monster.attackSpeed || 4) * 2
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'shove', monsterHP: monster.currentHP })
      break
    }

    case 'slice_and_dice': {
      // Dragon Claws — four cascading hits: 100%, 50%, 25%, and 25% of max hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const h1 = resist(rollDamage(acc, maxHit))
      const h2 = Math.floor(h1 / 2)
      const h3 = Math.floor(h2 / 2)
      const h4 = Math.max(h1 > 0 ? 1 : 0, h3)
      const hits = [h1, h2, h3, h4]
      const rawTotal = h1 + h2 + h3 + h4
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits, totalDamage: actual, specType: 'slice_and_dice', monsterHP: monster.currentHP })
      break
    }

    case 'lunge': {
      // Dinh's Bulwark — guaranteed 40–64 damage, ignoring all combat calculations
      const damage = randInt(40, 64)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'lunge', monsterHP: monster.currentHP })
      break
    }

    case 'triple_hit': {
      // Granite Maul — Quake: three rapid crush hits, each rolling its own damage
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const hits = [rollDamage(acc, maxHit), rollDamage(acc, maxHit), rollDamage(acc, maxHit)]
      for (let i = 0; i < hits.length; i++) hits[i] = resist(hits[i])
      const rawTotal = hits[0] + hits[1] + hits[2]
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits, totalDamage: actual, specType: 'triple_hit', monsterHP: monster.currentHP })
      break
    }

    case 'descent_of_darkness': {
      // Nightfang Bow — fires two arrows at 150% max hit each
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * 1.5)
      const atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      const hits = [rollDamage(acc, maxHit), rollDamage(acc, maxHit)]
      for (let i = 0; i < hits.length; i++) hits[i] = resist(hits[i])
      const rawTotal = hits[0] + hits[1]
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits, totalDamage: actual, specType: 'descent_of_darkness', monsterHP: monster.currentHP })
      break
    }

    case 'overpower': {
      // Dragon Mace — single crush hit at 150% max hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * 1.5)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'overpower', monsterHP: monster.currentHP })
      break
    }

    case 'soul_leech': {
      // Boneclaw Rapier — two stab hits at 100% max hit; heals for 100% of second hit's damage
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = wornMeleeMaxHit(effStr, bonuses.otherBonus)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const h1 = resist(rollDamage(acc, maxHit))
      const h2 = resist(rollDamage(acc, maxHit))
      const rawTotal = h1 + h2
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const healAmount = h2 > 0 ? Math.min(h2, actual) : 0
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [h1, h2], totalDamage: actual, specType: 'soul_leech', healAmount, monsterHP: monster.currentHP })
      break
    }

    case 'gale_shot': {
      // Stonegale Bow — guaranteed ranged hit at 140% max hit; stuns monster for 1 attack cycle
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * 1.4)
      const damage = randInt(1, Math.max(1, maxHit))
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      state.monsterAttackTimer += (monster.attackSpeed || 4)
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'gale_shot', stunned: true, monsterHP: monster.currentHP })
      break
    }

    case 'molten_crush': {
      // Cindermaw Maul — 125% crush max hit; on hit, reduces monster Defence level by 20%
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(wornMeleeMaxHit(effStr, bonuses.otherBonus) * 1.25)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      let defenceReducedBy = 0
      if (actual > 0) {
        const currentDefence = Math.max(0, monster.stats.defence || 0)
        defenceReducedBy = Math.floor(currentDefence * 0.2)
        monster.stats.defence = currentDefence - defenceReducedBy
      }
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'molten_crush', defenceReducedBy, monsterHP: monster.currentHP })
      break
    }

    case 'volley': {
      // Thornspine Shortbow — three rapid ranged shots at 70% max hit each
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(wornRangedMaxHit(effRng, bonuses.otherBonus) * 0.7)
      const atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      const hits = [rollDamage(acc, maxHit), rollDamage(acc, maxHit), rollDamage(acc, maxHit)]
      for (let i = 0; i < hits.length; i++) hits[i] = resist(hits[i])
      const rawTotal = hits[0] + hits[1] + hits[2]
      const actual = Math.min(rawTotal, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits, totalDamage: actual, specType: 'volley', monsterHP: monster.currentHP })
      break
    }

    case 'soul_drain': {
      // Umbral Duskmare Staff — a magic blast that restores Prayer points equal
      // to half the damage dealt (up to the pool cap). Damage scales with Magic.
      const magicLevel = playerStats.magic || 1
      const effMag = effectiveMagic(magicLevel)
      const atkRoll = maxAttackRoll(effMag, bonuses.attackBonus.magic || 0)
      const defRoll = monsterMagicDefenceRoll(monster.stats.magic, monster.stats.defence, monster.defenceBonus.magic || 0)
      const acc = hitChance(atkRoll, defRoll)
      const wornMagicDamage = getEffectiveWornMagicDamage(bonuses.otherBonus.magicDamage, equipment, itemsData)
      const baseDamage = Math.max(1, Math.floor(magicLevel / 3) + 12)
      const maxHit = magicMaxHit(baseDamage, wornMagicDamage)
      const damage = rollDamage(acc, Math.max(1, maxHit))
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      let prayerRestored = 0
      if (actual > 0 && Number.isFinite(state.maxPrayerPoints)) {
        const cur = Number(state.prayerPoints) || 0
        const restored = Math.min(state.maxPrayerPoints, cur + Math.floor(actual / 2))
        prayerRestored = restored - cur
        state.prayerPoints = restored
      }
      const xpSkills = { magic: actual * MAGIC_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'soul_drain', prayerRestored, monsterHP: monster.currentHP })
      break
    }

    case 'volatile_surge': {
      // Volatile Duskmare Staff — high-accuracy magic blast whose max hit scales
      // directly with Magic level (a maxed mage hits far above a normal spell).
      const magicLevel = playerStats.magic || 1
      const effMag = effectiveMagic(magicLevel)
      const atkRoll = Math.floor(maxAttackRoll(effMag, bonuses.attackBonus.magic || 0) * 1.25)
      const defRoll = monsterMagicDefenceRoll(monster.stats.magic, monster.stats.defence, monster.defenceBonus.magic || 0)
      const acc = hitChance(atkRoll, defRoll)
      const wornMagicDamage = getEffectiveWornMagicDamage(bonuses.otherBonus.magicDamage, equipment, itemsData)
      const baseDamage = Math.max(1, Math.floor(magicLevel * 0.6))
      const maxHit = magicMaxHit(baseDamage, wornMagicDamage)
      const damage = rollDamage(acc, Math.max(1, maxHit))
      const actual = Math.min(resist(damage), Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = { magic: actual * MAGIC_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [resist(damage)], totalDamage: actual, specType: 'volatile_surge', monsterHP: monster.currentHP })
      break
    }

    default:
      return { combatState, events: [] }
  }

  // Splats render over the HP bar of whichever enemy was hit, so every event
  // from this spec carries the target it landed on.
  if (targetsAdd) {
    for (const ev of events) {
      if (ev && (ev.type === 'specialHit' || ev.type === 'playerHit')) ev.toAdd = true
    }
  }

  triggerEnrageIfNeeded(state, monster, events)

  // Check target death from special attack (handles double-kill bosses like Olm)
  if (monster.currentHP <= 0) {
    resolveTargetDeath(state, monster, events, isOnTask)
  }

  // Only update the target if it's still alive — death handling may have
  // replaced it (raid advancement) or cleared it (an add despawning).
  if (monster.currentHP > 0) {
    if (targetsAdd) state.adds[addIndex] = monster
    else state.monster = monster
  }
  return { combatState: state, events }
}

// ── XP helpers (internal) ──

function _meleeXP(stance, damage) {
  if (damage <= 0) return {}
  const xpSkill = getMeleeXPSkill(stance)
  const xpSkills = {}
  if (Array.isArray(xpSkill)) {
    const per = Math.floor(damage * MELEE_XP_PER_DAMAGE / 3)
    for (const s of xpSkill) xpSkills[s] = per
  } else {
    xpSkills[xpSkill] = damage * MELEE_XP_PER_DAMAGE
  }
  xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
  return xpSkills
}

function _accXP(state, xpSkills) {
  for (const [skill, xp] of Object.entries(xpSkills)) {
    state.xpGained[skill] = (state.xpGained[skill] || 0) + xp
  }
}
