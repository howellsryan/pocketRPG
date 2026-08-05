// A stand-in for the CoopBossRoom Durable Object, for the D1-level co-op tests.
//
// The room is where membership lives once a session is running (it holds the
// fight in memory and overwrites state_json on every checkpoint), so
// joinCoopSession asks it to admit a member rather than writing the blob
// itself. Before the Pages → Workers migration these tests ran with no
// COOP_ROOM binding at all and exercised a D1 fallback path that existed only
// for a Pages deploy that had landed ahead of the world Worker. One Worker
// exports the class, so that path is gone and the binding always exists — this
// fake is what the tests bind instead.
//
// It implements only `join`, because that is the one action the D1-level tests
// drive. The room's own behaviour is covered by tests/coopRaidRoom.test.ts,
// which runs the real class.
import { COOP_MAX_MEMBERS, addCoopMember, memberCount } from '../../src/engine/coopBossEngine.js'

type Raw = { prepare: (sql: string) => { get: (...args: unknown[]) => any; run: (...args: unknown[]) => unknown } }

/** A COOP_ROOM binding backed by the same fake D1 the test seeded. */
export function fakeCoopRoom(raw: Raw) {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      async fetch(url: string, init?: RequestInit) {
        const action = new URL(url).pathname.slice(1)
        const body = JSON.parse(String(init?.body ?? '{}'))
        if (action !== 'join') {
          return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 404 })
        }
        const row = raw.prepare('SELECT * FROM coop_boss_sessions WHERE id = ?').get(body.sessionId)
        if (!row || row.status !== 'active') {
          return new Response(JSON.stringify({ error: 'session_ended' }), { status: 404 })
        }
        const state = JSON.parse(row.state_json)
        if (memberCount(state) >= COOP_MAX_MEMBERS) {
          return new Response(JSON.stringify({ error: 'session_full' }), { status: 409 })
        }
        const next = addCoopMember(state, body.member)
        raw.prepare('UPDATE coop_boss_sessions SET state_json = ?, member_count = ? WHERE id = ?')
          .run(JSON.stringify(next), memberCount(next), row.id)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    }),
  }
}
