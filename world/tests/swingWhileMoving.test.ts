// Regression: a one-hit kill never played an attack animation.
//
// The server resolves the first swing on the very tick the last step lands
// (tick.ts walks the path, then stepCombat swings), so the diff that carries
// anim:'attack' also carries the arrival tile — and the client is interpolating
// that step for the whole 600ms after it arrives. updateEntity used to let the
// traversal clip win outright, so the swing signal was consumed as a walk; by
// the time the stride finished, a kill in one blow had already put the server
// back to 'idle' and the clip never played. Multi-hit fights animated from the
// second swing onward, which is exactly what a player sees.
//
// Drives the real updateEntity/applyEntityDiff with stub AnimationActions.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyEntityDiff, createEntity, updateEntity, type AnimName, type GltfAnimator } from '../client/src/entities'
import { MOVE_DURATION_MS } from '../client/src/motion'
import type { EntityDiff } from '../shared/protocol'

type StubAction = THREE.AnimationAction & { plays: number; running: boolean }

function stubAction(): StubAction {
  const a = {
    plays: 0,
    running: false,
    reset() { return a },
    fadeIn() { return a },
    fadeOut() { a.running = false; return a },
    play() { a.plays++; a.running = true; return a },
    isRunning() { return a.running },
  }
  return a as unknown as StubAction
}

function animatorWith(names: AnimName[]): { animator: GltfAnimator; actions: Record<string, StubAction> } {
  const actions: Record<string, StubAction> = {}
  for (const n of names) actions[n] = stubAction()
  const animator: GltfAnimator = {
    kind: 'gltf',
    mixer: { update() {}, timeScale: 1 } as unknown as THREE.AnimationMixer,
    actions: actions as GltfAnimator['actions'],
    current: null,
  }
  return { animator, actions }
}

function diff(x: number, z: number, anim: EntityDiff['anim']): EntityDiff {
  return { id: 'p1', kind: 'player', x, z, anim }
}

describe('a swing signalled on the tick the attacker steps into reach', () => {
  it('plays the attack clip on the arrival step, not never', () => {
    const { animator, actions } = animatorWith(['idle', 'walk', 'run', 'attack'])
    const entity = createEntity('p1', 5, 5, new THREE.Object3D(), animator)

    // The arrival diff: one tile on, already swinging.
    applyEntityDiff(entity, diff(6, 5, 'attack'))
    const t0 = 1000
    updateEntity(entity, t0, 0.016)
    expect(entity.moving).toBe(true)
    // On the signal frame, alongside the splat and the target's death clip —
    // both of which render the moment the diff lands, while position lags the
    // whole segment behind.
    expect(actions.attack.plays).toBe(1)
    expect(animator.current).toBe(actions.attack)

    // The kill ended the fight, so the very next tick is already back to idle —
    // the clip keeps playing through it rather than being cut off.
    applyEntityDiff(entity, diff(6, 5, 'idle'))
    updateEntity(entity, t0 + MOVE_DURATION_MS / 2, 0.016)
    expect(animator.current).toBe(actions.attack)
    expect(actions.attack.plays).toBe(1)
  })

  it('holds an impact-aligned monster back by its sub-tick wind-up only', () => {
    // A registry monster with attackImpactSec is pre-signalled ticks ahead of
    // the blow; its clip start is nudged so the impact frame lands on the splat,
    // and the stride must not stretch that (it would play the telegraph and the
    // blow after the hit they were aligned to).
    const { animator, actions } = animatorWith(['idle', 'walk', 'run', 'attack'])
    animator.swingDelayMs = 150
    const entity = createEntity('n1', 5, 5, new THREE.Object3D(), animator)

    applyEntityDiff(entity, diff(6, 5, 'attack'))
    updateEntity(entity, 1000, 0.016)
    expect(actions.attack.plays).toBe(0)
    updateEntity(entity, 1100, 0.016)
    expect(actions.attack.plays).toBe(0)
    updateEntity(entity, 1150, 0.016)
    expect(actions.attack.plays).toBe(1)
  })

  it('fires immediately when the attacker is standing still', () => {
    const { animator, actions } = animatorWith(['idle', 'walk', 'run', 'attack'])
    const entity = createEntity('p1', 5, 5, new THREE.Object3D(), animator)

    applyEntityDiff(entity, diff(5, 5, 'attack'))
    updateEntity(entity, 1000, 0.016)
    expect(entity.moving).toBe(false)
    expect(actions.attack.plays).toBe(1)
  })

  it('fires only once per signalled swing, however many frames it spans', () => {
    const { animator, actions } = animatorWith(['idle', 'walk', 'run', 'attack'])
    const entity = createEntity('p1', 5, 5, new THREE.Object3D(), animator)

    applyEntityDiff(entity, diff(6, 5, 'attack'))
    for (let t = 0; t <= MOVE_DURATION_MS * 2; t += 50) updateEntity(entity, 1000 + t, 0.016)
    expect(actions.attack.plays).toBe(1)
  })

  it('cancels a held wind-up when the attacker dies before its clip starts', () => {
    const { animator, actions } = animatorWith(['idle', 'walk', 'run', 'attack', 'die'])
    animator.swingDelayMs = 150
    const entity = createEntity('n1', 5, 5, new THREE.Object3D(), animator)

    applyEntityDiff(entity, diff(6, 5, 'attack'))
    updateEntity(entity, 1000, 0.016)
    applyEntityDiff(entity, diff(6, 5, 'die'))
    for (let t = 50; t <= MOVE_DURATION_MS * 2; t += 50) updateEntity(entity, 1000 + t, 0.016)
    expect(actions.attack.plays).toBe(0)
    expect(animator.current).toBe(actions.die)
  })
})
