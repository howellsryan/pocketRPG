// Thin adapter around the REAL combat engine (src/engine/combat.js). No combat
// maths live here — createCombatState + processCombatTick own damage, accuracy,
// XP and drops; this file only drives one tick per zone tick, mirrors the
// monster HP onto the shared npc record, tracks the player's session HP, and
// funnels XP through the same grant pipeline mining uses. Contract pinned by
// world/tests/combat-adapter.test.ts.
import { createCombatState, processCombatTick } from '../../src/engine/combat.js'
import itemsData from '../../src/data/items.json'
import monstersData from '../../src/data/monsters.json'
import { adjacent, grantSessionXp, type TickPlayer } from './tick'
import { recordDamage, topDamageContributor, type NpcState } from './npc'
import type { TickContext, TickResult } from './tick'
import { spawnDrops } from './loot'

type EngineState = ReturnType<typeof createCombatState>
export type CombatSession = { npcId: string; state: EngineState }

const RESPAWN_TICKS = 25
const NPC_REMOVE_AFTER_DEATH_TICKS = 3

type Monsters = Record<string, Record<string, unknown>>

function playerStatsFor(player: TickPlayer): Record<string, number> {
  const lvl = (s: string) => player.stats[s]?.level ?? 1
  return {
    attack: lvl('attack'),
    strength: lvl('strength'),
    defence: lvl('defence'),
    ranged: lvl('ranged'),
    magic: lvl('magic'),
    hitpoints: player.maxHp,
    currentHP: player.hp,
    maxHP: player.maxHp,
  }
}

/** Begins a fight between the player and an npc. The engine state seeds from the
 * npc's CURRENT hp (a bull half-killed by an abandoned fight resumes there, not
 * at full), while `hitpoints` stays the true max. */
export function startCombat(player: TickPlayer, npc: NpcState): void {
  const monster = (monstersData as Monsters)[npc.monsterId]
  if (!monster) return
  const state = createCombatState(monster, 'melee', 'accurate')
  state.monster.currentHP = npc.hp
  player.combat = { npcId: npc.id, state }
  npc.state = 'combat'
  if (!npc.attackerId) npc.attackerId = player.charId
}

function killNpc(player: TickPlayer, npc: NpcState, loot: { itemId: string; quantity: number }[], ctx: TickContext, result: TickResult): void {
  npc.state = 'dead'
  npc.anim = 'die'
  npc.hp = 0
  npc.attackerId = null
  npc.respawnAtTick = ctx.tick + RESPAWN_TICKS
  npc.removeAtTick = ctx.tick + NPC_REMOVE_AFTER_DEATH_TICKS
  player.combat = null
  player.anim = 'idle'
  const owner = topDamageContributor(npc) ?? player.charId
  npc.damageByChar.clear()
  result.newLoot.push(...spawnDrops(loot, npc.x, npc.z, owner, ctx.tick))
  result.npcChanged.push(npc.id)
}

/** Advances one active combat tick for a player. Movement/cancel clears
 * `player.combat` upstream, so reaching here means the player intends to fight.
 * Ends the fight (bull returns toward idle) if the player is no longer adjacent. */
export function stepCombat(player: TickPlayer, ctx: TickContext, result: TickResult): void {
  const combat = player.combat
  if (!combat) return
  const npc = ctx.npcs?.get(combat.npcId)
  if (!npc || npc.state === 'dead') {
    player.combat = null
    player.anim = 'idle'
    return
  }
  if (!adjacent(player, npc)) {
    player.combat = null
    if (npc.attackerId === player.charId) npc.attackerId = null
    player.anim = 'idle'
    return
  }

  // Shared monster HP: each attacker runs their own engine session, so sync the
  // session's monster HP from the shared record before the tick (players tick
  // sequentially, so concurrent damage serializes) — and claim the retaliation
  // target if it's vacant. Only the target's session applies monster attacks;
  // other sessions discard them or the npc would swing once per attacker.
  combat.state.monster.currentHP = npc.hp
  if (!npc.attackerId) npc.attackerId = player.charId
  const isTarget = npc.attackerId === player.charId

  const { combatState, events } = processCombatTick(combat.state, playerStatsFor(player), player.equipment, itemsData, {}, [], null)
  combat.state = combatState
  player.anim = 'attack'
  npc.state = 'combat'
  npc.lastCombatTick = ctx.tick
  result.npcChanged.push(npc.id)

  for (const ev of events as { type: string; damage?: number; loot?: { itemId: string; quantity: number }[]; xpSkills?: Record<string, number> }[]) {
    if (ev.type === 'playerHit') {
      npc.hp = Math.max(0, combatState.monster.currentHP)
      recordDamage(npc, player.charId, ev.damage ?? 0, ctx.tick)
      result.hits.push({ targetId: npc.id, dmg: ev.damage ?? 0 })
    } else if (ev.type === 'monsterHit' || ev.type === 'dragonfireHit') {
      if (!isTarget) continue
      player.hp = Math.max(0, player.hp - (ev.damage ?? 0))
      result.hits.push({ targetId: player.charId, dmg: ev.damage ?? 0 })
    } else if (ev.type === 'monsterMiss') {
      if (!isTarget) continue
      result.hits.push({ targetId: player.charId, dmg: 0 })
    } else if (ev.type === 'xp' && ev.xpSkills) {
      for (const [skill, amount] of Object.entries(ev.xpSkills)) {
        if (amount) result.events.push(...grantSessionXp(player, skill, Math.floor(amount)))
      }
    } else if (ev.type === 'monsterDeath') {
      killNpc(player, npc, ev.loot ?? [], ctx, result)
    }
  }

  if (player.hp <= 0) {
    player.combat = null
    if (npc.attackerId === player.charId) npc.attackerId = null
    result.died = true
  }
}
