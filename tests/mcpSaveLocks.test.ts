// Every MCP tool that reaches writeSave has to refuse while another system owns
// the character's save. The PvP lock was the only one wired up here, so a chat
// or MCP action taken during a group boss fight bumped the save revision and
// the room's write-back was then refused as diverged — costing the player that
// whole fight's XP and the supplies it had already eaten (§14, §20).
import { describe, it, expect, beforeEach } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import { assertCharacterFree } from '../functions/_lib/mcp/tools.js'
import { joinCoopSession } from '../functions/_lib/game/coopBoss.js'

const BOSS = 'corporeal_horror'
const QUEST = 'the_heart_of_shadows'

let env: { DB: FakeD1 }
let raw: any

async function seedCharacter(id: number) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, 1, ?, 0, 0, 0, 0, 0, 0, 700, 126, 0, 0)`,
  ).run(id, `player${id}`)
  const inventory = new Array(28).fill(null)
  const json = JSON.stringify({
    stats: {
      attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 13_034_431 },
      hitpoints: { xp: 13_034_431 }, ranged: { xp: 13_034_431 }, magic: { xp: 13_034_431 },
      prayer: { xp: 13_034_431 },
    },
    inventory,
    bank: {},
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
    player: { currentHP: 99 },
    completedQuests: [QUEST],
  })
  const blob = await gzipJsonString(json)
  raw.prepare(
    'INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 1)',
  ).run(id, blob, json)
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB }
  raw = d.raw
})

describe('assertCharacterFree', () => {
  it('allows a character nothing else owns', async () => {
    await seedCharacter(7)
    await expect(assertCharacterFree(env as never, 7)).resolves.toBeUndefined()
  })

  it('blocks a character in a live co-op boss fight', async () => {
    await seedCharacter(7)
    await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    await expect(assertCharacterFree(env as never, 7)).rejects.toThrow(/group boss fight/i)
  })

  it('blocks a character in an active PvP match', async () => {
    await seedCharacter(7)
    await seedCharacter(8)
    raw.prepare(
      `INSERT INTO pvp_matches (id, character_a, character_b, status, started_at, current_tick, state_json, last_tick_at)
       VALUES (1, 7, 8, 'active', 0, 0, '{}', ?)`,
    ).run(Date.now())
    raw.prepare('UPDATE characters SET active_match_id = 1 WHERE id IN (7, 8)').run()
    await expect(assertCharacterFree(env as never, 7)).rejects.toThrow(/PvP match/i)
  })

  it('lets the character through again once the co-op fight is over', async () => {
    await seedCharacter(7)
    await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'player7' })
    raw.prepare('UPDATE characters SET active_coop_session_id = NULL WHERE id = 7').run()
    await expect(assertCharacterFree(env as never, 7)).resolves.toBeUndefined()
  })
})
