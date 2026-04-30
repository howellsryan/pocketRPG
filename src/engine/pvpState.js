export function normalizePvpState(rawState) {
  if (typeof rawState === 'string') {
    try {
      rawState = JSON.parse(rawState)
    } catch {
      return null
    }
  }
  if (!rawState || typeof rawState !== 'object') return null

  const rawCombatants = parseMaybeJson(rawState.combatants)
  const combatants = {}

  if (Array.isArray(rawCombatants)) {
    for (const entry of rawCombatants) {
      const normalized = normalizeCombatant(entry)
      if (!normalized) continue
      combatants[String(normalized.characterId)] = normalized
    }
  } else if (rawCombatants && typeof rawCombatants === 'object') {
    for (const entry of Object.values(rawCombatants)) {
      const normalized = normalizeCombatant(entry)
      if (!normalized) continue
      combatants[String(normalized.characterId)] = normalized
    }
  }

  return {
    ...rawState,
    tick: Number.isFinite(Number(rawState.tick)) ? Number(rawState.tick) : 0,
    recentEvents: Array.isArray(rawState.recentEvents)
      ? rawState.recentEvents
      : Array.isArray(rawState.recent_events)
        ? rawState.recent_events
        : [],
    combatants,
  }
}

function normalizeCombatant(rawCombatant) {
  rawCombatant = parseMaybeJson(rawCombatant)
  if (!rawCombatant || typeof rawCombatant !== 'object') return null
  const characterId = Number(rawCombatant.characterId ?? rawCombatant.character_id)
  if (!Number.isFinite(characterId) || characterId <= 0) return null

  const normalizedInventory = normalizeInventory(parseMaybeJson(rawCombatant.inventory))
  const maxHP = readPositiveInt(
    rawCombatant.maxHP,
    rawCombatant.max_hp,
    rawCombatant.player?.maxHP,
    rawCombatant.player?.max_hp,
    rawCombatant.stats?.hitpoints,
    rawCombatant.currentHP,
    rawCombatant.current_hp,
    10,
  )
  const hp = readPositiveInt(
    rawCombatant.hp,
    rawCombatant.currentHP,
    rawCombatant.current_hp,
    rawCombatant.player?.currentHP,
    rawCombatant.player?.current_hp,
    maxHP,
  )

  return {
    ...rawCombatant,
    characterId,
    maxHP,
    hp,
    specialAttackEnergy: Number(rawCombatant.specialAttackEnergy ?? rawCombatant.special_attack_energy ?? 0) || 0,
    totalPvpKills: readPvpStateNonNegativeInt(rawCombatant.totalPvpKills, rawCombatant.total_pvp_kills),
    lastUpdatedTotalPvpKills: readPvpStateNullablePositiveInt(
      rawCombatant.lastUpdatedTotalPvpKills,
      rawCombatant.last_updated_total_pvp_kills,
    ),
    pvpRank: readPvpStateNullablePositiveInt(rawCombatant.pvpRank, rawCombatant.pvp_rank),
    inventory: normalizedInventory,
  }
}

function normalizeInventory(rawInventory) {
  if (Array.isArray(rawInventory)) {
    return rawInventory.map(normalizeSlot)
  }
  if (!rawInventory || typeof rawInventory !== 'object') return []
  return Object.values(rawInventory).map(normalizeSlot)
}

function normalizeSlot(rawSlot) {
  rawSlot = parseMaybeJson(rawSlot)
  if (!rawSlot || typeof rawSlot !== 'object') return null
  const itemId = rawSlot.itemId ?? rawSlot.item_id
  if (!itemId) return null
  const quantity = Number(rawSlot.quantity)
  return {
    ...rawSlot,
    itemId,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
  }
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function readPositiveInt(...values) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return 1
}

function readPvpStateNonNegativeInt(...values) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed)
  }
  return 0
}

function readPvpStateNullablePositiveInt(...values) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return null
}
