import { useEffect, useRef, useState } from 'preact/hooks'
import { loadThree, canRender3D, assetUrl } from '../utils/three3d.js'
import { setupHideMask, attachWeapon, attachGearList, disposeObject } from '../3d/heroAttach.js'

// Live 3D character viewer. Lazy-loads three.js (see three3d.js), renders a GLB
// character, optionally attaches a weapon GLB to a named bone (or the model root
// when unrigged), and idles with an auto-rotate turntable + the model's first
// animation clip if it has one. Fully torn down on unmount — no WebGL context or
// RAF survives the screen, so nothing runs while idle.
//
// Capability-gated: when WebGL is unavailable or the load fails, it renders the
// `fallback` (the icon paper-doll) instead, so 3D is always a safe enhancement.
//
// Props:
//   characterPath public-relative path of the character GLB (resolved via probe)
//   weapon        { path, bone, position:[x,y,z], rotationDeg:[x,y,z], scale } | null
//   gear          array of the same spec shape (equipped armour pieces, each
//                 rigid-attached to its bone — helmet on Head, etc.) | null
//   idleClip      name of the animation clip to loop (default: first clip)
//   height        CSS height for the stage (default 360px)
//   autoRotate    turntable on/off (default true)
//   className     extra classes on the wrapper
//   fallback      VNode rendered when 3D can't run
//   onFail        called once when 3D can't run/load, so the parent can swap
//                 its whole layout (not just this slot) to the non-3D variant
function Model3DViewer({ characterPath, weapon = null, gear = null, idleClip = null, height = 360, autoRotate = true, className = '', fallback = null, onFail = null }) {
  const hostRef = useRef(null)
  const stateRef = useRef(null)      // holds three objects + disposed flag
  const [failed, setFailed] = useState(!canRender3D())

  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  useEffect(() => {
    if (failed && onFailRef.current) onFailRef.current()
  }, [failed])

  // ── Scene lifecycle: (re)build when the character changes ──
  useEffect(() => {
    if (!characterPath || !canRender3D()) { setFailed(true); return }
    let cancelled = false
    const host = hostRef.current
    const st = { disposed: false, raf: null, THREE: null, renderer: null, scene: null,
      camera: null, controls: null, mixer: null, clock: null, character: null,
      weapon: null, weaponAnchor: null, gear: [], gearToken: 0, bones: {}, ro: null,
      headMaskCtl: null, heroSkinned: null }
    stateRef.current = st

    loadThree().then(async ({ THREE, GLTFLoader, MeshoptDecoder, OrbitControls }) => {
      if (cancelled) return
      st.THREE = THREE
      const w = host.clientWidth || 320, h = height
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(w, h, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = height + 'px'
      renderer.domElement.style.touchAction = 'none'
      host.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.add(new THREE.HemisphereLight(0xfff2e0, 0x2a1c10, 2.0))
      const key = new THREE.DirectionalLight(0xfff2e0, 2.4); key.position.set(3, 5, 4); scene.add(key)
      const rim = new THREE.DirectionalLight(0x88bbff, 0.9); rim.position.set(-4, 2, -3); scene.add(rim)

      const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.enablePan = false
      controls.minDistance = 1.5
      controls.maxDistance = 9
      controls.autoRotate = autoRotate
      controls.autoRotateSpeed = 1.6

      Object.assign(st, { renderer, scene, camera, controls, clock: new THREE.Clock() })

      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      const charUrl = await assetUrl(characterPath)
      if (cancelled || st.disposed) return
      loader.load(charUrl, (gltf) => {
        if (cancelled || st.disposed) return
        const root = gltf.scene
        // normalise to ~1.8 units tall, feet on origin
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const scale = 1.8 / (size.y || 1)
        root.scale.setScalar(scale)
        root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
        const skinnedMeshes = []
        root.traverse((o) => {
          if (o.isBone) st.bones[o.name] = o
          if (o.isSkinnedMesh) skinnedMeshes.push(o)
        })
        scene.add(root)
        st.character = root
        // rebind target for skinned gear: the body (largest mesh — the hero
        // also carries small hair/eye meshes on the same skeleton)
        st.heroSkinned = skinnedMeshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0] || null
        st.headMaskCtl = setupHideMask(THREE, skinnedMeshes)
        camera.position.set(0, 1.15, 4.2)
        controls.target.set(0, 0.95, 0)
        controls.update()
        if (gltf.animations && gltf.animations.length) {
          const clip = (idleClip && gltf.animations.find((c) => c.name === idleClip)) || gltf.animations[0]
          st.mixer = new THREE.AnimationMixer(root)
          st.mixer.clipAction(clip).play()
        }
        attachWeapon(st, weaponRef.current, root)
        attachGearList(st, gearRef.current, root)
      }, undefined, () => { if (!cancelled) setFailed(true) })

      const renderLoop = () => {
        if (st.disposed) return
        st.raf = requestAnimationFrame(renderLoop)
        const dt = st.clock.getDelta()
        if (st.mixer) st.mixer.update(dt)
        controls.update()
        renderer.render(scene, camera)
      }
      renderLoop()

      // Idle-game hygiene: stop the loop entirely while the tab is hidden
      // (RAF is only throttled, not free, in background tabs) and resume
      // cleanly on return — swallow the accumulated clock delta so the
      // animation mixer doesn't jump-cut.
      st.onVis = () => {
        if (st.disposed) return
        if (document.hidden) {
          if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null }
        } else if (!st.raf) {
          st.clock.getDelta()
          renderLoop()
        }
      }
      document.addEventListener('visibilitychange', st.onVis)

      // keep aspect on container resize
      st.ro = new ResizeObserver(() => {
        if (st.disposed) return
        const cw = host.clientWidth || w
        renderer.setSize(cw, height, false)
        camera.aspect = cw / height
        camera.updateProjectionMatrix()
      })
      st.ro.observe(host)
    }).catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      teardown(st, host)
      stateRef.current = null
    }
  }, [characterPath, idleClip, height, autoRotate])

  // ── Weapon: attach / swap without rebuilding the scene ──
  // Keyed on the whole spec so registry transform edits re-apply live, not
  // just path/bone swaps.
  const weaponRef = useRef(weapon)
  useEffect(() => {
    weaponRef.current = weapon
    const st = stateRef.current
    if (st && st.character) attachWeapon(st, weapon, st.character)
  }, [weapon && JSON.stringify(weapon)])

  // ── Gear: attach / swap armour pieces without rebuilding the scene ──
  const gearRef = useRef(gear)
  useEffect(() => {
    gearRef.current = gear
    const st = stateRef.current
    if (st && st.character) attachGearList(st, gear, st.character)
  }, [gear && JSON.stringify(gear)])

  if (failed) return fallback

  return <div ref={hostRef} class={`w-full overflow-hidden rounded-[14px] ${className}`} style={{ height: height + 'px' }} aria-label="3D character preview" />
}

function teardown(st, host) {
  if (!st || st.disposed) return
  st.disposed = true
  if (st.onVis) document.removeEventListener('visibilitychange', st.onVis)
  if (st.raf) cancelAnimationFrame(st.raf)
  if (st.ro) st.ro.disconnect()
  if (st.controls) st.controls.dispose()
  if (st.scene) st.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) disposeObject(o) })
  if (st.renderer) {
    // renderer.getContext() works for WebGL2 too — canvas.getContext('webgl')
    // returns null once a webgl2 context exists, so don't ask the canvas.
    const gl = st.renderer.getContext()
    st.renderer.dispose()
    if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext() }
    const el = st.renderer.domElement
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }
  if (host) { while (host.firstChild) host.removeChild(host.firstChild) }
}

export default Model3DViewer
