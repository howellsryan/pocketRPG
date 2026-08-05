// Regression guards for the co-op integrity bugs (§14). Each test here fails
// against the pre-hardening code — they are the exploits, written down.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeD1, FakeD1 } from './helpers/d1'
import { fakeCoopRoom } from './helpers/coopRoom'
import { gzipJsonString } from '../functions/_lib/saveCodec.js'
import {
  coopBossRequirementFailure,
  isCoopSessionLive,
  isMemberSaveOwned,
  joinCoopSession,
  leaveCoopSession,
  parseSessionState,
  pruneCoopExhaust,
  shouldPruneCoopExhaust,
  readSession,
  settleCoopKill,
  sweepStaleCoopSessions,
  writeBackMember,
} from '../functions/_lib/game/coopBoss.js'
import { assertNotInCoopSession } from '../functions/_lib/game/coopBoss.js'

const BOSS = 'corporeal_horror'
const QUEST = 'the_heart_of_shadows'

let env: { DB: FakeD1; COOP_ROOM: ReturnType<typeof fakeCoopRoom> }
let raw: any

function baseSave(overrides: Record<string, unknown> = {}) {
  const inventory: any[] = new Array(28).fill(null)
  inventory[0] = { itemId: 'shark', quantity: 20 }
  return {
    stats: {
      attack: { xp: 13_034_431 }, strength: { xp: 13_034_431 }, defence: { xp: 13_034_431 },
      hitpoints: { xp: 13_034_431 }, ranged: { xp: 13_034_431 }, magic: { xp: 13_034_431 },
      prayer: { xp: 13_034_431 }, slayer: { xp: 13_034_431 },
    },
    inventory,
    bank: {},
    equipment: { weapon: { itemId: 'krylth_spear', quantity: 1 } },
    player: { currentHP: 99 },
    settings: { combatStance: 'aggressive' },
    completedQuests: [QUEST],
    ...overrides,
  }
}

async function seedCharacter(id: number, { ownerId = 1, save = baseSave() } = {}) {
  raw.prepare(
    `INSERT INTO characters (id, owner_id, username, created_at, is_ironman, is_one_life, credits, total_pvp_kills, credits_used, total_level, combat_level, is_bot, total_level_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 700, 126, 0, 0)`,
  ).run(id, ownerId, `player${id}`)
  const json = JSON.stringify(save)
  const blob = await gzipJsonString(json)
  raw.prepare(
    'INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision) VALUES (?, ?, ?, 0, 1)',
  ).run(id, blob, json)
}

function readSave(id: number) {
  return JSON.parse(raw.prepare('SELECT save_data FROM saves WHERE character_id = ?').get(id).save_data)
}

function revisionOf(id: number) {
  return raw.prepare('SELECT save_revision FROM saves WHERE character_id = ?').get(id).save_revision
}

/** Rewrites a save behind the room's back, exactly as /api/purchase or a
 * trading-post sale would if its co-op lock were missing. */
async function foreignWrite(id: number, mutate: (save: any) => void) {
  const save = readSave(id)
  mutate(save)
  const json = JSON.stringify(save)
  raw.prepare('UPDATE saves SET save_data = ?, save_blob = ?, save_revision = save_revision + 1 WHERE character_id = ?')
    .run(json, await gzipJsonString(json), id)
}

async function memberOf(sessionId: number, characterId: number) {
  return parseSessionState(await readSession(env as never, sessionId)).members[String(characterId)]
}

beforeEach(() => {
  const d = makeD1()
  env = { DB: d.DB, COOP_ROOM: fakeCoopRoom(d.raw) }
  raw = d.raw
})

describe('kill settlement is exactly-once', () => {
  const kill = (owner: number) => ({ ownerCharacterId: owner, contributors: [{ characterId: owner, damage: 2000 }] })

  it('grants a kill only once even when the same tick is settled twice', async () => {
    // The bug: settlement ran BEFORE the tick's optimistic-concurrency write,
    // so several members' polls each computed the same kill and a slightly late
    // one read the already-settled revision and granted the drop again.
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const session = { id: sessionId, boss_id: BOSS }
    const state = parseSessionState(await readSession(env as never, sessionId))

    vi.spyOn(Math, 'random').mockReturnValue(0)
    const first = await settleCoopKill(env as never, { session, state, kill: kill(7), killSeq: 1 })
    const second = await settleCoopKill(env as never, { session, state, kill: kill(7), killSeq: 1 })
    vi.restoreAllMocks()

    expect((second as any).replayed).toBe(true)
    const kc = raw.prepare("SELECT kill_count FROM kill_counts WHERE character_id = 7 AND source_id = ?").get(BOSS)
    expect(kc.kill_count).toBe(1)
    expect(second.granted).toEqual(first.granted)
  })

  it('settles a genuinely new kill under the next sequence number', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const session = { id: sessionId, boss_id: BOSS }

    await settleCoopKill(env as never, { session, state: parseSessionState(await readSession(env as never, sessionId)), kill: kill(7), killSeq: 1 })
    const state = parseSessionState(await readSession(env as never, sessionId))
    // The room's live member carries the revision the first settlement landed on.
    state.members['7'].saveRevision = revisionOf(7)
    await settleCoopKill(env as never, { session, state, kill: kill(7), killSeq: 2 })

    const kc = raw.prepare("SELECT kill_count FROM kill_counts WHERE character_id = 7 AND source_id = ?").get(BOSS)
    expect(kc.kill_count).toBe(2)
  })

  it('records one settlement row per kill sequence', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const session = { id: sessionId, boss_id: BOSS }
    const state = parseSessionState(await readSession(env as never, sessionId))
    for (let i = 0; i < 4; i++) await settleCoopKill(env as never, { session, state, kill: kill(7), killSeq: 1 })
    const rows = raw.prepare('SELECT COUNT(*) AS n FROM coop_kill_settlements WHERE session_id = ?').get(sessionId)
    expect(rows.n).toBe(1)
  })
})

describe('a save changed behind the room is never overwritten', () => {
  it('refuses the write-back rather than restoring the pre-fight pack', async () => {
    // The duplication: the room replays a join-time snapshot on write-back, so
    // selling the pack mid-session and then leaving handed the items straight
    // back while the coins stayed.
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    await foreignWrite(7, (save) => { save.inventory[0] = null; save.coins = 100_000 })

    const member = await memberOf(sessionId, 7)
    const result = await writeBackMember(env as never, { characterId: 7, identityId: 1, member, sessionId })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('diverged')
    const save = readSave(7)
    expect(save.inventory[0]).toBeNull()
    expect(save.coins).toBe(100_000)
  })

  it('releases the save lock even when it refuses the write', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    await foreignWrite(7, (save) => { save.coins = 1 })
    await writeBackMember(env as never, { characterId: 7, identityId: 1, member: await memberOf(sessionId, 7), sessionId })
    expect(await isCoopSessionLive(env as never, 7)).toBe(false)
  })

  it('refuses to grant a kill onto a diverged save', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    await foreignWrite(7, (save) => { save.inventory[0] = null })

    const state = parseSessionState(await readSession(env as never, sessionId))
    const out = await settleCoopKill(env as never, {
      session: { id: sessionId, boss_id: BOSS },
      state,
      kill: { ownerCharacterId: 7, contributors: [] },
      killSeq: 1,
    })

    expect((out as any).diverged).toBe(true)
    expect(out.granted).toEqual([])
    expect(readSave(7).inventory[0]).toBeNull()
  })

  it('writes back normally when nothing else touched the save', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const member = await memberOf(sessionId, 7)
    member.xpGained = { attack: 5_000 }
    member.inventory[0] = { itemId: 'shark', quantity: 3 }

    const result = await writeBackMember(env as never, { characterId: 7, identityId: 1, member, sessionId })

    expect(result.ok).toBe(true)
    const save = readSave(7)
    expect(save.inventory[0]).toEqual({ itemId: 'shark', quantity: 3 })
    expect(save.stats.attack.xp).toBe(13_039_431)
  })

  it('recognises ownership by the exact stamped revision', () => {
    expect(isMemberSaveOwned({ saveRevision: 4 }, 4)).toBe(true)
    expect(isMemberSaveOwned({ saveRevision: 4 }, 5)).toBe(false)
    // A member from before the stamp existed must fail closed, not be waved through.
    expect(isMemberSaveOwned({}, 0)).toBe(false)
  })
})

describe('boss requirements are enforced server-side', () => {
  it('refuses a boss whose Slayer requirement is unmet', () => {
    // Only the quest was checked server-side, so a crafted join walked into a
    // boss the player had not unlocked and collected its drop table.
    const save = baseSave({ stats: { ...baseSave().stats, slayer: { xp: 0 } } })
    const gate = coopBossRequirementFailure('deepmaw_kraken', save)
    expect(gate?.code).toBe('BOSS_REQUIREMENTS_NOT_MET')
    expect(gate?.message).toMatch(/Slayer level/)
  })

  it('refuses a boss gated behind a kill count the player has not reached', () => {
    expect(coopBossRequirementFailure('ashen_crucible', baseSave(), {})?.code).toBe('BOSS_REQUIREMENTS_NOT_MET')
  })

  it('allows the boss once the kill-count prerequisite is met', () => {
    expect(coopBossRequirementFailure('ashen_crucible', baseSave(), { ember_tyrant: 1 })).toBeNull()
  })

  it('ignores kill counts carried on the save blob', () => {
    // saveload.js strips bossKillCounts from every save on the way out — they
    // are server-authoritative in kill_counts. A gate that reads them off the
    // save sees {} forever, which locked players out of a boss they had every
    // kill for. Passing them here must NOT satisfy the gate.
    const save = baseSave({ bossKillCounts: { ember_tyrant: 99 } } as never)
    expect(coopBossRequirementFailure('ashen_crucible', save, {})?.code).toBe('BOSS_REQUIREMENTS_NOT_MET')
  })

  it('refuses the join outright, leaving no lock behind', async () => {
    await seedCharacter(7, { save: baseSave({ stats: { ...baseSave().stats, slayer: { xp: 0 } } }) })
    await expect(
      joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: 'deepmaw_kraken', username: 'p7' }),
    ).rejects.toMatchObject({ code: 'BOSS_REQUIREMENTS_NOT_MET' })
    const row = raw.prepare('SELECT active_coop_session_id FROM characters WHERE id = 7').get()
    expect(row.active_coop_session_id).toBeNull()
  })

  it('lets a fully-qualified character in', () => {
    expect(coopBossRequirementFailure(BOSS, baseSave())).toBeNull()
  })
})

describe('the save lock follows the member, not the room', () => {
  it('frees a crashed member while the fight carries on for everyone else', async () => {
    // The lockout: the lock keyed off the session's last tick, which any member
    // refreshed — so a player whose tab died stayed locked out of their own
    // save for as long as the others kept the room alive.
    await seedCharacter(7)
    await seedCharacter(8)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: BOSS, username: 'p8' })

    const now = Date.now()
    raw.prepare('UPDATE coop_boss_sessions SET last_tick_at = ? WHERE id = ?').run(now, sessionId)
    raw.prepare('UPDATE coop_session_members SET last_seen_at = ? WHERE session_id = ? AND character_id = 7').run(now - 200_000, sessionId)
    raw.prepare('UPDATE coop_session_members SET last_seen_at = ? WHERE session_id = ? AND character_id = 8').run(now, sessionId)

    expect(await isCoopSessionLive(env as never, 7)).toBe(false)
    expect(await isCoopSessionLive(env as never, 8)).toBe(true)
  })

  it('blocks every save-writing endpoint while the member is live', async () => {
    await seedCharacter(7)
    await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const refusal = await assertNotInCoopSession(env as never, 7)
    expect(refusal?.status).toBe(409)
    expect((await refusal!.json() as any).code).toBe('CHARACTER_IN_COOP_SESSION')
  })

  it('lets those endpoints through once the member is gone', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    await leaveCoopSession(env as never, { characterId: 7, identityId: 1, sessionId })
    expect(await assertNotInCoopSession(env as never, 7)).toBeNull()
  })
})

describe('a room reloading after eviction re-reads the durable facts', () => {
  it('keeps each member\'s own stored heartbeat, so a reload cannot revive a crashed member', async () => {
    // The room seeds its in-memory heartbeats from these rows on load. Seeding
    // them all as "seen now" would mean one live player's poll waking the room
    // silently re-locked a crashed player's save.
    await seedCharacter(7)
    await seedCharacter(8)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    await joinCoopSession(env as never, { characterId: 8, identityId: 1, bossId: BOSS, username: 'p8' })
    const stale = Date.now() - 200_000
    raw.prepare('UPDATE coop_session_members SET last_seen_at = ? WHERE session_id = ? AND character_id = 7').run(stale, sessionId)

    const rows = raw.prepare('SELECT character_id, last_seen_at FROM coop_session_members WHERE session_id = ? AND left_at IS NULL ORDER BY character_id').all(sessionId)
    expect(rows.map((r: any) => r.last_seen_at)).toEqual([stale, expect.any(Number)])
    expect(rows[1].last_seen_at).toBeGreaterThan(stale)
  })

  it('exposes the highest settled kill sequence, so a reload cannot burn the next grant', async () => {
    // killSeq is reloaded as max(session row, settlement ledger): a room evicted
    // between granting a kill and checkpointing would otherwise come back one
    // behind and lose the following kill's drop to a false replay.
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const state = parseSessionState(await readSession(env as never, sessionId))
    await settleCoopKill(env as never, {
      session: { id: sessionId, boss_id: BOSS }, state, kill: { ownerCharacterId: 7, contributors: [] }, killSeq: 3,
    })
    // The session row was never checkpointed with that sequence.
    expect((await readSession(env as never, sessionId)).kill_seq).toBe(0)
    const ledger = raw.prepare('SELECT MAX(kill_seq) AS seq FROM coop_kill_settlements WHERE session_id = ?').get(sessionId)
    expect(ledger.seq).toBe(3)
  })
})

describe('an abandoned room does not eat the XP earned in it', () => {
  it('banks a swept member\'s XP instead of discarding it', async () => {
    // The loss: the sweep released the lock without writing anybody back, so a
    // dropped connection cost the whole session's XP.
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const state = parseSessionState(await readSession(env as never, sessionId))
    state.members['7'].xpGained = { attack: 12_345 }
    raw.prepare('UPDATE coop_boss_sessions SET state_json = ?, last_tick_at = ? WHERE id = ?')
      .run(JSON.stringify(state), Date.now() - 200_000, sessionId)

    expect(await sweepStaleCoopSessions(env as never)).toBe(1)
    expect(readSave(7).stats.attack.xp).toBe(13_034_431 + 12_345)
    expect((await readSession(env as never, sessionId)).status).toBe('abandoned')
  })

  it('still releases the lock when the write-back is refused', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    await foreignWrite(7, (save) => { save.coins = 5 })
    raw.prepare('UPDATE coop_boss_sessions SET last_tick_at = ? WHERE id = ?').run(Date.now() - 200_000, sessionId)

    await sweepStaleCoopSessions(env as never)
    const row = raw.prepare('SELECT active_coop_session_id FROM characters WHERE id = 7').get()
    expect(row.active_coop_session_id).toBeNull()
  })
})

describe('finished fights do not accumulate forever', () => {
  it('drops the state blob and settlement ledger of long-ended sessions', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    const old = Date.now() - 48 * 60 * 60 * 1000
    raw.prepare("UPDATE coop_boss_sessions SET status = 'completed', ended_at = ? WHERE id = ?").run(old, sessionId)
    raw.prepare(
      'INSERT INTO coop_kill_settlements (session_id, kill_seq, character_id, boss_id, granted_json, settled_at) VALUES (?, 1, 7, ?, ?, ?)',
    ).run(sessionId, BOSS, '[]', old)

    await pruneCoopExhaust(env as never)

    expect(raw.prepare('SELECT COUNT(*) AS n FROM coop_kill_settlements').get().n).toBe(0)
    expect((await readSession(env as never, sessionId)).state_json).toBe('{}')
  })

  it('leaves a live session and its settlement ledger alone', async () => {
    await seedCharacter(7)
    const { sessionId } = await joinCoopSession(env as never, { characterId: 7, identityId: 1, bossId: BOSS, username: 'p7' })
    raw.prepare(
      'INSERT INTO coop_kill_settlements (session_id, kill_seq, character_id, boss_id, granted_json, settled_at) VALUES (?, 1, 7, ?, ?, ?)',
    ).run(sessionId, BOSS, '[]', Date.now())

    await pruneCoopExhaust(env as never)

    expect(raw.prepare('SELECT COUNT(*) AS n FROM coop_kill_settlements').get().n).toBe(1)
    expect((await readSession(env as never, sessionId)).state_json).not.toBe('{}')
  })

  it('is sampled rather than run on every picker request', () => {
    // The picker is opened on every boss tap and retention writes
    // unconditionally, so running it inline billed a scan-and-write to a read.
    expect(shouldPruneCoopExhaust(() => 0.01)).toBe(true)
    expect(shouldPruneCoopExhaust(() => 0.99)).toBe(false)
  })
})
