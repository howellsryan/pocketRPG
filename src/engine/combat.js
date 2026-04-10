import {
  effectiveStrength, meleeMaxHit, effectiveAttack, maxAttackRoll,
  maxDefenceRoll, hitChance, rollDamage, getMeleeStyleBonuses,
  getMeleeXPSkill, effectiveRanged, rangedMaxHit, getRangedStyleBonus,
  effectiveMagic, monsterMagicDefenceRoll, magicMaxHit
} from './formulas.js'
import { getEquipmentBonuses, getAttackSpeed, getAttackStyle } from './equipment.js'
import { getLevelFromXP } from './experience.js'
import { MELEE_XP_PER_DAMAGE, RANGED_XP_PER_DAMAGE, MAGIC_XP_PER_DAMAGE, HP_XP_PER_DAMAGE, EAT_TICK_COST } from '../utils/constants.js'
import { randInt } from '../utils/helpers.js'

/**
 * Create a new combat state
 */
export function createCombatState(monster, combatType = 'melee', stance = 'accurate', spell = null) {
  return {
    active: true,
    monster: { ...monster, currentHP: monster.hitpoints },
    combatType,      // 'melee', 'ranged', 'magic'
    stance,          // 'accurate', 'aggressive', 'controlled', 'defensive', 'rapid', 'longrange'
    spell,           // spell object for magic combat
    playerAttackTimer: 0,
    monsterAttackTimer: 0,
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
    activePotion: null,            // active potion item ID
    activePotionStartTick: 0,      // tick when potion was applied
    potionDuration: 0              // duration in ticks remaining for active potion
  }
}

/**
 * Process one combat tick.
 * Returns { combatState, events[] }
 * events: { type: 'playerHit'|'monsterHit'|'monsterDeath'|'playerDeath'|'xp'|'levelUp', ... }
 */
export function processCombatTick(combatState, playerStats, equipment, itemsData, prayersData = {}) {
  const state = { ...combatState }
  const events = []
  state.tickCount++

  // Decrement cooldowns
  if (state.playerAttackTimer > 0) state.playerAttackTimer--
  if (state.monsterAttackTimer > 0) state.monsterAttackTimer--
  if (state.eatCooldown > 0) state.eatCooldown--
  if (state.potionCooldown > 0) state.potionCooldown--

  // Decrement potion duration
  if (state.potionDuration > 0) state.potionDuration--
  if (state.potionDuration <= 0) state.activePotion = null

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

  // Apply potion bonuses to player stats
  if (state.activePotion && itemsData && typeof itemsData === 'object') {
    const potionItem = itemsData[state.activePotion]
    if (potionItem) {
      boostedPlayerStats = applyPotionBonuses(boostedPlayerStats, potionItem) || boostedPlayerStats
    }
  }

  const bonuses = getEquipmentBonuses(equipment, itemsData)
  const weaponSpeed = getAttackSpeed(equipment, itemsData)
  const weaponStyle = getAttackStyle(equipment, itemsData)
  const monster = state.monster

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
            const { combatState: newState, events: specEvents } = applySpecialAttack(state, playerStats, equipment, itemsData)
            // Merge events from special attack
            for (const ev of specEvents) {
              events.push(ev)
            }
            Object.assign(state, newState)
            state.specialAttackQueued = false
            // Reset attack timer for next action
            let speed = weaponSpeed
            if (state.combatType === 'ranged' && state.stance === 'rapid') speed = Math.max(1, speed - 1)
            state.playerAttackTimer = speed
            // Check monster death
            if (state.monster.currentHP <= 0) {
              state.monster.currentHP = 0
              state.active = false
              state.specialAttackEnergy = 100
              state.loot = rollDrops(state.monster)
              events.push({ type: 'monsterDeath', loot: state.loot, xpGained: { ...state.xpGained } })
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
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effStr = effectiveStrength(boostedPlayerStats.strength, 0, 1.0, styleBonuses.strengthStyleBonus)
      const maxHit = meleeMaxHit(effStr, bonuses.otherBonus.meleeStrength)
      const effAtk = effectiveAttack(boostedPlayerStats.attack, 0, 1.0, styleBonuses.attackStyleBonus)
      const atkRoll = maxAttackRoll(effAtk, bonuses.attackBonus[weaponStyle] || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus[weaponStyle] || 0)
      const acc = hitChance(atkRoll, defRoll)
      damage = rollDamage(acc, maxHit)

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
      const styleBonus = getRangedStyleBonus(state.stance)
      const effRng = effectiveRanged(boostedPlayerStats.ranged, 0, 1.0, styleBonus)
      const maxHit = rangedMaxHit(effRng, bonuses.otherBonus.rangedStrength)
      const atkRoll = maxAttackRoll(effRng, bonuses.attackBonus.ranged || 0)
      const defRoll = maxDefenceRoll(monster.stats.defence, monster.defenceBonus.ranged || 0)
      const acc = hitChance(atkRoll, defRoll)
      damage = rollDamage(acc, maxHit)

      // Consume one bolt/arrow per shot
      const equippedAmmo = equipment && equipment.ammo
      if (equippedAmmo) {
        events.push({ type: 'consumeAmmo', itemId: equippedAmmo.itemId, qty: 1 })
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
    } else if (state.combatType === 'magic' && state.spell) {
      const effMag = effectiveMagic(boostedPlayerStats.magic)
      const atkRoll = maxAttackRoll(effMag, bonuses.attackBonus.magic || 0)
      const defRoll = monsterMagicDefenceRoll(monster.stats.magic, monster.stats.defence, monster.defenceBonus.magic || 0)
      const acc = hitChance(atkRoll, defRoll)
      const maxHit = magicMaxHit(state.spell.baseDamage, bonuses.otherBonus.magicDamage)
      damage = rollDamage(acc, maxHit)

      // Magic always grants base spell XP on cast
      xpSkills.magic = (state.spell.baseXP || 0)
      if (damage > 0) {
        xpSkills.magic += damage * MAGIC_XP_PER_DAMAGE
        xpSkills.hitpoints = Math.floor(damage * HP_XP_PER_DAMAGE)
      }
    }

    const actualDamage = Math.min(damage, Math.max(0, monster.currentHP))
    monster.currentHP -= actualDamage
    events.push({ type: 'playerHit', damage: actualDamage, monsterHP: monster.currentHP })

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

    // Check monster death
    if (monster.currentHP <= 0) {
      monster.currentHP = 0
      state.active = false
      state.specialAttackEnergy = 100  // regenerate spec bar on kill
      // Roll drops
      state.loot = rollDrops(monster)
      events.push({ type: 'monsterDeath', loot: state.loot, xpGained: { ...state.xpGained } })
      return { combatState: state, events }
    }
  }

  // ── Monster Attack ──
  if (state.monsterAttackTimer <= 0) {
    let damage = 0

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
      const monsterEffAtk = (monster.stats.attack + 9)
      const monsterAtkRoll = monsterEffAtk * ((monster.attackBonus || 0) + 64)
      const playerDefLevel = boostedPlayerStats.defence
      const styleBonuses = getMeleeStyleBonuses(state.stance)
      const effDef = Math.floor(playerDefLevel) + styleBonuses.defenceStyleBonus + 8
      const defRoll = effDef * ((bonuses.defenceBonus[monster.attackStyle] || bonuses.defenceBonus.crush || 0) + 64)
      const acc = hitChance(monsterAtkRoll, defRoll)
      const monsterMaxHit = Math.floor(0.5 + (monster.stats.strength + 8) * ((monster.strengthBonus || 0) + 64) / 640)
      damage = rollDamage(acc, monsterMaxHit)

      // Apply protection prayer damage reduction if active and matches attack style
      if (state.activeProtectionPrayer && prayersData && typeof prayersData === 'object' && prayersData[state.activeProtectionPrayer]) {
        try {
          const prayer = prayersData[state.activeProtectionPrayer]
          if (prayer && prayer.bonusType === 'protection' && typeof prayer.damageReductionPercent === 'number') {
            if (protectionPrayerMatches(prayer.style, monster.attackStyle)) {
              const reduction = Math.floor(damage * prayer.damageReductionPercent / 100)
              damage = Math.max(0, damage - reduction)
            }
          }
        } catch (e) {
          // Silently fail if prayer application fails
        }
      }

      events.push({ type: 'monsterHit', damage, playerHP: playerStats.currentHP - damage })
    }

    state.monsterAttackTimer = monster.attackSpeed || 4
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
  for (const drop of monster.drops) {
    if (Math.random() < drop.chance) {
      const qty = Array.isArray(drop.quantity)
        ? Math.floor(Math.random() * (drop.quantity[1] - drop.quantity[0] + 1)) + drop.quantity[0]
        : drop.quantity
      loot.push({ itemId: drop.itemId, quantity: qty })
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

    default:
      return { combatState, events: [] }
  }

  // Check monster death from special attack
  if (monster.currentHP <= 0) {
    monster.currentHP = 0
    state.active = false
    state.specialAttackEnergy = 100
    state.loot = rollDrops(monster)
    events.push({ type: 'monsterDeath', loot: state.loot, xpGained: { ...state.xpGained } })
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
