export async function readCharacterPvpRank(env, characterId) {
  const id = Number(characterId)
  if (!Number.isFinite(id) || id <= 0) {
    return {
      totalPvpKills: 0,
      lastUpdatedTotalPvpKills: null,
      rank: null,
    }
  }

  const row = await env.DB.prepare(
    `WITH ranked AS (
       SELECT
         id,
         ROW_NUMBER() OVER (
           ORDER BY
             COALESCE(total_pvp_kills, 0) DESC,
             last_updated_total_pvp_kills ASC,
             id ASC
         ) AS pvp_rank
       FROM characters
       WHERE deleted_at IS NULL
         AND COALESCE(total_pvp_kills, 0) > 0
     )
     SELECT
       c.id,
       COALESCE(c.total_pvp_kills, 0) AS total_pvp_kills,
       c.last_updated_total_pvp_kills,
       r.pvp_rank
     FROM characters c
     LEFT JOIN ranked r ON r.id = c.id
     WHERE c.id = ? AND c.deleted_at IS NULL`
  ).bind(id).first()

  const totalPvpKills = Math.max(0, Number(row?.total_pvp_kills || 0) || 0)
  const rawUpdated = Number(row?.last_updated_total_pvp_kills)
  const rawRank = Number(row?.pvp_rank)

  return {
    totalPvpKills,
    lastUpdatedTotalPvpKills: Number.isFinite(rawUpdated) && rawUpdated > 0 ? rawUpdated : null,
    rank: totalPvpKills > 0 && Number.isFinite(rawRank) && rawRank > 0 ? rawRank : null,
  }
}

export function applyPvpRankToCombatant(combatant, rankInfo) {
  if (!combatant || typeof combatant !== 'object') return combatant
  return {
    ...combatant,
    totalPvpKills: Math.max(0, Number(rankInfo?.totalPvpKills || 0) || 0),
    lastUpdatedTotalPvpKills: rankInfo?.lastUpdatedTotalPvpKills ?? null,
    pvpRank: rankInfo?.rank ?? null,
  }
}
