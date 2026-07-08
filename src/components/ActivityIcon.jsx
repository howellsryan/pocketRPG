import GameIcon from './GameIcon.jsx'
import { getSkillArt } from '../utils/skillArt.js'
import itemsData from '../data/items.json'

/**
 * Best-available icon for a single activity ref, shared by every place that
 * lists activities by kind/ref (the place map's single-ref spots, its
 * multi-activity picker rows):
 *   1. a skill action's product item (matches the training screen's own icon
 *      exactly — e.g. "Mine clay" shows the clay glyph)
 *   2. a skill action with no product (e.g. dungeoneering floors) falls back
 *      to the skill's own emblem (SKILL_ART)
 *   3. a data-authored iconKey (gather tasks, slayer masters, minigames)
 *   4. the plain emoji every describeActivity() result carries (combat has no
 *      per-monster art in this data set, so it stays a generic glyph)
 * Callers with their own explicit override (e.g. a spot's own iconKey) should
 * check that first and skip this component entirely.
 *
 * `desc` is a describeActivity(kind, ref) result — pass it through rather
 * than recomputing, callers already have it for the label/level too.
 */
export default function ActivityIcon({ kind, actionRef, desc, size = 20, color = '#f2e4c2' }) {
  if (kind === 'skill' && desc.product) {
    const item = itemsData[desc.product]
    if (item) return <GameIcon item={item} size={size} />
  }
  if (desc.iconKey) return <GameIcon iconKey={desc.iconKey} size={size} color={color} />
  if (kind === 'skill') {
    const skillId = actionRef.indexOf(':') >= 0 ? actionRef.slice(0, actionRef.indexOf(':')) : actionRef
    return <GameIcon iconKey={getSkillArt(skillId).icon} size={size} color={color} />
  }
  return <span aria-hidden="true">{desc.icon}</span>
}
