import { useGame } from '../state/gameState.jsx'
import { useState, useRef, useEffect, useCallback } from 'preact/hooks'
import { getWorld, getPlace, listPlaces, getTier, getKind, shortestPath, pathLegs } from '../engine/world.js'
import { describeActivity } from '../engine/worldContent.js'
import { createTravelTask, travelFraction, travelDestName } from '../engine/travel.js'
import { PlaceIcon, PlaceScene } from '../components/PlaceArt.jsx'
import GameIcon from '../components/GameIcon.jsx'
import WaxSeal from '../components/WaxSeal.jsx'

// Facility chip glyph: bank reuses the existing in-game bank icon (the nav's coins
// glyph); furnace & anvil gets its bespoke PlaceIcon; anything else falls back to its
// emoji. Sized for the 44px-min facility chips.
function FacilityGlyph({ fid, fac }) {
  if (fid === 'bank') return <GameIcon iconKey="coins" size={16} title={fac?.label || 'Bank'} />
  if (fid === 'furnace_anvil') return <PlaceIcon facility="furnace_anvil" size={18} />
  return <span aria-hidden="true">{fac?.icon || '🏛️'}</span>
}

/**
 * World Map — Phase 1 (read-only) of the map-driven overhaul.
 * See docs/map-driven-overhaul-plan.md. Renders the place/road graph with
 * pan/zoom/fit and an informational place hub. No travel or activity gating yet
 * (that is Phase 2/3); tapping a place opens its hub and shows how far it is from
 * the player's current location. Current location is read from the save blob
 * (`worldLocation`).
 */

const MIN_K = 0.35
const MAX_K = 2.2

// Group a place's `{ kind, ref }` activities into [kind, [ref, ...]] pairs in a stable
// kind order for the hub's grouped list.
const WM_KIND_ORDER = ['raid', 'boss', 'dungeon', 'combat', 'skill', 'gather', 'agility', 'thieving', 'hunter', 'quest', 'minigame', 'shop']
function groupActivities(activities) {
  const byKind = {}
  for (const a of activities || []) {
    if (!a || !a.kind || !a.ref) continue
    ;(byKind[a.kind] || (byKind[a.kind] = [])).push(a.ref)
  }
  return Object.keys(byKind)
    .sort((x, y) => {
      const ix = WM_KIND_ORDER.indexOf(x), iy = WM_KIND_ORDER.indexOf(y)
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
    })
    .map((kind) => [kind, byKind[kind]])
}

export default function WorldMapScreen() {
  const { worldLocation, activeTask, setActiveTask, addToast } = useGame()
  const world = getWorld()
  const here = getPlace(worldLocation) ? worldLocation : world.start
  const travel = activeTask?.type === 'travel' ? activeTask : null

  const beginTravel = (destId) => {
    const task = createTravelTask(here, destId)
    if (!task) return
    setActiveTask(task)
    setOpenId(null)
    addToast(`🧭 Travelling to ${travelDestName(task)}`, 'info')
  }
  const cancelTravel = () => {
    if (!travel) return
    setActiveTask(null)
    addToast('Travel cancelled', 'info')
  }

  const stageRef = useRef(null)
  const boardRef = useRef(null)
  const viewRef = useRef({ x: 0, y: 0, k: 1 })
  const dragRef = useRef(null)
  const [openId, setOpenId] = useState(null)

  const applyView = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const v = viewRef.current
    board.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`
  }, [])

  const clampK = (k) => Math.max(MIN_K, Math.min(MAX_K, k))

  const fitAll = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const pad = 80
    const kx = (stage.clientWidth - pad * 2) / world.board.w
    const ky = (stage.clientHeight - pad * 2) / world.board.h
    const v = viewRef.current
    v.k = Math.max(MIN_K, Math.min(1, Math.min(kx, ky)))
    v.x = (stage.clientWidth - world.board.w * v.k) / 2
    v.y = (stage.clientHeight - world.board.h * v.k) / 2
    applyView()
  }, [applyView, world.board.w, world.board.h])

  const zoomBy = useCallback((f) => {
    const stage = stageRef.current
    if (!stage) return
    const v = viewRef.current
    const cx = stage.clientWidth / 2
    const cy = stage.clientHeight / 2
    const wx = (cx - v.x) / v.k
    const wy = (cy - v.y) / v.k
    v.k = clampK(v.k * f)
    v.x = cx - wx * v.k
    v.y = cy - wy * v.k
    applyView()
  }, [applyView])

  // Fit on mount and whenever the stage is resized.
  useEffect(() => {
    fitAll()
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitAll)
      return () => window.removeEventListener('resize', fitAll)
    }
    const ro = new ResizeObserver(() => fitAll())
    ro.observe(stage)
    return () => ro.disconnect()
  }, [fitAll])

  // ── pan ──
  const onPointerDown = (e) => {
    if (e.target.closest('.wm-node')) return
    const v = viewRef.current
    dragRef.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: 0 }
    stageRef.current?.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    const v = viewRef.current
    v.x = drag.vx + dx
    v.y = drag.vy + dy
    applyView()
  }
  const endDrag = () => { dragRef.current = null }

  const onWheel = (e) => {
    e.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const v = viewRef.current
    const wx = (mx - v.x) / v.k
    const wy = (my - v.y) / v.k
    v.k = clampK(v.k * (e.deltaY < 0 ? 1.12 : 0.89))
    v.x = mx - wx * v.k
    v.y = my - wy * v.k
    applyView()
  }

  const onNodeClick = (id) => {
    // Suppress click that ended a drag.
    if (dragRef.current && dragRef.current.moved > 6) return
    setOpenId(id)
  }

  const places = listPlaces()
  const openPlace = openId ? getPlace(openId) : null

  // Interpolate the traveller token along its route legs by the fraction done.
  const tokenPos = (() => {
    if (!travel) return null
    const legs = pathLegs(travel.path)
    if (!legs.length) return null
    const total = travel.totalTicks || legs.reduce((s, l) => s + l.ticks, 0) || 1
    let travelled = travelFraction(travel) * total
    for (const leg of legs) {
      const a = getPlace(leg.from)
      const b = getPlace(leg.to)
      if (!a || !b) continue
      if (travelled <= leg.ticks || leg === legs[legs.length - 1]) {
        const f = leg.ticks > 0 ? Math.min(1, travelled / leg.ticks) : 1
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
      }
      travelled -= leg.ticks
    }
    return null
  })()

  return (
    <div class="h-full w-full relative overflow-hidden bg-[var(--color-void)]" style={{ touchAction: 'none' }}>
      {/* top bar */}
      <div class="absolute top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 py-2 bg-[var(--color-void-light)] border-b border-[var(--color-void-border)]">
        <div class="font-[var(--font-display)] text-[var(--color-gold-light)] font-bold text-lg">World Map</div>
        <div class="text-[var(--color-parchment-dark)] text-xs italic font-[var(--font-body)]">Chart of Eldermoor</div>
        <div class="ml-auto flex items-center gap-2 px-3 py-1 rounded bg-[var(--color-void)] border border-[var(--color-void-border)]">
          <span class="text-base" aria-hidden="true">📍</span>
          <span class="flex flex-col leading-tight">
            <small class="uppercase tracking-widest text-[9px] text-[var(--color-ink-light)]">{travel ? 'Travelling to' : 'You are at'}</small>
            <b class="font-[var(--font-display)] text-[13px] text-[var(--color-gold-light)]">{travel ? travelDestName(travel) : getPlace(here)?.name}</b>
          </span>
        </div>
      </div>

      {/* stage */}
      <div
        ref={stageRef}
        class="wm-stage absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onWheel={onWheel}
      >
        <div ref={boardRef} class="wm-board" style={{ width: world.board.w + 'px', height: world.board.h + 'px' }}>
          <div class="wm-chart" />
          <svg class="wm-routes" width={world.board.w} height={world.board.h} xmlns="http://www.w3.org/2000/svg">
            {world.edges.map(([a, b, t]) => {
              const pa = world.places[a]
              const pb = world.places[b]
              if (!pa || !pb) return null
              const mx = (pa.x + pb.x) / 2
              const my = (pa.y + pb.y) / 2
              const label = `${t}t`
              const w = label.length * 8 + 12
              return (
                <g key={`${a}-${b}`}>
                  <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} class="wm-road" />
                  <rect x={mx - w / 2} y={my - 12} width={w} height={22} rx={4} class="wm-tickbg" />
                  <text x={mx} y={my + 4} text-anchor="middle" class="wm-tick">{label}</text>
                </g>
              )
            })}
          </svg>

          {places.map((p) => {
            const tier = getTier(p.tier)
            const sz = tier?.size || 56
            const isHere = p.id === here
            return (
              <button
                key={p.id}
                class={`wm-node${isHere ? ' wm-node--here' : ''}`}
                style={{ left: p.x + 'px', top: p.y + 'px', '--wm-accent': tier?.accent || 'var(--color-gold)' }}
                onClick={(e) => { e.stopPropagation(); onNodeClick(p.id) }}
                aria-label={`${p.name} — ${tier?.label || ''}${isHere ? ' (you are here)' : ''}`}
              >
                <span class="wm-medal" style={{ width: sz + 'px', height: sz + 'px' }}>
                  <span class="wm-face">
                    <PlaceIcon tier={p.tier} size={Math.round(sz * 0.58)} class="wm-face-art" />
                  </span>
                </span>
                <span class="wm-plate">
                  <span class="wm-name">{p.name}</span>
                  <span class="wm-tier">{tier?.label}</span>
                </span>
              </button>
            )
          })}

          {tokenPos && (
            <div class="wm-token" style={{ left: tokenPos.x + 'px', top: tokenPos.y + 'px' }} aria-hidden="true">🚶</div>
          )}
        </div>

        {/* legend */}
        <aside class="wm-legend">
          <h4>Settlements</h4>
          <div class="wm-legrow"><span class="wm-dot" style={{ background: 'var(--color-gold-light)' }} /> City — raids, all</div>
          <div class="wm-legrow"><span class="wm-dot" style={{ background: 'var(--color-mana-light)' }} /> Town — dungeons, bosses</div>
          <div class="wm-legrow"><span class="wm-dot" style={{ background: 'var(--color-emerald-light)' }} /> Village — monsters, quests</div>
          <div class="wm-legrow"><span class="wm-dot" style={{ background: 'var(--tier-bronze)' }} /> Hamlet — low-level monsters</div>
          <div class="wm-hint">Tap a settlement to travel there. Far places route through the roads between.</div>
        </aside>

        {/* controls */}
        <div class="wm-ctl">
          <button onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
          <button onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">−</button>
          <button onClick={fitAll} title="Fit map" aria-label="Fit map">⤢</button>
        </div>

        {/* travel banner */}
        {travel && (
          <div class="wm-travelbar" role="status">
            <div class="wm-travelbar-top">
              <span class="wm-travelbar-lead">Travelling to <b>{travelDestName(travel)}</b></span>
              <span class="wm-travelbar-ticks">{(travel.totalTicks ?? 0) - (travel.ticksRemaining ?? 0)} / {travel.totalTicks ?? 0} ticks</span>
            </div>
            <div class="wm-track"><div class="wm-track-fill" style={{ width: Math.round(travelFraction(travel) * 100) + '%' }} /></div>
            <div class="wm-travelbar-route">Route: {(travel.path || []).map((id) => getPlace(id)?.name || id).join(' → ')}</div>
            <button class="wm-travelbar-cancel" onClick={cancelTravel}>Turn back</button>
          </div>
        )}
      </div>

      {/* place hub */}
      {openPlace && (
        <PlaceHub
          place={openPlace}
          here={here}
          travelling={!!travel}
          onTravel={beginTravel}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function PlaceHub({ place, here, travelling, onTravel, onClose }) {
  const tier = getTier(place.tier)
  const isHere = place.id === here
  const route = isHere ? null : shortestPath(here, place.id)
  const canTravel = !isHere && !travelling && route && route.ticks > 0

  return (
    <>
      <div class="wm-scrim" onClick={onClose} />
      <div class="forge-shell wm-hub" role="dialog" aria-label={place.name}>
        <div class="wm-hub-banner" style={{ '--wm-accent': tier?.accent || 'var(--color-gold)' }}>
          <div class="wm-hub-scene" aria-hidden="true"><PlaceScene place={place} /></div>
          <div class="wm-hub-scene-veil" aria-hidden="true" />
          <button class="wm-hub-close" onClick={onClose} aria-label="Close">✕</button>
          <div class="wm-hub-meta">
            <span class="wm-hub-tier"><PlaceIcon tier={place.tier} size={18} /> {tier?.label}</span>
            <div class="wm-hub-name">{place.name}</div>
            <div class="wm-hub-sub">{place.sub}</div>
          </div>
        </div>
        <div class="wm-hub-body">
          {place.tier === 'city' && <WaxSeal size={48} rotate={-6} label="Capital" class="wm-hub-seal" />}
          <p class="wm-hub-lore">{place.lore}</p>
          {(place.facilities?.length > 0) && (
            <div class="wm-hub-facilities">
              {place.facilities.map((fid) => {
                const fac = getWorld().facilities?.[fid]
                return <span class="wm-facility" key={fid}><FacilityGlyph fid={fid} fac={fac} /> {fac?.label || fid}</span>
              })}
            </div>
          )}
          <div class="wm-hub-note">
            {isHere
              ? 'You are here.'
              : travelling
                ? 'You are already travelling. Turn back first to choose a new destination.'
                : route
                  ? `${place.name} is ${route.ticks} ticks away by road, via ${route.path.map((id) => getPlace(id)?.name || id).join(' → ')}.`
                  : 'No road reaches this place yet.'}
          </div>
          {canTravel && (
            <button class="wm-travel-btn" onClick={() => onTravel(place.id)}>
              Travel here · {route.ticks} ticks
            </button>
          )}
          <div class="wm-hub-sectionhead"><span>Available here</span></div>
          <div class="wm-hub-acts">
            {groupActivities(place.activities).map(([kind, refs]) => {
              const k = getKind(kind)
              return (
                <div class="wm-act-group" key={kind}>
                  <div class="wm-act-grouphead">
                    <span class="wm-tag" style={{ color: k?.color || 'var(--color-gold)' }}>{k?.label || kind}</span>
                    <span class="wm-act-count">{refs.length}</span>
                  </div>
                  <div class="wm-act-names">
                    {refs.map((ref, i) => {
                      const d = describeActivity(kind, ref)
                      return (
                        <span class="wm-act-chip" key={i}>
                          {d.icon} {d.name}{d.level != null ? ` · ${d.level}` : ''}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
