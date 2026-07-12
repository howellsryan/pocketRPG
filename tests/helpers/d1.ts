// Real-schema D1 test double. Applies the actual migrations/*.sql to an
// in-memory SQLite (node:sqlite, zero extra deps) and exposes the subset of
// the Cloudflare D1 interface the Pages Functions use (prepare().bind().first()
// / .run() / .all(), and DB.batch()). Because it runs the endpoints' REAL SQL
// against the REAL schema, a statement typo or a column that a migration never
// added fails the test — the schema-drift tripwire the map-based fakes can't
// give (see docs/testing-strategy-review.md Phase C1).
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'


const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', '..', 'migrations')

function coerce(v: unknown) {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v as any
}

// One bound statement. D1 binds up front then runs; node:sqlite binds per call,
// so we stash the args and pass them through.
class BoundStatement {
  constructor(private db: DatabaseSync, private sql: string, private args: any[]) {}
  private stmt() { return this.db.prepare(this.sql) }
  async first(_col?: string) {
    const row = this.stmt().get(...this.args)
    if (row == null) return null
    const plain = { ...(row as any) }
    return _col ? plain[_col] : plain
  }
  async all() {
    const results = (this.stmt().all(...this.args) as any[]).map((r) => ({ ...r }))
    return { success: true, results, meta: { changes: 0 } }
  }
  async run() {
    const info = this.stmt().run(...this.args)
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
  }
}

class PreparedStatement {
  constructor(private db: DatabaseSync, private sql: string, private bound: any[] = []) {}
  bind(...args: any[]) { return new PreparedStatement(this.db, this.sql, args.map(coerce)) }
  private delegate() { return new BoundStatement(this.db, this.sql, this.bound) }
  first(col?: string) { return this.delegate().first(col) }
  all() { return this.delegate().all() }
  run() { return this.delegate().run() }
}

export class FakeD1 {
  db: DatabaseSync
  constructor(db: DatabaseSync) { this.db = db }
  prepare(sql: string) { return new PreparedStatement(this.db, sql) }
  async batch(statements: PreparedStatement[]) {
    // D1 batches run in an implicit transaction; approximate with one here.
    this.db.exec('BEGIN')
    try {
      const out: any[] = []
      for (const s of statements) out.push(await (s as any).run())
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
}

/** Apply every migrations/*.sql in filename order to a fresh in-memory DB. */
export function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=OFF')
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  return db
}

/** A migrated DB wrapped in the D1 shim, ready to hand to a handler as env.DB. */
export function makeD1(): { DB: FakeD1, raw: DatabaseSync } {
  const raw = migratedDb()
  return { DB: new FakeD1(raw), raw }
}
