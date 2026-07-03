import { useGame } from '../state/gameState.jsx'
import { useState } from 'preact/hooks'
import { getWorld, getPlace, listPlaces, getTier, getKind, shortestPath, pathLegs } from '../engine/world.js'
import { isPlaceVaryingSkillRef, autoStartFromTask, placeActivities, activityLockReason } from '../engine/worldContent.js'
import { SCREENS } from '../utils/constants.js'
import { createTravelTask, travelFraction, travelDestName, travelCancelLocation } from '../engine/travel.js'
import { journeyStatus, teleportIntoJourney, planQuestJourney } from '../engine/journeys.js'
import { teleportCheck, deductRunes, formatRuneCost } from '../engine/teleports.js'
import { getLevelFromXP } from '../engine/experience.js'
import { PlaceIcon, PlaceScene, WorldTerrain } from '../components/PlaceArt.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { getSkillArt } from '../utils/skillArt.js'
import WaxSeal from '../components/WaxSeal.jsx'
import ActivityPickerModal from '../components/ActivityPickerModal.jsx'
import PlaceMapView from '../components/PlaceMapView.jsx'
import SlayerMasterModal from '../components/SlayerMasterModal.jsx'
import { placeHasMap } from '../engine/placeMaps.js'
import { usePanZoomStage } from '../hooks/usePanZoomStage.js'
import { getToken, getCharacterId } from '../cloud/api.js'
import questsData from '../data/quests.json'

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
const WM_KIND_ORDER = ['raid', 'boss', 'dungeon', 'combat', 'slayer', 'skill', 'gather', 'agility', 'thieving', 'hunter', 'quest', 'minigame', 'shop']
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
    // Getting a slayer task from the master homed here — never becomes an
    // activeTask; arrival routes to the Slayer screen which assigns it.
    case 'slayer': return { type: 'slayermaster', master: { id: ref } }
    default: return null
  }
}

export default function WorldMapScreen({ onNavigate, onAutoStart, initialView } = {}) {
  const {
    worldLocation, updateWorldLocation, activeTask, setActiveTask, addToast, requestActivityStart,
    inventory, bank, equipment, stats, itemsData, updateInventory, updateBankDirect, grantXP,
    skipHourHandlerRef, completedQuests, bossKillCounts, questQueue, removeFromQuestQueue,
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
    // Landing free (not resuming a journey): open the place's own map (when it
    // has one) or its hub so its activities are one tap away. Mid-journey
    // teleports keep the map clear.
    setOpenId(null)
    if (!nextTask && placeHasMap(destId)) setMapPlaceId(destId)
    else if (!nextTask) setOpenId(destId)
    const name = getPlace(destId)?.name || destId
    addToast(searching ? `Teleported to ${name} — the search begins` : `Teleported to ${name}`, 'info')
  }

  // Clicking an activity row in the place hub acts exactly like clicking it from its own
  // screen: starts immediately if we're already at a place that offers it, or opens the
  // same travel prompt used everywhere else if not (gameState's requestActivityStart
  // handles both — this just supplies the minimal task shape and, on an immediate start,
  // navigates to the owning screen the same way arrival auto-resume does).
  const activateActivity = (kind, ref) => {
    // Same locks the owning screens enforce on their action lists (levels,
    // slayer/quest gates, quest eligibility) — without this the hub row would
    // start (or travel to + auto-start) content above the player's level.
    // Rows render disabled off the same check; this backstops direct calls.
    const lock = activityLockReason(kind, ref, { stats, completedQuests, bossKillCounts })
    if (lock) {
      addToast(`${lock.reason}.`, lock.completed ? 'info' : 'error')
      return
    }
    // One master per place: tapping it opens its hub (get / cancel a task)
    // rather than assigning straight away, so an active task can't be replaced.
    if (kind === 'slayer') {
      setSlayerMasterId(ref)
      return
    }
    // Quests aren't place-bound tasks: starting one undertakes its journey from
    // wherever the player is — same flow as the quest board (QuestsScreen).
    if (kind === 'quest') {
      startQuestFromMap(ref)
      return
    }
    const task = fakeTaskFor(kind, ref)
    if (!task) return
    if (requestActivityStart(task)) {
      if (kind === 'minigame') onNavigate?.(SCREENS.MINIGAMES)
      // Starts from the place map carry a returnTo so the owning screen's
      // back/stop buttons come back to this map, not a hardcoded list.
      else onAutoStart?.(autoStartFromTask(task), mapPlaceId ? { screen: SCREENS.WORLD_MAP, data: { view: 'place' } } : undefined)
    }
  }

  // "Get New Task" from a master's hub modal: the same start flow as any other
  // place activity (immediate assign when here, travel prompt when remote).
  const startSlayerMaster = (ref) => {
    setSlayerMasterId(null)
    const task = fakeTaskFor('slayer', ref)
    if (requestActivityStart(task)) {
      onAutoStart?.(autoStartFromTask(task), mapPlaceId ? { screen: SCREENS.WORLD_MAP, data: { view: 'place' } } : undefined)
    }
  }

  // Start a quest journey from a place modal — the same flow as the quest board
  // (QuestsScreen.startQuestJourney): plan from the current location, dequeue it
  // if it was queued, and stay on the map to watch the trail unfold.
  const startQuestFromMap = (questId) => {
    const quest = questsData.find((q) => q.id === questId)
    if (!quest) return
    if (activeTask?.type === 'travel') {
      addToast('Finish or turn back your current journey first.', 'info')
      return
    }
    const jt = planQuestJourney(quest, here)
    if (!jt) {
      addToast('No route can be plotted from here.', 'error')
      return
    }
    setActiveTask(jt)
    if (questQueue.some((q) => q.id === quest.id)) removeFromQuestQueue(quest.id)
    setOpenId(null)
    setMapPlaceId(null)
    addToast(`🗺️ Journey begun: ${quest.name} — ${jt.journey.steps.length} places to visit`, 'info')
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

  // Credit skip: delegates to the shared Skip-1h flow (preflight, atomic
  // /api/skip-hour debit, then 1 hour of trail time — the current clue/quest
  // always finishes, leftover time chains the next scroll). Cloud accounts
  // only, same as the header skip button.
  const [skipBusy, setSkipBusy] = useState(false)
  const canCreditSkip = !!(getToken() && getCharacterId())
  const skipTravel = async () => {
    if (skipBusy) return
    setSkipBusy(true)
    try {
      await skipHourHandlerRef?.current?.()
    } finally {
      setSkipBusy(false)
    }
  }

  const [openId, setOpenId] = useState(null)
  // Slayer master whose hub modal is open (get / cancel a task). Set from
  // activateActivity; the modal's "Get New Task" runs startSlayerMaster.
  const [slayerMasterId, setSlayerMasterId] = useState(null)
  // Full-screen place map (PlaceMapView) for the place the player is at, when
  // placeMaps.json defines one — opened instead of the hub. `initialView:
  // 'place'` (a skilling screen's back/stop returnTo) reopens it on mount.
  const [mapPlaceId, setMapPlaceId] = useState(() =>
    initialView === 'place' && placeHasMap(here) ? here : null)
  // Generated map art (scripts/tripo-worldmap.mjs → world.json `mapImage`):
  // when set and loadable it replaces the painted procedural terrain; any
  // load failure falls straight back so the chart never renders blank.
  const [mapArtOk, setMapArtOk] = useState(true)

  const { stageRef, boardRef, stageProps, fitAll, zoomBy, wasGestureClick } = usePanZoomStage({
    boardW: world.board.w,
    boardH: world.board.h,
    uiSelector: '.wm-node, .wm-travelbar, .wm-legend, .wm-ctl',
  })

  const onNodeClick = (id) => {
    // Suppress the click that ended a drag or a pinch.
    if (wasGestureClick()) return
    // Your current place opens its interactive town map (when it has one)
    // rather than the hub — activities start from the map's spots.
    if (id === here && placeHasMap(id)) { setMapPlaceId(id); return }
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
        {...stageProps}
      >
        <div ref={boardRef} class="wm-board" style={{ width: world.board.w + 'px', height: world.board.h + 'px' }}>
          <div class="wm-chart" />
          {world.mapImage && mapArtOk
            ? <img class="wm-map-img" src={world.mapImage} alt="" draggable={false} onError={() => setMapArtOk(false)} />
            : <WorldTerrain />}
          <div class="wm-grunge" aria-hidden="true" />
          {/* Roads only — travel times live in the place hub / travel banner,
              never on the chart itself. */}
          <svg class="wm-routes" width={world.board.w} height={world.board.h} xmlns="http://www.w3.org/2000/svg">
            {world.edges.map(([a, b]) => {
              const pa = world.places[a]
              const pb = world.places[b]
              if (!pa || !pb) return null
              return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} class="wm-road" />
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
                  <button class="wm-travelbar-skip" disabled={skipBusy} onClick={skipTravel} title="Skip 1 hour of travel — 1 credit. The current clue or quest always finishes; spare time runs the next scroll.">
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

      {/* place map — full-screen interactive town map for the current place */}
      {mapPlaceId && getPlace(mapPlaceId) && (
        <PlaceMapView
          place={getPlace(mapPlaceId)}
          onClose={() => setMapPlaceId(null)}
          onActivate={activateActivity}
          onNavigate={onNavigate}
        />
      )}

      {/* Slayer master hub — get / cancel a task (one master per place) */}
      {slayerMasterId && (
        <SlayerMasterModal
          masterId={slayerMasterId}
          onClose={() => setSlayerMasterId(null)}
          onGetTask={() => startSlayerMaster(slayerMasterId)}
          onSlay={(monsterId) => { setSlayerMasterId(null); activateActivity('combat', monsterId) }}
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
  // Places with their own interactive map (placeMaps.json) start activities
  // from that map's spots — the hub's list is browse-only for them. Places
  // without one keep the clickable list so nothing becomes unstartable.
  const hasOwnMap = placeHasMap(place.id)

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
          {hasOwnMap && (
            <div class="wm-hub-note">Activities in {place.name} start from its town map — travel or teleport here to open it. Quests can begin from anywhere.</div>
          )}
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
        <ActivityPickerModal
          kind={openCategory}
          refs={groupActivities(placeActivities(place.id)).find(([k]) => k === openCategory)?.[1] || []}
          label={getKind(openCategory)?.label || openCategory}
          onClose={() => setOpenCategory(null)}
          onActivate={onActivate}
          readOnly={hasOwnMap}
        />
      )}
    </>
  )
}
