import { useEffect, useRef, useState } from 'preact/hooks'
import HPBar from './HPBar.jsx'
import { HitSplatLayer } from './HitSplat.jsx'
import { loadThree, canRender3D, assetUrl } from '../utils/three3d.js'
import { disposeObject, attachGearList, setupHideMask } from './Model3DViewer.jsx'
import { createProcCreature } from '../3d/rigs.js'

// Phase-2 combat arena (docs/3d-gameplay-investigation.md): the rigged hero
// (equipped weapon on the hand bone) faces the monster's model in a side-on
// diorama, rendered as an INLINE panel that replaces the HP-bar block of the
// combat screen — everything below (food/potions, gear swaps, spec/spell/
// prayer) stays interactive. The combat engine stays untouched: CombatScreen
// feeds this the same tick-derived hit splats it already renders, plus an
// `attackSignal` describing who landed a hit this tick; every hit plays the
// hero's attack clip (a distinct special clip + charge on special attacks)
// or the monster's transform-faked lunge (static meshes need no rig), with a
// recoil + red flash on whoever got hurt. Splats float over each combatant.
//
// Load gate: `onReady` fires once models are mounted and the first frame is
// queued (or after LOAD_TIMEOUT_MS, so a slow fetch can't stall the fight
// forever) — CombatScreen holds combat ticks until then. Same lifecycle
// hygiene as Model3DViewer: lazy three.js, teardown on unmount, RAF paused
// while the tab is hidden. Any load/init failure calls onFail so the parent
// drops back to the classic UI — the arena is always a safe enhancement.

const ARENA_GAP_X = 2.3          // world-space distance between the two actors
const ATTACK_IMPACT_DELAY_MS = 240 // lunge wind-up before the victim reacts
const LOAD_TIMEOUT_MS = 12000    // release the combat hold even if loading drags

function CombatArena3D({
  monsterName,
  monsterPath,
  monsterProc = null,
  monsterHeight = 2,
  monsterRotationDeg = [0, -90, 0],
  characterPath,
  heroProc = null,
  clips = {},
  weapon = null,
  gear = null,
  attackSignal = null,
  monsterHP,
  playerHP,
  monsterSplats,
  playerSplats,
  onReady,
  onFail,
}) {
  const hostRef = useRef(null)
  const stateRef = useRef(null)
  const [failed, setFailed] = useState(!canRender3D())
  const [ready, setReady] = useState(false)
  const stageHeight = Math.max(200, Math.min(Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.34), 330))

  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    if (failed && onFailRef.current) onFailRef.current()
  }, [failed])

  // The procedural hero swaps in place on equipment changes (see the effect
  // below), so the mount effect reads it through a ref instead of re-running.
  const heroProcRef = useRef(heroProc)

  useEffect(() => {
    if ((!characterPath && !heroProcRef.current) || (!monsterPath && !monsterProc) || !canRender3D()) { setFailed(true); return }
    let cancelled = false
    const host = hostRef.current
    const st = {
      disposed: false, raf: null, THREE: null, renderer: null, scene: null, camera: null,
      mixer: null, monsterMixer: null, clock: null, hero: null, monster: null, monsterCreature: null, heroCreature: null, bones: {}, weapon: null,
      gear: [], gearToken: 0, headMaskCtl: null, heroSkinned: null,
      idleAction: null, attackAction: null, specialAction: null,
      monsterIdleAction: null, monsterAttackAction: null, timers: new Set(),
      // Procedural timelines: { t, dur } advanced by the render loop.
      monsterLunge: null, monsterReact: null, heroReact: null, heroLunge: null,
      monsterFlash: null, heroFlash: null, monsterMats: [], heroMats: [],
    }
    stateRef.current = st

    let readyFired = false
    const fireReady = () => {
      if (readyFired || cancelled || st.disposed) return
      readyFired = true
      setReady(true)
      if (onReadyRef.current) onReadyRef.current()
    }
    // Load watchdog: if nothing mounted by now the network is too slow for
    // 3D — fail over to the classic bars instead of an empty stage (also
    // releases CombatScreen's tick hold via onFail → arenaClosed).
    const readyTimer = setTimeout(() => {
      if (st.hero) fireReady()
      else if (!cancelled && !st.disposed) setFailed(true)
    }, LOAD_TIMEOUT_MS)

    loadThree().then(async ({ THREE, GLTFLoader, MeshoptDecoder }) => {
      if (cancelled) return
      st.THREE = THREE
      const w = host.clientWidth || 320
      const h = stageHeight
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(w, h, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = h + 'px'
      host.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.add(new THREE.HemisphereLight(0xfff2e0, 0x2a1c10, 1.9))
      const key = new THREE.DirectionalLight(0xfff2e0, 2.2); key.position.set(3, 5, 4); scene.add(key)
      const rim = new THREE.DirectionalLight(0x88bbff, 0.9); rim.position.set(-4, 2, -3); scene.add(rim)
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(3.4, 40),
        new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1, metalness: 0 }),
      )
      ground.rotation.x = -Math.PI / 2
      scene.add(ground)

      const camera = new THREE.PerspectiveCamera(38, w / h, 0.01, 100)
      camera.position.set(0, 1.7, 4.8)
      camera.lookAt(0, Math.max(1.0, monsterHeight * 0.45), 0)
      Object.assign(st, { renderer, scene, camera, clock: new THREE.Clock() })

      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      const loadGlb = async (path) => {
        const url = await assetUrl(path)
        return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
      }

      // Wrap each actor: outer group carries position + procedural offsets,
      // inner model is normalised (target height, feet on the ground plane).
      const mountActor = (gltf, targetHeight, x, faceRotY) => {
        const group = new THREE.Group()
        arenaNormalizeInto(THREE, group, gltf.scene, targetHeight)
        group.position.set(x, 0, 0)
        group.rotation.y = faceRotY
        scene.add(group)
        return group
      }
      const collectMats = (obj) => {
        const mats = []
        obj.traverse((o) => {
          if (!o.material) return
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m.emissive) mats.push(m)
          }
        })
        return mats
      }

      const heroSpecNow = heroProcRef.current
      const [heroGltf, monsterGltf] = await Promise.all([
        heroSpecNow ? Promise.resolve(null) : loadGlb(characterPath),
        monsterProc ? Promise.resolve(null) : loadGlb(monsterPath),
      ])
      if (cancelled || st.disposed) return

      // Procedural hero: a rigged blend-shell creature wearing the composed
      // equipment (fit + animation come from the shared rig, so there is no
      // weapon/gear attach path). GLB hero: clips carry a baked root
      // orientation — animated, she faces +x (east) with no group rotation.
      if (heroSpecNow) st.heroCreature = createProcCreature(THREE, heroSpecNow)
      st.hero = st.heroCreature
        ? mountActor({ scene: st.heroCreature.group }, heroSpecNow.height || 1.8, -ARENA_GAP_X / 2,
            THREE.MathUtils.degToRad((heroSpecNow.rotationDeg || [0, 90, 0])[1]))
        : mountActor(heroGltf, 1.8, -ARENA_GAP_X / 2, 0)
      // Monster facing is registry data (`rotationDeg`, default faces the
      // hero) so a differently-authored GLB is a JSON fix, not a code change.
      const [mrx, mry, mrz] = monsterRotationDeg
      // Procedural monsters build a rigged blend-shell creature in place of a
      // GLB; mount and camera framing are shared, but motion (idle, lunge,
      // flinch, death) comes from the rig, not the group offsets below.
      if (monsterProc) st.monsterCreature = createProcCreature(THREE, monsterProc)
      st.monster = mountActor(
        st.monsterCreature ? { scene: st.monsterCreature.group } : monsterGltf,
        monsterHeight, ARENA_GAP_X / 2, THREE.MathUtils.degToRad(mry),
      )
      st.monster.rotation.x = THREE.MathUtils.degToRad(mrx)
      st.monsterBaseRotZ = THREE.MathUtils.degToRad(mrz)
      // Long-bodied monsters (dragons) are height-normalised but can span
      // several units — place them by their NEAREST edge so the snout starts
      // at a fixed gap from centre instead of overlapping the hero.
      const mBox = new THREE.Box3().setFromObject(st.monster)
      st.monsterBaseX = Math.max(0.6, st.monster.position.x + (0.35 - mBox.min.x))
      st.monster.position.x = st.monsterBaseX
      st.heroMats = collectMats(st.hero)
      st.monsterMats = collectMats(st.monster)
      if (!st.heroCreature) {
        let heroSkinnedMesh = null
        st.hero.traverse((o) => {
          if (o.isBone) st.bones[o.name] = o
          if (o.isSkinnedMesh && !heroSkinnedMesh) heroSkinnedMesh = o
        })
        st.heroSkinned = heroSkinnedMesh
        st.headMaskCtl = setupHideMask(THREE, heroSkinnedMesh)
      }

      // Frame both actors whatever the monster's bulk.
      const allBox = new THREE.Box3().setFromObject(st.monster).union(new THREE.Box3().setFromObject(st.hero))
      const spanX = allBox.max.x - allBox.min.x
      const midX = (allBox.max.x + allBox.min.x) / 2 * 0.4
      camera.position.set(midX, Math.max(1.7, allBox.max.y * 0.6), Math.max(4.8, spanX * 1.05))
      camera.lookAt(midX, Math.max(1.0, allBox.max.y * 0.42), 0)

      if (heroGltf && heroGltf.animations && heroGltf.animations.length) {
        st.mixer = new THREE.AnimationMixer(st.hero)
        const anims = heroGltf.animations
        const byName = (name) => (name ? anims.find((c) => c.name === name) : null)
        st.idleAction = st.mixer.clipAction(byName(clips.idle || 'Idle') || anims[0])
        st.idleAction.play()
        const onceAction = (clip) => {
          if (!clip) return null
          const action = st.mixer.clipAction(clip)
          action.setLoop(THREE.LoopOnce, 1)
          return action
        }
        st.attackAction = onceAction(byName(clips.attack || 'Box'))
        st.specialAction = onceAction(byName(clips.special))
        st.mixer.addEventListener('finished', (e) => {
          if (st.disposed || (e.action !== st.attackAction && e.action !== st.specialAction)) return
          e.action.fadeOut(0.15)
          st.idleAction.reset().fadeIn(0.15).play()
        })
      }

      // Rigged monsters animate from their own clips (import convention:
      // 'Idle' loops, 'Attack' fires on hit; unnamed single clip = idle).
      // Clip-less monsters keep the procedural bob + lunge.
      if (monsterGltf && monsterGltf.animations && monsterGltf.animations.length) {
        st.monsterMixer = new THREE.AnimationMixer(st.monster)
        const mAnims = monsterGltf.animations
        const idleClip = mAnims.find((c) => c.name === 'Idle') || mAnims[0]
        st.monsterIdleAction = st.monsterMixer.clipAction(idleClip)
        st.monsterIdleAction.play()
        const attackClip = mAnims.find((c) => c.name === 'Attack')
        if (attackClip) {
          st.monsterAttackAction = st.monsterMixer.clipAction(attackClip)
          st.monsterAttackAction.setLoop(THREE.LoopOnce, 1)
          st.monsterMixer.addEventListener('finished', (e) => {
            if (st.disposed || e.action !== st.monsterAttackAction) return
            e.action.fadeOut(0.15)
            st.monsterIdleAction.reset().fadeIn(0.15).play()
          })
        }
      }

      if (!st.heroCreature) {
        attachArenaWeapon(st, weaponRef.current)
        attachGearList(st, gearRef.current, st.hero)
      }

      const timeline = (tl, dt) => {
        if (!tl) return null
        tl.t += dt
        return tl.t >= tl.dur ? null : tl
      }
      const renderLoop = () => {
        if (st.disposed) return
        st.raf = requestAnimationFrame(renderLoop)
        const dt = st.clock.getDelta()
        const now = st.clock.elapsedTime
        if (st.mixer) st.mixer.update(dt)
        if (st.monsterMixer) st.monsterMixer.update(dt)
        if (st.monsterCreature) st.monsterCreature.update(dt)
        if (st.heroCreature) st.heroCreature.update(dt)

        // Monster idle bob + procedural attack/reaction offsets (GLB path
        // only — rigged creatures own all of their motion).
        if (st.monster && !st.monsterCreature) {
          let ox = 0, oy = Math.sin(now * 1.6) * 0.02 * monsterHeight, rz = 0
          st.monsterLunge = timeline(st.monsterLunge, dt)
          if (st.monsterLunge) {
            const p = st.monsterLunge.t / st.monsterLunge.dur
            ox -= Math.sin(Math.PI * p) * 0.9
            rz = Math.sin(Math.PI * p) * 0.08
          }
          st.monsterReact = timeline(st.monsterReact, dt)
          if (st.monsterReact) {
            const p = st.monsterReact.t / st.monsterReact.dur
            ox += Math.sin(p * 26) * 0.05 * (1 - p) + (1 - p) * 0.12
          }
          st.monster.position.x = (st.monsterBaseX ?? ARENA_GAP_X / 2) + ox
          st.monster.position.y = oy
          st.monster.rotation.z = (st.monsterBaseRotZ || 0) + rz
        }
        if (st.hero) {
          let ox = 0
          st.heroLunge = timeline(st.heroLunge, dt)
          if (st.heroLunge) ox += Math.sin(Math.PI * (st.heroLunge.t / st.heroLunge.dur)) * (st.heroLunge.amp || 0.45)
          st.heroReact = timeline(st.heroReact, dt)
          if (st.heroReact) {
            const p = st.heroReact.t / st.heroReact.dur
            ox -= Math.sin(p * 26) * 0.04 * (1 - p) + (1 - p) * 0.1
          }
          st.hero.position.x = -ARENA_GAP_X / 2 + ox
        }

        // Damage flash: emissive decaying over the timeline (red by default,
        // gold on special-attack impacts).
        for (const [tlKey, mats] of [['monsterFlash', st.monsterMats], ['heroFlash', st.heroMats]]) {
          st[tlKey] = timeline(st[tlKey], dt)
          const tl = st[tlKey]
          const p = tl ? 1 - tl.t / tl.dur : 0
          for (const m of mats) {
            if (p > 0) { m.emissive.setRGB(tl.r ?? 0.8, tl.g ?? 0.05, tl.b ?? 0.02); m.emissiveIntensity = p * 0.7 }
            else if (m.emissiveIntensity) { m.emissiveIntensity = 0 }
          }
          // Blend-shell materials have no emissive — the flash rides a shader
          // uniform instead.
          if (tlKey === 'monsterFlash' && st.monsterCreature) {
            st.monsterCreature.setFlash(tl ? (tl.r ?? 0.8) : 0.8, tl ? (tl.g ?? 0.05) : 0.05, tl ? (tl.b ?? 0.02) : 0.02, p * 0.7)
          }
          if (tlKey === 'heroFlash' && st.heroCreature) {
            st.heroCreature.setFlash(tl ? (tl.r ?? 0.8) : 0.8, tl ? (tl.g ?? 0.05) : 0.05, tl ? (tl.b ?? 0.02) : 0.02, p * 0.7)
          }
        }

        st.renderer.render(st.scene, st.camera)
      }
      renderLoop()
      fireReady()

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

      st.ro = new ResizeObserver(() => {
        if (st.disposed) return
        const cw = host.clientWidth || w
        st.renderer.setSize(cw, stageHeight, false)
        st.camera.aspect = cw / stageHeight
        st.camera.updateProjectionMatrix()
      })
      st.ro.observe(host)
    }).catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      clearTimeout(readyTimer)
      arenaTeardown(st, host)
      stateRef.current = null
    }
  }, [characterPath, monsterPath, monsterProc && JSON.stringify(monsterProc), monsterHeight, monsterRotationDeg.join()])

  // Weapon swaps mid-fight without a scene rebuild. Keyed on the whole spec
  // so registry transform edits re-apply live, not just path/bone swaps.
  // (GLB hero only — the procedural hero recomposes via heroProc above.)
  const weaponRef = useRef(weapon)
  useEffect(() => {
    weaponRef.current = weapon
    const st = stateRef.current
    if (st && st.hero && !st.heroCreature) attachArenaWeapon(st, weapon)
  }, [weapon && JSON.stringify(weapon)])

  // Gear (armour) swaps mid-fight the same way.
  const gearRef = useRef(gear)
  useEffect(() => {
    gearRef.current = gear
    const st = stateRef.current
    if (st && st.hero && !st.heroCreature) attachGearList(st, gear, st.hero)
  }, [gear && JSON.stringify(gear)])

  // Rigged creatures die on-screen: HP hitting 0 plays the death collapse,
  // and the auto-fight respawn (HP back above 0 on the same monster) stands
  // it back up. GLB monsters keep their existing behaviour.
  const wasDeadRef = useRef(false)
  useEffect(() => {
    const st = stateRef.current
    const hp = monsterHP && monsterHP.current
    const dead = hp <= 0
    if (st && st.monsterCreature && dead !== wasDeadRef.current) {
      st.monsterCreature.trigger(dead ? 'death' : 'respawn')
    }
    wasDeadRef.current = dead
  }, [monsterHP && monsterHP.current <= 0])

  // The procedural hero dies and respawns on-screen the same way.
  const heroWasDeadRef = useRef(false)
  useEffect(() => {
    const st = stateRef.current
    const dead = playerHP && playerHP.current <= 0
    if (st && st.heroCreature && dead !== heroWasDeadRef.current) {
      st.heroCreature.trigger(dead ? 'death' : 'respawn')
    }
    heroWasDeadRef.current = dead
  }, [playerHP && playerHP.current <= 0])

  // Equipment changes recompose the hero spec: swap the blend-shell creature
  // in place (same normalisation as mountActor) instead of rebuilding the
  // scene, so mid-fight gear swaps never re-trigger the loading hold.
  useEffect(() => {
    const prev = heroProcRef.current
    heroProcRef.current = heroProc
    const st = stateRef.current
    if (!st || !st.THREE || st.disposed || !st.hero || !st.heroCreature || !heroProc) return
    if (prev && JSON.stringify(prev) === JSON.stringify(heroProc)) return
    const old = st.heroCreature
    st.hero.remove(old.group)
    old.dispose()
    st.heroCreature = createProcCreature(st.THREE, heroProc)
    arenaNormalizeInto(st.THREE, st.hero, st.heroCreature.group, heroProc.height || 1.8)
  }, [heroProc && JSON.stringify(heroProc)])

  // A hit landed this tick: hero attacks when the player dealt damage, the
  // monster lunges when it hit back. Victims react at the impact moment.
  useEffect(() => {
    const st = stateRef.current
    if (!attackSignal || !st || st.disposed || !st.THREE) return
    if (attackSignal.hero) {
      const special = Boolean(attackSignal.special)
      if (st.heroCreature) {
        st.heroCreature.trigger('attack')
        // rig owns the swing; specials keep the bigger step-in
        if (special) st.heroLunge = { t: 0, dur: 0.6, amp: 0.45 }
      } else {
        const action = (special && st.specialAction) || st.attackAction
        if (action) {
          st.idleAction && st.idleAction.fadeOut(0.1)
          action.reset().fadeIn(0.1).play()
        }
        // Specials read as a charge: a bigger lunge on top of (or instead of)
        // the clip, and a gold impact flash instead of the usual red.
        if (special || !action) st.heroLunge = { t: 0, dur: special ? 0.6 : 0.5, amp: special ? 0.9 : 0.45 }
      }
      const timer = setTimeout(() => {
        st.timers.delete(timer)
        if (st.disposed) return
        if (st.monsterCreature) st.monsterCreature.trigger('hit')
        else st.monsterReact = { t: 0, dur: 0.45 }
        st.monsterFlash = special ? { t: 0, dur: 0.55, r: 1, g: 0.72, b: 0.08 } : { t: 0, dur: 0.4 }
      }, ATTACK_IMPACT_DELAY_MS)
      st.timers.add(timer)
    }
    if (attackSignal.monster) {
      if (st.monsterCreature) {
        st.monsterCreature.trigger('attack')
      } else if (st.monsterAttackAction) {
        st.monsterIdleAction && st.monsterIdleAction.fadeOut(0.1)
        st.monsterAttackAction.reset().fadeIn(0.1).play()
      } else {
        st.monsterLunge = { t: 0, dur: 0.55 }
      }
      const timer = setTimeout(() => {
        st.timers.delete(timer)
        if (st.disposed) return
        if (st.heroCreature) st.heroCreature.trigger('hit')
        else st.heroReact = { t: 0, dur: 0.45 }
        st.heroFlash = { t: 0, dur: 0.4 }
      }, ATTACK_IMPACT_DELAY_MS)
      st.timers.add(timer)
    }
  }, [attackSignal && attackSignal.seq])

  if (failed) return null

  return (
    <div class="relative">
      <div
        ref={hostRef}
        class="w-full overflow-hidden rounded-[14px] bg-[var(--color-void)] border border-[var(--color-void-border)]"
        style={{ height: stageHeight + 'px' }}
        aria-label={`3D battle: you versus ${monsterName}`}
      />
      {/* HP readouts pinned over each combatant's corner */}
      <div class="absolute top-2 left-2 w-[38%]">
        <div class="text-[10px] font-semibold text-[var(--color-parchment)] mb-0.5 drop-shadow">You</div>
        <HPBar current={playerHP.current} max={playerHP.max} />
      </div>
      <div class="absolute top-2 right-2 w-[38%]">
        <div class="text-[10px] font-semibold text-[var(--color-parchment)] mb-0.5 text-right drop-shadow">{monsterName}</div>
        <HPBar current={monsterHP.current} max={monsterHP.max} />
      </div>
      {/* Hit splats float over the models themselves */}
      <div class="absolute pointer-events-none" style={{ left: '8%', bottom: '18%', width: '30%', height: '42%' }}>
        <HitSplatLayer splats={playerSplats} />
      </div>
      <div class="absolute pointer-events-none" style={{ right: '8%', bottom: '22%', width: '32%', height: '46%' }}>
        <HitSplatLayer splats={monsterSplats} />
      </div>
      {/* Loading veil — combat is held until onReady, so make the wait visible */}
      {!ready && (
        <div class="absolute inset-0 flex items-center justify-center rounded-[14px] bg-[var(--color-void)]">
          <span class="text-xs font-semibold text-[var(--color-gold-dim)] animate-pulse">⚔️ Entering the arena…</span>
        </div>
      )}
    </div>
  )
}

// Normalise a model into a parent group: target height, feet on the ground
// plane, centred. Shared by initial mounts and procedural-hero swaps.
function arenaNormalizeInto(THREE, group, model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const scale = targetHeight / (size.y || 1)
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  group.add(model)
}

// Attach/replace the hero's weapon GLB on its bone (mirrors the equip-screen
// attach; arena-prefixed so top-level names stay unique across the build).
function attachArenaWeapon(st, weapon) {
  if (!st || !st.THREE || !st.hero) return
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
      const anchor = (weapon.bone && st.bones[weapon.bone]) ? st.bones[weapon.bone] : st.hero
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

function arenaTeardown(st, host) {
  if (!st || st.disposed) return
  st.disposed = true
  for (const t of st.timers) clearTimeout(t)
  st.timers.clear()
  if (st.onVis) document.removeEventListener('visibilitychange', st.onVis)
  if (st.raf) cancelAnimationFrame(st.raf)
  if (st.ro) st.ro.disconnect()
  if (st.monsterCreature) { st.monsterCreature.dispose(); st.monsterCreature = null }
  if (st.heroCreature) { st.heroCreature.dispose(); st.heroCreature = null }
  if (st.scene) st.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) disposeObject(o) })
  if (st.renderer) {
    const gl = st.renderer.getContext()
    st.renderer.dispose()
    if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext() }
    const el = st.renderer.domElement
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }
  if (host) { while (host.firstChild) host.removeChild(host.firstChild) }
}

export default CombatArena3D
