// Procedural animation rigs for blend-shell creatures (Phase 2 of
// docs/procedural-3d-plan.md). No clips, no skeletons: the rig moves SDF
// primitives every frame and the shell re-projects, so parts stay fused.
//
// Sub-systems, all driven from the spec:
// - Combat state machine (idle / attack / hit / death / respawn) producing
//   eased root motion per archetype.
// - Reactive legs: feet stay planted while the root moves; a foot steps only
//   when its hip has drifted past a threshold, alternating step groups —
//   the same solver handles 2, 4, or 6+ legs.
// - Verlet ropes (tails, ears, tentacles): physics segments that are SDF
//   primitives, so they flop while staying seamlessly fused.
// - Head sway (incommensurate slow sines — organic, never twitchy), breathe
//   (radius swell), wing flap, and a serpent spine wave.
//
// three.js is passed in by the caller; this module has no eval-time deps
// beyond blendShell.js.

import { createBlendShellCreature } from './blendShell.js'

const RIG_MAX_DT = 0.05
const RIG_SUBSTEP = 1 / 60
const RIG_DURATIONS = { attack: 0.6, hit: 0.45, death: 1.1 }

const rigClamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const rigEase = (p) => p * p * (3 - 2 * p)
const rigEaseOut = (p) => 1 - (1 - p) * (1 - p)

// Spec → living creature: { group, update(dt), trigger(event), setFlash,
// dispose }. `trigger` accepts 'attack' | 'hit' | 'death' | 'respawn'.
export function createProcCreature(THREE, spec) {
  const shell = createBlendShellCreature(THREE, spec)
  const { parts, byId, baseA, baseB, mats, overrideA, overrideB, radiusScale } = shell
  const archetype = spec.archetype || 'quadruped'

  // Creature-local extents: pivots and motion amplitudes scale with size.
  let minY = Infinity, maxY = -Infinity, cz = 0
  for (let i = 0; i < parts.length; i++) {
    const r = Math.max(parts[i].r1, parts[i].r2)
    minY = Math.min(minY, baseA[i].y - r, baseB[i].y - r)
    maxY = Math.max(maxY, baseA[i].y + r, baseB[i].y + r)
    cz += (baseA[i].z + baseB[i].z) / 2
  }
  const S = Math.max(0.3, maxY - minY)
  const pivot = new THREE.Vector3(0, (minY + maxY) / 2, (cz / parts.length))

  // ── legs ──
  const legIds = spec.legs || []
  const legs = legIds.map((leg, k) => {
    const idx = byId[leg.part]
    return {
      idx,
      footIdx: leg.foot !== undefined ? byId[leg.foot] : -1,
      hipBase: baseA[idx].clone(),
      footBase: baseB[idx].clone(),
      plant: baseB[idx].clone(),
      step: null,
      group: legGroup(archetype, k, legIds.length),
    }
  })
  for (const leg of legs) {
    overrideA[leg.idx] = new THREE.Vector3().copy(leg.hipBase)
    overrideB[leg.idx] = new THREE.Vector3().copy(leg.footBase)
    if (leg.footIdx >= 0) {
      overrideA[leg.footIdx] = new THREE.Vector3().copy(baseA[leg.footIdx])
      overrideB[leg.footIdx] = new THREE.Vector3().copy(baseB[leg.footIdx])
    }
  }

  // ── ropes ──
  const ropes = (spec.ropes || []).map((r) => {
    const idxs = r.parts.map((id) => byId[id])
    const pts = [baseA[idxs[0]].clone()]
    const lens = []
    for (const i of idxs) {
      pts.push(baseB[i].clone())
      lens.push(baseA[i].distanceTo(baseB[i]))
    }
    for (const i of idxs) {
      overrideA[i] = new THREE.Vector3().copy(baseA[i])
      overrideB[i] = new THREE.Vector3().copy(baseB[i])
    }
    return {
      idxs,
      pts,
      prev: pts.map((p) => p.clone()),
      lens,
      rest: pts.map((p) => p.clone()),
      anchorBase: baseA[idxs[0]].clone(),
      anchorIdx: r.anchorTo !== undefined ? byId[r.anchorTo] : -1,
      gravity: r.gravity ?? 2.2,
      sway: r.sway ?? 0.25,
      // 0 = limp chain (tails); higher springs back toward the authored
      // shape (ears, wattles — appendages that hold their pose but jiggle)
      stiffness: r.stiffness ?? 0,
      phase: Math.random() * Math.PI * 2,
    }
  })

  const headParts = spec.head ? spec.head.parts.map((id) => byId[id]) : []
  const headAnchor = spec.head ? new THREE.Vector3(...spec.head.anchor) : null

  // ── arms (humanoid) ── two-segment chains: upper rotates about the
  // shoulder anchor, lower (forearm + anything gripped, e.g. composed weapon
  // parts) additionally about the elbow. The right arm carries the weapon
  // swing on attack.
  const armSides = []
  if (spec.arms) {
    for (const side of ['left', 'right']) {
      const g = spec.arms[side]
      if (!g) continue
      armSides.push({
        right: side === 'right',
        upper: (g.upper || []).map((id) => byId[id]),
        lower: (g.lower || []).map((id) => byId[id]),
        anchor: new THREE.Vector3(...g.anchor),
        elbow: g.elbow ? new THREE.Vector3(...g.elbow) : null,
        phase: side === 'right' ? 0 : 1.7,
      })
    }
  }
  const breatheParts = spec.breathe ? spec.breathe.parts.map((id) => byId[id]) : []
  const wingParts = spec.wings ? spec.wings.parts.map((id) => byId[id]) : []
  const spineParts = spec.spine ? spec.spine.parts.map((id) => byId[id]) : []

  // ── state ──
  let t = 0
  let state = 'idle'
  let stateT = 0
  let dead = false
  let hopT = Math.random() * 2 // hopper idle timer
  let idleT = 0 // time since combat motion ended (drives leg re-homing)
  let acc = 0

  const rootPos = new THREE.Vector3()
  const rootEuler = new THREE.Euler()
  let rootScaleY = 1

  const tmpM = new THREE.Matrix4()
  const tmpM2 = new THREE.Matrix4()
  const tmpM3 = new THREE.Matrix4()
  const tmpV = new THREE.Vector3()
  const tmpV2 = new THREE.Vector3()
  const tmpE = new THREE.Euler()

  const trigger = (name) => {
    if (name === 'respawn') {
      dead = false
      state = 'idle'
      stateT = 0
      for (const leg of legs) { leg.plant.copy(leg.footBase); leg.step = null }
      for (const rope of ropes) {
        rope.pts.forEach((p, i) => p.copy(rope.rest[i]))
        rope.prev.forEach((p, i) => p.copy(rope.rest[i]))
      }
      return
    }
    if (dead) return
    if (name === 'death') { state = 'death'; stateT = 0; dead = true; return }
    if (name === 'attack' || name === 'hit') {
      // hits interrupt attacks and vice versa; retriggers restart
      state = name
      stateT = 0
    }
  }

  // Root motion per archetype+state. Writes rootPos/rootEuler/rootScaleY.
  const applyRootMotion = () => {
    rootPos.set(0, 0, 0)
    rootEuler.set(0, 0, 0)
    rootScaleY = 1
    const flying = archetype === 'flyer'
    const p = state === 'idle' ? 0 : rigClamp(stateT / RIG_DURATIONS[state], 0, 1)

    // idle base: gentle bob + weight shift (hover for flyers)
    if (flying) {
      rootPos.y += 0.045 * S * Math.sin(t * 1.6)
      rootEuler.z += 0.05 * Math.sin(t * 0.9)
      rootEuler.x += 0.03 * Math.sin(t * 1.3 + 1)
    } else if (!dead) {
      rootPos.y += 0.012 * S * Math.sin(t * 1.1)
      rootPos.x += 0.008 * S * Math.sin(t * 0.4)
    }

    if (archetype === 'hopper' && state === 'idle' && !dead) {
      // periodic in-place hop: crouch → airborne → land squash → recover
      const cycle = 2.6
      const hp = (t + hopT) % cycle
      if (hp < 0.25) { const e = rigEase(hp / 0.25); rootScaleY = 1 - 0.14 * e }
      else if (hp < 0.6) {
        const e = (hp - 0.25) / 0.35
        rootPos.y += 0.22 * S * Math.sin(Math.PI * e)
        rootScaleY = 1 + 0.1 * Math.sin(Math.PI * e)
      } else if (hp < 0.85) { const e = 1 - rigEase((hp - 0.6) / 0.25); rootScaleY = 1 - 0.12 * e }
    }

    if (state === 'attack') {
      if (archetype === 'hopper') {
        // pounce: squash, leap forward with stretch, land back home
        if (p < 0.25) { const e = rigEase(p / 0.25); rootScaleY = 1 - 0.18 * e; rootPos.y -= 0.06 * S * e }
        else {
          const e = (p - 0.25) / 0.75
          rootPos.z += 0.5 * S * Math.sin(Math.PI * e)
          rootPos.y += 0.2 * S * Math.sin(Math.PI * rigClamp(e * 1.15, 0, 1))
          rootScaleY = 1 + 0.12 * Math.sin(Math.PI * e)
        }
      } else if (archetype === 'serpent') {
        // strike: coil back then whip forward, nose down
        if (p < 0.3) { const e = rigEase(p / 0.3); rootPos.z -= 0.14 * S * e }
        else { const e = (p - 0.3) / 0.7; rootPos.z += 0.55 * S * Math.sin(Math.PI * e) - 0.14 * S * (1 - rigEaseOut(rigClamp(e * 2, 0, 1))); rootEuler.x += 0.18 * Math.sin(Math.PI * e) }
      } else if (archetype === 'humanoid') {
        // the sword arm carries the action: a modest step-in plus hip twist
        // into the slash, no quadruped-style body lunge
        if (p < 0.25) { const e = rigEase(p / 0.25); rootPos.z -= 0.05 * S * e; rootPos.y -= 0.02 * S * e }
        else {
          const e = (p - 0.25) / 0.75
          rootPos.z += 0.16 * S * Math.sin(Math.PI * e) - 0.05 * S * (1 - rigEaseOut(rigClamp(e * 2, 0, 1)))
          rootEuler.y -= 0.35 * Math.sin(Math.PI * e)
          rootEuler.x += 0.08 * Math.sin(Math.PI * e)
        }
      } else {
        // ground/flyer lunge with anticipation crouch
        if (p < 0.25) { const e = rigEase(p / 0.25); rootPos.z -= 0.08 * S * e; if (!flying) rootPos.y -= 0.045 * S * e }
        else { const e = (p - 0.25) / 0.75; rootPos.z += 0.45 * S * Math.sin(Math.PI * e) - 0.08 * S * (1 - rigEaseOut(rigClamp(e * 2, 0, 1))); rootEuler.x += (flying ? 0.3 : 0.12) * Math.sin(Math.PI * e) }
      }
    } else if (state === 'hit') {
      const fall = 1 - p
      rootPos.z -= 0.13 * S * Math.sin(Math.PI * rigClamp(p * 1.15, 0, 1))
      rootEuler.y += 0.05 * Math.sin(p * 18) * fall
      if (!flying) rootPos.y += 0.015 * S * Math.sin(p * 14) * fall
    } else if (state === 'death') {
      const e = rigEase(p)
      if (flying) {
        // fall from hover, then keel over
        rootPos.set(0, 0, 0); rootEuler.set(0, 0, 0)
        rootPos.y -= (minY > 0.02 ? minY : 0.1 * S) * rigClamp(p * 2, 0, 1)
        rootEuler.z += 1.15 * rigEase(rigClamp(p * 1.4 - 0.3, 0, 1))
        rootPos.y -= 0.16 * S * rigEase(rigClamp(p * 1.4 - 0.3, 0, 1))
      } else if (archetype === 'serpent') {
        rootScaleY = 1 - 0.45 * e
      } else if (archetype === 'humanoid') {
        // crumple forward: knees give (squash), torso slumps face-down
        rootEuler.x += 1.05 * e
        rootPos.y -= 0.16 * S * e
        rootScaleY = 1 - 0.2 * e
      } else {
        rootEuler.z += 0.95 * e
        rootPos.y -= 0.22 * S * e
        rootScaleY = 1 - 0.1 * e
      }
    }

    // squash/stretch happens about the pivot; shift down so the belly stays
    // grounded instead of the feet lifting
    rootPos.y -= (pivot.y - minY) * (1 - rootScaleY)
    tmpM.makeTranslation(rootPos.x + pivot.x, rootPos.y + pivot.y, rootPos.z + pivot.z)
    tmpM2.makeRotationFromEuler(rootEuler)
    tmpM.multiply(tmpM2)
    tmpM2.makeScale(1, rootScaleY, 1)
    tmpM.multiply(tmpM2)
    tmpM2.makeTranslation(-pivot.x, -pivot.y, -pivot.z)
    tmpM.multiply(tmpM2)
    shell.rootMat.copy(tmpM)
  }

  const rotAboutInto = (out, anchor, ex, ey, ez) => {
    out.makeTranslation(anchor.x, anchor.y, anchor.z)
    tmpM2.makeRotationFromEuler(tmpE.set(ex, ey, ez))
    out.multiply(tmpM2)
    tmpM2.makeTranslation(-anchor.x, -anchor.y, -anchor.z)
    out.multiply(tmpM2)
    return out
  }

  const updateLegs = (dt) => {
    if (!legs.length) return
    const deathP = state === 'death' ? rigEase(rigClamp(stateT / RIG_DURATIONS.death, 0, 1)) : 0
    const stepping = new Set()
    for (const leg of legs) if (leg.step) stepping.add(leg.group)
    for (const leg of legs) {
      // hip rides the root; the planted foot does not
      tmpV.copy(leg.hipBase).applyMatrix4(shell.rootMat)
      overrideA[leg.idx].copy(tmpV)
      if (deathP > 0) {
        // death: the foot stops being planted and rides the keeling body
        // rigidly — legs stay coherent with the roll instead of slicing
        // through the torso toward a ground plant
        tmpV2.copy(leg.footBase).applyMatrix4(shell.rootMat)
        leg.plant.lerp(tmpV2, rigClamp(dt * 10, 0, 1))
        leg.step = null
      } else if (leg.step) {
        const st = leg.step
        st.t += dt
        const p = rigClamp(st.t / st.dur, 0, 1)
        leg.plant.lerpVectors(st.from, st.to, rigEase(p))
        leg.plant.y = leg.footBase.y + Math.sin(Math.PI * p) * 0.07 * S
        if (p >= 1) { leg.plant.copy(st.to); leg.step = null }
      } else if (!dead) {
        // step when the root has dragged the hip too far from the plant;
        // once combat motion has been over for a beat, tighten the threshold
        // so plants scrambled by hit/attack knockback re-home to the stance
        tmpV2.set(leg.footBase.x + rootPos.x, leg.footBase.y, leg.footBase.z + rootPos.z)
        const dx = tmpV2.x - leg.plant.x
        const dz = tmpV2.z - leg.plant.z
        const drift = Math.hypot(dx, dz)
        const threshold = (idleT > 0.5 ? 0.025 : 0.09) * S
        if (drift > threshold && !stepping.has(1 - leg.group)) {
          leg.step = {
            from: leg.plant.clone(),
            // overshoot proportionally (25% of drift) so gaits read alive; a
            // fixed-length overshoot lands past the re-step threshold and the
            // legs flail forever after the first combat root motion
            to: tmpV2.clone().add(tmpV.set(dx, 0, dz).multiplyScalar(0.25)),
            t: 0,
            dur: 0.16,
          }
          stepping.add(leg.group)
        }
      }
      overrideB[leg.idx].copy(leg.plant)
      if (leg.footIdx >= 0) {
        // hoof/claw rides its foot rigidly
        tmpV.subVectors(leg.plant, leg.footBase)
        overrideA[leg.footIdx].copy(baseA[leg.footIdx]).add(tmpV)
        overrideB[leg.footIdx].copy(baseB[leg.footIdx]).add(tmpV)
      }
    }
  }

  const ropeAccel = new THREE.Vector3()
  const updateRopes = (h) => {
    for (const rope of ropes) {
      // anchor follows the root (and the anchor part's sway, e.g. ears on a
      // swaying head)
      tmpV.copy(rope.anchorBase)
      if (rope.anchorIdx >= 0) tmpV.applyMatrix4(mats[rope.anchorIdx])
      tmpV.applyMatrix4(shell.rootMat)
      rope.pts[0].copy(tmpV)
      ropeAccel.set(rope.sway * Math.sin(t * 1.7 + rope.phase), -rope.gravity, rope.sway * 0.6 * Math.sin(t * 1.1 + rope.phase * 2))
      for (let i = 1; i < rope.pts.length; i++) {
        const p = rope.pts[i]
        const prev = rope.prev[i]
        const vx = (p.x - prev.x) * 0.9
        const vy = (p.y - prev.y) * 0.9
        const vz = (p.z - prev.z) * 0.9
        prev.copy(p)
        p.x += vx + ropeAccel.x * h * h * S
        p.y += vy + ropeAccel.y * h * h * S
        p.z += vz + ropeAccel.z * h * h * S
        if (rope.stiffness > 0) {
          // spring toward the authored rest shape carried along with the anchor
          tmpV2.copy(rope.rest[i])
          if (rope.anchorIdx >= 0) tmpV2.applyMatrix4(mats[rope.anchorIdx])
          tmpV2.applyMatrix4(shell.rootMat)
          p.lerp(tmpV2, rope.stiffness)
        }
        if (p.y < 0.015) p.y = 0.015 // floor
      }
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < rope.lens.length; i++) {
          const a = rope.pts[i]
          const b = rope.pts[i + 1]
          tmpV.subVectors(b, a)
          const d = tmpV.length() || 1e-6
          const corr = (d - rope.lens[i]) / d
          if (i === 0) b.addScaledVector(tmpV, -corr)
          else { a.addScaledVector(tmpV, corr * 0.5); b.addScaledVector(tmpV, -corr * 0.5) }
        }
      }
    }
  }

  const commitRopes = () => {
    for (const rope of ropes) {
      for (let i = 0; i < rope.idxs.length; i++) {
        overrideA[rope.idxs[i]].copy(rope.pts[i])
        overrideB[rope.idxs[i]].copy(rope.pts[i + 1])
      }
    }
  }

  const update = (dt) => {
    dt = rigClamp(dt || 0, 0, RIG_MAX_DT)
    t += dt
    if (state !== 'idle') {
      stateT += dt
      idleT = 0
      if (stateT >= RIG_DURATIONS[state] && state !== 'death') { state = 'idle'; stateT = 0 }
    } else {
      idleT += dt
    }

    applyRootMotion()

    for (let i = 0; i < parts.length; i++) { mats[i].identity(); radiusScale[i] = 1 }

    if (breatheParts.length && !dead) {
      const s = 1 + (spec.breathe.amp ?? 0.03) * Math.sin(t * (spec.breathe.rate ?? 2))
      for (const i of breatheParts) radiusScale[i] = s
    }
    if (rootScaleY !== 1) {
      const fat = 1 / Math.sqrt(Math.max(0.4, rootScaleY))
      for (let i = 0; i < parts.length; i++) radiusScale[i] *= fat
    }

    if (headParts.length && !dead) {
      const amp = spec.head.amp ?? 0.16
      let yaw = amp * (0.6 * Math.sin(t * 0.7) + 0.4 * Math.sin(t * 1.13))
      let pitch = amp * 0.5 * (0.5 * Math.sin(t * 0.53 + 1) + 0.5 * Math.sin(t * 1.31))
      if (state === 'attack' && archetype === 'biped') {
        // peck: the head itself dives
        const p = rigClamp(stateT / RIG_DURATIONS.attack, 0, 1)
        pitch += 0.7 * Math.sin(Math.PI * rigClamp((p - 0.15) / 0.6, 0, 1))
      }
      rotAboutInto(tmpM, headAnchor, pitch, yaw, 0)
      for (const i of headParts) mats[i].premultiply(tmpM)
    }

    if (armSides.length && !dead) {
      const hitP = state === 'hit' ? rigClamp(stateT / RIG_DURATIONS.hit, 0, 1) : -1
      const atkP = state === 'attack' ? rigClamp(stateT / RIG_DURATIONS.attack, 0, 1) : -1
      for (const arm of armSides) {
        // idle: slow incommensurate sway so arms never look pinned
        let pitch = 0.05 * Math.sin(t * 0.83 + arm.phase) + 0.02 * Math.sin(t * 1.31 + arm.phase)
        let roll = 0.03 * Math.sin(t * 1.07 + arm.phase)
        let bend = -0.12
        if (atkP >= 0 && arm.right) {
          // sword swing: raise back over the shoulder, slash down across,
          // recover — the blade is mid-slash at the arena's 240ms impact.
          const wind = rigEase(rigClamp(atkP / 0.3, 0, 1))
          const strike = rigEase(rigClamp((atkP - 0.28) / 0.18, 0, 1))
          const recover = rigEase(rigClamp((atkP - 0.55) / 0.45, 0, 1))
          pitch += 1.25 * wind - 2.95 * strike + 1.7 * recover
          roll += -0.35 * Math.sin(Math.PI * atkP)
          bend += -0.85 * wind + 1.0 * strike - 0.15 * recover
        } else if (hitP >= 0) {
          // guard: both forearms snap up in front, then relax
          const g = Math.sin(Math.PI * rigClamp(hitP * 1.15, 0, 1))
          pitch += -0.5 * g
          bend += -0.7 * g
        }
        rotAboutInto(tmpM, arm.anchor, pitch, 0, roll)
        for (const i of arm.upper) mats[i].premultiply(tmpM)
        if (arm.elbow) {
          rotAboutInto(tmpM3, arm.elbow, bend, 0, 0)
          tmpM3.premultiply(tmpM)
        } else {
          tmpM3.copy(tmpM)
        }
        for (const i of arm.lower) mats[i].premultiply(tmpM3)
      }
    }

    if (wingParts.length) {
      const rate = spec.wings.rate ?? 9
      const amp = (spec.wings.amp ?? 0.5) * (state === 'attack' ? 1.5 : 1) * (dead ? 0 : 1)
      for (const i of wingParts) {
        const side = baseA[i].x <= 0 ? 1 : -1
        rotAboutInto(tmpM, baseA[i], 0, 0, side * amp * Math.sin(t * rate))
        mats[i].premultiply(tmpM)
      }
    }

    if (spineParts.length) {
      // amp is in creature-local units, not height-relative — serpents are
      // long and low, so height would scale the wave into invisibility
      const amp = (spec.spine.amp ?? 0.08) * (dead ? 0.15 : state === 'attack' ? 1.6 : 1)
      const wave = spec.spine.wave ?? 1.6
      const rate = spec.spine.rate ?? 2.2
      spineParts.forEach((i, k) => {
        const falloff = (k + 1) / spineParts.length
        tmpM.makeTranslation(amp * falloff * Math.sin(k * wave - t * rate), 0, 0)
        mats[i].premultiply(tmpM)
      })
    }

    updateLegs(dt)

    // fixed-substep verlet so ropes never explode on a long frame
    acc += dt
    let steps = 0
    while (acc >= RIG_SUBSTEP && steps < 4) { updateRopes(RIG_SUBSTEP); acc -= RIG_SUBSTEP; steps++ }
    if (steps === 4) acc = 0
    commitRopes()

    shell.commit()
  }
  update(0)

  return {
    group: shell.group,
    update,
    trigger,
    setFlash: shell.setFlash,
    dispose: shell.dispose,
  }
}

// Step-group assignment: legs are authored in left/right pairs front-to-back.
// Quadrupeds move diagonal pairs together; bipeds alternate; 6+ legs split
// into tripod-style alternating sets.
function legGroup(archetype, k, count) {
  if (count <= 2) return k % 2
  if (count === 4) return (k === 0 || k === 3) ? 0 : 1
  return (k + (k >> 1)) % 2
}
