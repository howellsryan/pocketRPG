import { exchangeHandoff, getStoredSession, parseHandoffFromHash, pocketRpgUrl, type WorldSession } from './auth'
import { hideOverlay, showLoginRequired } from './ui'
import { connect, onMessage, send } from './net'
import { clampZoom, createCamera, createGround, createLights, createRenderer, createScene, updateCamera } from './scene'
import { createEntity, createHeroMesh, setEntityTarget, updateEntity, type Entity } from './entities'
import { createClickMarker, setupClickToMove, showClickMarker, updateClickMarker } from './input'
import type { ServerMessage } from '../../shared/protocol'

const ZONE_ID = 'pasture'

function enterWorld(session: WorldSession): void {
  const socket = connect(window.location.host, ZONE_ID)
  let self: Entity | null = null
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

        const { mesh, animator } = await createHeroMesh()
        self = createEntity(message.selfId, message.you.x, message.you.z, mesh, animator)
        scene.add(self.mesh)

        setupClickToMove(renderer.domElement, camera, ground, (tile) => {
          send(socket, { t: 'walk', x: tile.x, z: tile.z })
          showClickMarker(marker, tile.x, tile.z)
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

    if (message.t === 'diff' && self) {
      const mine = message.ents?.find((e) => e.id === self!.id)
      if (mine) setEntityTarget(self, mine)
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
