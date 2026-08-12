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
  it('plays the attack clip once the stride finishes, not never', () => {
    const { animator, actions } = animatorWith(['idle', 'walk', 'run', 'attack'])
    const entity = createEntity('p1', 5, 5, new THREE.Object3D(), animator)

    // The arrival diff: one tile on, already swinging.
    applyEntityDiff(entity, diff(6, 5, 'attack'))
    const t0 = 1000
    updateEntity(entity, t0, 0.016)
    expect(entity.moving).toBe(true)
    expect(actions.attack.plays).toBe(0)

    // Mid-stride the walk clip still owns the mixer — the swing is held, not
    // dropped, and not fired early into a slide.
    updateEntity(entity, t0 + MOVE_DURATION_MS / 2, 0.016)
    expect(actions.attack.plays).toBe(0)
    expect(animator.current).toBe(actions.walk)

    // The kill ended the fight, so the very next tick is already back to idle.
    applyEntityDiff(entity, diff(6, 5, 'idle'))
    updateEntity(entity, t0 + MOVE_DURATION_MS, 0.016)
    expect(actions.attack.plays).toBe(1)
    expect(animator.current).toBe(actions.attack)
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

  it('cancels a held swing when the attacker dies before the stride ends', () => {
    const { animator, actions } = animatorWith(['idle', 'walk', 'run', 'attack', 'die'])
    const entity = createEntity('p1', 5, 5, new THREE.Object3D(), animator)

    applyEntityDiff(entity, diff(6, 5, 'attack'))
    updateEntity(entity, 1000, 0.016)
    applyEntityDiff(entity, diff(6, 5, 'die'))
    for (let t = 50; t <= MOVE_DURATION_MS * 2; t += 50) updateEntity(entity, 1000 + t, 0.016)
    expect(actions.attack.plays).toBe(0)
    expect(animator.current).toBe(actions.die)
  })
})
