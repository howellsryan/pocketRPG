import { useEffect, useRef, useState } from 'preact/hooks'
import { loadThree, canRender3D, assetUrl } from '../utils/three3d.js'

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
        let skinnedMesh = null
        root.traverse((o) => {
          if (o.isBone) st.bones[o.name] = o
          if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o
        })
        scene.add(root)
        st.character = root
        st.heroSkinned = skinnedMesh
        st.headMaskCtl = setupHideMask(THREE, skinnedMesh)
        camera.position.set(0, 1.15, 4.2)
        controls.target.set(0, 0.95, 0)
        controls.update()
        if (gltf.animations && gltf.animations.length) {
          const clip = (idleClip && gltf.animations.find((c) => c.name === idleClip)) || gltf.animations[0]
          st.mixer = new THREE.AnimationMixer(root)
          st.mixer.clipAction(clip).play()
        }
        attachWeapon(st, weaponRef.current)
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
    if (st && st.character) attachWeapon(st, weapon)
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

// Load + attach (or detach) the weapon GLB. Cheap swap: only the weapon subtree
// is touched, the character/scene stay put.
function attachWeapon(st, weapon) {
  if (!st || !st.THREE || !st.character) return
  // remove any previous weapon
  if (st.weapon && st.weaponAnchor) { st.weaponAnchor.remove(st.weapon); disposeObject(st.weapon); st.weapon = null }
  if (!weapon || !weapon.path) return
  const token = (st.weaponToken = (st.weaponToken || 0) + 1)
  loadThree().then(async ({ THREE, GLTFLoader, MeshoptDecoder }) => {
    if (st.disposed || token !== st.weaponToken) return
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const wUrl = await assetUrl(weapon.path)
    if (st.disposed || token !== st.weaponToken) return
    loader.load(wUrl, (gltf) => {
      if (st.disposed || token !== st.weaponToken) return
      const obj = gltf.scene
      const anchor = (weapon.bone && st.bones[weapon.bone]) ? st.bones[weapon.bone] : st.character
      const [px, py, pz] = weapon.position || [0, 0, 0]
      const [rx, ry, rz] = weapon.rotationDeg || [0, 0, 0]
      obj.position.set(px, py, pz)
      obj.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz))
      obj.scale.setScalar(typeof weapon.scale === 'number' ? weapon.scale : 1)
      anchor.add(obj)
      st.weapon = obj
      st.weaponAnchor = anchor
    })
  }).catch(() => {})
}

// Per-vertex region masks so a covering piece can cut the hero's hidden
// anatomy out of the render entirely (registry `hideHead`/`hideBody`/
// `hideLegs`), rather than trying to hide it by transforming bones. A
// bone-transform approach was tried first for the head and discarded: Head
// and Neck share skin weights at the collar, so scaling the bone always
// leaves some pinch, and since every clip animates the bones the hidden
// bone's position had to be re-derived every frame — still only
// approximately right in extreme poses. The mask is exact in every pose
// because it never touches the skeleton: each channel of `hideMask` is the
// vertex's total skin weight on that region's bones (computed once from the
// existing skinning data), and the fragment shader discards any fragment
// whose interpolated mask says it's dominantly inside a hidden region.
// Body/legs plates need this even more than helms: they're baked snug
// against the bind-pose body (canonicalize-armour.mjs), so posed skin would
// otherwise bulge through the plate at every animation extreme.
const HIDE_REGION_BONES = {
  head: ['Head'],
  torso: ['Spine01', 'Spine02', 'Waist', 'L_Clavicle', 'R_Clavicle'],
  legs: [
    'Hip', 'Pelvis',
    'L_Thigh', 'L_ThighTwist01', 'L_ThighTwist02', 'L_Calf', 'L_CalfTwist01', 'L_CalfTwist02', 'L_Foot', 'L_ToeBase',
    'R_Thigh', 'R_ThighTwist01', 'R_ThighTwist02', 'R_Calf', 'R_CalfTwist01', 'R_CalfTwist02', 'R_Foot', 'R_ToeBase',
  ],
}
export function setupHideMask(THREE, skinnedMesh) {
  if (!skinnedMesh || !skinnedMesh.skeleton) return null
  const regionIdx = ['head', 'torso', 'legs'].map((r) => {
    const wanted = new Set(HIDE_REGION_BONES[r])
    return new Set(skinnedMesh.skeleton.bones.map((b, i) => (wanted.has(b.name) ? i : -1)).filter((i) => i >= 0))
  })
  const geo = skinnedMesh.geometry
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight
  const n = geo.attributes.position.count
  const mask = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(i, k), w = sw.getComponent(i, k)
      for (let r = 0; r < 3; r++) if (regionIdx[r].has(j)) mask[i * 3 + r] += w
    }
  }
  geo.setAttribute('hideMask', new THREE.BufferAttribute(mask, 3))
  const mats = Array.isArray(skinnedMesh.material) ? skinnedMesh.material : [skinnedMesh.material]
  const shaders = []
  const hidden = new THREE.Vector3(0, 0, 0) // onBeforeCompile fires lazily on
  // first render, so the desired state must be the shader's INITIAL uniform
  // value — a set-then-compile ordering silently no-ops otherwise.
  for (const mat of mats) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHideMask = { value: hidden }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 hideMask;\nvarying vec3 vHideMask;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHideMask = hideMask;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHideMask;\nvarying vec3 vHideMask;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (dot(uHideMask, step(vec3(0.5, 0.35, 0.35), vHideMask)) > 0.0) discard;')
      shaders.push(shader)
    }
    mat.needsUpdate = true
  }
  return {
    setHidden({ head = false, torso = false, legs = false } = {}) {
      hidden.set(head ? 1 : 0, torso ? 1 : 0, legs ? 1 : 0)
    },
  }
}

// Load + attach the equipped armour GLBs (helmet on Head, etc.) — same cheap
// swap + token-guard discipline as attachWeapon, shared by the equip-screen
// viewer and the combat arena (their `st` both carry gear/gearToken/bones).
export function attachGearList(st, gear, fallbackAnchor) {
  if (!st || !st.THREE) return
  for (const g of st.gear || []) { g.anchor.remove(g.obj); disposeObject(g.obj) }
  st.gear = []
  const token = (st.gearToken = (st.gearToken || 0) + 1)
  const list = (gear || []).filter((p) => p && p.path)
  if (st.headMaskCtl) st.headMaskCtl.setHidden({
    head: list.some((p) => p.hideHead),
    torso: list.some((p) => p.hideBody),
    legs: list.some((p) => p.hideLegs),
  })
  if (!list.length) return
  loadThree().then(async ({ THREE, GLTFLoader, MeshoptDecoder }) => {
    if (st.disposed || token !== st.gearToken) return
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    for (const piece of list) {
      const url = await assetUrl(piece.path)
      if (st.disposed || token !== st.gearToken) return
      loader.load(url, (gltf) => {
        if (st.disposed || token !== st.gearToken) return
        let pieceSkinned = null
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !pieceSkinned) pieceSkinned = o })
        if (pieceSkinned && st.heroSkinned) {
          // body/legs slot: canonicalize-armour.mjs baked this mesh's vertices
          // into hero's own raw local mesh space and gave it a skin mirroring
          // hero's own skeleton, so it needs no position/rotation/scale — just
          // rebind onto the hero's LIVE skeleton (discarding the file's own
          // loaded one) and add it as a sibling of the hero's own mesh so it
          // inherits the same ancestor scale/position. Must rebind with
          // heroSkinned.bindMatrix (its ORIGINAL, frozen-at-load matrixWorld),
          // not heroSkinned.matrixWorld (which reflects whatever runtime
          // scale/position got applied to the hero's ancestors since load) —
          // those two diverge once the viewer normalises the hero to a fixed
          // height, and binding against the wrong one tears the mesh apart on
          // any pose where different bones rotate by different amounts.
          pieceSkinned.bind(st.heroSkinned.skeleton, st.heroSkinned.bindMatrix)
          st.heroSkinned.parent.add(pieceSkinned)
          st.gear.push({ obj: pieceSkinned, anchor: st.heroSkinned.parent })
          return
        }
        const obj = gltf.scene
        const boneAnchor = piece.bone ? st.bones[piece.bone] : null
        const anchor = boneAnchor || fallbackAnchor
        if (!anchor) return
        const [px, py, pz] = piece.position || [0, 0, 0]
        const [rx, ry, rz] = piece.rotationDeg || [0, 0, 0]
        obj.position.set(px, py, pz)
        obj.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz))
        obj.scale.setScalar(typeof piece.scale === 'number' ? piece.scale : 1)
        anchor.add(obj)
        st.gear.push({ obj, anchor })
      })
    }
  }).catch(() => {})
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose() }
        m.dispose()
      }
    }
  })
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
