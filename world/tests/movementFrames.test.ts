import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyEntityDiff, createEntity, updateEntity } from '../client/src/entities'

describe('queued movement across slow frames', () => {
  const moving = () => {
    const entity = createEntity('hero', 0, 0, new THREE.Group())
    applyEntityDiff(entity, { id: 'hero', kind: 'player', x: 1, z: 0, anim: 'walk' })
    updateEntity(entity, 7, 0)
    applyEntityDiff(entity, { id: 'hero', kind: 'player', x: 2, z: 0, anim: 'walk' })
    applyEntityDiff(entity, { id: 'hero', kind: 'player', x: 3, z: 0, anim: 'walk' })
    return entity
  }
  it.each([60, 30, 15])('retains trajectory timing at %i FPS', fps => {
    const entity = moving()
    for (let now = 1000 / fps; now < 750; now += 1000 / fps) updateEntity(entity, now, 1 / fps)
    updateEntity(entity, 750, 1 / fps)
    // The first step ends at607, deliberately between frames; catchup is143/440 complete.
    expect(entity.mesh.position.x).toBeCloseTo(1.5 + 143 / 440, 8)
  })
  it('consumes completed queued segments during a long frame', () => {
    const entity = moving()
    updateEntity(entity, 1200, 1.2)
    expect(entity.mesh.position.x).toBeCloseTo(2.5 + 153 / 600, 8)
    updateEntity(entity, 2500, 1.3)
    expect(entity.mesh.position.x).toBe(3.5)
    expect(entity.moving).toBe(false)
  })
  it('starts a fresh walk from its current frame after an idle gap', () => {
    const entity = createEntity('hero', 0, 0, new THREE.Group())
    updateEntity(entity, 10_000, .016)
    applyEntityDiff(entity, { id: 'hero', kind: 'player', x: 1, z: 0, anim: 'walk' })
    updateEntity(entity, 20_000, .016)
    expect(entity.mesh.position.x).toBe(.5)
    updateEntity(entity, 20_300, .3)
    expect(entity.mesh.position.x).toBe(1)
  })
})
