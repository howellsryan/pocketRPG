import { useGame } from '../state/gameState.jsx'
import { useState, useRef, useEffect, useCallback } from 'preact/hooks'
import { getWorld, getPlace, listPlaces, getTier, getKind, shortestPath, pathLegs } from '../engine/world.js'
import { describeActivity, activityGroupLabel, isPlaceVaryingSkillRef, autoStartFromTask, placeActivities } from '../engine/worldContent.js'
import { SCREENS } from '../utils/constants.js'
import { createTravelTask, travelFraction, travelDestName, travelCancelLocation } from '../engine/travel.js'
import { journeyStatus, teleportIntoJourney } from '../engine/journeys.js'
import { teleportCheck, deductRunes, formatRuneCost } from '../engine/teleports.js'
import { getLevelFromXP } from '../engine/experience.js'
import { PlaceIcon, PlaceScene, WorldTerrain } from '../components/PlaceArt.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { getSkillArt } from '../utils/skillArt.js'
import WaxSeal from '../components/WaxSeal.jsx'
import Modal from '../components/Modal.jsx'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'

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

// Travel durations surface as wall-clock time (600ms ticks) — players never
// see raw tick counts on this screen.
const wmTravelTime = (ticks) => {
  const s = Math.round((Number(ticks) || 0) * 0.6)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}m ${r}s` : `${m}m`
}

// Group a place's `{ kind, ref }` activities into [kind, [ref, ...]] pairs in a stable
// kind order for the hub's grouped list.
const WM_KIND_ORDER = ['raid', 'boss', 'dungeon', 'combat', 'skill', 'gather', 'agility', 'thieving', 'hunter', 'quest', 'minigame', 'shop']
function groupActivities(activities) {
  const byKind = {}
  for (const a of activities || []) {
    if (!a || !a.kind || !a.ref) continue
    if (a.kind === 'skill' && !isPlaceVaryingSkillRef(a.ref)) continue
    ;(byKind[a.kind] || (byKind[a.kind] = [])).push(a.ref)
  }
  return Object.keys(byKind)
    .sort((x, y) => {
      const ix = WM_KIND_ORDER.indexOf(x), iy = WM_KIND_ORDER.indexOf(y)
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
    })
    .map((kind) => [kind, byKind[kind]])
}

// Minimal task shape carrying only the id field `activityRef`/`autoStartFromTask` read
// for this kind — enough to gate + resume a start, without needing the full content
// record (monster/action/etc) that the owning screen looks up for itself.
function fakeTaskFor(kind, ref) {
  switch (kind) {
    case 'combat': return { type: 'combat', monster: { id: ref } }
    case 'raid': return { type: 'raid', raid: { id: ref } }
    case 'skill': {
      const i = ref.indexOf(':')
      return i < 0 ? null : { type: 'skill', skill: ref.slice(0, i), action: { id: ref.slice(i + 1) } }
    }
    case 'gather': return { type: 'gather', gatherTask: { id: ref } }
    case 'agility': return { type: 'agility', action: { id: ref } }
    case 'thieving': return { type: 'thieving', npc: { id: ref } }
    case 'hunter': return { type: 'hunter', action: { id: ref } }
    // No specific reward task at this level (the place hub lists the whole venue) — gate
    // by the minigame itself; arrival just opens the Minigames screen, task unpicked.
    case 'minigame': return { type: 'minigame', minigameTask: { minigame: ref } }
    default: return null
  }
}

export default function WorldMapScreen({ onNavigate, onAutoStart } = {}) {
  const {
    worldLocation, updateWorldLocation, activeTask, setActiveTask, addToast, requestActivityStart,
    inventory, bank, equipment, stats, itemsData, updateInventory, updateBankDirect, grantXP,
  } = useGame()
  const world = getWorld()
  const here = getPlace(worldLocation) ? worldLocation : world.start
  const travel = activeTask?.type === 'travel' ? activeTask : null
  const magicLevel = getLevelFromXP(stats?.magic?.xp || 0)

  const beginTravel = (destId) => {
    const task = createTravelTask(here, destId)
    if (!task) return
    setActiveTask(task)
    setOpenId(null)
    addToast(`🧭 Travelling to ${travelDestName(task)}`, 'info')
  }

  // Instant magic travel: needs the place's Magic level + runes (world.json
  // `teleport`), consumes them inventory-first like spellcasting, grants Magic XP.
  // Teleporting supersedes whatever occupied the single task slot — the same rule
  // as starting a walk — except a journey walking leg, which re-plans from the
  // landing place (landing on the waypoint itself skips straight to the search).
  const teleCheckFor = (destId) =>
    teleportCheck(destId, { magicLevel, inventory, bank, equipment, itemsData })

  const castTeleport = (destId) => {
    if (destId === here && !travel) return
    if (travel?.journey?.phase === 'search') {
      addToast(`You're searching ${travelDestName(travel)} — finish or abandon the journey first.`, 'info')
      return
    }
    const chk = teleCheckFor(destId)
    if (!chk.ok) {
      addToast(chk.reason, 'error')
      return
    }
    let nextTask = null
    let searching = false
    if (travel?.journey) {
      const re = teleportIntoJourney(travel, destId)
      if (!re) {
        addToast('The trail cannot continue from there.', 'error')
        return
      }
      nextTask = re.task
      searching = re.searching
    }
    const paid = deductRunes(chk.runes, inventory)
    if (!paid) {
      addToast('Not enough runes.', 'error')
      return
    }
    updateInventory(paid.inventory)
    if (Object.keys(paid.bankUpdates).length > 0) updateBankDirect(paid.bankUpdates)
    grantXP('magic', chk.xp)
    updateWorldLocation(destId)
    setActiveTask(nextTask)
    setOpenId(null)
    const name = getPlace(destId)?.name || destId
    addToast(searching ? `Teleported to ${name} — the search begins` : `Teleported to ${name}`, 'info')
  }

  // Clicking an activity row in the place hub acts exactly like clicking it from its own
  // screen: starts immediately if we're already at a place that offers it, or opens the
  // same travel prompt used everywhere else if not (gameState's requestActivityStart
  // handles both — this just supplies the minimal task shape and, on an immediate start,
  // navigates to the owning screen the same way arrival auto-resume does).
  const activateActivity = (kind, ref) => {
    const task = fakeTaskFor(kind, ref)
    if (!task) return
    if (requestActivityStart(task)) {
      if (kind === 'minigame') onNavigate?.(SCREENS.MINIGAMES)
      else onAutoStart?.(autoStartFromTask(task))
    }
  }
  // Turning back keeps the legs already walked: snap to the last node fully reached
  // (plan §9 #2) rather than reverting the whole journey to its origin. Abandoning a
  // clue/quest journey costs nothing but the time spent — the scroll/quest is only
  // consumed on the final search.
  const cancelTravel = () => {
    if (!travel) return
    const journey = !!travel.journey
    const stopAt = travelCancelLocation(travel)
    setActiveTask(null)
    if (stopAt && stopAt !== here) {
      updateWorldLocation(stopAt)
      addToast(`${journey ? 'Journey abandoned' : 'Travel cancelled'} — you stop at ${getPlace(stopAt)?.name || stopAt}`, 'info')
    } else {
      addToast(journey ? 'Journey abandoned' : 'Travel cancelled', 'info')
    }
  }

  // Credit skip: the server owns the atomic 1-credit debit (/api/travel/skip);
  // the client then zeroes the countdown so the very next game tick runs the
  // normal completion path — walking legs arrive, searches finish (final
  // searches grant their content), journey phases chain, and queued
  // auto-starts fire exactly as if the timer ran out on its own. Cloud
  // accounts only (credits live server-side).
  const travelRef = useRef(travel)
  travelRef.current = travel
  const [skipBusy, setSkipBusy] = useState(false)
  const canCreditSkip = !!(getToken() && getCharacterId())
  const skipTravel = async () => {
    if (skipBusy || !travelRef.current) return
    setSkipBusy(true)
    try {
      const res = await api.travelSkip()
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      // Re-read the live task: if the leg ended during the round-trip there
      // is nothing left to finish (never resurrect a completed task).
      const cur = travelRef.current
      if (cur) setActiveTask({ ...cur, ticksRemaining: 0 })
      addToast('💎 Skipped ahead — 1 credit', 'info')
    } catch (err) {
      if (err?.status === 402) addToast('Not enough credits to skip.', 'error')
      else addToast(err?.message || 'Failed to skip travel.', 'error')
    } finally {
      setSkipBusy(false)
    }
  }

  const stageRef = useRef(null)
  const boardRef = useRef(null)
  const viewRef = useRef({ x: 0, y: 0, k: 1 })
  const dragRef = useRef(null)
  const pointersRef = useRef(new Map()) // active pointers, for two-finger pinch
  const pinchRef = useRef(null) // { d0, k0, x0, y0, mid0 } while pinching
  const pinchEndedAtRef = useRef(0) // suppress the trailing click on a node
  const [openId, setOpenId] = useState(null)
  // Generated map art (scripts/tripo-worldmap.mjs → world.json `mapImage`):
  // when set and loadable it replaces the painted procedural terrain; any
  // load failure falls straight back so the chart never renders blank.
  const [mapArtOk, setMapArtOk] = useState(true)

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

  // ── pan + pinch ──
  const onPointerDown = (e) => {
    const pts = pointersRef.current
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Never capture a pointer that started on a node: capture retargets the eventual
    // click to the stage and the place tap would die. Pinch moves still reach us by
    // bubbling — the stage fills the screen.
    if (!e.target.closest('.wm-node')) stageRef.current?.setPointerCapture?.(e.pointerId)
    if (pts.size === 2) {
      // Second finger starts a pinch (even if it lands on a node): freeze the drag and
      // remember the starting view + finger midpoint/spread.
      const [a, b] = [...pts.values()]
      const v = viewRef.current
      dragRef.current = null
      pinchRef.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        k0: v.k, x0: v.x, y0: v.y,
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      return
    }
    if (pts.size > 2 || e.target.closest('.wm-node')) return
    const v = viewRef.current
    dragRef.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: 0 }
  }

  const onPointerMove = (e) => {
    const pts = pointersRef.current
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pinch = pinchRef.current
    if (pinch && pts.size >= 2) {
      const stage = stageRef.current
      if (!stage) return
      const rect = stage.getBoundingClientRect()
      const [a, b] = [...pts.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
      const v = viewRef.current
      // Keep the world point that started under the fingers glued to their midpoint.
      const wx = (pinch.mid0.x - rect.left - pinch.x0) / pinch.k0
      const wy = (pinch.mid0.y - rect.top - pinch.y0) / pinch.k0
      v.k = clampK(pinch.k0 * (d / pinch.d0))
      v.x = mid.x - wx * v.k
      v.y = mid.y - wy * v.k
      applyView()
      return
    }
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
  const endDrag = (e) => {
    const pts = pointersRef.current
    if (e?.pointerId != null) pts.delete(e.pointerId)
    else pts.clear()
    if (pinchRef.current && pts.size < 2) {
      pinchRef.current = null
      pinchEndedAtRef.current = Date.now()
    }
    if (pts.size === 0) dragRef.current = null
  }

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
    // Suppress the click that ended a drag or a pinch.
    if (dragRef.current && dragRef.current.moved > 6) return
    if (pinchRef.current || Date.now() - pinchEndedAtRef.current < 350) return
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
          {world.mapImage && mapArtOk
            ? <img class="wm-map-img" src={world.mapImage} alt="" draggable={false} onError={() => setMapArtOk(false)} />
            : <WorldTerrain />}
          <div class="wm-grunge" aria-hidden="true" />
          <svg class="wm-routes" width={world.board.w} height={world.board.h} xmlns="http://www.w3.org/2000/svg">
            {world.edges.map(([a, b, t]) => {
              const pa = world.places[a]
              const pb = world.places[b]
              if (!pa || !pb) return null
              const mx = (pa.x + pb.x) / 2
              const my = (pa.y + pb.y) / 2
              const label = wmTravelTime(t)
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
        <aside class="forge-shell wm-legend">
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

        {/* travel banner — a plain trip, or a Phase 5 clue/quest journey with steps */}
        {travel && (() => {
          const js = journeyStatus(travel)
          // Skip the walk: teleport straight to the leg's destination (journeys
          // then start their search there). Hidden mid-search — nothing to skip.
          const tele = js?.searching ? null : teleCheckFor(travel.dest)
          return (
            <div class="forge-shell wm-travelbar" role="status">
              <div class="wm-travelbar-top">
                <span class="wm-travelbar-lead">
                  {js
                    ? <>{js.icon} {js.searching ? <>Searching <b>{travelDestName(travel)}</b></> : <>Following the trail to <b>{travelDestName(travel)}</b></>}</>
                    : <>Travelling to <b>{travelDestName(travel)}</b></>}
                </span>
                <span class="wm-travelbar-ticks">{wmTravelTime((travel.totalTicks ?? 0) - (travel.ticksRemaining ?? 0))} / {wmTravelTime(travel.totalTicks ?? 0)}</span>
              </div>
              <div class="wm-track"><div class="wm-track-fill" style={{ width: Math.round(travelFraction(travel) * 100) + '%' }} /></div>
              <div class="wm-travelbar-route">
                {js
                  ? `${js.name} — step ${js.step} of ${js.steps}`
                  : `Route: ${(travel.path || []).map((id) => getPlace(id)?.name || id).join(' → ')}`}
              </div>
              <div class="wm-travelbar-actions">
                {canCreditSkip && (
                  <button class="wm-travelbar-skip" disabled={skipBusy} onClick={skipTravel} title={js?.searching ? 'Finish this search instantly — costs 1 credit' : 'Finish this walk instantly — costs 1 credit'}>
                    💎 Skip · 1 credit
                  </button>
                )}
                {tele?.ok && (
                  <button class="wm-travelbar-tele" onClick={() => castTeleport(travel.dest)} title={`Consumes ${formatRuneCost(tele.runes, itemsData)} · +${tele.xp} Magic XP`}>
                    <GameIcon iconKey={getSkillArt('magic').icon} color="#fff" size={16} /> Teleport ahead
                  </button>
                )}
                <button class="wm-travelbar-cancel" onClick={cancelTravel}>{js ? 'Abandon journey' : 'Turn back'}</button>
              </div>
            </div>
          )
        })()}
      </div>

      {/* place hub */}
      {openPlace && (
        <PlaceHub
          place={openPlace}
          here={here}
          travelling={!!travel}
          searching={travel?.journey?.phase === 'search'}
          tele={teleCheckFor(openPlace.id)}
          itemsData={itemsData}
          onTravel={beginTravel}
          onTeleport={castTeleport}
          onClose={() => setOpenId(null)}
          onActivate={activateActivity}
        />
      )}
    </div>
  )
}

function PlaceHub({ place, here, travelling, searching, tele, itemsData, onTravel, onTeleport, onClose, onActivate }) {
  const tier = getTier(place.tier)
  const isHere = place.id === here
  const route = isHere ? null : shortestPath(here, place.id)
  const canTravel = !isHere && !travelling && route && route.ticks > 0
  // Teleporting is allowed mid-walk (that's its point — skip the roads); only a
  // journey search pins you to its waypoint until finished or abandoned.
  const showTeleport = !isHere && place.teleport && !searching
  const [openCategory, setOpenCategory] = useState(null)

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
          {(isHere || travelling || !route) && (
            <div class="wm-hub-note">
              {isHere
                ? 'You are here.'
                : searching
                  ? 'You are mid-search on a journey. Finish or abandon it before moving on.'
                  : travelling
                    ? 'You are already travelling — turn back to walk elsewhere, or teleport to skip the roads.'
                    : 'No road reaches this place yet.'}
            </div>
          )}
          {canTravel && (
            <button class="wm-travel-btn" onClick={() => onTravel(place.id)}>
              Travel here · {wmTravelTime(route.ticks)}
            </button>
          )}
          {showTeleport && (
            <button
              class={`wm-tele-btn${tele.ok ? '' : ' is-locked'}`}
              onClick={() => tele.ok ? onTeleport(place.id) : null}
              disabled={!tele.ok}
              title={tele.ok ? `Teleport — instant, +${tele.xp} Magic XP` : tele.reason}
            >
              <span class="wm-tele-btn__lead">
                <GameIcon iconKey={getSkillArt('magic').icon} color={tele.ok ? '#fff' : 'var(--fm-ink-faint)'} size={16} /> Teleport · Magic {place.teleport.level}
              </span>
              <span class="wm-tele-btn__cost">{tele.ok ? formatRuneCost(tele.runes, itemsData) : tele.reason}</span>
            </button>
          )}
          <div class="wm-hub-sectionhead"><span>Available here</span></div>
          <div class="wm-cat-grid">
            {groupActivities(placeActivities(place.id)).map(([kind, refs]) => {
              const k = getKind(kind)
              return (
                <button class="wm-cat-btn" key={kind} onClick={() => setOpenCategory(kind)}>
                  <span class="wm-cat-btn__dot" style={{ background: k?.color || 'var(--fm-brass)' }} />
                  <span class="wm-cat-btn__label">{k?.label || kind}</span>
                  <span class="wm-cat-btn__count">{refs.length}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {openCategory && (
        <CategoryModal
          kind={openCategory}
          refs={groupActivities(placeActivities(place.id)).find(([k]) => k === openCategory)?.[1] || []}
          label={getKind(openCategory)?.label || openCategory}
          onClose={() => setOpenCategory(null)}
          onActivate={onActivate}
        />
      )}
    </>
  )
}

// One category's actions, e.g. all "Skill" refs at a place — sub-grouped by skill
// (activityGroupLabel) where that's meaningful, so a 140-action city doesn't render
// as one flat list. Vellum ledger panel (wm-actmodal-panel), matching the app-wide
// Forgemark parchment.
function CategoryModal({ kind, refs, label, onClose, onActivate }) {
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
      {groups.map((g, gi) => (
        <div class="wm-actmodal-group" key={g.label || gi}>
          {g.label && <div class="wm-actmodal-grouphead">{g.label}</div>}
          <div class="fm-ledger">
            {g.refs.map((ref, i) => {
              const d = describeActivity(kind, ref)
              return (
                <button class="wm-actmodal-row" key={i} onClick={() => onActivate(kind, ref)}>
                  <span class="wm-actmodal-row__icon">{d.icon}</span>
                  <span class="wm-actmodal-row__name">{d.name}</span>
                  {d.level != null && <span class="wm-actmodal-row__lvl">{d.level}</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </Modal>
  )
}
