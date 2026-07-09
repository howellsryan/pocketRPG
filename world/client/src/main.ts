import { exchangeHandoff, getStoredSession, parseHandoffFromHash, pocketRpgUrl, type WorldSession } from './auth'
import { hideOverlay, initHud, pushMessage, renderInventory, showLoginRequired, showXpDrop } from './ui'
import { connect, onMessage, send } from './net'
import { clampZoom, createCamera, createGround, createLights, createRenderer, createScene, updateCamera } from './scene'
import { applyEntityDiff, createEntity, createHeroMesh, updateEntity, type Entity } from './entities'
import { createClickMarker, setupClickToMove, showClickMarker, updateClickMarker } from './input'
import { createStatics, type Statics } from './statics'
import type { ServerMessage, ZoneEvent } from '../../shared/protocol'

const ZONE_ID = 'pasture'

function handleEvent(event: ZoneEvent): void {
  if (event.e === 'inv') renderInventory(event.inventory)
  else if (event.e === 'xp') showXpDrop(event.skill, event.amount)
  else if (event.e === 'msg') pushMessage(event.text)
}

function enterWorld(session: WorldSession): void {
  const socket = connect(window.location.host, ZONE_ID)
  let self: Entity | null = null
  let statics: Statics | null = null
  const rockStates = new Map<string, boolean>()
  let zoom = 1

  socket.addEventListener('open', () => {
    send(socket, { t: 'hello', token: session.token })
  })

  onMessage(socket, (message: ServerMessage) => {
    if (message.t === 'welcome') {
      void (async () => {
        hideOverlay()
        const scene = createScene()
        createLights(scene)
        const ground = createGround(scene, message.zone.collision, message.zone.w, message.zone.h)
        const marker = createClickMarker(scene)
        const camera = createCamera()
        const container = document.getElementById('scene')!
        const renderer = createRenderer(container)

        initHud()
        renderInventory(message.you.inventory)

        const [heroResult, staticsResult] = await Promise.all([
          createHeroMesh(),
          createStatics(scene, message.statics),
        ])
        statics = staticsResult
        for (const [id, depleted] of rockStates) staticsResult.setRockDepleted(id, depleted)
        self = createEntity(message.selfId, message.you.x, message.you.z, heroResult.mesh, heroResult.animator)
        scene.add(self.mesh)

        setupClickToMove(
          renderer.domElement,
          camera,
          ground,
          staticsResult.pickables,
          (tile) => {
            send(socket, { t: 'walk', x: tile.x, z: tile.z })
            showClickMarker(marker, tile.x, tile.z)
          },
          (target) => {
            send(socket, { t: 'interact', kind: target.kind, id: target.id, action: target.action })
          }
        )

        renderer.domElement.addEventListener(
          'wheel',
          (event) => {
            zoom = clampZoom(zoom + event.deltaY * 0.001)
            event.preventDefault()
          },
          { passive: false }
        )

        window.addEventListener('resize', () => {
          camera.aspect = window.innerWidth / window.innerHeight
          camera.updateProjectionMatrix()
          renderer.setSize(window.innerWidth, window.innerHeight)
        })

        let lastFrameTime = performance.now()
        function frame(now: number): void {
          const deltaSeconds = (now - lastFrameTime) / 1000
          lastFrameTime = now
          if (self) {
            updateEntity(self, now, deltaSeconds)
            updateCamera(camera, self.mesh.position, zoom)
          }
          updateClickMarker(marker, now)
          renderer.render(scene, camera)
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      })()
      return
    }

    if (message.t === 'diff') {
      if (self) {
        const mine = message.ents?.find((e) => e.id === self!.id)
        if (mine) applyEntityDiff(self, mine)
      }
      if (message.rocks) {
        for (const rock of message.rocks) {
          rockStates.set(rock.id, rock.depleted)
          statics?.setRockDepleted(rock.id, rock.depleted)
        }
      }
      message.events?.forEach(handleEvent)
      return
    }

    if (message.t === 'error') {
      showLoginRequired(pocketRpgUrl())
    }
  })
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
