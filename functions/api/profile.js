import { json } from '../_lib/auth.js'
import { decodeSaveRow } from '../_lib/saveCodec.js'
import { getCombatLevelFromSave } from '../_lib/combatLevel.js'
import { getTotalLevelFromSave } from '../_lib/saveSummary.js'
import { getLevelFromXP } from '../../src/engine/experience.js'
import { ALL_SKILLS } from '../../src/utils/constants.js'

const USERNAME_RE = /^[A-Za-z0-9_-]{3,16}$/
const CACHE_TTL_SECONDS = 30

// Public read-only player profile: the exact per-skill breakdown behind a
// leaderboard entry. Returns only skill levels/XP (plus derived totals and the
// account-type flags already shown on the board) — never inventory, bank, or
// anything ownership-sensitive. No auth: the leaderboard it backs is public.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const username = (url.searchParams.get('username') || '').trim()
  if (!USERNAME_RE.test(username)) {
    return json({ error: 'Invalid username' }, 400)
  }

  const char = await env.DB.prepare(
    `SELECT id, username, total_level, combat_level, is_ironman, is_one_life, created_at
       FROM characters
      WHERE username = ? COLLATE NOCASE AND deleted_at IS NULL AND is_bot = 0`
  ).bind(username).first()
  if (!char) return json({ error: 'Character not found' }, 404)

  const saveRow = await env.DB.prepare(
    'SELECT save_data, save_blob, updated_at FROM saves WHERE character_id = ?'
  ).bind(char.id).first()

  let save = null
  if (saveRow) {
    try {
      const decoded = await decodeSaveRow(saveRow)
      const saveData = decoded?.save_data ?? saveRow.save_data
      if (saveData) save = JSON.parse(saveData)
    } catch {
      save = null
    }
  }

  const stats = (save && typeof save.stats === 'object' && save.stats) || {}
  const skills = ALL_SKILLS.map(skill => {
    const entry = stats[skill]
    const xp = Math.max(0, Math.floor(Number(entry?.xp) || 0))
    const level = Number.isFinite(Number(entry?.level)) && Number(entry?.level) > 0
      ? Math.floor(Number(entry.level))
      : getLevelFromXP(xp)
    return { skill, level, xp }
  })

  // Prefer freshly-derived totals from the save; fall back to the denormalized
  // columns when the save blob is missing/undecodable.
  const totalLevel = save ? getTotalLevelFromSave(save) : Number(char.total_level) || 0
  const combatLevel = save ? getCombatLevelFromSave(save) : Number(char.combat_level) || 3

  return json(
    {
      username: char.username,
      totalLevel,
      combatLevel,
      isIronman: !!char.is_ironman,
      isOneLife: !!char.is_one_life,
      createdAt: char.created_at,
      updatedAt: saveRow?.updated_at ?? null,
      skills,
    },
    200,
    { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}` },
  )
}
