import { describe, expect, it } from 'vitest'
import { handleEditorRequest } from '../server/editor'
import type { Env } from '../server/env'
import type { ZoneDef } from '../shared/zone'

// Purpose-built in-memory D1 covering exactly the queries zoneStore.ts and
// editor.ts issue (dispatch on SQL substrings, like the grants test does).
function makeFakeDb() {
  const defs = new Map<string, { def_json: string; revision: number; updated_at: number }>()
  let revs: { id: number; zone_id: string; revision: number; def_json: string; created_at: number }[] = []
  const positions = new Map<number, { zone_id: string; x: number; z: number }>()
  let revId = 1

  function exec(sql: string, args: unknown[]) {
    if (sql.includes('INSERT INTO world_zone_defs')) {
      const [zoneId, def_json, revision, updated_at] = args as [string, string, number, number]
      defs.set(zoneId, { def_json, revision, updated_at })
    } else if (sql.includes('INSERT INTO world_zone_revisions')) {
      const [zone_id, revision, def_json, created_at] = args as [string, number, string, number]
      revs.push({ id: revId++, zone_id, revision, def_json, created_at })
    } else if (sql.includes('DELETE FROM world_zone_revisions WHERE zone_id = ? AND id NOT IN')) {
      const [zoneId, , limit] = args as [string, string, number]
      const keep = revs.filter((r) => r.zone_id === zoneId).sort((a, b) => b.revision - a.revision).slice(0, limit)
      const keepIds = new Set(keep.map((r) => r.id))
      revs = revs.filter((r) => r.zone_id !== zoneId || keepIds.has(r.id))
    } else if (sql.includes('DELETE FROM world_zone_defs')) {
      const [zoneId] = args as [string]
      const had = defs.delete(zoneId)
      return { meta: { changes: had ? 1 : 0 } }
    } else if (sql.includes('DELETE FROM world_zone_revisions WHERE zone_id = ?')) {
      const [zoneId] = args as [string]
      revs = revs.filter((r) => r.zone_id !== zoneId)
    } else if (sql.includes('INSERT INTO world_positions')) {
      const [characterId, zone_id, x, z] = args as [number, string, number, number]
      positions.set(characterId, { zone_id, x, z })
    }
    return { meta: { changes: 1 } }
  }

  function first(sql: string, args: unknown[]) {
    if (sql.includes('SELECT def_json FROM world_zone_defs')) {
      const row = defs.get(args[0] as string)
      return row ? { def_json: row.def_json } : null
    }
    if (sql.includes('SELECT revision FROM world_zone_defs')) {
      const row = defs.get(args[0] as string)
      return row ? { revision: row.revision } : null
    }
    if (sql.includes('SELECT def_json FROM world_zone_revisions')) {
      const [zoneId, revision] = args as [string, number]
      const row = revs.find((r) => r.zone_id === zoneId && r.revision === revision)
      return row ? { def_json: row.def_json } : null
    }
    return null
  }

  function all(sql: string, args: unknown[]) {
    if (sql.includes('SELECT zone_id, revision, updated_at FROM world_zone_defs')) {
      const results = [...defs.entries()]
        .map(([zone_id, r]) => ({ zone_id, revision: r.revision, updated_at: r.updated_at }))
        .sort((a, b) => a.zone_id.localeCompare(b.zone_id))
      return { results }
    }
    if (sql.includes('SELECT revision, created_at FROM world_zone_revisions')) {
      const results = revs
        .filter((r) => r.zone_id === args[0])
        .sort((a, b) => b.revision - a.revision)
        .map((r) => ({ revision: r.revision, created_at: r.created_at }))
      return { results }
    }
    return { results: [] }
  }

  function stmt(sql: string, args: unknown[] = []): any {
    return {
      bind: (...a: unknown[]) => stmt(sql, a),
      first: async () => first(sql, args),
      all: async () => all(sql, args),
      run: async () => exec(sql, args),
      _exec: () => exec(sql, args),
    }
  }

  const db = {
    prepare: (sql: string) => stmt(sql),
    batch: async (statements: { _exec: () => unknown }[]) => statements.map((s) => s._exec()),
  }
  return { db: db as unknown as D1Database, positions, defs }
}

function makeEnv(overrides: Partial<Env> = {}) {
  const { db, positions, defs } = makeFakeDb()
  const env = { DB: db, WORLD_EDITOR_TOKEN: 'secret', ...overrides } as unknown as Env
  return { env, positions, defs }
}

function req(method: string, body?: unknown, token: string | null = 'secret', origin?: string): Request {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (origin) headers.Origin = origin
  return new Request('https://world.example/api/world/editor', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function zone(id: string, extra: Partial<ZoneDef> = {}): ZoneDef {
  return {
    id,
    name: `Zone ${id}`,
    width: 5,
    height: 5,
    spawn: { x: 2, z: 2 },
    collision: ['.....', '.....', '.....', '.....', '.....'],
    objects: [],
    npcs: [],
    ...extra,
  }
}

describe('editor API auth', () => {
  it('503s when the editor token is unset', async () => {
    const { env } = makeEnv({ WORLD_EDITOR_TOKEN: undefined })
    const res = await handleEditorRequest(req('GET', undefined, 'secret'), env, '/zones')
    expect(res.status).toBe(503)
  })

  it('401s on a wrong bearer token', async () => {
    const { env } = makeEnv()
    const res = await handleEditorRequest(req('GET', undefined, 'wrong'), env, '/zones')
    expect(res.status).toBe(401)
  })

  it('tolerates a trailing newline in the stored secret (wrangler paste footgun)', async () => {
    const { env } = makeEnv({ WORLD_EDITOR_TOKEN: 'secret\n' })
    const res = await handleEditorRequest(req('GET', undefined, 'secret'), env, '/zones')
    expect(res.status).toBe(200)
  })

  it('answers a CORS preflight for a workers.dev origin', async () => {
    const { env } = makeEnv()
    const res = await handleEditorRequest(req('OPTIONS', undefined, null, 'https://x.preview.workers.dev'), env, '/zones')
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://x.preview.workers.dev')
  })
})

describe('editor API zones', () => {
  it('lists the bundled zones', async () => {
    const { env } = makeEnv()
    const res = await handleEditorRequest(req('GET'), env, '/zones')
    const body = (await res.json()) as { zones: { id: string; source: string }[] }
    const ids = body.zones.map((z) => z.id)
    expect(ids).toContain('overworld')
    expect(body.zones.find((z) => z.id === 'overworld')?.source).toBe('bundled')
  })

  it('saves a new zone, then serves it as stored', async () => {
    const { env } = makeEnv()
    const put = await handleEditorRequest(req('PUT', zone('newland')), env, '/zones/newland')
    expect(put.status).toBe(200)
    expect((await put.json()) as any).toMatchObject({ ok: true, revision: 1 })

    const list = (await (await handleEditorRequest(req('GET'), env, '/zones')).json()) as any
    expect(list.zones.find((z: any) => z.id === 'newland')?.source).toBe('stored')

    const get = (await (await handleEditorRequest(req('GET'), env, '/zones/newland')).json()) as any
    expect(get.def.id).toBe('newland')
    expect(get.source).toBe('stored')
  })

  it('rejects an invalid zone and stores nothing', async () => {
    const { env, defs } = makeEnv()
    const bad = zone('bad', { collision: ['....', '....'] }) // wrong dims
    const res = await handleEditorRequest(req('PUT', bad), env, '/zones/bad')
    expect(res.status).toBe(400)
    expect((await res.json()) as any).toHaveProperty('errors')
    expect(defs.has('bad')).toBe(false)
  })

  it('rejects a body id that does not match the path', async () => {
    const { env } = makeEnv()
    const res = await handleEditorRequest(req('PUT', zone('a')), env, '/zones/b')
    expect(res.status).toBe(400)
  })

  it('overrides a bundled zone and bumps the revision on re-save', async () => {
    const { env } = makeEnv()
    await handleEditorRequest(req('PUT', zone('overworld')), env, '/zones/overworld')
    const second = (await (await handleEditorRequest(req('PUT', zone('overworld')), env, '/zones/overworld')).json()) as any
    expect(second.revision).toBe(2)
    const list = (await (await handleEditorRequest(req('GET'), env, '/zones')).json()) as any
    expect(list.zones.find((z: any) => z.id === 'overworld')?.source).toBe('overridden')
  })

  it('rejects an exit to an unknown zone', async () => {
    const { env } = makeEnv()
    const withExit = zone('src', { exits: [{ id: 'e', x: 0, z: 0, toZone: 'ghost', toX: 2, toZ: 2, label: 'Ghost' }] })
    const res = await handleEditorRequest(req('PUT', withExit), env, '/zones/src')
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).errors[0]).toContain('unknown zone')
  })

  it('accepts an exit to a stored target zone', async () => {
    const { env } = makeEnv()
    await handleEditorRequest(req('PUT', zone('target')), env, '/zones/target')
    const src = zone('src', { exits: [{ id: 'e', x: 0, z: 0, toZone: 'target', toX: 2, toZ: 2, label: 'Target' }] })
    const res = await handleEditorRequest(req('PUT', src), env, '/zones/src')
    expect(res.status).toBe(200)
  })

  it('deletes a stored override and reverts to bundled', async () => {
    const { env } = makeEnv()
    await handleEditorRequest(req('PUT', zone('overworld')), env, '/zones/overworld')
    const del = await handleEditorRequest(req('DELETE'), env, '/zones/overworld')
    expect(del.status).toBe(200)
    expect((await del.json()) as any).toMatchObject({ ok: true, revertedToBundled: true })
    const list = (await (await handleEditorRequest(req('GET'), env, '/zones')).json()) as any
    expect(list.zones.find((z: any) => z.id === 'overworld')?.source).toBe('bundled')
  })

  it('404s deleting a zone with no stored override', async () => {
    const { env } = makeEnv()
    const res = await handleEditorRequest(req('DELETE'), env, '/zones/overworld')
    expect(res.status).toBe(404)
  })

  it('lists and restores revisions', async () => {
    const { env } = makeEnv()
    await handleEditorRequest(req('PUT', zone('r', { name: 'First' })), env, '/zones/r')
    await handleEditorRequest(req('PUT', zone('r', { name: 'Second' })), env, '/zones/r')
    const revs = (await (await handleEditorRequest(req('GET'), env, '/zones/r/revisions')).json()) as any
    expect(revs.revisions.map((x: any) => x.revision)).toEqual([2, 1])

    const restore = (await (await handleEditorRequest(req('POST', { revision: 1 }), env, '/zones/r/restore')).json()) as any
    expect(restore).toMatchObject({ ok: true, revision: 3, restoredFrom: 1 })
    const get = (await (await handleEditorRequest(req('GET'), env, '/zones/r')).json()) as any
    expect(get.def.name).toBe('First')
  })
})

describe('editor API teleport', () => {
  it('writes a world position for a walkable tile', async () => {
    const { env, positions } = makeEnv()
    await handleEditorRequest(req('PUT', zone('spot')), env, '/zones/spot')
    const res = await handleEditorRequest(req('POST', { characterId: 7, zone: 'spot', x: 2, z: 2 }), env, '/teleport')
    expect(res.status).toBe(200)
    expect(positions.get(7)).toMatchObject({ zone_id: 'spot', x: 2, z: 2 })
  })

  it('404s teleport to an unknown zone', async () => {
    const { env } = makeEnv()
    const res = await handleEditorRequest(req('POST', { characterId: 7, zone: 'ghost', x: 0, z: 0 }), env, '/teleport')
    expect(res.status).toBe(404)
  })

  it('400s teleport onto a blocked tile', async () => {
    const { env } = makeEnv()
    await handleEditorRequest(req('PUT', zone('walled', { spawn: { x: 0, z: 0 }, collision: ['.....', '.....', '..#..', '.....', '.....'] })), env, '/zones/walled')
    const res = await handleEditorRequest(req('POST', { characterId: 7, zone: 'walled', x: 2, z: 2 }), env, '/teleport')
    expect(res.status).toBe(400)
  })
})
