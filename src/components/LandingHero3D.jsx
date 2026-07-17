import { useEffect, useRef, useState } from 'preact/hooks'
import { loadThree, assetUrl, webglAvailable, prefersReducedData } from '../utils/three3d.js'

// Landing-page WebGL hero: Warlord Grondar idling in forge light with drifting
// ember motes, pointer parallax, and a tap-to-attack flourish. Marketing-only
// surface, so it deliberately skips the gameplay `is3DEnabled()` build gate —
// the guards here are capability/preference ones (WebGL, reduced data, reduced
// motion), and the pre-rendered poster (public/landing/lp-grondar.webp, baked
// by the same lighting rig) is both the instant LCP visual and the permanent
// fallback. three.js + the 2.8 MB GLB only load after idle, off the LCP path.

const LH3D_MODEL = '3d-samples/monsters/warlord_grondar.glb'
const LH3D_HEIGHT = 2.6
const LH3D_BASE_YAW = 20 * (Math.PI / 180)

export default function LandingHero3D({ poster, posterSmall, alt }) {
  const hostRef = useRef(null)
  const canvasRef = useRef(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return undefined
    let reducedMotion = false
    try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { /* poster stays */ }
    if (reducedMotion || !webglAvailable() || prefersReducedData()) return undefined

    let disposed = false
    let cleanup = null
    // .bind(window): these are WindowOrWorkerGlobalScope methods with a
    // WebIDL receiver check — calling them as idle.cancel(...) below passes
    // `idle` as `this` and throws "Illegal invocation" without the bind.
    const idle = ('requestIdleCallback' in window)
      ? { id: requestIdleCallback(boot, { timeout: 2000 }), cancel: cancelIdleCallback.bind(window) }
      : { id: setTimeout(boot, 600), cancel: clearTimeout.bind(window) }

    async function boot() {
      let three
      try {
        three = await loadThree()
      } catch { return }
      const { THREE, GLTFLoader, MeshoptDecoder } = three
      let gltf
      try {
        const url = await assetUrl(LH3D_MODEL)
        gltf = await new Promise((res, rej) =>
          new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, res, undefined, rej))
      } catch { return }
      if (disposed) return

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
      renderer.setClearColor(0x000000, 0)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

      const scene = new THREE.Scene()
      // Forge-lit rig — must stay in step with the poster render so the
      // poster→canvas crossfade is invisible.
      scene.add(new THREE.HemisphereLight(0xffe0b8, 0x160b06, 1.15))
      const key = new THREE.DirectionalLight(0xffd9a8, 2.2)
      key.position.set(2.5, 5, 4)
      scene.add(key)
      const emberLight = new THREE.PointLight(0xf0742a, 30, 12, 2)
      emberLight.position.set(-1.6, 0.5, 2.2)
      scene.add(emberLight)
      const rim = new THREE.DirectionalLight(0xe6c878, 2.6)
      rim.position.set(-3.5, 4, -4)
      scene.add(rim)

      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const scale = LH3D_HEIGHT / (size.y || 1)
      model.scale.setScalar(scale)
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
      model.rotation.y = LH3D_BASE_YAW
      scene.add(model)

      const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100)
      camera.position.set(0, LH3D_HEIGHT * 0.46, LH3D_HEIGHT * 2.05)

      // Ember motes drifting up through the frame (additive point sprites).
      const EMBERS = 70
      const pos = new Float32Array(EMBERS * 3)
      const speed = new Float32Array(EMBERS)
      const seedEmber = (i, yLow) => {
        pos[i * 3] = (Math.random() - 0.5) * 3.2
        pos[i * 3 + 1] = yLow ? Math.random() * 0.4 : Math.random() * 3.2
        pos[i * 3 + 2] = (Math.random() - 0.5) * 1.6
        speed[i] = 0.25 + Math.random() * 0.5
      }
      for (let i = 0; i < EMBERS; i++) seedEmber(i, false)
      const emberGeo = new THREE.BufferGeometry()
      emberGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const spriteCanvas = document.createElement('canvas')
      spriteCanvas.width = spriteCanvas.height = 64
      const g = spriteCanvas.getContext('2d')
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      grad.addColorStop(0, 'rgba(255,190,110,1)')
      grad.addColorStop(0.35, 'rgba(240,116,42,0.75)')
      grad.addColorStop(1, 'rgba(240,116,42,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
      const emberTex = new THREE.CanvasTexture(spriteCanvas)
      const emberMat = new THREE.PointsMaterial({
        map: emberTex, size: 0.055, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      })
      const embers = new THREE.Points(emberGeo, emberMat)
      scene.add(embers)

      const mixer = new THREE.AnimationMixer(model)
      const clips = gltf.animations || []
      const byName = (n) => clips.find((c) => c.name === n)
      const idleClip = byName('Idle') || clips[0]
      const idleAction = idleClip ? mixer.clipAction(idleClip) : null
      if (idleAction) idleAction.play()
      let attackAction = null
      const attackClip = byName('Attack')
      if (attackClip && idleAction) {
        attackAction = mixer.clipAction(attackClip)
        attackAction.setLoop(THREE.LoopOnce, 1)
        attackAction.clampWhenFinished = true
        attackAction.timeScale = 1.35
        mixer.addEventListener('finished', (e) => {
          if (e.action !== attackAction) return
          idleAction.enabled = true
          idleAction.reset().fadeIn(0.35).play()
        })
      }
      const onTap = () => {
        if (!attackAction || attackAction.isRunning()) return
        idleAction.fadeOut(0.2)
        attackAction.reset().fadeIn(0.1).play()
      }
      host.addEventListener('pointerdown', onTap)

      // Pointer parallax; slow auto-sway when the pointer is elsewhere.
      let targetX = 0
      let targetY = 0
      let pointerAt = 0
      let swayX = 0
      let swayY = 0
      const onMove = (e) => {
        const r = host.getBoundingClientRect()
        targetX = ((e.clientX - r.left) / r.width) * 2 - 1
        targetY = ((e.clientY - r.top) / r.height) * 2 - 1
        pointerAt = performance.now()
      }
      host.addEventListener('pointermove', onMove)

      const sizeToHost = () => {
        const w = host.clientWidth || 1
        const hgt = host.clientHeight || 1
        renderer.setSize(w, hgt, false)
        camera.aspect = w / hgt
        camera.updateProjectionMatrix()
      }
      sizeToHost()
      const ro = ('ResizeObserver' in window) ? new ResizeObserver(sizeToHost) : null
      if (ro) ro.observe(host)

      const clock = new THREE.Clock()
      let raf = 0
      let inView = true
      const frame = () => {
        raf = 0
        if (disposed || !inView || document.hidden) return
        const dt = Math.min(clock.getDelta(), 0.1)
        const t = clock.elapsedTime
        mixer.update(dt)
        const auto = performance.now() - pointerAt > 2500
        const tx = auto ? Math.sin(t * 0.25) * 0.45 : targetX
        const ty = auto ? Math.sin(t * 0.18) * 0.2 : targetY
        const k = Math.min(1, dt * 3)
        swayX += (tx - swayX) * k
        swayY += (ty - swayY) * k
        model.rotation.y = LH3D_BASE_YAW + swayX * 0.3
        camera.position.x = swayX * 0.16
        camera.position.y = LH3D_HEIGHT * 0.46 - swayY * 0.1
        camera.lookAt(0, LH3D_HEIGHT * 0.52, 0)
        emberLight.intensity = 30 + Math.sin(t * 2.1) * 6
        for (let i = 0; i < EMBERS; i++) {
          pos[i * 3 + 1] += speed[i] * dt
          pos[i * 3] += Math.sin(t * 0.8 + i) * 0.0008
          if (pos[i * 3 + 1] > 3.4) seedEmber(i, true)
        }
        emberGeo.attributes.position.needsUpdate = true
        renderer.render(scene, camera)
        raf = requestAnimationFrame(frame)
      }
      const kick = () => {
        if (!raf && !disposed && inView && !document.hidden) {
          clock.getDelta()
          raf = requestAnimationFrame(frame)
        }
      }
      const io = ('IntersectionObserver' in window)
        ? new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; kick() }, { threshold: 0.05 })
        : null
      if (io) io.observe(host)
      const onVis = () => kick()
      document.addEventListener('visibilitychange', onVis)

      renderer.render(scene, camera)
      setLive(true)
      kick()

      cleanup = () => {
        if (raf) cancelAnimationFrame(raf)
        document.removeEventListener('visibilitychange', onVis)
        host.removeEventListener('pointermove', onMove)
        host.removeEventListener('pointerdown', onTap)
        if (io) io.disconnect()
        if (ro) ro.disconnect()
        mixer.stopAllAction()
        emberGeo.dispose()
        emberMat.dispose()
        emberTex.dispose()
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose()
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
          for (const m of mats) {
            for (const v of Object.values(m)) { if (v && v.isTexture) v.dispose() }
            m.dispose()
          }
        })
        renderer.dispose()
      }
    }

    return () => {
      disposed = true
      idle.cancel(idle.id)
      if (cleanup) cleanup()
    }
  }, [])

  return (
    <div class={`lp-stage${live ? ' lp-stage--live' : ''}`} ref={hostRef}>
      <span class="lp-stage__glow" aria-hidden="true" />
      <img
        class="lp-stage__poster"
        src={poster}
        srcset={posterSmall ? `${posterSmall} 360w, ${poster} 720w` : undefined}
        sizes="(min-width: 880px) 430px, 66vw"
        alt={alt}
        width="720" height="863"
        loading="eager" fetchpriority="high" decoding="async"
      />
      <canvas class="lp-stage__canvas" ref={canvasRef} aria-hidden="true" />
    </div>
  )
}
