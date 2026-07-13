import { clearStoredSession, exchangeHandoff, getStoredSession, getStoredZone, parseHandoffFromHash, pocketRpgUrl, storeZone, type WorldSession } from './auth'
import { hideConnBanner, hideOverlay, initChatInput, initHud, paintHudIcons, pushMessage, removeHpBar, removeNameplate, removeOverheadChat, renderEquipment, renderInventory, setRunState, setSpecialEnergy, setSpellButton, setStanceActive, showConnBanner, showContextMenu, showHitsplat, showLoginRequired, showTransitionOverlay, showXpDrop, updateHpBar, updateHpPill, updateNameplate, updateOverheadChat, npcExamine } from './ui'
import { createMinimap, type Minimap, type MinimapDot } from './minimap'
import { closeBankUI, isBankOpen, openBankUI, updateBankInventory, updateBankUI } from './bank'
import { closeCraftUI, openCraftUI, updateCraftInventory, updateCraftStats, type SkillLevels } from './crafting'
import { getLevelFromXP } from '../../../src/engine/experience.js'
import { connect, onMessage, send } from './net'
import { clampZoom, createCamera, createGround, createLights, createRenderer, createScene, tileToWorld, updateCamera } from './scene'
import { createHeightField } from './terrain'
import { applyEntityDiff, applyWeapon, createEntity, createHeroMesh, createMonsterMesh, updateEntity, type Entity } from './entities'
import { createClickMarker, setupInput, showClickMarker, updateClickMarker } from './input'
import { createStatics, type Statics } from './statics'
import { createProps } from './props'
import { createExitMarkers, type ExitLayer } from './exits'
import { createLootLayer, type LootLayer } from './loot'
import { itemName, loadItemIcons } from './itemIcon'
import { primaryInvAction } from '../../shared/itemActions'
import { combatLevelFromStats } from '../../../src/engine/combatLevel.js'
import { getCombatType } from '../../../src/engine/equipment.js'
import monstersData from '../../../src/data/monsters.json'
import itemsData from '../../../src/data/items.json'
import spellsData from '../../../src/data/spells.json'
import * as THREE from 'three'
import type { EntityDiff, ExitMarker, InvActionWire, InvSlot, ServerMessage, ZoneEvent } from '../../shared/protocol'
import type { MenuRow, Pickable } from './picking'

type Monsters = Record<string, { name?: string; combatLevel?: number } | undefined>
const monsters = monstersData as unknown as Monsters
type Items = Record<string, { poweredStaff?: boolean } | undefined>
const items = itemsData as unknown as Items
type Spells = Record<string, { name: string; levelReq: number }>
const spells = spellsData as unknown as Spells

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
  const socket = connect(window.location.host, getStoredZone())
  let self: Entity | null = null
  let statics: Statics | null = null
  let lootLayer: LootLayer | null = null
  let exitLayer: ExitLayer | null = null
  let transitioning = false
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

  /** Shows the Combat tab's spell selector while a castable magic weapon is
   * equipped (powered staffs need no spell — the engine has its own path). */
  function refreshSpellUI(equipment: Record<string, string>): void {
    const weaponId = equipment.weapon
    const shaped = weaponId ? { weapon: { itemId: weaponId } } : {}
    const magic = getCombatType(shaped, itemsData) === 'magic' && !(weaponId && items[weaponId]?.poweredStaff)
    setSpellButton(magic, selectedSpell ? spells[selectedSpell]?.name ?? selectedSpell : null)
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
    else if (event.e === 'spec') setSpecialEnergy(event.energy)
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
      entry.xp += event.amount
      entry.level = Math.max(entry.level, getLevelFromXP(entry.xp))
      updateCraftStats(stats)
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
    if (transitioning) return
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
    updateHpPill(message.you.hp, message.you.maxHp)
    running = message.you.running
    setRunState(message.you.runEnergy, message.you.running)
    setStanceActive(message.you.stance)
    setSpecialEnergy(message.you.specialEnergy)
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
      // A background/resume can leave the self mesh hidden (culling/context
      // churn) — make sure it's shown again on every resync.
      self.mesh.visible = true
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
      storeZone(message.zone.id)
      if (sceneBuilt) {
        resyncFromWelcome(message)
        return
      }
      sceneBuilt = true
      void (async () => {
        hideOverlay()
        const scene = createScene(message.zone.ambience)
        createLights(scene, message.zone.ambience)
        // Register the zone height sampler before anything is placed, so every
        // tileToWorld call rides the terrain. T0: null corners => flat.
        createHeightField(message.zone.w, message.zone.h, null)
        const ground = createGround(scene, message.zone.collision, message.zone.w, message.zone.h, message.zone.palette)
        exitLayer = createExitMarkers(scene, message.zone.exits ?? [])
        exitMarkers = message.zone.exits ?? []
        void createProps(scene, message.zone.props ?? [])
        const marker = createClickMarker(scene)
        camera = createCamera()
        const container = document.getElementById('scene')!
        const renderer = createRenderer(container)

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
          onRunToggle: () => send(socket, { t: 'setRun', run: !running }),
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
        setStanceActive(message.you.stance)
        setSpecialEnergy(message.you.specialEnergy)
        renderEquipment(message.you.equipment)
        selectedSpell = message.you.spell ?? null
        refreshSpellUI(message.you.equipment)
        paintHudIcons() // icon data is loaded by now (Promise.all above)
        statics = staticsResult
        for (const [id, depleted] of rockStates) staticsResult.setRockDepleted(id, depleted)
        self = createEntity(message.selfId, message.you.x, message.you.z, heroResult.mesh, heroResult.animator)
        if (message.you.gear) void applyWeapon(self.mesh, message.you.gear)
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
        minimap = createMinimap(message.zone.collision, message.zone.w, message.zone.h, message.zone.palette, walkTo)
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
          onMessage: (text) => pushMessage(text),
          getPickables: () => [
            ...(statics?.pickables ?? []),
            ...(exitLayer?.pickables ?? []),
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
        let lastMinimap = 0
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
          exitLayer?.update(now)
          updateClickMarker(marker, now)
          if (minimap && self && now - lastMinimap > 150) {
            lastMinimap = now
            const tile = (o: THREE.Object3D): { x: number; z: number } => ({ x: Math.floor(o.position.x), z: Math.floor(o.position.z) })
            const dots: MinimapDot[] = exitMarkers.map((m) => ({ x: m.x, z: m.z, kind: 'exit' as const }))
            for (const npc of npcs.values()) if (npc.serverAnim !== 'die') dots.push({ ...tile(npc.mesh), kind: 'npc' })
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
      if (self && ent.id === self.id) {
        applyEntityDiff(self, ent)
        if (ent.gear) void applyWeapon(self.mesh, ent.gear)
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
