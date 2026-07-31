import { useEffect, useRef, useState } from 'preact/hooks'
import HPBar from './HPBar.jsx'
import { HitSplatLayer } from './HitSplat.jsx'
import { loadThree, canRender3D, assetUrl } from '../utils/three3d.js'
import { disposeObject, attachWeapon, attachGearList, setupHideMask } from '../3d/heroAttach.js'
import { createProcCreature } from '../3d/rigs.js'
import { mountArenaBiome } from '../3d/biomes.js'
import { TICK_DURATION } from '../utils/constants.js'
import { resolveWindupTick } from '../utils/combatWindup.js'
import { selectMonsterAttackClip, monsterAttackClipName } from '../engine/monsterClips.js'

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
// A rigged monster's swing is instead LED by `windupSignal` (fired one tick
// early) so a slow clip connects on the hit tick — its recoil/flash then
// lands with the splat rather than 240ms later. See the wind-up effect below.
//
// Load gate: `onReady` fires once models are mounted and the first frame is
// queued (or after LOAD_TIMEOUT_MS, so a slow fetch can't stall the fight
// forever) — CombatScreen holds combat ticks until then. Same lifecycle
// hygiene as Model3DViewer: lazy three.js, teardown on unmount, RAF paused
// while the tab is hidden. Any load/init failure calls onFail so the parent
// drops back to the classic UI — the arena is always a safe enhancement.

const ARENA_GAP_X = 2.3          // world-space distance between the two actors
const ATTACK_IMPACT_DELAY_MS = 240 // impact point for un-led swings (proc/clip-less)
const LOAD_TIMEOUT_MS = 12000    // release the combat hold even if loading drags
// GLB-rigged monsters with no death clip (e.g. Warlord Grondar — its source
// only ships idle + a punch-swing) get a coded collapse instead: tip the
// mounted group over its feet-pivot rather than relying on baked animation.
const MONSTER_FALL_ANGLE = Math.PI * 0.42
const MONSTER_FALL_RATE = 3.2

// Points `st.monsterAttackAction` at the clip for the style the monster is
// about to swing with. A rig with one attack clip resolves to it for every
// style, so this is a no-op there.
function stopMonsterAttackActions(st) {
  for (const action of Object.values(st.monsterAttackActions || {})) action.stop()
}

function selectMonsterAttackAction(st, attackStyle, monsterId) {
  const actions = st.monsterAttackActions
  if (!actions) return
  const next = actions[monsterAttackClipName(attackStyle, monsterId)] || actions.Attack || Object.values(actions)[0] || null
  if (!next || next === st.monsterAttackAction) return
  // Mid-swing the running clip keeps the body; swapping under it snaps the rig.
  if (st.monsterAttackAction && st.monsterAttackAction.isRunning()) return
  st.monsterAttackAction = next
}

function CombatArena3D({
  monsterId = null,
  monsterName,
  monsterPath,
  monsterProc = null,
  monsterHeight = 2,
  monsterRotationDeg = [0, -90, 0],
  characterPath,
  characterRotationDeg = [0, 0, 0],
  heroProc = null,
  biome = null,
  clips = {},
  weapon = null,
  gear = null,
  attackSignal = null,
  windupSignal = null,
  monsterAttackImpactSec = null,
  monsterAttackMaxSec = null,
  monsterAttackStyle = null,
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

  // The procedural hero swaps in place on equipment changes, and the
  // procedural monster on boss form changes (see the effects below), so the
  // mount effect reads both through refs instead of re-running.
  const heroProcRef = useRef(heroProc)
  const monsterProcRef = useRef(monsterProc)
  const biomeRef = useRef(biome)
  biomeRef.current = biome
  // The style of the monster's NEXT swing. A rigged monster's swing is led by
  // the wind-up a tick early, and a style-rotating boss has already picked the
  // upcoming form by then, so reading it there selects the right clip.
  const monsterAttackStyleRef = useRef(monsterAttackStyle)
  monsterAttackStyleRef.current = monsterAttackStyle

  useEffect(() => {
    if ((!characterPath && !heroProcRef.current) || (!monsterPath && !monsterProc) || !canRender3D()) { setFailed(true); return }
    let cancelled = false
    const host = hostRef.current
    const st = {
      disposed: false, raf: null, THREE: null, renderer: null, scene: null, camera: null,
      mixer: null, monsterMixer: null, clock: null, hero: null, monster: null, monsterCreature: null, heroCreature: null, bones: {}, weapon: null,
      gear: [], gearToken: 0, headMaskCtl: null, heroSkinned: null,
      idleAction: null, attackAction: null, specialAction: null,
      monsterIdleAction: null, monsterAttackAction: null, monsterLedAttack: false, monsterSwingScheduled: false, timers: new Set(),
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
      // Biome set dressing owns lights/ground/backdrop when the fight's place
      // has one (Phase 4); the classic dark disc stays as the null fallback.
      if (biomeRef.current) {
        st.biome = mountArenaBiome(THREE, scene, biomeRef.current)
      } else {
        scene.add(new THREE.HemisphereLight(0xfff2e0, 0x2a1c10, 1.9))
        const key = new THREE.DirectionalLight(0xfff2e0, 2.2); key.position.set(3, 5, 4); scene.add(key)
        const rim = new THREE.DirectionalLight(0x88bbff, 0.9); rim.position.set(-4, 2, -3); scene.add(rim)
        const ground = new THREE.Mesh(
          new THREE.CircleGeometry(3.4, 40),
          new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1, metalness: 0 }),
        )
        ground.rotation.x = -Math.PI / 2
        scene.add(ground)
      }

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
      const monsterSpecNow = monsterProcRef.current
      const [heroGltf, monsterGltf] = await Promise.all([
        heroSpecNow ? Promise.resolve(null) : loadGlb(characterPath),
        monsterSpecNow ? Promise.resolve(null) : loadGlb(monsterPath),
      ])
      if (cancelled || st.disposed) return

      // Procedural hero: a rigged blend-shell creature wearing the composed
      // equipment (fit + animation come from the shared rig, so there is no
      // weapon/gear attach path). GLB hero: authored facing is registry data
      // (character `rotationDeg`, [0,90,0] turns the +z-facing Quaternius
      // build toward the monster) so a differently-authored GLB is a JSON
      // fix, not a code change.
      if (heroSpecNow) st.heroCreature = createProcCreature(THREE, heroSpecNow)
      st.hero = st.heroCreature
        ? mountActor({ scene: st.heroCreature.group }, heroSpecNow.height || 1.8, -ARENA_GAP_X / 2,
            THREE.MathUtils.degToRad((heroSpecNow.rotationDeg || [0, 90, 0])[1]))
        : mountActor(heroGltf, 1.8, -ARENA_GAP_X / 2, THREE.MathUtils.degToRad((characterRotationDeg || [0, 0, 0])[1]))
      // Monster facing is registry data (`rotationDeg`, default faces the
      // hero) so a differently-authored GLB is a JSON fix, not a code change.
      const [mrx, mry, mrz] = monsterSpecNow ? (monsterSpecNow.rotationDeg || [0, -90, 0]) : monsterRotationDeg
      // Procedural monsters build a rigged blend-shell creature in place of a
      // GLB; mount and camera framing are shared, but motion (idle, lunge,
      // flinch, death) comes from the rig, not the group offsets below.
      if (monsterSpecNow) st.monsterCreature = createProcCreature(THREE, monsterSpecNow)
      st.monster = mountActor(
        st.monsterCreature ? { scene: st.monsterCreature.group } : monsterGltf,
        monsterSpecNow ? (monsterSpecNow.height || 1.4) : monsterHeight,
        ARENA_GAP_X / 2, THREE.MathUtils.degToRad(mry),
      )
      st.monsterBaseRotX = THREE.MathUtils.degToRad(mrx)
      st.monster.rotation.x = st.monsterBaseRotX
      st.monsterBaseRotZ = THREE.MathUtils.degToRad(mrz)
      st.monsterFallCur = 0
      st.monsterFallTarget = 0
      // Long-bodied monsters (dragons) are height-normalised but can span
      // several units — place them by their NEAREST edge so the snout starts
      // at a fixed gap from centre instead of overlapping the hero. Runs
      // again on boss form swaps (the new body's bulk can differ wildly), so
      // it also owns the monster's shadow blob and the camera framing.
      if (st.biome) st.biome.addShadowBlob(-ARENA_GAP_X / 2, 0, 0.55)
      st.placeMonster = () => {
        const mBox = new THREE.Box3().setFromObject(st.monster)
        st.monsterBaseX = Math.max(0.6, st.monster.position.x + (0.35 - mBox.min.x))
        st.monster.position.x = st.monsterBaseX
        if (st.biome) {
          const blobR = Math.max(0.5, (mBox.max.x - mBox.min.x) * 0.42)
          if (st.monsterBlob) {
            st.monsterBlob.position.x = st.monsterBaseX
            st.monsterBlob.scale.setScalar(blobR * 2)
          } else {
            st.monsterBlob = st.biome.addShadowBlob(st.monsterBaseX, 0, blobR)
          }
        }
        // Frame both actors whatever the monster's bulk.
        const allBox = new THREE.Box3().setFromObject(st.monster).union(new THREE.Box3().setFromObject(st.hero))
        const spanX = allBox.max.x - allBox.min.x
        const midX = (allBox.max.x + allBox.min.x) / 2 * 0.4
        camera.position.set(midX, Math.max(1.7, allBox.max.y * 0.6), Math.max(4.8, spanX * 1.05))
        camera.lookAt(midX, Math.max(1.0, allBox.max.y * 0.42), 0)
      }
      st.placeMonster()
      st.heroMats = collectMats(st.hero)
      st.monsterMats = collectMats(st.monster)
      if (!st.heroCreature) {
        const skinnedMeshes = []
        st.hero.traverse((o) => {
          if (o.isBone) st.bones[o.name] = o
          if (o.isSkinnedMesh) skinnedMeshes.push(o)
        })
        // rebind target for skinned gear: the body (largest mesh — the hero
        // also carries small hair/eye meshes on the same skeleton)
        st.heroSkinned = skinnedMeshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0] || null
        st.headMaskCtl = setupHideMask(THREE, skinnedMeshes)
      }

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
          // Hold the final frame instead of snapping to the bind pose the
          // instant the clip ends — the finished handler crossfades back to
          // idle, so without this the hero jolts before idle fades in.
          action.clampWhenFinished = true
          return action
        }
        st.attackAction = onceAction(byName(clips.attack || 'Box'))
        st.specialAction = onceAction(byName(clips.special))
        st.hitAction = onceAction(byName(clips.hit))
        st.deathAction = onceAction(byName(clips.death)) // clamped: stays collapsed
        st.mixer.addEventListener('finished', (e) => {
          if (st.disposed || (e.action !== st.attackAction && e.action !== st.specialAction && e.action !== st.hitAction)) return
          // Crossfade from the clamped end pose back into the still-running idle
          // (no reset — restarting the loop from frame 0 pops the stance).
          e.action.fadeOut(0.25)
          st.idleAction.enabled = true
          st.idleAction.fadeIn(0.25).play()
        })
      }

      // Rigged monsters animate from their own clips (import convention:
      // 'Idle' loops, 'Attack' fires on hit, 'Death' plays once and holds;
      // unnamed single clip = idle). Monsters with no 'Death' clip fall back
      // to the coded collapse (below) instead. Clip-less monsters keep the
      // procedural bob + lunge.
      if (monsterGltf && monsterGltf.animations && monsterGltf.animations.length) {
        st.monsterMixer = new THREE.AnimationMixer(st.monster)
        const mAnims = monsterGltf.animations
        const idleClip = mAnims.find((c) => c.name === 'Idle') || mAnims[0]
        st.monsterIdleAction = st.monsterMixer.clipAction(idleClip)
        st.monsterIdleAction.play()
        // A rig may carry a second attack clip for ranged/magic swings. Both are
        // prepared here and the live one is chosen per swing from the style the
        // monster is about to attack with (selectMonsterAttackAction).
        st.monsterAttackActions = {}
        for (const style of ['melee', 'ranged']) {
          const clip = selectMonsterAttackClip(mAnims, style, monsterId)
          if (!clip || st.monsterAttackActions[clip.name]) continue
          // Registry cap (attackMaxSec): a rig whose attack clip ends by
          // collapsing to the floor is cut at the follow-through, or every swing
          // reads as the monster dropping dead. Min, so it's idempotent on the
          // cached clip this mixer shares with the next fight.
          if (monsterAttackMaxSec > 0) clip.duration = Math.min(clip.duration, monsterAttackMaxSec)
          const action = st.monsterMixer.clipAction(clip)
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true // hold the end frame; crossfade below (no bind-pose snap)
          st.monsterAttackActions[clip.name] = action
        }
        if (Object.keys(st.monsterAttackActions).length) {
          selectMonsterAttackAction(st, monsterAttackStyleRef.current, monsterId)
          st.monsterMixer.addEventListener('finished', (e) => {
            if (st.disposed || !Object.values(st.monsterAttackActions).includes(e.action)) return
            e.action.fadeOut(0.25)
            st.monsterIdleAction.enabled = true
            st.monsterIdleAction.fadeIn(0.25).play()
          })
        }
        const deathClip = mAnims.find((c) => c.name === 'Death')
        if (deathClip) {
          st.monsterDeathAction = st.monsterMixer.clipAction(deathClip)
          st.monsterDeathAction.setLoop(THREE.LoopOnce, 1)
          st.monsterDeathAction.clampWhenFinished = true
        }
      }

      if (!st.heroCreature) {
        attachWeapon(st, weaponRef.current, st.hero)
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
        if (st.monsterMixer && (st.monsterFallCur || 0) < 0.98) st.monsterMixer.update(dt)
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
          st.monsterFallCur += (((st.monsterFallTarget || 0)) - st.monsterFallCur) * Math.min(1, dt * MONSTER_FALL_RATE)
          st.monster.position.x = (st.monsterBaseX ?? ARENA_GAP_X / 2) + ox
          st.monster.position.y = oy * (1 - st.monsterFallCur)
          st.monster.rotation.z = (st.monsterBaseRotZ || 0) + rz
          st.monster.rotation.x = (st.monsterBaseRotX || 0) + st.monsterFallCur * MONSTER_FALL_ANGLE
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
    // Procedural monster spec changes (boss form swaps, dev spec edits) swap
    // the creature in place via the effect below instead of rebuilding the
    // scene; GLB monsters keep the full remount on registry changes.
  }, [characterPath, monsterPath, Boolean(monsterProc), monsterProc ? '' : monsterHeight + '|' + monsterRotationDeg.join(), biome && biome.id])

  // Weapon swaps mid-fight without a scene rebuild. Keyed on the whole spec
  // so registry transform edits re-apply live, not just path/bone swaps.
  // (GLB hero only — the procedural hero recomposes via heroProc above.)
  const weaponRef = useRef(weapon)
  useEffect(() => {
    weaponRef.current = weapon
    const st = stateRef.current
    if (st && st.hero && !st.heroCreature) attachWeapon(st, weapon, st.hero)
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
    if (st && dead !== wasDeadRef.current) { st.monsterLedAttack = false; st.monsterSwingScheduled = false } // stale wind-up can't land through a death/respawn
    if (st && st.monsterCreature && dead !== wasDeadRef.current) {
      st.monsterCreature.trigger(dead ? 'death' : 'respawn')
    } else if (st && st.monster && !st.monsterCreature && dead !== wasDeadRef.current) {
      if (st.monsterDeathAction) {
        // A real baked death clip takes over entirely — no coded topple.
        if (dead) {
          stopMonsterAttackActions(st)
          st.monsterIdleAction && st.monsterIdleAction.fadeOut(0.1)
          st.monsterDeathAction.reset().fadeIn(0.1).play()
        } else {
          st.monsterDeathAction.fadeOut(0.2)
          st.monsterIdleAction && st.monsterIdleAction.reset().fadeIn(0.2).play()
        }
      } else {
        st.monsterFallTarget = dead ? 1 : 0
        if (dead) stopMonsterAttackActions(st)
      }
    }
    wasDeadRef.current = dead
  }, [monsterHP && monsterHP.current <= 0])

  // The hero dies and respawns on-screen the same way — the GLB hero plays
  // its death clip and stays collapsed (clampWhenFinished) until HP recovers.
  const heroWasDeadRef = useRef(false)
  useEffect(() => {
    const st = stateRef.current
    const dead = playerHP && playerHP.current <= 0
    if (st && dead !== heroWasDeadRef.current) {
      if (st.heroCreature) {
        st.heroCreature.trigger(dead ? 'death' : 'respawn')
      } else if (st.deathAction) {
        if (dead) {
          st.idleAction && st.idleAction.fadeOut(0.1)
          st.hitAction && st.hitAction.stop()
          st.deathAction.reset().fadeIn(0.1).play()
        } else {
          st.deathAction.fadeOut(0.2)
          st.idleAction && st.idleAction.reset().fadeIn(0.2).play()
        }
      }
    }
    heroWasDeadRef.current = dead
  }, [playerHP && playerHP.current <= 0])

  // Boss form changes (multiForm monsters, combat.monster.currentForm) swap
  // the monster's blend-shell creature in place — a phase transition never
  // rebuilds the scene or re-triggers the loading hold. The new body's bulk
  // can differ wildly (throne → spider), so placement/framing re-run too.
  useEffect(() => {
    const prev = monsterProcRef.current
    monsterProcRef.current = monsterProc
    const st = stateRef.current
    if (!st || !st.THREE || st.disposed || !st.monster || !st.monsterCreature || !monsterProc) return
    if (prev && JSON.stringify(prev) === JSON.stringify(monsterProc)) return
    const T = st.THREE
    const old = st.monsterCreature
    st.monster.remove(old.group)
    old.dispose()
    st.monsterCreature = createProcCreature(T, monsterProc)
    arenaNormalizeInto(T, st.monster, st.monsterCreature.group, monsterProc.height || 1.4)
    const [mrx, mry, mrz] = monsterProc.rotationDeg || [0, -90, 0]
    st.monster.rotation.y = T.MathUtils.degToRad(mry)
    st.monster.rotation.x = T.MathUtils.degToRad(mrx)
    st.monsterBaseRotZ = T.MathUtils.degToRad(mrz)
    // placeMonster measures from the current position, so re-centre first.
    st.monster.position.set(ARENA_GAP_X / 2, 0, 0)
    if (st.placeMonster) st.placeMonster()
  }, [monsterProc && JSON.stringify(monsterProc)])

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
      // A rigged monster's swing is LED on the wind-up tick so it connects on
      // this exact hit tick — the hero then flinches now, in sync with the
      // engine's hit splat (reactDelay 0). Everything else (proc creatures,
      // clip-less monsters, or a missed wind-up) plays from here and reacts at
      // the clip's impact point.
      let reactDelay = ATTACK_IMPACT_DELAY_MS
      if (st.monsterCreature) {
        st.monsterCreature.trigger('attack')
      } else if (st.monsterAttackAction) {
        if (st.monsterLedAttack) reactDelay = 0
        else {
          selectMonsterAttackAction(st, monsterAttackStyleRef.current, monsterId)
          st.monsterIdleAction && st.monsterIdleAction.fadeOut(0.1)
          st.monsterAttackAction.reset().fadeIn(0.1).play()
        }
        st.monsterLedAttack = false
        st.monsterSwingScheduled = false // this cycle's swing has landed
      } else {
        st.monsterLunge = { t: 0, dur: 0.55 }
      }
      const reactHero = () => {
        if (st.disposed) return
        if (st.heroCreature) {
          st.heroCreature.trigger('hit')
        } else if (st.hitAction && !(st.deathAction && st.deathAction.isRunning())) {
          // flinch clip (dying hero keeps the collapse); mid-swing hits keep
          // the attack clip and settle for the procedural recoil
          if (st.attackAction && st.attackAction.isRunning()) {
            st.heroReact = { t: 0, dur: 0.45 }
          } else {
            st.idleAction && st.idleAction.fadeOut(0.1)
            st.hitAction.reset().fadeIn(0.1).play()
          }
        } else {
          st.heroReact = { t: 0, dur: 0.45 }
        }
        st.heroFlash = { t: 0, dur: 0.4 }
      }
      if (reactDelay === 0) reactHero()
      else {
        const timer = setTimeout(() => { st.timers.delete(timer); reactHero() }, reactDelay)
        st.timers.add(timer)
      }
    }
  }, [attackSignal && attackSignal.seq])

  // The engine broadcasts how many ticks remain until the monster's next
  // attack. A rigged monster (GLB with a baked 'Attack' clip) leads its swing
  // so the blow's IMPACT frame lands on the hit tick's splat. The impact point
  // is `attackImpactSec` into the clip (registry data — e.g. an overhead smash
  // connects part-way through a long clip); absent → the clip's end. The swing
  // starts on the single tick where that lead still fits before the hit, offset
  // into the gap so the impact frame coincides with the hit, then plays its
  // recovery until the next swing (or idle) takes over. Proc creatures /
  // clip-less monsters own their timing and ignore this.
  useEffect(() => {
    const st = stateRef.current
    if (!windupSignal || !st || st.disposed || !st.monsterAttackAction) return
    if (st.monsterSwingScheduled || (st.monsterFallCur || 0) > 0.02) return
    selectMonsterAttackAction(st, monsterAttackStyleRef.current, monsterId)
    const ticks = windupSignal.ticks || 0
    if (ticks < 1) return
    const clip = st.monsterAttackAction.getClip()
    const clipMs = (clip && clip.duration ? clip.duration : 0.5) * 1000
    const impactMs = Math.min(clipMs, (monsterAttackImpactSec != null ? monsterAttackImpactSec * 1000 : clipMs))
    // Shared timing (src/utils/combatWindup.js) — the same helper the open-world
    // path uses, so both align the impact frame onto the hit tick identically.
    const windup = resolveWindupTick(ticks, impactMs, TICK_DURATION)
    if (!windup) return
    st.monsterSwingScheduled = true
    const timer = setTimeout(() => {
      st.timers.delete(timer)
      if (st.disposed || (st.monsterFallCur || 0) > 0.02 || (st.monsterDeathAction && st.monsterDeathAction.isRunning())) return
      st.monsterIdleAction && st.monsterIdleAction.fadeOut(0.1)
      st.monsterAttackAction.reset().fadeIn(0.1).play()
      st.monsterLedAttack = true
    }, windup.startDelayMs)
    st.timers.add(timer)
  }, [windupSignal && windupSignal.seq])

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
  if (st.biome) { st.biome.dispose(); st.biome = null }
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
