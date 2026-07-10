import { exchangeHandoff, getStoredSession, parseHandoffFromHash, pocketRpgUrl, type WorldSession } from './auth'
import { hideConnBanner, hideOverlay, initChatInput, initHud, pushMessage, removeHpBar, removeNameplate, removeOverheadChat, renderInventory, showConnBanner, showHitsplat, showLoginRequired, showXpDrop, updateHpBar, updateNameplate, updateOverheadChat, npcExamine } from './ui'
import { connect, onMessage, send } from './net'
import { clampZoom, createCamera, createGround, createLights, createRenderer, createScene, tileToWorld, updateCamera } from './scene'
import { applyEntityDiff, applyWeapon, createCowMesh, createEntity, createHeroMesh, updateEntity, type Entity } from './entities'
import { createClickMarker, setupInput, showClickMarker, updateClickMarker } from './input'
import { createStatics, type Statics } from './statics'
import { createLootLayer, type LootLayer } from './loot'
import { loadItemIcons } from './itemIcon'
import { combatLevelFromStats } from '../../../src/engine/combatLevel.js'
import monstersData from '../../../src/data/monsters.json'
import * as THREE from 'three'
import type { EntityDiff, InvSlot, ServerMessage, ZoneEvent } from '../../shared/protocol'
import type { Pickable } from './picking'

const ZONE_ID = 'pasture'

type Monsters = Record<string, { name?: string; combatLevel?: number } | undefined>
const monsters = monstersData as unknown as Monsters

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

function enterWorld(session: WorldSession): void {
  const socket = connect(window.location.host, ZONE_ID)
  let self: Entity | null = null
  let statics: Statics | null = null
  let lootLayer: LootLayer | null = null
  let camera: THREE.PerspectiveCamera | null = null
  const npcs = new Map<string, Entity>()
  const npcLoading = new Set<string>()
  const pendingNpcDiff = new Map<string, EntityDiff>()
  const others = new Map<string, Entity>()
  const otherLoading = new Set<string>()
  const pendingOtherDiff = new Map<string, EntityDiff>()
  const overheads = new Map<string, { text: string; until: number }>()
  const rockStates = new Map<string, boolean>()
  let playerCombatLevel = 3
  let zoom = 1
  // Local pack copy so a drag-reorder can apply optimistically; every server
  // {e:'inv'} (including the reorder echo) replaces it wholesale.
  let inventory: InvSlot[] = []
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
    }
    else if (event.e === 'xp') showXpDrop(event.skill, event.amount)
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
    void createCowMesh().then(({ mesh, animator }) => {
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

  // Other players are ghosts: shared hero model, name plate, no pick target.
  function ensureOther(scene: THREE.Scene, diff: EntityDiff): void {
    const existing = others.get(diff.id)
    if (existing) {
      applyEntityDiff(existing, diff)
      if (diff.gear) void applyWeapon(existing.mesh, diff.gear)
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
      if (d.gear) void applyWeapon(entity.mesh, d.gear)
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
  }

  socket.addEventListener('open', () => {
    hideConnBanner()
    send(socket, { t: 'hello', token: session.token })
  })
  socket.addEventListener('close', () => {
    authed = false
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
  // Threshold sits above the 10s ping cadence — a quick app switch on a
  // healthy connection must never trigger a reconnect.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && performance.now() - lastServerMsg > 15000) {
      lastServerMsg = performance.now()
      socket.reconnect()
    }
  })

  /** Repeat welcome after a reconnect: snap self to the server's position,
   * replace pack/stats, and drop every other entity — the intro diff that
   * follows the welcome repopulates npcs/others/loot/rock states. */
  function resyncFromWelcome(message: Extract<ServerMessage, { t: 'welcome' }>): void {
    inventory = message.you.inventory
    renderInventory(inventory)
    playerCombatLevel = combatLevelFromStats(message.you.stats)
    if (self) {
      const pos = tileToWorld(message.you.x, message.you.z)
      self.queue.length = 0
      self.mesh.position.copy(pos)
      self.fromPos.copy(pos)
      self.toPos.copy(pos)
      self.moving = false
      self.serverAnim = 'idle'
      void applyWeapon(self.mesh, message.you.gear)
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
      if (sceneBuilt) {
        resyncFromWelcome(message)
        return
      }
      sceneBuilt = true
      void (async () => {
        hideOverlay()
        const scene = createScene()
        createLights(scene)
        const ground = createGround(scene, message.zone.collision, message.zone.w, message.zone.h)
        const marker = createClickMarker(scene)
        camera = createCamera()
        const container = document.getElementById('scene')!
        const renderer = createRenderer(container)

        initHud((from, to) => {
          const moved = inventory[from]
          if (!moved) return
          inventory[from] = inventory[to] ?? null
          inventory[to] = moved
          renderInventory(inventory)
          send(socket, { t: 'moveInv', from, to })
        })
        initChatInput((text) => send(socket, { t: 'chat', text }))
        playerCombatLevel = combatLevelFromStats(message.you.stats)
        lootLayer = createLootLayer(scene)

        const [heroResult, staticsResult] = await Promise.all([
          createHeroMesh(),
          createStatics(scene, message.statics),
          loadItemIcons(),
        ])
        inventory = message.you.inventory
        renderInventory(inventory)
        statics = staticsResult
        for (const [id, depleted] of rockStates) staticsResult.setRockDepleted(id, depleted)
        self = createEntity(message.selfId, message.you.x, message.you.z, heroResult.mesh, heroResult.animator)
        if (message.you.gear) void applyWeapon(self.mesh, message.you.gear)
        scene.add(self.mesh)

        // Rapid taps on the same tile collapse to one walk — the server path
        // wouldn't change, and it keeps tap-spam inside the rate budget.
        let lastWalk = { x: -1, z: -1, at: 0 }
        setupInput(renderer.domElement, camera, ground, {
          onWalk: (tile) => {
            showClickMarker(marker, tile.x, tile.z)
            const now = performance.now()
            if (tile.x === lastWalk.x && tile.z === lastWalk.z && now - lastWalk.at < 400) return
            lastWalk = { x: tile.x, z: tile.z, at: now }
            send(socket, { t: 'walk', x: tile.x, z: tile.z })
          },
          onInteract: (interact) => {
            send(socket, { t: 'interact', kind: interact.kind, id: interact.id, action: interact.action })
          },
          onMessage: (text) => pushMessage(text),
          getPickables: () => [
            ...(statics?.pickables ?? []),
            ...[...npcs.values()].filter((e) => e.serverAnim !== 'die').map((e) => e.mesh),
            ...(lootLayer?.pickables ?? []),
          ],
          getPlayerCombatLevel: () => playerCombatLevel,
        })

        renderer.domElement.addEventListener(
          'wheel',
          (event) => {
            zoom = clampZoom(zoom + event.deltaY * 0.001)
            event.preventDefault()
          },
          { passive: false }
        )

        window.addEventListener('resize', () => {
          if (!camera) return
          camera.aspect = window.innerWidth / window.innerHeight
          camera.updateProjectionMatrix()
          renderer.setSize(window.innerWidth, window.innerHeight)
        })

        let lastFrameTime = performance.now()
        function frame(now: number): void {
          const deltaSeconds = (now - lastFrameTime) / 1000
          lastFrameTime = now
          if (self && camera) {
            updateEntity(self, now, deltaSeconds)
            updateCamera(camera, self.mesh.position, zoom)
          }
          for (const npc of npcs.values()) {
            updateEntity(npc, now, deltaSeconds)
            if (npc.hp != null && npc.maxHp && npc.hp < npc.maxHp && npc.serverAnim !== 'die') {
              const s = toScreen(npc.mesh.position, 1.4)
              updateHpBar(npc.id, s.x, s.y, npc.hp / npc.maxHp)
            } else {
              removeHpBar(npc.id)
            }
          }
          for (const other of others.values()) {
            updateEntity(other, now, deltaSeconds)
            const s = toScreen(other.mesh.position, 2.0)
            updateNameplate(other.id, s.x, s.y, other.name ?? 'Adventurer')
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
          updateClickMarker(marker, now)
          renderer.render(scene, camera!)
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)

        // Any ents/rocks/loot that arrived before the scene was ready.
        applyDeferred(scene)
      })()
      return
    }

    if (message.t === 'diff') {
      applyDiff(message)
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
      if (self && ent.id === self.id) applyEntityDiff(self, ent)
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
