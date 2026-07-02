import { useState } from 'preact/hooks'
import { getTier, getKind } from '../engine/world.js'
import { getPlaceMap, describeSpot } from '../engine/placeMaps.js'
import { usePanZoomStage } from '../hooks/usePanZoomStage.js'
import { useEscapeKey } from '../hooks/useEscapeKey.js'
import { getSkillArt } from '../utils/skillArt.js'
import GameIcon from './GameIcon.jsx'
import ActivityPickerModal from './ActivityPickerModal.jsx'

/**
 * PlaceMapView — full-screen interactive map of one place (town/settlement),
 * the world map's interaction model one level down: the place's illustration
 * (placeMaps.json) with pan/zoom and positioned activity spots instead of the
 * hub's clickable list. Shared by every place that has a `placeMaps.json`
 * entry. Tapping a single-activity spot starts it via `onActivate(kind, ref)`
 * (the world map's activateActivity — level gate + requestActivityStart);
 * multi-activity spots (e.g. a whole skill) open the shared picker first.
 */
export default function PlaceMapView({ place, onClose, onActivate }) {
  const map = getPlaceMap(place?.id)
  const [pickerSpot, setPickerSpot] = useState(null)
  // Escape backs out to the world map — unless the picker is open (Modal's own
  // escape handling closes that first).
  useEscapeKey(() => onClose?.(), !pickerSpot)
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
  // Dead spots (stale ref / group with nothing offered) never render.
  const spots = (map.spots || [])
    .map((spot) => ({ spot, desc: describeSpot(place.id, spot) }))
    .filter((s) => s.desc.refs.length > 0)

  const onSpotClick = (spot, desc) => {
    if (wasGestureClick()) return
    if (desc.refs.length === 1) onActivate?.(spot.kind, desc.refs[0])
    else setPickerSpot({ spot, desc })
  }

  return (
    <div class="pm-root" role="dialog" aria-label={`${place.name} map`}>
      <div ref={stageRef} class="wm-stage absolute inset-0" {...stageProps}>
        <div ref={boardRef} class="wm-board" style={{ width: map.w + 'px', height: map.h + 'px' }}>
          <img class="pm-map-img" src={map.image} alt="" draggable={false} />
          {spots.map(({ spot, desc }, i) => (
            <button
              key={i}
              class="pm-spot"
              style={{ left: spot.x + 'px', top: spot.y + 'px', '--pm-accent': getKind(spot.kind)?.color || 'var(--color-gold)' }}
              onClick={(e) => { e.stopPropagation(); onSpotClick(spot, desc) }}
              aria-label={`${desc.label}${desc.sublabel ? ` — ${desc.sublabel}` : ''}`}
            >
              <span class="pm-spot__medal">
                {desc.skillArtId
                  ? <GameIcon iconKey={getSkillArt(desc.skillArtId).icon} size={20} color="#f2e4c2" />
                  : <span aria-hidden="true">{desc.icon}</span>}
              </span>
              <span class="pm-spot__plate">
                <span class="pm-spot__name">{desc.label}</span>
                {desc.refs.length > 1
                  ? <span class="pm-spot__count">{desc.refs.length}</span>
                  : desc.level != null ? <span class="pm-spot__lvl">Lv {desc.level}</span> : null}
              </span>
            </button>
          ))}
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
    </div>
  )
}
