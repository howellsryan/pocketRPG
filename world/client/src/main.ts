import { clearStoredSession, exchangeHandoff, getRunPref, getStoredSession, getStoredZone, parseHandoffFromHash, pocketRpgUrl, storeRunPref, storeZone, type WorldSession } from './auth'
import { hideBossFrame, hideConnBanner, hideOverlay, initChatInput, initHud, paintHudIcons, pushKillFeed, pushMessage, removeHpBar, removeNameplate, removeOverheadChat, removeOverheadPrayer, updateOverheadPrayer, renderEquipment, renderInventory, renderPrayerPanel, renderSpellbook, setPrayerState, setRunState, setSpecialEnergy, setSpellButton, setStanceActive, setThreatPanel, showBossFrame, showConnBanner, showContextMenu, showDeathChoiceOverlay, showHitsplat, showLoginRequired, showTransitionOverlay, showUniqueBanner, showPvpCrossingPrompt, setPvpBanner, showXpDrop, updateHpBar, updateHpPill, updateNameplate, updateOverheadChat, npcExamine, type SpellbookEntry, type TeleportEntry } from './ui'
import { PVP_LEVEL_BRACKET } from '../../shared/pvpArea'
import { createMinimap, type Minimap, type MinimapDot } from './minimap'
import { openWorldMap, type WorldMapData } from './worldMap'
import { closeBankUI, isBankOpen, openBankUI, updateBankInventory, updateBankUI } from './bank'
import { closeCraftUI, openCraftUI, updateCraftInventory, updateCraftStats, type SkillLevels } from './crafting'
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { connect, isInstanceDeathClose, isInstanceFullClose, onMessage, send } from './net'
import { createAwayWatch } from './away'
import { sendLeaveBeacon } from './leaveBeacon'
import { createCamera, createLights, createRenderer, createScene, FOG_FAR, tileToWorld, updateCamera, updateShadowLight } from './scene'
import { attachCameraControls } from './cameraControls'
import { createTerrain } from './terrain'
import { chunkFollowRadius, chunkKey, CHUNK_TILES, type ChunkedTerrain } from './chunkedTerrain'
import { createScatterLayers } from './scatter'
import { applyEntityDiff, applyGear, createEntity, createHeroMesh, createMonsterMesh, pickProxyOf, updateEntity, type Entity } from './entities'
import { createClickMarker, setupInput, showClickMarker, updateClickMarker } from './input'
import { preventPageZoom } from './preventZoom'
import { createStatics, type Statics } from './statics'
import { createProps } from './props'
import { createAmbient, type AmbientLayer } from './ambient'
import { createExitMarkers, type ExitLayer } from './exits'
import { createLootLayer, type LootLayer } from './loot'
import { itemName, loadItemIcons } from './itemIcon'
import { primaryInvAction } from '../../shared/itemActions'
import { combatLevelFromStats } from '../../../src/engine/combatLevel.js'
import { getCombatType } from '../../../src/engine/equipment.js'
import monstersData from '../../../src/data/monsters.json'
import itemsData from '../../../src/data/items.json'
import spellsData from '../../../src/data/spells.json'
import skillsData from '../../../src/data/skills.json'
import * as THREE from 'three'
import type { EntityDiff, ExitMarker, InvActionWire, InvSlot, ServerMessage, ZoneEvent } from '../../shared/protocol'
import type { MenuRow, Pickable } from './picking'

type Monsters = Record<string, { name?: string; combatLevel?: number; boss?: boolean } | undefined>
const monsters = monstersData as unknown as Monsters
type Items = Record<string, { poweredStaff?: boolean } | undefined>
const items = itemsData as unknown as Items
type Spells = Record<string, { name: string; levelReq: number }>
const spells = spellsData as unknown as Spells

// Full spellbook for the Magic tab. Combat spells drive autocast (select →
// tap a monster); skill spells are informational in the open world for now.
const combatSpellList: SpellbookEntry[] = Object.entries(spells)
  .map(([id, s]) => ({ id, name: s.name, level: s.levelReq }))
  .sort((a, b) => a.level - b.level)
type MagicAction = { id: string; name: string; level: number }
const skillSpellList: SpellbookEntry[] = ((skillsData as { magic?: { actions?: MagicAction[] } }).magic?.actions ?? [])
  .map((a) => ({ id: a.id, name: a.name, level: a.level }))
  .sort((a, b) => a.level - b.level)

function buildNpcPickable(diff: EntityDiff): Pickable {
  const monster = diff.monsterId ? monsters[diff.monsterId] : undefined
  return {
    kind: 'npc',
    id: diff.id,
    name: diff.name ?? monster?.name ?? 'Monster',
    actions: [{ label: 'Attack', action: 'attack' }],
    monsterLevel: monster?.combatLevel,
    examine: npcExamine(diff.monsterId ?? ''),
  }
}

/** Other players are menu-only (item 10): no `actions`, so topPick/hoverText
 * skip them (HOVER_PRIORITY has no 'player' entry) and a left-click through a
 * crowd still walks — buildMenu gives player pickables their own "Follow" and
 * (in the Wilderness) "Attack" rows instead of running them through the normal
 * actions list. Attack is deliberately NOT a left-click default: hitting a
 * stranger because they walked under your finger is not a fight anyone chose. */
function buildPlayerPickable(diff: EntityDiff): Pickable {
  return {
    kind: 'player',
    id: diff.id,
    name: diff.name ?? 'Adventurer',
    actions: [],
    monsterLevel: diff.combatLevel,
    ...(diff.bot ? { bot: true } : {}),
  }
}

function enterWorld(session: WorldSession): void {
  // The room this socket is bound to, kept so the exit beacon can name it — it
  // travels without a socket, so the server can't infer the room from the caller.
  const room = getStoredZone()
  const socket = connect(window.location.host, room)
  let self: Entity | null = null
  let statics: Statics | null = null
  let lootLayer: LootLayer | null = null
  let exitLayer: ExitLayer | null = null
  let ambientLayer: AmbientLayer | null = null
  // Chunk-streamed ground (big merged maps only; per-zone maps stay single-mesh
  // and leave this null). Driven each frame to follow the player.
  let chunkedTerrain: ChunkedTerrain | null = null
  let lastChunkKey = ''
  let transitioning = false
  let camera: THREE.PerspectiveCamera | null = null
  let cam: ReturnType<typeof attachCameraControls> | null = null
  let sun: THREE.DirectionalLight | null = null
  const npcs = new Map<string, Entity>()
  const npcLoading = new Set<string>()
  const pendingNpcDiff = new Map<string, EntityDiff>()
  const others = new Map<string, Entity>()
  const otherLoading = new Set<string>()
  const pendingOtherDiff = new Map<string, EntityDiff>()
  const overheads = new Map<string, { text: string; until: number }>()
  const rockStates = new Map<string, boolean>()
  // Latest damage-contribution snapshot per boss npc id (item 11), keyed so the
  // boss frame can look up whichever npc self.targetId currently points at.
  const threatByNpc = new Map<string, { charId: string; name: string; dmg: number }[]>()
  const EMPTY_CONTRIBUTORS: { charId: string; name: string; dmg: number }[] = []
  // Boss frame / threat panel are DOM rebuilds (setThreatPanel clears and
  // reconstructs rows via innerHTML) — calling them every animation frame is
  // layout thrash near a boss. Cache what was last drawn and skip the DOM
  // write when nothing changed; the threat snapshot only gets a new array
  // reference when a {e:'threat'} event lands, so identity comparison for
  // the contributors list is enough (no per-frame deep diff needed).
  let lastBossFrame: { npcId: string; hp: number; maxHp: number } | null = null
  let lastThreatContributors: { charId: string; name: string; dmg: number }[] | null = null
  let playerCombatLevel = 3
  /** Whether SELF is north of the Wilderness line. Server-reported
   * ({e:'pvpState'}) rather than derived from our own tile: the line is the
   * server's rule, and a client that decided it locally would offer attacks the
   * server then refuses. */
  let selfInDanger = false
  let minimap: Minimap | null = null
  let exitMarkers: ExitMarker[] = []
  // Local run state so the toggle button sends the opposite; server {e:'run'}
  // events keep it authoritative.
  let running = false
  // Local pack copy so a drag-reorder can apply optimistically; every server
  // {e:'inv'} (including the reorder echo) replaces it wholesale.
  let inventory: InvSlot[] = []
  // Session skill levels for the recipe panel's gates: seeded from the welcome,
  // advanced by {e:'xp'} events (level derived the same way the server does).
  let stats: SkillLevels = {}
  // Selected combat spell (magic weapons); server-validated, optimistic locally.
  let selectedSpell: string | null = null
  // The overworld's place centres, drawn as the Magic tab's Teleport section.
  // Empty on per-zone maps (no landmarks) → the section is dropped.
  let teleports: TeleportEntry[] = []
  // Zone-static data the big world map bakes/marks once at welcome — none of
  // it changes over the life of a session (a zone change is a full reload).
  let worldMapData: Omit<WorldMapData, 'self'> | null = null
  // Whether the equipped weapon can cast the selected spell (drives the "tap a
  // monster" vs "equip a staff" hint when a combat spell is picked).
  let magicWeaponEquipped = false

  /** Picks a combat spell from the Magic tab: highlights it, tells the server,
   * and prompts the player to choose a target. Casts on the next monster tap
   * once a staff is equipped (same autocast path as the Combat tab picker). */
  function selectCombatSpell(id: string): void {
    selectedSpell = id
    send(socket, { t: 'setSpell', spell: id })
    setSpellButton(magicWeaponEquipped, spells[id]?.name ?? id)
    refreshSpellbook()
    const name = spells[id]?.name ?? 'Spell'
    pushMessage(magicWeaponEquipped
      ? `${name} selected — tap a monster to attack.`
      : `${name} selected. Equip a staff, then tap a monster to cast it.`)
  }

  function selectSkillSpell(id: string): void {
    const name = skillSpellList.find((a) => a.id === id)?.name ?? 'That spell'
    pushMessage(`${name} is cast from the PocketRPG game — skill spells aren’t in the open world yet.`)
  }

  /** Repaints the Magic tab spellbook against the live Magic level + selection. */
  function refreshSpellbook(): void {
    renderSpellbook({
      teleports,
      combat: combatSpellList,
      skill: skillSpellList,
      magicLevel: stats.magic?.level ?? 1,
      selectedSpellId: selectedSpell,
      onTeleport: (placeId) => send(socket, { t: 'teleport', placeId }),
      onCombat: selectCombatSpell,
      onSkill: selectSkillSpell,
    })
  }

  /** Re-applies the persisted run toggle after a welcome — the server always
   * welcomes players walking, so without this the toggle resets on every
   * refresh, logout, or zone transition. */
  function syncRunFromPref(energy: number): void {
    if (!getRunPref() || energy <= 0 || running) return
    running = true
    setRunState(energy, true)
    send(socket, { t: 'setRun', run: true })
  }

  /** Shows the Combat tab's spell selector while a castable magic weapon is
   * equipped (powered staffs need no spell — the engine has its own path). */
  function refreshSpellUI(equipment: Record<string, string>): void {
    const weaponId = equipment.weapon
    const shaped = weaponId ? { weapon: { itemId: weaponId } } : {}
    magicWeaponEquipped = getCombatType(shaped, itemsData) === 'magic' && !(weaponId && items[weaponId]?.poweredStaff)
    setSpellButton(magicWeaponEquipped, selectedSpell ? spells[selectedSpell]?.name ?? selectedSpell : null)
    refreshSpellbook()
  }
  // partysocket reconnects silently and re-fires 'open'; a repeat welcome must
  // RESYNC the existing scene, never rebuild it (a second renderer/loop breaks
  // everything until a hard refresh).
  let sceneBuilt = false
  let authed = false
  let lastServerMsg = performance.now()

  function toScreen(pos: THREE.Vector3, yOffset: number): { x: number; y: number } {
    const v = pos.clone()
    v.y += yOffset
    if (camera) v.project(camera)
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight }
  }

  function meshOf(id: string): THREE.Object3D | null {
    if (self && id === self.id) return self.mesh
    return npcs.get(id)?.mesh ?? others.get(id)?.mesh ?? null
  }

  function handleEvent(event: ZoneEvent): void {
    if (event.e === 'inv') {
      inventory = event.inventory
      renderInventory(inventory)
      updateBankInventory(inventory)
      updateCraftInventory(inventory)
    }
    else if (event.e === 'hp') updateHpPill(event.hp, event.maxHp)
    else if (event.e === 'run') {
      running = event.running
      setRunState(event.energy, event.running)
    }
    else if (event.e === 'spec') setSpecialEnergy(event.energy, event.queued)
    else if (event.e === 'prayer') setPrayerState(event.points, event.max, event.protection, event.combat)
    else if (event.e === 'kill') pushKillFeed(event.monster, event.killer)
    else if (event.e === 'pvpPrompt') {
      showPvpCrossingPrompt(() => send(socket, { t: 'pvpConsent', yes: true }))
    }
    else if (event.e === 'pvpState') {
      selfInDanger = event.inDanger
      setPvpBanner(event.inDanger, event.opponentName)
    }
    else if (event.e === 'pvpKill') pushKillFeed(event.victim, event.killer)
    else if (event.e === 'uniqueDrop') showUniqueBanner(event.monster, event.player, event.item, event.epic)
    else if (event.e === 'threat') threatByNpc.set(event.npcId, event.contributors)
    else if (event.e === 'equip') {
      renderEquipment(event.equipment)
      refreshSpellUI(event.equipment)
    }
    else if (event.e === 'bank') {
      if (event.open) openBankUI(event.bank, inventory, (op, itemId, qty) => send(socket, { t: 'bank', op, itemId, qty }))
      else if (isBankOpen()) updateBankUI(event.bank)
    }
    else if (event.e === 'station') {
      openCraftUI(event.station, inventory, stats, (station, recipeId, qty) => send(socket, { t: 'craft', station, recipeId, qty }))
    }
    else if (event.e === 'xp') {
      const entry = stats[event.skill] ?? (stats[event.skill] = { xp: 0, level: 1 })
      const before = entry.level
      entry.xp += event.amount
      entry.level = Math.max(entry.level, getLevelFromXP(entry.xp))
      updateCraftStats(stats)
      if (event.skill === 'magic') refreshSpellbook()
      // A Prayer level-up unlocks new prayers — rebuild the toggle grid so they appear.
      if (event.skill === 'prayer' && entry.level > before) renderPrayerPanel(entry.level, (id) => send(socket, { t: 'pray', prayerId: id }))
      showXpDrop(event.skill, event.amount)
    }
    else if (event.e === 'msg') pushMessage(event.text)
    else if (event.e === 'hit') {
      const mesh = meshOf(event.targetId)
      if (mesh) {
        const s = toScreen(mesh.position, 0.9)
        showHitsplat(s.x, s.y, event.dmg)
      }
    } else if (event.e === 'chat') {
      pushMessage(`${event.name}: ${event.text}`)
      overheads.set(event.charId, { text: event.text, until: performance.now() + 4000 })
    }
  }

  function ensureNpc(scene: THREE.Scene, diff: EntityDiff): void {
    const existing = npcs.get(diff.id)
    if (existing) {
      applyEntityDiff(existing, diff)
      return
    }
    pendingNpcDiff.set(diff.id, diff)
    if (npcLoading.has(diff.id)) return
    npcLoading.add(diff.id)
    void createMonsterMesh(diff.monsterId).then(({ mesh, animator }) => {
      const d = pendingNpcDiff.get(diff.id) ?? diff
      if (!npcLoading.has(diff.id)) return
      const entity = createEntity(diff.id, d.x, d.z, mesh, animator)
      entity.serverAnim = d.anim
      entity.name = d.name
      entity.monsterId = d.monsterId
      entity.hp = d.hp
      entity.maxHp = d.maxHp
      mesh.userData.pick = buildNpcPickable(d)
      scene.add(entity.mesh)
      npcs.set(diff.id, entity)
      npcLoading.delete(diff.id)
      pendingNpcDiff.delete(diff.id)
    })
  }

  function removeNpc(id: string): void {
    const entity = npcs.get(id)
    if (entity) {
      entity.mesh.parent?.remove(entity.mesh)
      npcs.delete(id)
    }
    npcLoading.delete(id)
    pendingNpcDiff.delete(id)
    removeHpBar(id)
  }

  // Other players: shared hero model, name plate — pickable for the Follow
  // context-menu row only (item 10), never a hover/left-click default.
  function ensureOther(scene: THREE.Scene, diff: EntityDiff): void {
    const existing = others.get(diff.id)
    if (existing) {
      applyEntityDiff(existing, diff)
      // The pickable is built once at mesh creation; patch the level in place so
      // a level-up mid-session isn't stale in the menu (and no per-tick alloc).
      const pick = existing.mesh.userData.pick as Pickable | undefined
      if (pick) pick.monsterLevel = diff.combatLevel
      if (diff.gear) void applyGear(existing.mesh, diff.gear)
      return
    }
    pendingOtherDiff.set(diff.id, diff)
    if (otherLoading.has(diff.id)) return
    otherLoading.add(diff.id)
    void createHeroMesh().then(({ mesh, animator }) => {
      const d = pendingOtherDiff.get(diff.id) ?? diff
      if (!otherLoading.has(diff.id)) return
      const entity = createEntity(diff.id, d.x, d.z, mesh, animator)
      entity.serverAnim = d.anim
      entity.name = d.name
      mesh.userData.pick = buildPlayerPickable(d)
      if (d.gear) void applyGear(entity.mesh, d.gear)
      scene.add(entity.mesh)
      others.set(diff.id, entity)
      otherLoading.delete(diff.id)
      pendingOtherDiff.delete(diff.id)
    })
  }

  function removeOther(id: string): void {
    const entity = others.get(id)
    if (entity) {
      entity.mesh.parent?.remove(entity.mesh)
      others.delete(id)
    }
    otherLoading.delete(id)
    pendingOtherDiff.delete(id)
    overheads.delete(id)
    removeNameplate(id)
    removeOverheadChat(id)
    removeOverheadPrayer(id)
    removeHpBar(id)
  }

  socket.addEventListener('open', () => {
    hideConnBanner()
    send(socket, { t: 'hello', token: session.token })
  })
  socket.addEventListener('close', (event) => {
    if (transitioning) return
    authed = false
    // A 1008 (policy) close is a terminal rejection of this session — the token
    // is bad/expired or the character isn't in this world's DB, so net.ts stops
    // reconnecting. Drop the stale session (a reload lands on login) and show
    // the login screen instead of an endless "Reconnecting…" on black.
    // A full boss lair is a refusal of the ROOM, not of the session: the token
    // is fine and clearing it would log the player out over a queueing problem.
    // Send them to the overworld instead.
    if (isInstanceFullClose(event as CloseEvent)) {
      transitioning = true
      storeZone('overworld')
      hideConnBanner()
      showTransitionOverlay('That lair is full — heading back to the world…')
      window.location.reload()
      return
    }
    // Expected close after a death in an instanced lair — the `instanceDeath`
    // message already put up the choice screen, so this must not be treated
    // as a rejected session (clearing it would strand the player mid-choice).
    if (isInstanceDeathClose(event as CloseEvent)) return
    if ((event as CloseEvent).code === 1008) {
      clearStoredSession()
      hideConnBanner()
      showLoginRequired(pocketRpgUrl())
      return
    }
    showConnBanner()
  })

  // Heartbeat keeps mobile networks/NATs from silently killing the socket, and
  // the watchdog force-reconnects one that looks open but has gone deaf —
  // otherwise taps get buffered into a dead socket and burst seconds later.
  let pingN = 0
  setInterval(() => {
    if (authed && socket.readyState === WebSocket.OPEN) send(socket, { t: 'ping', n: ++pingN })
    if (document.visibilityState === 'visible' && performance.now() - lastServerMsg > 20000) {
      lastServerMsg = performance.now()
      socket.reconnect()
    }
  }, 10000)
  // Backgrounding the world tab counts as leaving it (see away.ts): the world
  // holds this character's save lock while its socket is open, so a tab left
  // running behind the idle game blocks every cloud save. Departing releases the
  // lock now; coming back reconnects and re-enters at the checkpoint.
  const awayWatch = createAwayWatch({
    isHidden: () => document.visibilityState === 'hidden',
    depart: () => {
      if (authed && socket.readyState === WebSocket.OPEN) send(socket, { t: 'leave' })
      // close() (unlike a dropped socket) stops partysocket reconnecting, so we
      // stay out until the player is actually looking at the world again.
      socket.close()
    },
    resume: () => {
      showConnBanner()
      lastServerMsg = performance.now()
      socket.reconnect()
    },
  })
  // Threshold sits above the 10s ping cadence — a quick app switch on a
  // healthy connection must never trigger a reconnect.
  document.addEventListener('visibilitychange', () => {
    // Ordering matters: a resume above reconnects and re-stamps lastServerMsg,
    // so the watchdog below can't fire a second reconnect on the same event.
    awayWatch.onVisibilityChange()
    if (document.visibilityState === 'visible' && performance.now() - lastServerMsg > 15000) {
      lastServerMsg = performance.now()
      socket.reconnect()
    }
  })

  // Closing the tab/browser is a deliberate exit, so it gets exactly what the
  // Log out button gets: the server flushes the save and releases the world lock
  // now, instead of holding both for the linger grace period — which is what
  // left the idle game unable to save on the way back.
  //
  // The `leave` frame alone is not enough: during unload there is no guarantee a
  // socket write is flushed before the socket dies, and a beacon is the one
  // request browsers promise to deliver (see leaveBeacon.ts). Both are sent —
  // whichever lands first departs the player, and the second is a no-op.
  //
  // `persisted` means the page went into the back/forward cache and may return —
  // that IS what linger is for, so leave those alone. A zone transition is not
  // an exit either: the player is mid-handoff to the next room.
  function departOnUnload(): void {
    if (transitioning) return
    if (authed && socket.readyState === WebSocket.OPEN) send(socket, { t: 'leave' })
    sendLeaveBeacon({
      token: session.token,
      room,
      origin: window.location.origin,
      sendBeacon: navigator.sendBeacon ? (url, body) => navigator.sendBeacon(url, body) : null,
      keepaliveFetch: (url, body) => {
        void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
          .catch(() => {})
      },
    })
  }
  window.addEventListener('pagehide', (event) => {
    if ((event as PageTransitionEvent).persisted) return
    departOnUnload()
  })

  /** Repeat welcome after a reconnect: snap self to the server's position,
   * replace pack/stats, and drop every other entity — the intro diff that
   * follows the welcome repopulates npcs/others/loot/rock states. */
  function resyncFromWelcome(message: Extract<ServerMessage, { t: 'welcome' }>): void {
    inventory = message.you.inventory
    renderInventory(inventory)
    updateHpPill(message.you.hp, message.you.maxHp)
    running = message.you.running
    setRunState(message.you.runEnergy, message.you.running)
    syncRunFromPref(message.you.runEnergy)
    setStanceActive(message.you.stance)
    setSpecialEnergy(message.you.specialEnergy)
    renderPrayerPanel(message.you.stats.prayer?.level ?? 1, (id) => send(socket, { t: 'pray', prayerId: id }))
    setPrayerState(message.you.prayer.points, message.you.prayer.max, message.you.prayer.protection, message.you.prayer.combat)
    renderEquipment(message.you.equipment)
    closeBankUI()
    closeCraftUI()
    stats = message.you.stats
    selectedSpell = message.you.spell ?? null
    refreshSpellUI(message.you.equipment)
    playerCombatLevel = combatLevelFromStats(message.you.stats)
    if (self) {
      const pos = tileToWorld(message.you.x, message.you.z)
      self.queue.length = 0
      self.mesh.position.copy(pos)
      self.fromPos.copy(pos)
      self.toPos.copy(pos)
      self.moving = false
      self.serverAnim = 'idle'
      // Resync drops every npc/other, so a target from the fight we just left
      // would otherwise dangle forever — same reason npcChanged/died clear it
      // server-side.
      self.targetId = null
      // A background/resume can leave the self mesh hidden (culling/context
      // churn) — make sure it's shown again on every resync.
      self.mesh.visible = true
      void applyGear(self.mesh, message.you.gear)
    }
    for (const id of [...others.keys(), ...otherLoading]) removeOther(id)
    for (const id of [...npcs.keys(), ...npcLoading]) removeNpc(id)
    for (const id of rockStates.keys()) {
      rockStates.set(id, false)
      statics?.setRockDepleted(id, false)
    }
    lootLayer?.clear()
  }

  onMessage(socket, (message: ServerMessage) => {
    lastServerMsg = performance.now()
    if (message.t === 'welcome') {
      authed = true
      storeZone(message.zone.id)
      teleports = (message.zone.landmarks ?? []).map((l) => ({ id: l.id, label: l.label }))
      worldMapData = {
        collision: message.zone.collision,
        width: message.zone.w,
        height: message.zone.h,
        palette: message.zone.palette,
        ground: message.zone.ground,
        statics: message.statics,
        landmarks: message.zone.landmarks ?? [],
        spawns: message.zone.spawns ?? [],
        exits: message.zone.exits ?? [],
      }
      if (sceneBuilt) {
        resyncFromWelcome(message)
        return
      }
      sceneBuilt = true
      void (async () => {
        hideOverlay()
        const scene = createScene(message.zone.ambience)
        sun = createLights(scene, message.zone.ambience).sun
        // Build terrain first: registers the zone height sampler so every
        // tileToWorld call rides the surface, and returns the ground mesh that
        // picking raycasts. Flat when the zone has no `terrain` block.
        // A big merged map (overworld) streams its ground in chunks around the
        // player; per-zone maps render whole (chunkCentre omitted → single mesh
        // or full-map render, unchanged). Follow radius exceeds the fog so the
        // player never sees the terrain edge.
        const followRadius = chunkFollowRadius(FOG_FAR)
        const terrainResult = createTerrain(scene, message.zone.collision, message.zone.w, message.zone.h, message.zone.palette, message.zone.terrain, message.zone.ground, { chunkCentre: { x: message.you.x, z: message.you.z, radius: followRadius } })
        const { heightField, mesh: ground } = terrainResult
        chunkedTerrain = terrainResult.chunked ?? null
        lastChunkKey = chunkedTerrain ? chunkKey(Math.floor(message.you.x / CHUNK_TILES), Math.floor(message.you.z / CHUNK_TILES)) : ''
        // Decorative scatter: avoid static-object, exit, and prop tiles
        // (blocked tiles are skipped by the placer). NPCs move, so their spawn
        // tiles aren't masked.
        if (message.zone.terrain?.scatter?.length) {
          const occupied = new Set<string>([
            ...message.statics.map((s) => `${s.x},${s.z}`),
            ...(message.zone.exits ?? []).map((e) => `${e.x},${e.z}`),
            ...(message.zone.props ?? []).map((p) => `${p.x},${p.z}`),
          ])
          void createScatterLayers(scene, message.zone.terrain.scatter, message.zone.w, message.zone.h, message.zone.collision, occupied, (message.zone.terrain.procedural?.seed ?? 1) | 0, heightField.heightAt)
        }
        exitLayer = createExitMarkers(scene, message.zone.exits ?? [])
        exitMarkers = message.zone.exits ?? []
        void createProps(scene, message.zone.props ?? [])
        ambientLayer = createAmbient(scene, message.zone.ambient, heightField.heightAt, message.zone.collision, message.zone.id)
        const marker = createClickMarker(scene)
        camera = createCamera()
        const container = document.getElementById('scene')!
        const renderer = createRenderer(container)
        cam = attachCameraControls(renderer.domElement)
        preventPageZoom()

        const sendInvAction = (slot: number, action: InvActionWire): void => {
          send(socket, { t: 'invAction', slot, action })
        }
        initHud({
          onMoveInv: (from, to) => {
            const moved = inventory[from]
            if (!moved) return
            inventory[from] = inventory[to] ?? null
            inventory[to] = moved
            renderInventory(inventory)
            send(socket, { t: 'moveInv', from, to })
          },
          onSlotTap: (index) => {
            const slot = inventory[index]
            if (!slot) return
            const primary = primaryInvAction(slot.itemId)
            if (primary) sendInvAction(index, primary.action)
          },
          onSlotMenu: (index, x, y) => {
            const slot = inventory[index]
            if (!slot) return
            const name = itemName(slot.itemId)
            const primary = primaryInvAction(slot.itemId)
            const rows: MenuRow[] = []
            const actions: (InvActionWire | null)[] = []
            if (primary) {
              rows.push({ text: `${primary.label} ${name}`, targetName: name })
              actions.push(primary.action)
            }
            rows.push({ text: `Drop ${name}`, targetName: name })
            actions.push('drop')
            rows.push({ text: 'Cancel', local: 'cancel' })
            actions.push(null)
            showContextMenu(rows, x, y, (row) => {
              const action = actions[rows.indexOf(row)]
              if (action) sendInvAction(index, action)
            })
          },
          onRunToggle: () => {
            const next = !running
            storeRunPref(next)
            send(socket, { t: 'setRun', run: next })
          },
          onStance: (stance) => {
            setStanceActive(stance)
            send(socket, { t: 'setStance', stance })
          },
          onSpellMenu: (x, y) => {
            const magicLevel = stats.magic?.level ?? 1
            const castable = Object.entries(spells)
              .filter(([, s]) => s.levelReq <= magicLevel)
              .sort((a, b) => a[1].levelReq - b[1].levelReq)
            const rows: MenuRow[] = [
              ...castable.map(([, s]) => ({ text: `${s.name} (Lv ${s.levelReq})` })),
              { text: 'No spell' },
              { text: 'Cancel', local: 'cancel' as const },
            ]
            showContextMenu(rows, x, y, (row) => {
              const index = rows.indexOf(row)
              if (index < 0 || index >= rows.length - 1) return
              selectedSpell = index < castable.length ? castable[index][0] : null
              send(socket, { t: 'setSpell', spell: selectedSpell })
              setSpellButton(true, selectedSpell ? spells[selectedSpell].name : null)
            })
          },
          onSpecial: () => send(socket, { t: 'special' }),
          onUnequip: (slot) => send(socket, { t: 'unequip', slot }),
          onWorldMap: () => {
            if (!self || !worldMapData) return
            openWorldMap({ ...worldMapData, self: { x: Math.floor(self.mesh.position.x), z: Math.floor(self.mesh.position.z) } })
          },
          onLogout: () => {
            // Reload rather than close(): partysocket auto-reconnects on a bare
            // close and would re-enter the world. A reload with the session
            // cleared lands on the login screen with no reconnect loop. (The
            // server also linger-flushes on the dropped socket, so no data is
            // lost even if the logout frame doesn't flush before unload.)
            send(socket, { t: 'logout' })
            clearStoredSession()
            window.location.reload()
          },
        })
        initChatInput((text) => send(socket, { t: 'chat', text }))
        stats = message.you.stats
        playerCombatLevel = combatLevelFromStats(message.you.stats)
        lootLayer = createLootLayer(scene)

        const [heroResult, staticsResult] = await Promise.all([
          createHeroMesh(),
          createStatics(scene, message.statics),
          loadItemIcons(),
        ])
        inventory = message.you.inventory
        renderInventory(inventory)
        updateHpPill(message.you.hp, message.you.maxHp)
        running = message.you.running
        setRunState(message.you.runEnergy, message.you.running)
        syncRunFromPref(message.you.runEnergy)
        setStanceActive(message.you.stance)
        setSpecialEnergy(message.you.specialEnergy)
        renderPrayerPanel(message.you.stats.prayer?.level ?? 1, (id) => send(socket, { t: 'pray', prayerId: id }))
        setPrayerState(message.you.prayer.points, message.you.prayer.max, message.you.prayer.protection, message.you.prayer.combat)
        renderEquipment(message.you.equipment)
        selectedSpell = message.you.spell ?? null
        refreshSpellUI(message.you.equipment)
        paintHudIcons() // icon data is loaded by now (Promise.all above)
        statics = staticsResult
        for (const [id, depleted] of rockStates) staticsResult.setRockDepleted(id, depleted)
        self = createEntity(message.selfId, message.you.x, message.you.z, heroResult.mesh, heroResult.animator)
        if (message.you.gear) void applyGear(self.mesh, message.you.gear)
        scene.add(self.mesh)

        // Rapid taps on the same tile collapse to one walk — the server path
        // wouldn't change, and it keeps tap-spam inside the rate budget.
        let lastWalk = { x: -1, z: -1, at: 0 }
        const walkTo = (tile: { x: number; z: number }): void => {
          closeBankUI()
          closeCraftUI()
          showClickMarker(marker, tile.x, tile.z)
          const now = performance.now()
          if (tile.x === lastWalk.x && tile.z === lastWalk.z && now - lastWalk.at < 400) return
          lastWalk = { x: tile.x, z: tile.z, at: now }
          send(socket, { t: 'walk', x: tile.x, z: tile.z })
        }
        minimap = createMinimap(message.zone.collision, message.zone.w, message.zone.h, message.zone.palette, message.statics, walkTo)
        setupInput(renderer.domElement, camera, ground, {
          onWalk: walkTo,
          onInteract: (interact) => {
            if (interact.kind === 'exit') {
              // Client-side sugar: walking onto the tile is what transitions.
              const tile = exitLayer?.tiles.get(interact.id)
              if (tile) {
                closeBankUI()
                closeCraftUI()
                showClickMarker(marker, tile.x, tile.z)
                send(socket, { t: 'walk', x: tile.x, z: tile.z })
              }
              return
            }
            send(socket, { t: 'interact', kind: interact.kind, id: interact.id, action: interact.action })
          },
          onFollow: (targetId) => {
            const name = others.get(targetId)?.name ?? 'them'
            send(socket, { t: 'follow', targetId })
            pushMessage(`Following ${name}.`)
          },
          onMessage: (text) => pushMessage(text),
          getPickables: () => [
            ...(statics?.pickables ?? []),
            ...(exitLayer?.pickables ?? []),
            // Proxies, never the models: raycasting a skinned character costs a
            // full per-triangle bone transform (entities.ts PICK_PROXY).
            ...[...npcs.values()].filter((e) => e.serverAnim !== 'die').map((e) => pickProxyOf(e.mesh)),
            ...(lootLayer?.pickables ?? []),
            ...[...others.values()].map((e) => pickProxyOf(e.mesh)),
          ],
          getPlayerCombatLevel: () => playerCombatLevel,
          // Recomputed per menu, not stored on the pickable: whether an attack
          // is on the table depends on where BOTH of us are standing right now.
          decoratePickable: (pick) => {
            if (pick.kind !== 'player') return
            const other = others.get(pick.id)
            const level = other?.combatLevel ?? pick.monsterLevel
            const attackable = selfInDanger
              && !!other?.pvp
              && level != null
              && Math.abs(level - playerCombatLevel) <= PVP_LEVEL_BRACKET
            // The ACTION is the decoration: it makes the player a left-click
            // target, gives them a hover line, and supplies the menu's Attack
            // row — all three from one decision, so they cannot disagree.
            pick.actions = attackable ? [{ label: 'Attack', action: 'attack' }] : []
            pick.attackable = attackable
            pick.bot = !!other?.bot
            if (level != null) pick.monsterLevel = level
          },
          // Wheel zoom, arrow-key orbit/zoom, and middle-drag orbit all live in
          // cam (cameraControls.ts) — pinch is the one gesture input.ts already
          // owns (two-finger touch), forwarded into the same state.
          onPinchZoom: (ratio) => cam?.pinch(ratio),
        })

        window.addEventListener('resize', () => {
          if (!camera) return
          camera.aspect = window.innerWidth / window.innerHeight
          camera.updateProjectionMatrix()
          renderer.setSize(window.innerWidth, window.innerHeight)
        })

        // Resolves an entity's combat opponent to a live world position for
        // facing (updateEntity); null once the opponent dies/disconnects/logs
        // off so the entity just keeps its last yaw instead of snapping.
        const targetPosOf = (entity: Entity): THREE.Vector3 | null => (entity.targetId ? meshOf(entity.targetId)?.position ?? null : null)

        // Above the nameplate and the chat bubble — an overhead is the first
        // thing you read off another player, and it has to survive them talking.
        const drawOverheadPrayer = (entity: Entity): void => {
          if (!entity.overhead) return removeOverheadPrayer(entity.id)
          const s = toScreen(entity.mesh.position, 2.75)
          updateOverheadPrayer(entity.id, s.x, s.y, entity.overhead)
        }

        let lastFrameTime = performance.now()
        let lastMinimap = 0
        function frame(now: number): void {
          const deltaSeconds = (now - lastFrameTime) / 1000
          lastFrameTime = now
          if (self && camera && cam) {
            cam.update(deltaSeconds)
            updateEntity(self, now, deltaSeconds, targetPosOf(self))
            // Own overhead HP bar while fighting or damaged (item 11) — the
            // fixed HP pill stays; this is the in-world bar other players see
            // on themselves too, offset below where a nameplate would sit.
            if (self.hp != null && self.maxHp && (self.targetId != null || self.hp < self.maxHp)) {
              const s = toScreen(self.mesh.position, 1.7)
              updateHpBar(self.id, s.x, s.y, self.hp / self.maxHp)
            } else {
              removeHpBar(self.id)
            }
            drawOverheadPrayer(self)
            updateCamera(camera, self.mesh.position, cam.state.zoom, cam.state.yaw)
            if (sun) updateShadowLight(sun, self.mesh.position)
            // Stream ground chunks around the player — only when they cross a
            // chunk boundary, so most frames do no work and there's no churn.
            if (chunkedTerrain) {
              const cx = Math.floor(self.mesh.position.x / CHUNK_TILES)
              const cz = Math.floor(self.mesh.position.z / CHUNK_TILES)
              const key = chunkKey(cx, cz)
              if (key !== lastChunkKey) {
                lastChunkKey = key
                chunkedTerrain.setCentre(self.mesh.position.x, self.mesh.position.z, chunkFollowRadius(FOG_FAR))
              }
            }
          }
          for (const npc of npcs.values()) {
            updateEntity(npc, now, deltaSeconds, targetPosOf(npc))
            if (npc.hp != null && npc.maxHp && npc.hp < npc.maxHp && npc.serverAnim !== 'die') {
              const s = toScreen(npc.mesh.position, 1.4)
              updateHpBar(npc.id, s.x, s.y, npc.hp / npc.maxHp)
            } else {
              removeHpBar(npc.id)
            }
          }
          // Boss HP frame + damage-contribution readout (item 11): shown whenever
          // the player is targeting a boss-flagged monster.
          const bossTarget = self?.targetId ? npcs.get(self.targetId) : null
          const bossDef = bossTarget?.monsterId ? monsters[bossTarget.monsterId] : null
          if (bossTarget && bossDef?.boss && bossTarget.serverAnim !== 'die' && bossTarget.hp != null && bossTarget.maxHp) {
            const npcId = self!.targetId!
            if (!lastBossFrame || lastBossFrame.npcId !== npcId || lastBossFrame.hp !== bossTarget.hp || lastBossFrame.maxHp !== bossTarget.maxHp) {
              showBossFrame(bossDef.name ?? bossTarget.monsterId ?? 'Boss', bossTarget.hp, bossTarget.maxHp)
              lastBossFrame = { npcId, hp: bossTarget.hp, maxHp: bossTarget.maxHp }
            }
            const contributors = threatByNpc.get(npcId) ?? EMPTY_CONTRIBUTORS
            if (contributors !== lastThreatContributors) {
              setThreatPanel(contributors, self!.id)
              lastThreatContributors = contributors
            }
          } else if (lastBossFrame || lastThreatContributors) {
            hideBossFrame()
            lastBossFrame = null
            lastThreatContributors = null
          }
          for (const other of others.values()) {
            updateEntity(other, now, deltaSeconds, targetPosOf(other))
            const s = toScreen(other.mesh.position, 2.0)
            updateNameplate(other.id, s.x, s.y, other.name ?? 'Adventurer')
            if (other.hp != null && other.maxHp && (other.targetId != null || other.hp < other.maxHp)) {
              const hpS = toScreen(other.mesh.position, 1.7)
              updateHpBar(other.id, hpS.x, hpS.y, other.hp / other.maxHp)
            } else {
              removeHpBar(other.id)
            }
            drawOverheadPrayer(other)
          }
          for (const [id, overhead] of overheads) {
            const mesh = id === self?.id ? self.mesh : others.get(id)?.mesh
            if (!mesh || now > overhead.until) {
              overheads.delete(id)
              removeOverheadChat(id)
              continue
            }
            const s = toScreen(mesh.position, 2.35)
            updateOverheadChat(id, s.x, s.y, overhead.text)
          }
          lootLayer?.update(deltaSeconds)
          exitLayer?.update(now)
          ambientLayer?.update(deltaSeconds)
          updateClickMarker(marker, now)
          if (minimap && self && now - lastMinimap > 150) {
            lastMinimap = now
            const tile = (o: THREE.Object3D): { x: number; z: number } => ({ x: Math.floor(o.position.x), z: Math.floor(o.position.z) })
            const dots: MinimapDot[] = exitMarkers.map((m) => ({ x: m.x, z: m.z, kind: 'exit' as const }))
            for (const npc of npcs.values()) {
              if (npc.serverAnim === 'die') continue
              const boss = npc.monsterId ? monsters[npc.monsterId]?.boss : undefined
              dots.push({ ...tile(npc.mesh), kind: 'npc', boss })
            }
            for (const other of others.values()) dots.push({ ...tile(other.mesh), kind: 'other' })
            minimap.update(tile(self.mesh), dots)
          }
          renderer.render(scene, camera!)
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)

        // WebGL contexts get dropped when a mobile tab is backgrounded; without
        // handling the loss three.js re-uploads on restore, but the default
        // event cancels that — preventDefault re-enables automatic recovery so
        // the scene (and self) comes back instead of staying blank.
        renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false)

        // Any ents/rocks/loot that arrived before the scene was ready.
        applyDeferred(scene)
      })()
      return
    }

    if (message.t === 'diff') {
      applyDiff(message)
      return
    }

    if (message.t === 'transition') {
      // Save + position row are already durable server-side. A full reload
      // guarantees a clean scene/renderer for the new zone.
      transitioning = true
      storeZone(message.zone)
      showTransitionOverlay('Entering…')
      socket.close()
      window.location.reload()
      return
    }

    if (message.t === 'snap') {
      // Travel teleport: hard-snap self to the server's new position (no walk
      // interpolation across the map). Same pattern as the death respawn.
      if (self) {
        const pos = tileToWorld(message.x, message.z)
        self.queue.length = 0
        self.mesh.position.copy(pos)
        self.fromPos.copy(pos)
        self.toPos.copy(pos)
        self.moving = false
      }
      return
    }

    if (message.t === 'dead') {
      if (self) {
        const pos = tileToWorld(message.respawn.x, message.respawn.z)
        self.queue.length = 0
        self.mesh.position.copy(pos)
        self.fromPos.copy(pos)
        self.toPos.copy(pos)
        self.moving = false
      }
      pushMessage('Oh dear, you are dead! You wake back at the entrance.')
      return
    }

    if (message.t === 'instanceDeath') {
      // The room already ejected us (socket closes right after this message) —
      // show the choice instead of the ordinary in-place respawn toast above.
      showDeathChoiceOverlay({
        zoneName: message.zoneName,
        returnHref: `${pocketRpgUrl()}/?enterWorld=${encodeURIComponent(message.zone)}`,
        idleHref: pocketRpgUrl(),
      })
      return
    }

    if (message.t === 'error') {
      showLoginRequired(pocketRpgUrl())
    }
  })

  // Diffs can arrive before the async scene setup finishes; buffer until then.
  const deferred: Extract<ServerMessage, { t: 'diff' }>[] = []
  function applyDeferred(scene: THREE.Scene): void {
    for (const msg of deferred) applyDiffTo(scene, msg)
    deferred.length = 0
  }
  function applyDiff(message: Extract<ServerMessage, { t: 'diff' }>): void {
    const scene = self?.mesh.parent as THREE.Scene | undefined
    if (!scene) {
      deferred.push(message)
      return
    }
    applyDiffTo(scene, message)
  }
  function applyDiffTo(scene: THREE.Scene, message: Extract<ServerMessage, { t: 'diff' }>): void {
    for (const ent of message.ents ?? []) {
      if (self && ent.id === self.id) {
        applyEntityDiff(self, ent)
        if (ent.gear) void applyGear(self.mesh, ent.gear)
      }
      else if (ent.kind === 'npc') ensureNpc(scene, ent)
      else if (ent.kind === 'player') ensureOther(scene, ent)
    }
    for (const id of message.removed ?? []) {
      if (others.has(id) || otherLoading.has(id)) removeOther(id)
      else removeNpc(id)
    }
    if (message.rocks) {
      for (const rock of message.rocks) {
        rockStates.set(rock.id, rock.depleted)
        statics?.setRockDepleted(rock.id, rock.depleted)
      }
    }
    if (message.loot || message.lootRemoved) lootLayer?.apply(message.loot, message.lootRemoved)
    message.events?.forEach(handleEvent)
  }
}

async function boot(): Promise<void> {
  const handoff = parseHandoffFromHash(window.location.hash)
  if (handoff) {
    history.replaceState(null, '', window.location.pathname + window.location.search)
    try {
      const session = await exchangeHandoff(handoff)
      enterWorld(session)
      return
    } catch (err) {
      console.error('[World][boot] handoff exchange failed, showing login-required', err)
      showLoginRequired(pocketRpgUrl())
      return
    }
  }

  const stored = getStoredSession()
  if (stored) {
    enterWorld(stored)
    return
  }

  showLoginRequired(pocketRpgUrl())
}

boot()
