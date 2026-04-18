import {
  effectiveStrength, meleeMaxHit, effectiveAttack, maxAttackRoll,
  maxDefenceRoll, hitChance, rollDamage, getMeleeStyleBonuses,
  getMeleeXPSkill, effectiveRanged, rangedMaxHit, getRangedStyleBonus,
  effectiveMagic, monsterMagicDefenceRoll, magicMaxHit
} from './formulas.js'
import { getEquipmentBonuses, getAttackSpeed, getAttackStyle } from './equipment.js'
import { getLevelFromXP } from './experience.js'
import { hasRequiredRunes, getRunesToConsume } from './runes.js'
import { MELEE_XP_PER_DAMAGE, RANGED_XP_PER_DAMAGE, MAGIC_XP_PER_DAMAGE, HP_XP_PER_DAMAGE, EAT_TICK_COST } from '../utils/constants.js'
import { randInt } from '../utils/helpers.js'

/**
 * Create a new combat state
 */
export function createCombatState(monster, combatType = 'melee', stance = 'accurate', spell = null) {
  // Apply initial form for multi-form bosses (e.g. Zulrah)
  let preparedMonster = prepareMonster(monster)
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
    log: [],         // combat log entries
    tickCount: 0,
    xpGained: {},    // accumulated xp per skill
    loot: null,      // set on monster death
    specialAttackEnergy: 100,  // 0-100; starts at 100 for each new fight, drains on use, refills on kill
    specialAttackQueued: false,  // flag to fire special attack on next available tick
    activeProtectionPrayer: null,  // one protection prayer, reset on each new fight
    activeCombatPrayer: null,      // one combat enhancing prayer, reset on each new fight
    activePotions: {},             // { potionItemId: durationInTicks } - multiple different potion types allowed
    doubleKillCount: 0,            // tracks how many times a requiresDoubleKill boss has been defeated
    raid: null                     // raid state: { raidId, bosses[], currentBossIndex, monstersData }
  }
}

/**
 * Prepare a monster for combat (apply initial form, set currentHP).
 */
function prepareMonster(monster) {
  let preparedMonster = { ...monster, currentHP: monster.hitpoints }
  if (monster.multiForm && monster.forms) {
    const formKey = monster.initialForm || Object.keys(monster.forms)[0]
    const form = monster.forms[formKey]
    if (form) {
      preparedMonster.currentForm = formKey
      preparedMonster.formAttackCount = 0
      preparedMonster.formSwitchThreshold = monster.randomFormEveryAttack ? 1 : randomFormSwitchThreshold(monster)
      preparedMonster.attackStyle = form.attackStyle
      preparedMonster.attackBonus = form.attackBonus ?? monster.attackBonus ?? 0
      preparedMonster.strengthBonus = form.strengthBonus ?? monster.strengthBonus ?? 0
      preparedMonster.defenceBonus = { ...form.defenceBonus }
      preparedMonster.formMaxHit = form.maxHit
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
export function createRaidCombatState(raidData, monstersData, combatType = 'melee', stance = 'accurate', spell = null) {
  const firstBossId = raidData.bosses[0]
  const firstBoss = monstersData[firstBossId]
  if (!firstBoss) return null
  const state = createCombatState(firstBoss, combatType, stance, spell)
  state.raid = {
    raidId: raidData.id,
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
function randomFormSwitchThreshold(monster) {
  const min = monster.formSwitchMin || 1
  const max = monster.formSwitchMax || 5
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Pick the next form. If formCycleOrder is defined, cycles in order;
 * otherwise picks a random form (including possibly the current one).
 */
function pickNextForm(monster) {
  const keys = Object.keys(monster.forms || {})
  if (keys.length <= 1) return monster.currentForm
  if (monster.formCycleOrder && Array.isArray(monster.formCycleOrder)) {
    const cycle = monster.formCycleOrder
    const idx = cycle.indexOf(monster.currentForm)
    return cycle[(idx + 1) % cycle.length]
  }
  return keys[Math.floor(Math.random() * keys.length)]
}

/**
 * Returns the immunity type ('melee', 'ranged', 'magic') of the monster's current form,
 * or null if the current form has no immunity. Used for phase-based bosses like Demonic Gorilla.
 */
function getFormImmunity(monster) {
  if (!monster.multiForm || !monster.currentForm || !monster.forms) return null
  return monster.forms[monster.currentForm]?.immunity || null
}

/**
 * Handle monster death. Supports double-kill requirement (e.g. Olm), Verzik phased boss, and raid boss advancement.
 * Returns true if the monster truly died (combat ends), false if it regenerated/advanced (combat continues).
 */
function checkMonsterDeath(state, monster, events) {
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
    state.loot = rollRaidRewards(raid.rewards)
    events.push({ type: 'raidComplete', raidId: raid.raidId, loot: state.loot, xpGained: { ...state.xpGained } })
    events.push({ type: 'monsterDeath', loot: state.loot, xpGained: { ...state.xpGained } })
    return true
  }

  // True death (non-raid)
  state.active = false
  state.specialAttackEnergy = 100
  state.loot = rollDrops(monster)
  events.push({ type: 'monsterDeath', loot: state.loot, xpGained: { ...state.xpGained } })
  return true
}

/**
 * Process one combat tick.
 * Returns { combatState, events[] }
 * events: { type: 'playerHit'|'monsterHit'|'monsterDeath'|'playerDeath'|'xp'|'levelUp', ... }
 */
export function processCombatTick(combatState, playerStats, equipment, itemsData, prayersData = {}, inventory = []) {
  const state = { ...combatState }
  const events = []
  state.tickCount++

  // Decrement cooldowns
  if (state.playerAttackTimer > 0) state.playerAttackTimer--
  if (state.monsterAttackTimer > 0) state.monsterAttackTimer--
  if (state.eatCooldown > 0) state.eatCooldown--
  if (state.potionCooldown > 0) state.potionCooldown--

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

  // Apply potion bonuses to player stats from all active potions
  if (Object.keys(state.activePotions).length > 0 && itemsData && typeof itemsData === 'object') {
    for (const potionId of Object.keys(state.activePotions)) {
      const potionItem = itemsData[potionId]
      if (potionItem) {
        boostedPlayerStats = applyPotionBonuses(boostedPlayerStats, potionItem) || boostedPlayerStats
      }
    }
  }

  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const weaponSpeed = getAttackSpeed(equipment, itemsData)
  const weaponStyle = getAttackStyle(equipment, itemsData)
  const monster = state.monster

  // Look up equipped weapon + scale-charge info for this tick
  const equippedWeaponEntry = equipment?.weapon
  const equippedWeapon = equippedWeaponEntry ? itemsData[equippedWeaponEntry.itemId] : null
  const weaponIsScaleCharged = !!equippedWeapon?.scaleCharged
  const weaponIsPoweredStaff = !!equippedWeapon?.poweredStaff
  const weaponCharges = equippedWeaponEntry?.charges || 0

  // ── Player Attack ──
  if (state.playerAttackTimer <= 0 && state.eatCooldown <= 0) {
    // Check if special attack is queued
    if (state.specialAttackQueued) {
      // Fire the special attack instead of normal attack
      const weaponEntry = equipment?.weapon
      if (weaponEntry) {
        const weapon = itemsData[weaponEntry.itemId]
        if (weapon?.specialAttack) {
          // Check if we still have enough energy before firing
          const currentEnergy = state.specialAttackEnergy || 0
          if (currentEnergy >= weapon.specialAttack.energyCost) {
            // Drain energy when special attack actually fires
            state.specialAttackEnergy = Math.max(0, currentEnergy - weapon.specialAttack.energyCost)
            // Check form immunity before firing (e.g. Demonic Gorilla)
            const specImmunity = getFormImmunity(monster)
            if (specImmunity && specImmunity === state.combatType) {
              // Energy drained but attack is fully blocked — consistent with normal spec early-return
              state.specialAttackQueued = false
              events.push({ type: 'immuneHit', immunity: specImmunity, monsterName: monster.name })
              let speed = weaponSpeed
              if (state.combatType === 'ranged' && state.stance === 'rapid') speed = Math.max(1, speed - 1)
              state.playerAttackTimer = speed
              state.monster = monster
              return { combatState: state, events }
            }
            const { combatState: newState, events: specEvents } = applySpecialAttack(state, playerStats, equipment, itemsData)
            // Merge events from special attack
            for (const ev of specEvents) {
              events.push(ev)
            }
            Object.assign(state, newState)
            state.specialAttackQueued = false
            // If a boss phase reset occurred, timers are already set — don't override them
            const hadPhaseReset = specEvents.some(ev => ev.type === 'bossPhaseReset')
            if (!hadPhaseReset) {
              let speed = weaponSpeed
              if (state.combatType === 'ranged' && state.stance === 'rapid') speed = Math.max(1, speed - 1)
              state.playerAttackTimer = speed
            }
            // Return if combat ended (death) or phase reset
            if (!state.active || state.monster.currentHP <= 0) {
              if (state.active && state.monster.currentHP <= 0) {
                checkMonsterDeath(state, state.monster, events)
              }
              return { combatState: state, events }
            }
            return { combatState: state, events }
          }
        }
      }
      // Clear queued flag if we can't fire for any reason
      state.specialAttackQueued = false
    }

    let damage = 0
    let xpSkills = {}

    if (state.combatType === 'melee') {
      // Scythe of vitur: requires charges for melee attacks
      if (equippedWeapon?.scaleCharged && equippedWeapon?.scythePassive) {
        if (weaponCharges <= 0) {
          events.push({ type: 'noCharges', itemId: equippedWeaponEntry.itemId })
          state.playerAttackTimer = weaponSpeed
          state.monster = monster
          return { combatState: state, events }
        }
      }

      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(boostedPlayerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(boostedPlayerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      damage = rollDamage(acc, maxHit)

      // Scythe of vitur passive: 3 hits at 100%, 50%, 25% max hit
      if (equippedWeapon?.scythePassive && damage > 0) {
        const hit2 = rollDamage(acc, Math.floor(maxHit * 0.5))
        const hit3 = rollDamage(acc, Math.floor(maxHit * 0.25))
        damage += hit2 + hit3
        events.push({ type: 'scythePassive', hits: [damage - hit2 - hit3, hit2, hit3] })
      }

      // Consume one charge per scythe swing
      if (equippedWeapon?.scaleCharged && equippedWeapon?.scythePassive) {
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

      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(boostedPlayerStats.ranged, 0, 1.0, styleBonus)
      let maxHit = rangedMaxHit(effRng, bonuses.otherBonus.rangedStrength)
      let atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)

      // Dragon Hunter Crossbow: +30% accuracy and damage vs dragon-type monsters
      if (equippedWeapon?.dragonHunter && monster.isDragon) {
        atkRoll = Math.floor(atkRoll * 1.3)
        maxHit = Math.floor(maxHit * 1.3)
      }

      // Twisted Bow: scales accuracy and damage with target's magic level (OSRS formula, capped at M=250)
      if (equippedWeapon?.scalesWithMagic) {
        const M = Math.min(250, Math.max(1, monster.stats?.magic || 1))
        const accInner = Math.floor(3 * M / 10) - 100
        const dmgInner = Math.floor(3 * M / 10) - 140
        const accMult = Math.min(140, Math.max(0, 140 + Math.floor((3 * M - 10) / 100) - Math.floor(accInner * accInner / 100))) / 100
        const dmgMult = Math.min(250, Math.max(0, 250 + Math.floor((3 * M - 14) / 100) - Math.floor(dmgInner * dmgInner / 100))) / 100
        atkRoll = Math.floor(atkRoll * accMult)
        maxHit = Math.floor(maxHit * dmgMult)
      }

      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      damage = rollDamage(acc, maxHit)

      if (weaponIsScaleCharged) {
        // Consume one scale charge per shot
        events.push({ type: 'consumeCharge', qty: 1 })
      } else {
        // Consume one bolt/arrow per shot
        const equippedAmmo = equipment && equipment.ammo
        if (equippedAmmo) {
          events.push({ type: 'consumeAmmo', itemId: equippedAmmo.itemId, qty: 1 })
        }
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
      const atkRoll = maxAttackRoll(effMag, bonuses.attackBonus.magic || 0)
      const defRoll = monsterMagicDefenceRoll(monster.stats.magic, monster.stats.defence, monster.defenceBonus.magic || 0)
      const acc = hitChance(atkRoll, defRoll)
      // Max hit scales with magic level: base at level 75, +1 per 3 levels above.
      // At 75 = 24, at 99 = 32, at 123 = 39 (matches OSRS trident formulas approx).
      const magicLevel = boostedPlayerStats.magic || 1
      const baseDamage = Math.max(1, Math.floor(magicLevel / 3) + 9)
      const maxHit = magicMaxHit(baseDamage, bonuses.otherBonus.magicDamage)
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
        const atkRoll = maxAttackRoll(effMag, bonuses.attackBonus.magic || 0)
        const defRoll = monsterMagicDefenceRoll(monster.stats.magic, monster.stats.defence, monster.defenceBonus.magic || 0)
        const acc = hitChance(atkRoll, defRoll)
        const maxHit = magicMaxHit(state.spell.baseDamage, bonuses.otherBonus.magicDamage)
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

    // ── Form Immunity Check (e.g. Demonic Gorilla) ──
    const formImmunity = getFormImmunity(monster)
    const isImmune = !!formImmunity && formImmunity === state.combatType
    if (isImmune) {
      damage = 0
      xpSkills = {}
    }

    const actualDamage = Math.min(damage, Math.max(0, monster.currentHP))
    monster.currentHP -= actualDamage
    if (isImmune) {
      events.push({ type: 'immuneHit', immunity: formImmunity, monsterName: monster.name })
    } else {
      events.push({ type: 'playerHit', damage: actualDamage, monsterHP: monster.currentHP })
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

    // Check monster death (handles double-kill bosses like Olm)
    if (monster.currentHP <= 0) {
      state.monster = monster
      const died = checkMonsterDeath(state, monster, events)
      if (died) return { combatState: state, events }
      // Boss regenerated — skip monster attack this tick, timers already set
      return { combatState: state, events }
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
      const monsterEffAtk = ((monster.stats.magic || monster.stats.attack || 1) + 9)
      const monsterAtkRoll = monsterEffAtk * ((monster.attackBonus || 0) + 64)
      const playerDefLevel = boostedPlayerStats.defence
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effDef = Math.floor(playerDefLevel) + styleBonuses.defenceStyleBonus + 8
      const defRoll = effDef * ((bonuses.defenceBonus[effectiveAttackStyle] || bonuses.defenceBonus.crush || 0) + 64)
      const acc = hitChance(monsterAtkRoll, defRoll)
      // Multi-form monsters may declare an explicit max hit per form
      const monsterMaxHit = monster.formMaxHit != null
        ? monster.formMaxHit
        : Math.floor(0.5 + (monster.stats.strength + 8) * ((monster.strengthBonus || 0) + 64) / 640)
      damage = rollDamage(acc, monsterMaxHit)

      // Apply protection prayer damage reduction if active and matches attack style
      if (state.activeProtectionPrayer && prayersData && typeof prayersData === 'object' && prayersData[state.activeProtectionPrayer]) {
        try {
          const prayer = prayersData[state.activeProtectionPrayer]
          if (prayer && prayer.bonusType === 'protection' && typeof prayer.damageReductionPercent === 'number') {
            if (protectionPrayerMatches(prayer.style, effectiveAttackStyle)) {
              const reduction = Math.floor(damage * prayer.damageReductionPercent / 100)
              damage = Math.max(0, damage - reduction)
            }
          }
        } catch (e) {
          // Silently fail if prayer application fails
        }
      }

      if (damage === 0 && acc < 1.0) {
        events.push({ type: 'monsterMiss', playerHP: playerStats.currentHP })
      } else {
        events.push({ type: 'monsterHit', damage, playerHP: playerStats.currentHP - damage })
      }
    }

    state.monsterAttackTimer = monster.attackSpeed || 4

    // ── Multi-form switch check (e.g. Zulrah) ──
    if (monster.multiForm && monster.forms) {
      monster.formAttackCount = (monster.formAttackCount || 0) + 1
      if (monster.formAttackCount >= (monster.formSwitchThreshold || 3)) {
        const previousForm = monster.currentForm
        const nextKey = pickNextForm(monster)
        const nextForm = monster.forms[nextKey]
        if (nextForm) {
          monster.currentForm = nextKey
          monster.attackStyle = nextForm.attackStyle
          monster.attackBonus = nextForm.attackBonus ?? monster.attackBonus
          monster.strengthBonus = nextForm.strengthBonus ?? monster.strengthBonus
          monster.defenceBonus = { ...nextForm.defenceBonus }
          monster.formMaxHit = nextForm.maxHit
          monster.formAttackCount = 0
          // For per-attack randomization, keep threshold at 1; otherwise randomize
          monster.formSwitchThreshold = monster.randomFormEveryAttack ? 1 : randomFormSwitchThreshold(monster)
          // Delay next attack by one cycle after a form change so the player can adapt
          state.monsterAttackTimer = (monster.attackSpeed || 4)
          events.push({
            type: 'formChange',
            previousForm,
            currentForm: nextKey,
            displayName: nextForm.displayName || nextKey,
            icon: nextForm.icon || '',
            attackStyle: nextForm.attackStyle,
            weakness: nextForm.weakness,
            immunity: nextForm.immunity,
            monsterName: monster.name
          })
        }
      }
    }
  }

  state.monster = monster
  return { combatState: state, events }
}

/**
 * Roll monster drops
 */
function rollDrops(monster) {
  if (!monster.drops) return []
  const loot = []
  const rolls = monster.dropRolls || 1
  for (const drop of monster.drops) {
    // Always drops (chance === 1.0) are rolled once regardless of dropRolls
    const timesToRoll = (drop.chance >= 1.0) ? 1 : rolls
    for (let r = 0; r < timesToRoll; r++) {
      if (Math.random() < drop.chance) {
        const qty = Array.isArray(drop.quantity)
          ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
          : drop.quantity
        loot.push({ itemId: drop.itemId, quantity: qty, ...(drop.noted ? { noted: true } : {}) })
      }
    }
  }
  return loot
}

/**
 * Roll raid rewards (always drops + unique chance with weighted selection).
 */
function rollRaidRewards(rewards) {
  if (!rewards) return []
  const loot = []
  // Roll always/standard drops
  if (rewards.always) {
    for (const drop of rewards.always) {
      if (Math.random() < drop.chance) {
        const qty = Array.isArray(drop.quantity)
          ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
          : drop.quantity
        loot.push({ itemId: drop.itemId, quantity: qty })
      }
    }
  }
  // Roll for a unique item
  if (rewards.unique && Math.random() < rewards.unique.chance) {
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
  // If no potion item or no boost, return unmodified stats
  if (!potionItem || !potionItem.boost) {
    return playerStats
  }

  try {
    const boostedStats = { ...playerStats }
    const effect = potionItem.effect

    if (effect === 'combat') {
      // Apply boost to all combat stats (melee + ranged + magic)
      boostedStats.attack = Math.floor(boostedStats.attack + potionItem.boost)
      boostedStats.strength = Math.floor(boostedStats.strength + potionItem.boost)
      boostedStats.defence = Math.floor(boostedStats.defence + potionItem.boost)
      boostedStats.ranged = Math.floor(boostedStats.ranged + potionItem.boost)
      boostedStats.magic = Math.floor(boostedStats.magic + potionItem.boost)
    } else if (effect === 'attack') {
      // Apply boost to attack only
      boostedStats.attack = Math.floor(boostedStats.attack + potionItem.boost)
    } else if (effect === 'strength') {
      // Apply boost to strength only
      boostedStats.strength = Math.floor(boostedStats.strength + potionItem.boost)
    } else if (effect === 'defence') {
      // Apply boost to defence only
      boostedStats.defence = Math.floor(boostedStats.defence + potionItem.boost)
    } else if (effect === 'ranged') {
      // Apply boost to ranged only
      boostedStats.ranged = Math.floor(boostedStats.ranged + potionItem.boost)
    } else if (effect === 'magic') {
      // Apply boost to magic only
      boostedStats.magic = Math.floor(boostedStats.magic + potionItem.boost)
    } else if (effect === 'hp') {
      // HP effect is handled in the drinking logic, not here
      // Return unmodified stats
      return playerStats
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
export function applySpecialAttack(combatState, playerStats, equipment, itemsData) {
  const weaponEntry = equipment?.weapon
  if (!weaponEntry) return { combatState, events: [] }
  const weapon = itemsData[weaponEntry.itemId]
  if (!weapon?.specialAttack) return { combatState, events: [] }
  const spec = weapon.specialAttack

  const state = {
    ...combatState,
    monster: { ...combatState.monster, defenceBonus: { ...combatState.monster.defenceBonus }, stats: { ...combatState.monster.stats } }
  }
  const events = []
  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const weaponStyle = getAttackStyle(equipment, itemsData)
  const monster = state.monster

  switch (spec.type) {
    case 'double_hit': {
      // Dragon Dagger — two hits at 115% max hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength) * 1.15)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const hits = [rollDamage(acc, maxHit), rollDamage(acc, maxHit)]
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
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(0, 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'zero_defence', monsterHP: monster.currentHP })
      break
    }

    case 'stun': {
      // Abyssal Whip — hit + if not miss, delay monster's next attack by 1 attack cycle
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const stunned = damage > 0
      if (stunned) state.monsterAttackTimer += (monster.attackSpeed || 4)
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'stun', stunned, monsterHP: monster.currentHP })
      break
    }

    case 'judgement': {
      // Armadyl Godsword — 125% accuracy + 125% max hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = Math.floor(meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength) * 1.25)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = Math.floor(maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0) * 1.25)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'judgement', monsterHP: monster.currentHP })
      break
    }

    case 'healing_blade': {
      // Saradomin Godsword — hit + heal 50% of damage (min 10 HP)
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const minHeal = spec.minHeal || 10
      const healAmount = Math.max(minHeal, Math.floor(actual / 2))
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'healing_blade', healAmount, monsterHP: monster.currentHP })
      break
    }

    case 'freeze': {
      // Zamorak Godsword — hit + freeze monster for stunTicks ticks
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      state.monsterAttackTimer += (spec.stunTicks || 33)
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'freeze', monsterHP: monster.currentHP })
      break
    }

    case 'warstrike': {
      // Bandos Godsword — hit + reduce monster defenceBonus by damage dealt
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      if (actual > 0) {
        for (const k of Object.keys(monster.defenceBonus)) {
          monster.defenceBonus[k] = Math.max(-64, monster.defenceBonus[k] - actual)
        }
      }
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'warstrike', monsterHP: monster.currentHP })
      break
    }

    case 'lightning': {
      // Saradomin Sword — normal melee hit + guaranteed magic lightning hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const meleeDmg = rollDamage(acc, maxHit)
      const lightningDmg = randInt(1, spec.lightningMax || 16)
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
      const maxHit = Math.floor(rangedMaxHit(effRng, bonuses.otherBonus.rangedStrength) * 0.75)
      const atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      const hits = [rollDamage(acc, maxHit), rollDamage(acc, maxHit)]
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
      // Armadyl Crossbow — guaranteed hit at 125% max hit
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(rangedMaxHit(effRng, bonuses.otherBonus.rangedStrength) * 1.25)
      const damage = randInt(1, Math.max(1, maxHit))
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'pebble_shot', monsterHP: monster.currentHP })
      break
    }

    case 'toxic_siphon': {
      // Toxic Blowpipe — guaranteed 150% max hit ranged attack, heals for half damage dealt.
      // Also consumes one scale charge (like a normal blowpipe shot).
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(playerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = Math.floor(rangedMaxHit(effRng, bonuses.otherBonus.rangedStrength) * 1.5)
      const damage = randInt(1, Math.max(1, maxHit))
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const healAmount = Math.floor(actual / 2)
      const xpSkills = { ranged: actual * RANGED_XP_PER_DAMAGE, hitpoints: Math.floor(actual * HP_XP_PER_DAMAGE) }
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'toxic_siphon', healAmount, monsterHP: monster.currentHP })
      // Consume one scale charge on spec — emit so the UI decrements charges.
      events.push({ type: 'consumeCharge', qty: 1 })
      break
    }

    case 'shove': {
      // Zamorak Spear — 175% accuracy + stun 2 monster attacks
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = Math.floor(maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0) * 1.75)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const damage = rollDamage(acc, maxHit)
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      state.monsterAttackTimer += (monster.attackSpeed || 4) * 2
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'shove', monsterHP: monster.currentHP })
      break
    }

    case 'slice_and_dice': {
      // Dragon Claws — four cascading hits: 100%, 50%, 25%, and 25% of max hit
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(playerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(playerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      const h1 = rollDamage(acc, maxHit)
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
      const actual = Math.min(damage, Math.max(0, monster.currentHP))
      monster.currentHP -= actual
      const xpSkills = _meleeXP(state.stance, actual)
      _accXP(state, xpSkills)
      events.push({ type: 'xp', xpSkills })
      events.push({ type: 'specialHit', hits: [damage], totalDamage: actual, specType: 'lunge', monsterHP: monster.currentHP })
      break
    }

    default:
      return { combatState, events: [] }
  }

  // Check monster death from special attack (handles double-kill bosses like Olm)
  if (monster.currentHP <= 0) {
    checkMonsterDeath(state, monster, events)
  }

  state.monster = monster
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
