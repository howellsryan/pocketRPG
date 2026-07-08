import { useState } from 'preact/hooks'
import { getTier, getKind } from '../engine/world.js'
import { getPlaceMap, describeSpot, spotType, BANK_TRAINING_SKILLS, facilityTrainingSkill } from '../engine/placeMaps.js'
import { usePanZoomStage } from '../hooks/usePanZoomStage.js'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import { getSkillArt } from '../utils/skillArt.js'
import { getRaidArt } from '../utils/combatArt.js'
import { SCREENS } from '../utils/constants.js'
import skillsData from '../data/skills.json'
import GameIcon from './GameIcon.jsx'
import Modal from './Modal.jsx'
import ActivityPickerModal from './ActivityPickerModal.jsx'
import ActivityIcon from './ActivityIcon.jsx'

/**
 * PlaceMapView — full-screen interactive map of one place (town/settlement),
 * the world map's interaction model one level down: the place's illustration
 * (placeMaps.json) with pan/zoom and positioned spots instead of the hub's
 * clickable list. Shared by every place that has a `placeMaps.json` entry.
 *
 * Spot behaviours (spotType): activity spots start via `onActivate(kind, ref)`
 * (the world map's activateActivity — level gate + requestActivityStart, so
 * remote refs open the travel prompt); multi-activity spots open the shared
 * picker first. A `facility: 'bank'` spot opens the bank modal (use bank +
 * the bank-bound skills); other facility spots (furnace_anvil/altar/stove)
 * open their skill's training screen; a `screen` spot navigates via
 * `onNavigate`. Skilling screens entered from here get a `returnTo` back to
 * this view.
 */
export default function PlaceMapView({ place, onClose, onActivate, onNavigate }) {
  const map = getPlaceMap(place?.id)
  const [pickerSpot, setPickerSpot] = useState(null)
  const [bankSpot, setBankSpot] = useState(null)
  // Escape backs out to the world map — unless a modal is open (Modal's own
  // escape handling closes that first).
  useEscapeKey(() => onClose?.(), !pickerSpot && !bankSpot)
  const { stageRef, boardRef, stageProps, fitAll, zoomBy, wasGestureClick } = usePanZoomStage({
    boardW: map?.w || 1,
    boardH: map?.h || 1,
    uiSelector: '.pm-spot, .pm-topbar, .wm-ctl',
    minK: 0.25,
    maxK: 2.2,
    fitPad: 24,
  })
  if (!map) return null

  const tier = getTier(place.tier)
  // Where screens opened from this map send the player back to (see App's
  // renderScreen returnNav): this place's map on the world map screen.
  const returnTo = { screen: SCREENS.WORLD_MAP, data: { view: 'place' } }

  // Activity spots resolve refs (dead spots never render); facility/screen
  // spots are landmarks with their own label/glyph from the data.
  const spots = (map.spots || [])
    .map((spot) => {
      const type = spotType(spot)
      return { spot, type, desc: type === 'activity' ? describeSpot(place.id, spot) : null }
    })
    .filter((s) => s.type !== 'activity' || s.desc.refs.length > 0)

  const onSpotClick = ({ spot, type, desc }) => {
    if (wasGestureClick()) return
    if (type === 'facility') {
      if (spot.facility === 'bank') { setBankSpot(spot); return }
      // Single-skill facilities (furnace & anvil / altar / stove) go straight
      // to their skill's training screen, back button returning here.
      const skillId = facilityTrainingSkill(spot.facility)
      if (skillId === 'magic') onNavigate?.(SCREENS.MAGIC, { returnTo })
      else if (skillId) onNavigate?.(SCREENS.SKILLS, { skillId, returnTo })
      return
    }
    if (type === 'screen') {
      onNavigate?.(spot.screen)
      return
    }
    if (desc.refs.length === 1) onActivate?.(spot.kind, desc.refs[0])
    else setPickerSpot({ spot, desc })
  }

  const spotGlyph = ({ spot, type, desc }) => {
    // An explicit iconKey always wins, regardless of spot type or ref count
    // (e.g. the Quests Board landmark — many refs, one deliberate glyph).
    if (spot.iconKey) return <GameIcon iconKey={spot.iconKey} size={20} color="#f2e4c2" />
    if (type === 'facility') {
      if (spot.facility === 'bank') return <GameIcon iconKey="coins" size={20} title={spot.label || 'Bank'} />
      const skillId = facilityTrainingSkill(spot.facility)
      return skillId
        ? <GameIcon iconKey={getSkillArt(skillId).icon} size={20} color="#f2e4c2" />
        : <span aria-hidden="true">{spot.icon || '🏛️'}</span>
    }
    if (type === 'screen') {
      return <span aria-hidden="true">{spot.icon || '🏛️'}</span>
    }
    if (desc.skillArtId) return <GameIcon iconKey={getSkillArt(desc.skillArtId).icon} size={20} color="#f2e4c2" />
    // Raid spots reuse the combat screen's raid emblem (RAID_ART) so the icon
    // matches what the player sees in the Combat screen's raids section, unless
    // the spot carries an explicit emoji override.
    if (!spot.icon && spot.kind === 'raid' && desc.refs.length === 1) {
      return <GameIcon iconKey={getRaidArt(desc.refs[0]).icon} size={20} color="#f2e4c2" />
    }
    // A single-ref spot without a group/raid shortcut above (individual mining
    // veins, dungeoneering floors, gather tasks, slayer masters, ...) resolves
    // the specific activity's own icon instead of the generic per-kind emoji —
    // see ActivityIcon (its fallback still honours an explicit spot.icon via
    // desc.icon). Multi-ref spots with no group/iconKey (rare) keep that emoji.
    if (desc.refs.length === 1) {
      return <ActivityIcon kind={spot.kind} actionRef={desc.refs[0]} desc={desc} size={20} color="#f2e4c2" />
    }
    return <span aria-hidden="true">{desc.icon}</span>
  }

  return (
    <div class="pm-root" role="dialog" aria-label={`${place.name} map`}>
      <div ref={stageRef} class="wm-stage absolute inset-0" {...stageProps}>
        <div ref={boardRef} class="wm-board" style={{ width: map.w + 'px', height: map.h + 'px' }}>
          <img class="pm-map-img" src={map.image} alt="" draggable={false} />
          {spots.map((entry, i) => {
            const { spot, type, desc } = entry
            const label = desc?.label || spot.label || spot.facility || spot.screen
            return (
              <button
                key={i}
                class="pm-spot"
                style={{ left: spot.x + 'px', top: spot.y + 'px', '--pm-accent': (type === 'activity' && getKind(spot.kind)?.color) || 'var(--color-gold)' }}
                onClick={(e) => { e.stopPropagation(); onSpotClick(entry) }}
                aria-label={`${label}${desc?.sublabel ? ` — ${desc.sublabel}` : ''}`}
              >
                <span class="pm-spot__medal">{spotGlyph(entry)}</span>
                <span class="pm-spot__plate">
                  <span class="pm-spot__name">{label}</span>
                  {desc && desc.refs.length > 1
                    ? <span class="pm-spot__count">{desc.refs.length}</span>
                    : desc?.level != null ? <span class="pm-spot__lvl">Lv {desc.level}</span> : null}
                </span>
              </button>
            )
          })}
        </div>

        <div class="pm-topbar">
          <button class="pm-back" onClick={onClose} aria-label="Back to world map">← World Map</button>
          <div class="pm-title">
            <span class="pm-title__name">{place.name}</span>
            <span class="pm-title__tier">{tier?.label}</span>
          </div>
        </div>

        <div class="wm-ctl">
          <button onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
          <button onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">−</button>
          <button onClick={fitAll} title="Fit map" aria-label="Fit map">⤢</button>
        </div>
      </div>

      {pickerSpot && (
        <ActivityPickerModal
          kind={pickerSpot.spot.kind}
          refs={pickerSpot.desc.refs}
          label={pickerSpot.desc.label}
          onClose={() => setPickerSpot(null)}
          onActivate={(kind, ref) => { setPickerSpot(null); onActivate?.(kind, ref) }}
        />
      )}
      {bankSpot && (
        <PlaceBankModal
          label={bankSpot.label || `Bank of ${place.name}`}
          onClose={() => setBankSpot(null)}
          onNavigate={onNavigate}
          returnTo={returnTo}
        />
      )}
    </div>
  )
}

/**
 * The bank landmark's activities: use the bank, or train any of the
 * bank-bound skills — the ones doable at every banked settlement
 * (BANK_TRAINING_SKILLS ⇔ FACILITY_SKILL_MAP.bank; prayer/cooking/smithing
 * belong to their altar/stove/furnace & anvil facilities instead). Rows
 * navigate to the owning screen; `returnTo` brings its back/stop buttons
 * home to this place map.
 */
function PlaceBankModal({ label, onClose, onNavigate, returnTo }) {
  const skillName = (skillId) => skillsData[skillId]?.name || skillId.charAt(0).toUpperCase() + skillId.slice(1)
  const go = (screen, data) => { onClose(); onNavigate?.(screen, data) }
  return (
    <Modal title={label} onClose={onClose} className="wm-actmodal-panel" contentClassName="wm-actmodal-content">
      <div class="fm-ledger">
        <button class="wm-actmodal-row" onClick={() => go(SCREENS.BANK, { returnTo })}>
          <span class="wm-actmodal-row__icon"><GameIcon iconKey="coins" size={18} /></span>
          <span class="wm-actmodal-row__name">Use Bank</span>
        </button>
        {BANK_TRAINING_SKILLS.map((skillId) => (
          <button
            key={skillId}
            class="wm-actmodal-row"
            onClick={() => skillId === 'magic'
              ? go(SCREENS.MAGIC, { returnTo })
              : go(SCREENS.SKILLS, { skillId, returnTo })}
          >
            <span class="wm-actmodal-row__icon"><GameIcon iconKey={getSkillArt(skillId).icon} size={18} color={getSkillArt(skillId).accent} /></span>
            <span class="wm-actmodal-row__name">Train {skillName(skillId)}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
