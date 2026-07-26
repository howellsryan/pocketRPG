#!/usr/bin/env node
// Add an item to a character's inventory inside their cloud save.
//
// The save is a gzipped JSON blob in D1 (`saves.save_blob`, mirrored as text in
// `saves.save_data`). This reads that row through wrangler, gunzips it, appends
// to `save.inventory` only, re-gzips and writes it back under a save_revision
// guard so a concurrent client save can never be clobbered.
//
// Usage:
//   node scripts/grant-save-item.mjs --env preview --character 12 --item dragon_scimitar --qty 1
//   node scripts/grant-save-item.mjs            # fully interactive
//
// Flags: --env prod|preview  --character <id>  --item <id|name>  --qty <n>
//        --noted  --db <name>  --dry-run  --yes  --no-backup
//
// Needs wrangler auth: `wrangler login`, or CLOUDFLARE_API_TOKEN +
// CLOUDFLARE_ACCOUNT_ID in the environment.

import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  INVENTORY_SLOTS,
  addItemToSaveInventory,
  buildUpdateSql,
  countInInventory,
  readInventory,
  resolveItem,
  toHexLiteral,
} from './lib/saveItemGrant.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const itemsData = JSON.parse(readFileSync(resolve(ROOT, 'src/data/items.json'), 'utf8'))

const DATABASES = { prod: 'pocketrpg', preview: 'pocketrpg-preview' }

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}

function parseArgs(argv) {
  const out = { qty: null, noted: false, dryRun: false, yes: false, backup: true }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--env') out.env = next()
    else if (a === '--character' || a === '--character-id' || a === '-c') out.character = next()
    else if (a === '--item' || a === '-i') out.item = next()
    else if (a === '--qty' || a === '-q') out.qty = next()
    else if (a === '--db') out.db = next()
    else if (a === '--noted') out.noted = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--yes' || a === '-y') out.yes = true
    else if (a === '--no-backup') out.backup = false
    else if (a === '--help' || a === '-h') out.help = true
    else die(`Unknown argument: ${a}`)
  }
  return out
}

function die(msg) {
  console.error(C.red(`\n✗ ${msg}\n`))
  process.exit(1)
}

let rl = null
async function ask(question, { silentIfNonTty = false } = {}) {
  if (!process.stdin.isTTY) {
    if (silentIfNonTty) return ''
    die(`Need "${question}" but stdin is not a TTY — pass it as a flag instead.`)
  }
  if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout })
  return (await rl.question(question)).trim()
}

// wrangler prints warnings and banners around its JSON. Take the first
// balanced JSON value in the output rather than trusting the whole stream.
function extractJson(stdout) {
  const start = stdout.search(/[[{]/)
  if (start === -1) throw new Error(`No JSON in wrangler output:\n${stdout}`)
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < stdout.length; i += 1) {
    const ch = stdout[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth += 1
    else if (ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(stdout.slice(start, i + 1))
    }
  }
  throw new Error(`Truncated JSON in wrangler output:\n${stdout.slice(0, 400)}…`)
}

function d1(db, sql) {
  const bin = process.env.WRANGLER_BIN || 'npx'
  const argv = bin === 'npx' ? ['wrangler'] : []
  let stdout
  try {
    stdout = execFileSync(
      bin,
      [...argv, 'd1', 'execute', db, '--remote', '--json', '--command', sql],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_yes: 'true' },
      },
    )
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    die(`wrangler d1 execute failed against "${db}".\n${detail || err.message}\n\nCheck you are logged in (wrangler login) or that CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are set.`)
  }
  const parsed = extractJson(stdout)
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  return { results: first?.results || [], meta: first?.meta || {} }
}

function fmtTime(ms) {
  const n = Number(ms)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : 'never'
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`grant-save-item — add an item to a character's cloud-save inventory

  --env prod|preview     which D1 database (asked if omitted)
  --character <id>       character id (asked if omitted)
  --item <id|name>       item id or name (asked if omitted)
  --qty <n>              quantity, default 1
  --noted                add as a noted stack
  --db <name>            override the D1 database name
  --dry-run              show what would change, write nothing
  --yes                  skip the confirmation prompt (preview only)
  --no-backup            do not write the pre-change save to .save-backups/`)
    return
  }

  // 1) Target database.
  let envName = (args.env || await ask('Environment [prod/preview]: ')).toLowerCase()
  if (envName === 'production') envName = 'prod'
  if (!DATABASES[envName]) die(`Environment must be "prod" or "preview" (got "${envName}").`)
  const db = args.db || DATABASES[envName]

  // 2) Character.
  const characterRaw = args.character || await ask('Character id: ')
  const characterId = Number(characterRaw)
  if (!Number.isInteger(characterId) || characterId <= 0) die(`Character id must be a positive integer (got "${characterRaw}").`)

  console.log(C.dim(`\nReading character ${characterId} from ${db} (${envName})…`))
  const { results } = d1(db, `SELECT c.id AS character_id, c.name, c.owner_id, c.deleted_at, c.active_match_id, c.active_coop_session_id, c.total_level, s.save_revision, s.updated_at, length(s.save_blob) AS blob_len, hex(s.save_blob) AS blob_hex FROM characters c LEFT JOIN saves s ON s.character_id = c.id WHERE c.id = ${characterId};`)
  const row = results[0]
  if (!row) die(`No character with id ${characterId} in ${db}.`)
  if (row.deleted_at) die(`Character ${characterId} ("${row.name}") is deleted (deleted_at = ${fmtTime(row.deleted_at)}).`)
  if (!row.blob_hex) die(`Character ${characterId} ("${row.name}") has no save_blob row yet — nothing to edit.`)

  // 3) Save locks. Writing under any of these races a server-side writer that
  //    owns the save (CLAUDE.md §14/§20) and would lose one side's changes.
  const lock = d1(db, `SELECT (SELECT COUNT(*) FROM pvp_matches WHERE id = (SELECT active_match_id FROM characters WHERE id = ${characterId}) AND status = 'active') AS pvp_active, (SELECT heartbeat_at FROM world_sessions WHERE character_id = ${characterId}) AS world_heartbeat, (SELECT active_coop_session_id FROM characters WHERE id = ${characterId}) AS coop_session;`).results[0] || {}
  const worldLive = Number(lock.world_heartbeat) > 0 && Date.now() - Number(lock.world_heartbeat) < 120_000
  if (Number(lock.pvp_active) > 0) die('Character is in an active PvP match — its save is locked. Try again after the match.')
  if (lock.coop_session) die(`Character is in co-op boss session ${lock.coop_session} — its save is locked. Try again after the fight.`)
  if (worldLive) die(`Character has a live open-world session (heartbeat ${fmtTime(lock.world_heartbeat)}) — its save is locked. Try again once it lapses (~2 min).`)

  // 4) Decode.
  const blob = Buffer.from(row.blob_hex, 'hex')
  if (!(blob[0] === 0x1f && blob[1] === 0x8b)) die('save_blob is not gzip — refusing to touch it.')
  const originalJson = gunzipSync(blob).toString('utf8')
  const save = JSON.parse(originalJson)
  const expectedRevision = Number(row.save_revision) || 0

  // 5) Item.
  const itemRaw = args.item || await ask('Item id or name: ')
  const match = resolveItem(itemsData, itemRaw)
  if (match.error) {
    console.error(C.red(`\n✗ ${match.error}`))
    if (match.candidates?.length) {
      console.error('\nDid you mean:')
      for (const c of match.candidates) console.error(`  ${c.id.padEnd(32)} ${c.name}`)
    }
    process.exit(1)
  }
  const { itemId, item } = match

  const qtyRaw = args.qty || (await ask('Quantity [1]: ')) || '1'
  const qty = Number(qtyRaw)
  if (!Number.isInteger(qty) || qty < 1) die(`Quantity must be a positive integer (got "${qtyRaw}").`)

  const stackable = item.stackable === true
  const heldBefore = countInInventory(save, itemId)
  const slotsBefore = readInventory(save).length

  // 6) Confirm the item BEFORE touching anything.
  console.log(`
${C.bold('Confirm this grant')}
  Database      ${C.bold(db)}  (${envName === 'prod' ? C.red('PRODUCTION') : C.green('preview')})
  Character     ${row.name} (id ${row.character_id}, owner ${row.owner_id}, total level ${row.total_level})
  Save          revision ${expectedRevision}, updated ${fmtTime(row.updated_at)}, ${row.blob_len} bytes gzipped
  Item          ${C.bold(item.name)}  ${C.dim(`(id: ${itemId}${match.matchedBy !== 'id' ? `, matched by ${match.matchedBy}` : ''})`)}
  Type          ${item.type || 'unknown'}${item.slot ? ` · slot ${item.slot}` : ''} · ${stackable ? 'stackable' : 'non-stackable'}${args.noted ? ' · adding as NOTED' : ''}
  Quantity      ${qty}
  Inventory     ${slotsBefore}/${INVENTORY_SLOTS} slots used, currently holding ${heldBefore} × ${item.name}
`)

  // --yes covers preview only; production always asks, and asks for a phrase
  // that names the item so a mistyped id cannot be confirmed by reflex.
  if (!args.dryRun && !(args.yes && envName !== 'prod')) {
    const expected = envName === 'prod' ? `grant ${itemId}` : 'yes'
    const answer = await ask(`Type ${C.bold(expected)} to write this to ${db}: `)
    if (answer !== expected) die('Aborted — nothing was written.')
  }

  // 7) Mutate the inventory only.
  let result
  try {
    result = addItemToSaveInventory(save, itemId, qty, { stackable, noted: args.noted })
  } catch (err) {
    die(err.message)
  }
  const newJson = JSON.stringify(save)

  // Nothing outside `inventory` may differ — a mistake here silently rewrites a
  // player's save, and gzip round-tripping hides it in the diff.
  const beforeCheck = JSON.parse(originalJson)
  const afterCheck = JSON.parse(newJson)
  delete beforeCheck.inventory
  delete afterCheck.inventory
  if (JSON.stringify(beforeCheck) !== JSON.stringify(afterCheck)) {
    die('Internal check failed: fields outside `inventory` changed. Nothing was written.')
  }

  console.log(`${C.green('→')} ${heldBefore} → ${countInInventory(save, itemId)} × ${item.name}; slots ${result.slotsBefore} → ${result.slotsAfter}/${INVENTORY_SLOTS}`)

  if (args.backup) {
    const dir = resolve(ROOT, '.save-backups')
    mkdirSync(dir, { recursive: true })
    const path = resolve(dir, `${envName}-char${characterId}-rev${expectedRevision}-${Date.now()}.json`)
    writeFileSync(path, originalJson)
    console.log(C.dim(`  backup: ${path}`))
  }

  if (args.dryRun) {
    console.log(C.yellow('\nDry run — no write issued.'))
    return
  }

  // 8) Write back, guarded on the revision we read.
  const sql = buildUpdateSql({
    characterId,
    expectedRevision,
    blobHex: toHexLiteral(gzipSync(Buffer.from(newJson, 'utf8'))),
    saveJson: newJson,
    now: Date.now(),
  })
  const write = d1(db, sql)
  if (!write.meta?.changes) {
    die(`Write matched no rows — save_revision moved past ${expectedRevision} while we worked (the player saved). Nothing changed; run the script again.`)
  }

  const after = d1(db, `SELECT save_revision, updated_at, hex(save_blob) AS blob_hex FROM saves WHERE character_id = ${characterId};`).results[0]
  const verified = JSON.parse(gunzipSync(Buffer.from(after.blob_hex, 'hex')).toString('utf8'))
  const verifiedCount = countInInventory(verified, itemId)
  if (verifiedCount !== heldBefore + qty) {
    die(`Verification mismatch: expected ${heldBefore + qty} × ${item.name} in the stored save, found ${verifiedCount}.`)
  }
  console.log(C.green(`\n✓ Wrote save revision ${after.save_revision} (${fmtTime(after.updated_at)}) — ${verifiedCount} × ${item.name} in inventory.`))
  console.log(C.dim('  The player must reload the game to pull the new save.'))
}

main()
  .catch((err) => die(err?.stack || String(err)))
  .finally(() => rl?.close())
