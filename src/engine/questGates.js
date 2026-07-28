// Preview-only escape hatch: with this flag on, every QUEST REQUIREMENT is
// treated as met, so a tester reaches quest-gated gear, bosses, shops, slayer
// tasks and places without grinding the quest first. It is deliberately not a
// runtime setting — nothing a player sends can turn it on.
//
// Two independent locks keep it out of production:
//   1. The client value is baked at BUILD time (`pocketQuestGatesDisabled`, see
//      build_single.cjs) from CF_PAGES_BRANCH — main and branch-less local
//      builds bake `false`, so the production bundle cannot express the bypass.
//   2. The server value needs DISABLE_QUEST_REQUIREMENTS === 'true', which only
//      exists in the [env.preview] vars blocks, AND a non-production hostname.
//      Pasting the var into the production vars still resolves to false.
//
// The distinction this module exists to enforce: it answers "is this
// REQUIREMENT met", never "is this quest complete". Completion status must keep
// reading the real set — routing it through here would mark every quest done
// and empty the quest list instead of unlocking it.

// Every hostname that serves real player data. Preview deployments live on
// *.pages.dev / *.workers.dev and are unaffected.
const PRODUCTION_HOSTS = new Set([
  'pocketrpg.co.uk',
  'www.pocketrpg.co.uk',
  'world.pocketrpg.co.uk',
])

// Server-side value, installed per request from the environment. Module scope
// is safe here because it is deployment-constant: one deployment has one env
// and one host class, so concurrent requests in an isolate all resolve alike.
let installedBypass = false

/**
 * Install the server-side bypass for this deployment. Callers must pass the
 * result of `resolveQuestGateBypass` on EVERY request (including `false`), so a
 * request that does not qualify cannot inherit an earlier `true`.
 */
export function setQuestGateBypass(enabled) {
  installedBypass = enabled === true
}

/**
 * Resolve the server-side bypass from a Worker/Pages env and the request URL.
 * Pure — both locks are checked here, and anything unexpected resolves to
 * `false` so the failure mode is "gates enforced".
 */
export function resolveQuestGateBypass(env, requestUrl) {
  if (env?.DISABLE_QUEST_REQUIREMENTS !== 'true') return false
  let hostname
  try {
    hostname = new URL(requestUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  return !PRODUCTION_HOSTS.has(hostname)
}

/** True when quest requirements are currently bypassed. */
export function questGatesDisabled() {
  if (installedBypass) return true
  return typeof pocketQuestGatesDisabled !== 'undefined' && pocketQuestGatesDisabled === true
}

/**
 * The single funnel for "does the player meet this quest requirement". Accepts
 * whatever shape the caller holds the completed quests in — Set, array, or the
 * plain object a save blob deserialises to.
 *
 * @param {Set<string>|string[]|Record<string, boolean>|null|undefined} completedQuests
 * @param {string|null|undefined} questId the required quest, falsy when ungated
 */
/**
 * The completed-quest set held in a SAVE PAYLOAD, as a Set.
 *
 * Its home is `settings.completedQuests` — the top level is where three server
 * paths mistakenly looked for it, each of which then gated on an empty set and
 * failed open (co-op boss and raid entry) or closed (equipping gated gear
 * inside a fight). Anything reading quests off a save goes through here so
 * there is one answer to "where does it live". The top-level fallback covers
 * save shapes that predate the split; it is a fallback, not the path.
 *
 * This reports COMPLETION, so it deliberately does not consult the preview
 * bypass — `questRequirementMet` is the only thing that may (§4).
 */
export function completedQuestsFromSave(saveObject) {
  const fromSettings = saveObject?.settings?.completedQuests
  const completed = fromSettings !== undefined ? fromSettings : saveObject?.completedQuests
  if (completed instanceof Set) return new Set(completed)
  if (Array.isArray(completed)) return new Set(completed.filter((q) => typeof q === 'string'))
  if (completed && typeof completed === 'object') {
    return new Set(Object.keys(completed).filter((q) => completed[q]))
  }
  return new Set()
}

export function questRequirementMet(completedQuests, questId) {
  if (!questId) return true
  if (questGatesDisabled()) return true
  if (!completedQuests) return false
  if (typeof completedQuests.has === 'function') return completedQuests.has(questId)
  if (Array.isArray(completedQuests)) return completedQuests.includes(questId)
  return Boolean(completedQuests[questId])
}
