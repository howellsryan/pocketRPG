#!/usr/bin/env node
// Dev-only fixture: applies the repo's D1 migrations to a local Miniflare
// D1 database, inserts one identity + one character + one minimal save,
// and prints a #handoff=<jwt> URL for manual testing of `wrangler dev`.
// Refuses to run anywhere that looks like production.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.CF_PAGES || process.env.CLOUDFLARE_ENV) {
  console.error('dev-seed: refusing to run — CF_PAGES/CLOUDFLARE_ENV is set, this looks like production.')
  process.exit(1)
}

const worldDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = path.join(worldDir, '..')
const devVarsPath = path.join(worldDir, '.dev.vars')

function readJwtSecret() {
  try {
    const raw = readFileSync(devVarsPath, 'utf8')
    const match = /^JWT_SECRET=(.*)$/m.exec(raw)
    if (match) return match[1].trim()
  } catch {
    // fall through to the documented default
  }
  return 'dev-secret-change-me'
}

function runWrangler(args) {
  execFileSync('npx', ['wrangler', ...args], { cwd: worldDir, stdio: 'inherit' })
}

// `wrangler d1 migrations apply` (not a hand-rolled per-file replay) — it
// tracks already-applied migrations in a bookkeeping table, so re-running
// this script is safe even though several migrations use non-idempotent
// `ALTER TABLE ADD COLUMN`. `migrations_dir` in wrangler.jsonc points this
// at the repo-root `migrations/` folder shared with the main Pages project.
// `--env preview` is required now that pocketrpg-preview only exists inside
// wrangler.jsonc's env.preview block (D1 bindings aren't inherited from the
// top-level/production config) — this is local-only dev seeding, never prod.
console.log('dev-seed: applying migrations to local D1...')
runWrangler(['d1', 'migrations', 'apply', 'pocketrpg-preview', '--env', 'preview', '--local'])

const SKILL_IDS = [
  'mining', 'woodcutting', 'fishing', 'smithing', 'cooking', 'fletching', 'crafting',
  'herblore', 'agility', 'prayer', 'magic', 'thieving', 'firemaking', 'farming',
  'hunter', 'dungeoneering', 'runecraft',
]
const COMBAT_STAT_IDS = ['attack', 'strength', 'defence', 'ranged']

const stats = {}
for (const id of SKILL_IDS) stats[id] = { xp: 0, level: 1 }
for (const id of COMBAT_STAT_IDS) stats[id] = { xp: 0, level: 1 }
stats.hitpoints = { xp: 1154, level: 10 } // CLAUDE.md §5: starting HP level 10

const saveObject = { stats, inventory: [], bank: {}, settings: {} }
const saveData = JSON.stringify(saveObject)
const saveBlobHex = gzipSync(Buffer.from(saveData, 'utf8')).toString('hex')

const now = Date.now()
const escapedSaveData = saveData.replace(/'/g, "''")

const seedSql = `
DELETE FROM world_grants WHERE character_id = 1;
DELETE FROM audit_events WHERE character_id = 1;
DELETE FROM world_positions WHERE character_id = 1;
DELETE FROM saves WHERE character_id = 1;
DELETE FROM characters WHERE id = 1;
DELETE FROM oauth_identities WHERE id = 1;
INSERT INTO oauth_identities (id, provider, provider_user_id, email, display_name, created_at)
  VALUES (1, 'dev', 'dev-user', NULL, 'Dev Tester', ${now});
INSERT INTO characters (id, owner_id, username, created_at, deleted_at)
  VALUES (1, 1, 'WorldTester', ${now}, NULL);
INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision)
  VALUES (1, X'${saveBlobHex}', '${escapedSaveData}', ${now}, 1);
`.trim()

console.log('dev-seed: seeding identity + character + save...')
runWrangler(['d1', 'execute', 'pocketrpg-preview', '--env', 'preview', '--local', `--command=${seedSql}`])

const jwtSecret = readJwtSecret()
const { signJWT } = await import(path.join(repoRoot, 'functions', '_lib', 'jwt.js'))
const handoff = await signJWT({ sub: 1, character_id: 1, scope: 'world_handoff' }, jwtSecret, 60)

console.log('')
console.log('dev-seed: done. Start `npm run dev` (wrangler dev) then visit:')
console.log(`  http://localhost:8787/#handoff=${handoff}`)
console.log('(the handoff token expires in 60s — mint a fresh one by re-running this script if it goes stale)')
