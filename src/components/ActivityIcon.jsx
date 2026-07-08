import GameIcon from './GameIcon.jsx'
import { getSkillArt } from '../utils/skillArt.js'
import itemsData from '../data/items.json'

/**
 * Best-available icon for an activity ref, shared by every place that lists
 * activities by kind/ref (the place map's spots, its multi-activity picker):
 *   1. an explicit iconKey override (spot.iconKey / data-authored iconKey)
 *   2. a skill action's product item (matches the training screen's own icon
 *      exactly — e.g. "Mine tin ore" shows the tin ore glyph)
 *   3. a skill action with no product (e.g. dungeoneering floors) falls back
 *      to the skill's own emblem (SKILL_ART)
 *   4. the plain emoji every describeActivity() result carries (combat has no
 *      per-monster art in this data set, so it stays a generic glyph)
 *
 * `desc` is a describeActivity(kind, ref) result — pass it through rather
 * than recomputing, callers already have it for the label/level too.
 */
export default function ActivityIcon({ kind, actionRef, desc, iconKey: override, size = 20, color = '#f2e4c2' }) {
  if (override) return <GameIcon iconKey={override} size={size} color={color} />
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
