import minigamesData from '../data/minigames.json'

// One funnel for a minigame's skill requirements. A section may gate on more
// than one skill (`reqs`) or on a single one (`req`), and both the Minigames
// screen and the World Map read the gate — routing them through here is what
// stops a section being startable from one surface and locked on the other.
// Requirements are per MINIGAME, never per task: every reward task of a section
// is the same venue, so they gate together.

const gatedMinigamesById = {}
for (const mg of Array.isArray(minigamesData.minigames) ? minigamesData.minigames : []) {
  if (mg?.id) gatedMinigamesById[mg.id] = mg
}

const normaliseMinigameReq = (req) => {
  const level = Math.floor(Number(req?.level) || 0)
  return req?.skill && level > 1 ? { skill: req.skill, level } : null
}

/** Every skill requirement of a minigame, as `{ skill, level }[]`. */
export function minigameRequirements(minigameId) {
  const mg = gatedMinigamesById[minigameId]
  if (!mg) return []
  const raw = Array.isArray(mg.reqs) ? mg.reqs : (mg.req ? [mg.req] : [])
  return raw.map(normaliseMinigameReq).filter(Boolean)
}

/**
 * Every requirement `levelOf(skill)` does not satisfy — ALL of them, so a
 * section gated on two skills tells a player short on both what it still wants
 * rather than sending them to train one and come back for the other.
 * `levelOf` takes a skill id and returns the current level.
 */
export function unmetMinigameRequirements(minigameId, levelOf) {
  return minigameRequirements(minigameId).filter(req => (Number(levelOf(req.skill)) || 0) < req.level)
}

/** "Farming level 50" — prose form, for toasts and lock reasons. */
export function minigameRequirementLabel(req) {
  if (!req?.skill) return ''
  return `${req.skill.charAt(0).toUpperCase()}${req.skill.slice(1)} level ${req.level}`
}

/** "Farming 50" — the compact form the minigame rows show behind a padlock. */
export function minigameRequirementShortLabel(req) {
  if (!req?.skill) return ''
  return `${req.skill.charAt(0).toUpperCase()}${req.skill.slice(1)} ${req.level}`
}

/** "Farming level 50 and Herblore level 50" — every outstanding requirement. */
export function minigameRequirementsLabel(reqs) {
  const parts = (reqs || []).map(minigameRequirementLabel).filter(Boolean)
  if (parts.length < 2) return parts[0] || ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
