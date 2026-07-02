import Modal from './Modal.jsx'
import { describeActivity, activityGroupLabel } from '../engine/worldContent.js'

/**
 * One activity category's actions, e.g. all "Skill" refs at a place — sub-grouped
 * by skill (activityGroupLabel) where that's meaningful, so a 140-action city
 * doesn't render as one flat list. Vellum ledger panel (wm-actmodal-panel),
 * matching the app-wide Forgemark parchment. Shared between the world-map place
 * hub (read-only browse: `readOnly`) and the place map's spot picker (rows
 * clickable, starting via `onActivate(kind, ref)`).
 */
export default function ActivityPickerModal({ kind, refs, label, onClose, onActivate, readOnly = false }) {
  // Ascending by level (unmapped/no-level entries sort last, stable otherwise) so
  // low-level skilling actions and weak monsters lead the list.
  const sortedRefs = refs
    .map((ref) => ({ ref, level: describeActivity(kind, ref).level }))
    .sort((a, b) => {
      if (a.level == null && b.level == null) return 0
      if (a.level == null) return 1
      if (b.level == null) return -1
      return a.level - b.level
    })
    .map((x) => x.ref)

  const groups = []
  const byLabel = new Map()
  for (const ref of sortedRefs) {
    const groupLabel = activityGroupLabel(kind, ref)
    if (groupLabel == null) { groups.push({ label: null, refs: [ref] }); continue }
    let g = byLabel.get(groupLabel)
    if (!g) { g = { label: groupLabel, refs: [] }; byLabel.set(groupLabel, g); groups.push(g) }
    g.refs.push(ref)
  }

  return (
    <Modal title={label} titleRight={<span class="wm-actmodal-count">{refs.length}</span>} onClose={onClose} className="wm-actmodal-panel" contentClassName="wm-actmodal-content">
      {readOnly && <div class="wm-actmodal-note">Offered here — start activities from the town map when you visit.</div>}
      {groups.map((g, gi) => (
        <div class="wm-actmodal-group" key={g.label || gi}>
          {g.label && <div class="wm-actmodal-grouphead">{g.label}</div>}
          <div class="fm-ledger">
            {g.refs.map((ref, i) => {
              const d = describeActivity(kind, ref)
              const inner = (
                <>
                  <span class="wm-actmodal-row__icon">{d.icon}</span>
                  <span class="wm-actmodal-row__name">{d.name}</span>
                  {d.level != null && <span class="wm-actmodal-row__lvl">{d.level}</span>}
                </>
              )
              return readOnly
                ? <div class="wm-actmodal-row wm-actmodal-row--static" key={i}>{inner}</div>
                : <button class="wm-actmodal-row" key={i} onClick={() => onActivate(kind, ref)}>{inner}</button>
            })}
          </div>
        </div>
      ))}
    </Modal>
  )
}
