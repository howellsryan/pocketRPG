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
// Modest melee stats so the Phase 2 bull fight resolves quickly in manual/e2e
// testing (level 1 unarmed takes ~40s to grind through 8 HP).
stats.attack = { xp: 4470, level: 20 }
stats.strength = { xp: 4470, level: 20 }
stats.defence = { xp: 4470, level: 20 }

// Pack fixture: ore (inventory pull-through + Phase 7 smelting), raw beef
// (Phase 7 cooking), food + bones (invAction eat/bury), a spare weapon (equip
// swap). Bank fixture exercises withdraw.
const inventory = [
  ...Array.from({ length: 5 }, () => ({ itemId: 'tin_ore', quantity: 1 })),
  ...Array.from({ length: 3 }, () => ({ itemId: 'copper_ore', quantity: 1 })),
  { itemId: 'raw_beef', quantity: 1 },
  { itemId: 'trout', quantity: 1 },
  { itemId: 'trout', quantity: 1 },
  { itemId: 'bones', quantity: 1 },
  { itemId: 'bronze_sword', quantity: 1 },
  // Strike-spell runes so char 2's magic_staff can actually cast in tests.
  { itemId: 'air_rune', quantity: 100 },
  { itemId: 'mind_rune', quantity: 100 },
]
const bank = { trout: { itemId: 'trout', quantity: 5 }, copper_ore: { itemId: 'copper_ore', quantity: 7 } }
// Distinct equipped weapons exercise the Phase 5 gear pipeline: char 1 a
// tier-tinted sword, char 2 a staff (and each sees the other's on screen).
const makeSave = (weaponItemId) => {
  const saveObject = { stats, inventory, bank, settings: {}, equipment: { weapon: { itemId: weaponItemId, quantity: 1 } } }
  const saveData = JSON.stringify(saveObject)
  return { saveData, saveBlobHex: gzipSync(Buffer.from(saveData, 'utf8')).toString('hex') }
}
const save1 = makeSave('runeforged_scimitar')
const save2 = makeSave('magic_staff')

const now = Date.now()
const escaped1 = save1.saveData.replace(/'/g, "''")
const escaped2 = save2.saveData.replace(/'/g, "''")

const seedSql = `
DELETE FROM world_grants WHERE character_id IN (1, 2);
DELETE FROM audit_events WHERE character_id IN (1, 2);
DELETE FROM world_positions WHERE character_id IN (1, 2);
DELETE FROM saves WHERE character_id IN (1, 2);
DELETE FROM characters WHERE id IN (1, 2);
DELETE FROM oauth_identities WHERE id IN (1, 2);
INSERT INTO oauth_identities (id, provider, provider_user_id, email, display_name, created_at)
  VALUES (1, 'dev', 'dev-user', NULL, 'Dev Tester', ${now});
INSERT INTO characters (id, owner_id, username, created_at, deleted_at)
  VALUES (1, 1, 'WorldTester', ${now}, NULL);
INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision)
  VALUES (1, X'${save1.saveBlobHex}', '${escaped1}', ${now}, 1);
INSERT INTO oauth_identities (id, provider, provider_user_id, email, display_name, created_at)
  VALUES (2, 'dev', 'dev-user-2', NULL, 'Dev Tester 2', ${now});
INSERT INTO characters (id, owner_id, username, created_at, deleted_at)
  VALUES (2, 2, 'WorldFriend', ${now}, NULL);
INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision)
  VALUES (2, X'${save2.saveBlobHex}', '${escaped2}', ${now}, 1);
`.trim()

console.log('dev-seed: seeding identity + character + save...')
runWrangler(['d1', 'execute', 'pocketrpg-preview', '--env', 'preview', '--local', `--command=${seedSql}`])

const jwtSecret = readJwtSecret()
const { signJWT } = await import(path.join(repoRoot, 'functions', '_lib', 'jwt.js'))
const handoff = await signJWT({ sub: 1, character_id: 1, scope: 'world_handoff' }, jwtSecret, 60)
const handoff2 = await signJWT({ sub: 2, character_id: 2, scope: 'world_handoff' }, jwtSecret, 60)

console.log('')
console.log('dev-seed: done. Start `npm run dev` (wrangler dev) then visit:')
console.log(`  http://localhost:8787/#handoff=${handoff}`)
console.log(`second character (presence testing): http://localhost:8787/#handoff=${handoff2}`)
console.log('(the handoff tokens expire in 60s — mint fresh ones by re-running this script if they go stale)')
