// Hero attachment runtime shared by the equip-screen viewer (Model3DViewer),
// the combat arena (CombatArena3D), and the render harness
// (docs/prototypes/arena-hero-harness.html via scripts/render-arena-hero.mjs)
// — one implementation so what the harness screenshots is exactly what ships.
// Plain JS (no JSX/preact) so the harness can import it as a browser module.
import { loadThree, assetUrl } from '../utils/three3d.js'

// Per-vertex region masks so a covering piece can cut the hero's hidden
// anatomy out of the render entirely (registry `hideHead`/`hideBody`/
// `hideLegs`), rather than trying to hide it by transforming bones. A
// bone-transform approach was tried first for the head and discarded: head
// and neck share skin weights at the collar, so scaling the bone always
// leaves some pinch, and since every clip animates the bones the hidden
// bone's position had to be re-derived every frame — still only
// approximately right in extreme poses. The mask is exact in every pose
// because it never touches the skeleton: each channel of `hideMask` is the
// vertex's total skin weight on that region's bones (computed once from the
// existing skinning data), and the fragment shader discards any fragment
// whose interpolated mask says it's dominantly inside a hidden region.
// Body/legs outfit pieces need this even more than helms: posed skin would
// otherwise bulge through the piece at every animation extreme.
// Bone names are the Quaternius universal rig (scripts/build-arena-hero.mjs).
const HIDE_REGION_BONES = {
  head: ['Head'],
  torso: ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'],
  legs: [
    'pelvis',
    'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'ball_leaf_l',
    'thigh_r', 'calf_r', 'foot_r', 'ball_r', 'ball_leaf_r',
  ],
}

// The hero is several skinned meshes sharing one skeleton (body + hair +
// eyes), so the mask must cover ALL of them — a helm that hides the head has
// to take the hair mesh with it. Accepts one mesh or an array; returns a
// single control driving every mesh's shader.
export function setupHideMask(THREE, skinnedMeshes) {
  const meshes = (Array.isArray(skinnedMeshes) ? skinnedMeshes : [skinnedMeshes]).filter((m) => m && m.skeleton)
  if (!meshes.length) return null
  const hidden = new THREE.Vector3(0, 0, 0) // onBeforeCompile fires lazily on
  // first render, so the desired state must be the shader's INITIAL uniform
  // value — a set-then-compile ordering silently no-ops otherwise.
  for (const skinnedMesh of meshes) {
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
    for (const mat of mats) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uHideMask = { value: hidden }
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec3 hideMask;\nvarying vec3 vHideMask;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHideMask = hideMask;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uHideMask;\nvarying vec3 vHideMask;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (dot(uHideMask, step(vec3(0.5, 0.35, 0.35), vHideMask)) > 0.0) discard;')
      }
      mat.needsUpdate = true
    }
  }
  return {
    setHidden({ head = false, torso = false, legs = false } = {}) {
      hidden.set(head ? 1 : 0, torso ? 1 : 0, legs ? 1 : 0)
    },
  }
}

// Tier tint: recolour the piece's materials with the registry `tint`.
// `mode` is false (default), true, or 'replace':
//  - false: multiply only materials named "*steel*" — the Quaternius weapon
//    builds (scripts/build-quaternius-weapons.mjs) bake their steel materials
//    to a neutral grey ladder, so a multiply keeps the light/dark shading
//    while recolouring bronze → runeforged; wood handles stay untouched.
//  - true: multiply every material (skinned outfit pieces — a tier-dyed
//    outfit read over its own texture).
//  - 'replace': hard-set every material's colour to the tint AND drop any
//    diffuse texture (equipModels.js TINT_ALL_MODELS). The openworld weapon
//    pipeline (mace/talwar/pickaxe/crossbow/spear/staff/trident) and
//    q_celtic.gltf keep their source's own (often dark/textured) colours, so
//    multiplying barely shifts the result — these need a full override to
//    read as "this item's tier colour" the way the grey-baked models do.
export function applyEquipTint(THREE, obj, tint, mode = false) {
  if (!tint) return
  const c = new THREE.Color(tint)
  obj.traverse((o) => {
    if (!o.material) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m.color) continue
      if (mode === 'replace') {
        m.color.copy(c)
        if (m.map) { m.map = null; m.needsUpdate = true }
      } else if (mode === true || /steel/i.test(m.name || '')) {
        m.color.multiply(c)
      }
    }
  })
}

// Load + attach (or detach) the weapon GLB on the hero's hand bone (model
// root when the spec carries no bone). Cheap swap: only the weapon subtree is
// touched, the character/scene stay put. `st` carries { THREE, disposed,
// bones, weapon, weaponAnchor, weaponToken }.
export function attachWeapon(st, weapon, fallbackAnchor) {
  if (!st || !st.THREE || !fallbackAnchor) return
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
      const anchor = (weapon.bone && st.bones[weapon.bone]) ? st.bones[weapon.bone] : fallbackAnchor
      const [px, py, pz] = weapon.position || [0, 0, 0]
      const [rx, ry, rz] = weapon.rotationDeg || [0, 0, 0]
      obj.position.set(px, py, pz)
      obj.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz))
      obj.scale.setScalar(typeof weapon.scale === 'number' ? weapon.scale : 1)
      applyEquipTint(THREE, obj, weapon.tint, weapon.tintAll)
      anchor.add(obj)
      st.weapon = obj
      st.weaponAnchor = anchor
    })
  }).catch(() => {})
}

// Load + attach the equipped armour GLBs — same cheap swap + token-guard
// discipline as attachWeapon, shared by the equip-screen viewer and the
// combat arena (their `st` both carry gear/gearToken/bones/heroSkinned).
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
        // Quaternius outfit exports keep each sub-part (body/belt/belt/arms,
        // legs/boots, ...) as its own skinned mesh node rather than one merged
        // mesh, so a piece can carry several — collect all of them, not just
        // the first, or whole sub-parts (boots, pauldrons) silently vanish.
        const pieceSkinnedList = []
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh) pieceSkinnedList.push(o) })
        // Only body/legs outfit pieces (built to share the hero skeleton, marked
        // by their region hide-flag) get rebound onto the hero's live skeleton.
        // A skinned prop with its own rig (the cape's 13-bone drape) is attached
        // rigidly to a bone below in its own bind pose instead — rebinding its
        // mismatched joints onto the hero skeleton would tear it apart.
        if (pieceSkinnedList.length && st.heroSkinned && (piece.hideBody || piece.hideLegs)) {
          for (const pieceSkinned of pieceSkinnedList) {
            // body/legs slot: the outfit build (build-quaternius-outfits.mjs)
            // gave this mesh a skin mirroring hero's own skeleton (same joint
            // order), so it needs no position/rotation/scale — just rebind onto
            // the hero's LIVE skeleton (discarding the file's own loaded one)
            // and add it as a sibling of the hero's own mesh so it inherits the
            // same ancestor scale/position. Must rebind with
            // heroSkinned.bindMatrix (its ORIGINAL, frozen-at-load matrixWorld),
            // not heroSkinned.matrixWorld (which reflects whatever runtime
            // scale/position got applied to the hero's ancestors since load) —
            // those two diverge once the viewer normalises the hero to a fixed
            // height, and binding against the wrong one tears the mesh apart on
            // any pose where different bones rotate by different amounts.
            pieceSkinned.bind(st.heroSkinned.skeleton, st.heroSkinned.bindMatrix)
            applyEquipTint(THREE, pieceSkinned, piece.tint, true)
            st.heroSkinned.parent.add(pieceSkinned)
            st.gear.push({ obj: pieceSkinned, anchor: st.heroSkinned.parent })
          }
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
        // 'replace' (equipModels.js TINT_ALL_MODELS) wins when set — those
        // openworld weapon models need a hard colour override. Amulets/capes
        // are grey-baked props recoloured whole by a multiply instead (their
        // metal/cloth isn't named 'steel'); other rigid pieces keep the
        // name-scoped metal tint so wood/leather stays untouched.
        applyEquipTint(THREE, obj, piece.tint, piece.tintAll || piece.slot === 'neck' || piece.slot === 'cape')
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
