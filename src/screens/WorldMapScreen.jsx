import { useGame } from '../state/gameState.jsx'
import { useState, useEffect } from 'preact/hooks'
import { getWorld, getPlace, listPlaces, getTier, getKind, shortestPath, pathLegs } from '../engine/world.js'
import { isPlaceVaryingSkillRef, autoStartFromTask, placeActivities, activityLockReason } from '../engine/worldContent.js'
import { SCREENS } from '../utils/constants.js'
import { createTravelTask, travelFraction, travelDestName, formatTravelTicks } from '../engine/travel.js'
import { planQuestJourney } from '../engine/journeys.js'
import TeleportRuneCost from '../components/TeleportRuneCost.jsx'
import { PlaceIcon, PlaceScene, WorldTerrain } from '../components/PlaceArt.jsx'
import GameIcon from '../components/GameIcon.jsx'
import WorldEntryButton from '../components/WorldEntryButton.jsx'
import { worldBetaEnabled } from '../utils/helpers.js'
import { getSkillArt } from '../utils/skillArt.js'
import WaxSeal from '../components/WaxSeal.jsx'
import ActivityPickerModal from '../components/ActivityPickerModal.jsx'
import PlaceMapView from '../components/PlaceMapView.jsx'
import SlayerMasterModal from '../components/SlayerMasterModal.jsx'
import TravelStatusContent from '../components/TravelStatusContent.jsx'
import { useTravelStatus } from '../hooks/useTravelStatus.js'
import { placeHasMap } from '../engine/placeMaps.js'
import { RAID_TASK_META } from '../engine/slayerMasters.js'
import { usePanZoomStage } from '../hooks/usePanZoomStage.js'
import questsData from '../data/quests.json'
import minigamesData from '../data/minigames.json'
import { isMinigameItemUnlocked } from '../utils/completion.js'
import { countItem } from '../engine/inventory.js'

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

// Group a place's `{ kind, ref }` activities into [kind, [ref, ...]] pairs in a stable
// kind order for the hub's grouped list.
const WM_KIND_ORDER = ['raid', 'boss', 'dungeon', 'combat', 'slayer', 'skill', 'gather', 'farming', 'agility', 'thieving', 'hunter', 'quest', 'minigame', 'shop']
function groupActivities(activities) {
  const byKind = {}
  for (const a of activities || []) {
    if (!a || !a.kind || !a.ref) continue
    if (a.kind === 'skill' && !isPlaceVaryingSkillRef(a.ref)) continue
    // Bank is already shown via the place.facilities badges above this grid —
    // a "Bank 1" category button here would just be a redundant second glyph
    // for the same thing (same reasoning as the skill exclusion above).
    if (a.kind === 'bank') continue
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
    // Farming: ref is the farm location id; arrival opens that farm's patch view.
    case 'farming': return { type: 'farming', location: { id: ref } }
    // Minigames are handled in activateActivity: the venue ref alone can't start
    // anything — a specific reward task is picked there so it can auto-start.
    // Getting a slayer task from the master homed here — never becomes an
    // activeTask; arrival routes to the Slayer screen which assigns it.
    case 'slayer': return { type: 'slayermaster', master: { id: ref } }
    default: return null
  }
}

export default function WorldMapScreen({ onNavigate, onAutoStart, initialView } = {}) {
  const {
    worldLocation, activeTask, setActiveTask, addToast, requestActivityStart,
    inventory, bank, equipment, stats, itemsData,
    completedQuests, bossKillCounts, killCountsLoaded, questQueue, removeFromQuestQueue,
    unlockedMinigameItems,
  } = useGame()
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

  // Teleport check/cast + turn-back are shared with TravelStatusModal (the
  // same status shown on any other screen) via useTravelStatus — one source
  // of truth for the rune bill and what landing does. Landing free (not
  // resuming a journey or a gated action) opens the place's own map (when it
  // has one) or its hub here, since this screen is the one place with a hub
  // to open; TravelStatusModal has none, so it leaves onLandedFree unset.
  const { teleCheckFor, castTeleport, cancelTravel } = useTravelStatus({
    onAutoStart: (autoStart, returnTo) => {
      setOpenId(null)
      setMapPlaceId(null)
      setSlayerMasterId(null)
      onAutoStart?.(autoStart, returnTo)
    },
    onLandedFree: (destId) => {
      setOpenId(null)
      if (placeHasMap(destId)) setMapPlaceId(destId)
      else setOpenId(destId)
    },
  })

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
    const lock = activityLockReason(kind, ref, { stats, completedQuests, bossKillCounts, bossKillCountsLoaded: killCountsLoaded })
    if (lock) {
      addToast(`${lock.reason}.`, (lock.completed || lock.pending) ? 'warning' : 'error')
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
    // Minigames auto-start rather than stopping at the Minigames list: pick the
    // venue's next reward task here so the task shape carries a specific id —
    // an immediate start (and a travel arrival) then resumes it via the
    // Minigames screen's initialTaskId auto-start.
    const task = kind === 'minigame'
      ? (() => {
          const mgTask = pickMinigameTask(ref)
          if (!mgTask) addToast("You're missing an item this minigame's tasks require.", 'error')
          return mgTask ? { type: 'minigame', minigameTask: mgTask } : null
        })()
      : fakeTaskFor(kind, ref)
    if (!task) return
    if (requestActivityStart(task)) {
      // Starts from the place map carry a returnTo so the owning screen's
      // back/stop buttons come back to this map, not a hardcoded list.
      onAutoStart?.(autoStartFromTask(task), mapPlaceId ? { screen: SCREENS.WORLD_MAP, data: { view: 'place' } } : undefined)
    }
  }

  // Venue → the reward task an auto-start runs: first not-yet-unlocked task whose
  // item requirement is met (data order — the same order the Minigames screen
  // lists), falling back to the first startable one so a finished venue can
  // still be re-run. Null when every task needs an item the player doesn't own.
  const pickMinigameTask = (venueId) => {
    const owned = (itemId) => countItem(inventory, itemId) > 0
      || (bank?.[itemId]?.quantity > 0)
      || Object.values(equipment || {}).some((slot) => slot?.itemId === itemId)
    const startable = minigamesData.tasks.filter((t) => t.minigame === venueId && (!t.requiresItem || owned(t.requiresItem)))
    return startable.find((t) => !isMinigameItemUnlocked(unlockedMinigameItems, t.product)) || startable[0] || null
  }

  // "Get New Task" travel gate: returns true when the player is at the master's
  // place (assign happens inline in the modal, so we stay on the map), false
  // when a travel prompt was raised — arrival then auto-assigns via resumeAutoStart.
  const startSlayerMaster = (ref) => requestActivityStart(fakeTaskFor('slayer', ref))

  // Start a quest journey from a place modal — the same flow as the quest board
  // (QuestsScreen.startQuestJourney): plan from the current location, dequeue it
  // if it was queued, and stay on the map to watch the trail unfold.
  const startQuestFromMap = (questId) => {
    const quest = questsData.find((q) => q.id === questId)
    if (!quest) return
    if (activeTask?.type === 'travel') {
      addToast('Finish or turn back your current journey first.', 'warning')
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

  // When a journey begins (an action gated behind travel was confirmed), close
  // any open place modal so the player drops onto the map and can watch their
  // token walk the route. Fires only on the transition into travel, so hubs
  // opened mid-journey (e.g. to teleport) stay put.
  const traveling = !!travel
  useEffect(() => {
    if (traveling) {
      setOpenId(null)
      setMapPlaceId(null)
      setSlayerMasterId(null)
    }
  }, [traveling])

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
      {worldBetaEnabled() && !travel && <WorldEntryButton className="wm-explore" />}
      {/* stage */}
      <div
        ref={stageRef}
        class="wm-stage absolute inset-0"
        {...stageProps}
      >
        {/* The chart is painted parchment in BOTH themes, so its labels must not
            read the flipping text tokens — a nested data-theme pins the whole
            board to the vellum side. */}
        <div ref={boardRef} class="wm-board" data-theme="light" style={{ width: world.board.w + 'px', height: world.board.h + 'px' }}>
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
        <div class="wm-ctl" data-theme="light">
          <button onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
          <button onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">−</button>
          <button onClick={fitAll} title="Fit map" aria-label="Fit map">⤢</button>
        </div>

        {/* travel banner — a plain trip, or a Phase 5 clue/quest journey with steps.
            Content shared with TravelStatusModal via TravelStatusContent — this is
            just the map's own chrome around it. */}
        {travel && (
          <div class="forge-shell wm-travelbar" role="status">
            <TravelStatusContent
              travel={travel}
              teleCheckFor={teleCheckFor}
              itemsData={itemsData}
              onTeleport={() => castTeleport(travel.dest)}
              onCancel={cancelTravel}
            />
          </div>
        )}
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
          onSlay={(monsterId) => {
            setSlayerMasterId(null)
            // Raid-completion proxy tasks (RAID_TASK_META): the assigned "monster"
            // is a raid final boss, never independently placed — route into the
            // raid entry flow, never a bare 1-on-1 combat activity against it.
            const raidMeta = RAID_TASK_META[monsterId]
            activateActivity(raidMeta ? 'raid' : 'combat', raidMeta ? raidMeta.raidId : monsterId)
          }}
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
              Travel here · {formatTravelTicks(route.ticks)}
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
                <GameIcon iconKey={getSkillArt('magic').icon} color={tele.ok ? '#fff' : 'var(--text-faint)'} size={16} /> Teleport · Magic {place.teleport.level}
              </span>
              {/* Runes stay on screen when the cast is refused: the reason says
                  what is wrong, the icons say what it would take. */}
              <TeleportRuneCost runes={tele.runeCost} />
              {!tele.ok && <span class="wm-tele-btn__cost">{tele.reason}</span>}
            </button>
          )}
          <div class="wm-hub-sectionhead"><span>Available here</span></div>
          {hasOwnMap && (
            <div class="wm-hub-note">Activities in {place.name} start from its town map — travel or teleport here to open it. Quests can begin from anywhere.</div>
          )}
          <div class="wm-cat-grid">
            {groupActivities(placeActivities(place.id)).map(([kind, refs]) => {
              const k = getKind(kind)
              // A place hosts exactly one slayer master, so skip the picker list
              // and open its hub directly — one fewer tap.
              const onClick = kind === 'slayer'
                ? () => onActivate('slayer', refs[0])
                : () => setOpenCategory(kind)
              return (
                <button class="wm-cat-btn" key={kind} onClick={onClick}>
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
