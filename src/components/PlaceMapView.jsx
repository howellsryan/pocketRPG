import { useState } from 'preact/hooks'
import { getTier, getKind } from '../engine/world.js'
import { getPlaceMap, describeSpot, spotType, BANK_TRAINING_SKILLS } from '../engine/placeMaps.js'
import { usePanZoomStage } from '../hooks/usePanZoomStage.js'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import { getSkillArt } from '../utils/skillArt.js'
import { SCREENS } from '../utils/constants.js'
import skillsData from '../data/skills.json'
import GameIcon from './GameIcon.jsx'
import Modal from './Modal.jsx'
import ActivityPickerModal from './ActivityPickerModal.jsx'

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
 * every train-anywhere skill); a `screen` spot navigates via `onNavigate`.
 * Skilling screens entered from here get a `returnTo` back to this view.
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
      if (spot.facility === 'bank') setBankSpot(spot)
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
    if (type === 'facility') return <GameIcon iconKey="coins" size={20} title={spot.label || 'Bank'} />
    if (type === 'screen') {
      return spot.iconKey
        ? <GameIcon iconKey={spot.iconKey} size={20} color="#f2e4c2" />
        : <span aria-hidden="true">{spot.icon || '🏛️'}</span>
    }
    return desc.skillArtId
      ? <GameIcon iconKey={getSkillArt(desc.skillArtId).icon} size={20} color="#f2e4c2" />
      : <span aria-hidden="true">{desc.icon}</span>
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
 * facility-bound skills — the ones doable at every banked settlement rather
 * than tied to a specific city (BANK_TRAINING_SKILLS ⇔ FACILITY_SKILLS).
 * Rows navigate to the owning screen; `returnTo` brings its back/stop
 * buttons home to this place map.
 */
function PlaceBankModal({ label, onClose, onNavigate, returnTo }) {
  const skillName = (skillId) => skillsData[skillId]?.name || skillId.charAt(0).toUpperCase() + skillId.slice(1)
  const go = (screen, data) => { onClose(); onNavigate?.(screen, data) }
  return (
    <Modal title={label} onClose={onClose} className="wm-actmodal-panel" contentClassName="wm-actmodal-content">
      <div class="fm-ledger">
        <button class="wm-actmodal-row" onClick={() => go(SCREENS.BANK)}>
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
