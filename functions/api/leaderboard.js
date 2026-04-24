import { json } from '../_lib/auth.js'

export async function onRequestGet({ request, env }) {
  try {
    const rows = await env.DB.prepare(
      `SELECT c.id, c.username, s.save_data
       FROM characters c
       LEFT JOIN saves s ON s.character_id = c.id
       WHERE c.deleted_at IS NULL
       ORDER BY c.created_at ASC`
    ).all()

    const characters = (rows.results || []).map(row => {
      let totalLevel = 0
      if (row.save_data) {
        try {
          const saveData = JSON.parse(row.save_data)
          const stats = saveData.stats || {}
          for (const skill of Object.values(stats)) {
            if (skill && skill.level) {
              totalLevel += skill.level
            }
          }
        } catch (e) {
          console.error('[Leaderboard] Failed to parse save data for character', row.id, e)
        }
      }
      return {
        username: row.username,
        totalLevel
      }
    })

    // Sort by total level descending
    characters.sort((a, b) => b.totalLevel - a.totalLevel)

    return json({ characters })
  } catch (err) {
    console.error('[Leaderboard] Error fetching leaderboard:', err)
    return json({ error: 'Failed to fetch leaderboard', characters: [] }, 500)
  }
}
