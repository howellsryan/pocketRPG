/**
 * placeMaps — per-place interactive map definitions (src/data/placeMaps.json):
 * an illustrated town/settlement image with positioned activity "spots" the
 * player taps to start activities, replacing the world-map place hub's
 * clickable list for any place that has one. Pure logic, no UI imports
 * (engine layer — CLAUDE.md §3); PlaceMapView renders it.
 *
 * A spot stands for one activity or a whole group of them:
 *   { x, y, kind, ref }              — a single activity (starts directly)
 *   { x, y, kind: 'skill', group }   — every `group:*` skill ref at the place
 *   { x, y, kind }                   — every ref of that kind at the place
 * `label` optionally overrides the display name. Coordinates are pixels on the
 * map image (`w`×`h`), same convention as world.json place x/y on the board.
 *
 * In the single-file build `placeMapsData` rides the lazily-loaded game chunk
 * (like worldActivitiesData — see build_single.cjs); the typeof guard tolerates
 * the chunk not having loaded yet, when nothing renders a place map anyway.
 */
import placeMapsData from '../data/placeMaps.json'
import skillsData from '../data/skills.json'
import { placeActivities, describeActivity } from './worldContent.js'

function placeMapsSource() {
  return typeof placeMapsData !== 'undefined' ? placeMapsData : {}
}

/** The place's map definition `{ image, w, h, spots }`, or null. */
export function getPlaceMap(placeId) {
  return placeMapsSource()[placeId] || null
}

export function placeHasMap(placeId) {
  return !!getPlaceMap(placeId)
}

/**
 * Activity refs a spot stands for, restricted to what the place actually
 * offers (worldActivities.json) so a stale spot never starts an activity the
 * place doesn't have. Empty array = dead spot, don't render it.
 */
export function resolveSpotRefs(placeId, spot) {
  if (!spot || !spot.kind) return []
  const offered = placeActivities(placeId)
  if (spot.ref) {
    return offered.some((a) => a.kind === spot.kind && a.ref === spot.ref) ? [spot.ref] : []
  }
  const prefix = spot.kind === 'skill' && spot.group ? spot.group + ':' : null
  return offered
    .filter((a) => a.kind === spot.kind && (!prefix || a.ref.startsWith(prefix)))
    .map((a) => a.ref)
}

// Kinds whose spot glyph is the matching skill's emblem (utils/skillArt) rather
// than the activity's emoji.
const SPOT_SKILL_ART_KINDS = new Set(['agility', 'thieving', 'hunter'])

/**
 * Display descriptor for a spot: `{ refs, label, sublabel, icon, skillArtId,
 * level }`. Single-activity spots describe that activity (name/emoji/level);
 * group spots use the group's skill name and emblem. `skillArtId` (a skill id
 * for utils/skillArt, or null) wins over the emoji `icon` when set.
 */
export function describeSpot(placeId, spot) {
  const refs = resolveSpotRefs(placeId, spot)
  const single = refs.length === 1 ? describeActivity(spot.kind, refs[0]) : null
  const groupName = spot.kind === 'skill' && spot.group
    ? (skillsData[spot.group]?.name || spot.group.charAt(0).toUpperCase() + spot.group.slice(1))
    : null
  const label = spot.label || single?.name || groupName || spot.kind
  // The landmark label alone ("Grand Smithy") doesn't always say what you do
  // there — surface the activity/skill name underneath when it differs.
  const inner = single?.name || groupName
  const sublabel = spot.label && inner && inner !== spot.label ? inner : null
  const skillArtId = spot.kind === 'skill' && spot.group
    ? spot.group
    : SPOT_SKILL_ART_KINDS.has(spot.kind) ? spot.kind : null
  const icon = single?.icon || (refs.length ? describeActivity(spot.kind, refs[0]).icon : '❔')
  return { refs, label, sublabel, icon, skillArtId, level: single?.level ?? null }
}
