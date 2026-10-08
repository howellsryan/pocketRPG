import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProcCreature } from '../../src/3d/rigs.js'
import { applyEntityDiff, createEntity, createMonsterMesh, pickProxyOf, updateEntity } from '../client/src/entities'
import { creatureSpecFor } from '../client/src/procCreature'

type Uniforms = { uB: { value: THREE.Vector4[] } }
function uniforms(mesh: THREE.Object3D): Uniforms {
  let result: Uniforms | undefined
  mesh.traverse(o => {
    const material = (o as THREE.Mesh).material as THREE.ShaderMaterial
    if (material?.uniforms?.uB) result = material.uniforms as Uniforms
  })
  if (!result) throw Error('Expected the real procedural skin')
  return result
}
const humanoid = (locomotion?: string) => ({
  archetype: 'humanoid', locomotion, palette: ['#5e7949'],
  parts: [
    { id: 'body', a: [0,.5,0], b: [0,.85,0], r1:.18, r2:.2, color:0 },
    { id: 'legL', a: [-.1,.5,0], b: [-.1,.06,0], r1:.07, r2:.04, color:0 },
    { id: 'legR', a: [.1,.5,0], b: [.1,.06,0], r1:.07, r2:.04, color:0 },
  ],
  legs: [{ part: 'legL' },{ part: 'legR' }],
})
afterEach(() => vi.unstubAllGlobals())

describe('canonical Cave Goblin presentation', () => {
  it('uses the shared humanoid spec without fetching an unrelated GLTF and keeps a one-tile pick height', async () => {
    const fetch = vi.fn(() => { throw Error('Goblin must not fetch a GLTF') })
    vi.stubGlobal('fetch', fetch)
    const result = await createMonsterMesh('cave_goblin')
    expect(creatureSpecFor('cave_goblin')?.archetype).toBe('humanoid')
    expect(result.animator?.kind).toBe('proc')
    expect(fetch).not.toHaveBeenCalled()
    result.mesh.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(pickProxyOf(result.mesh), true)
    expect(box.min.y).toBeCloseTo(0)
    expect(box.max.y).toBeCloseTo(1)
  })

  it('animates opposite grounded strides only for creatures that opt in', () => {
    const walking = createProcCreature(THREE, humanoid('biped'))
    const legacy = createProcCreature(THREE, humanoid())
    expect(typeof walking.setLocomotion).toBe('function')
    walking.setLocomotion(1)
    legacy.setLocomotion(1)
    for (let i=0; i<8; i++) { walking.update(1/60); legacy.update(1/60) }
    const feet = uniforms(walking.group).uB.value
    expect(feet[1].z * feet[2].z).toBeLessThan(0)
    expect(Math.max(feet[1].y, feet[2].y)).toBeGreaterThan(.08)
    expect(Math.min(feet[1].y, feet[2].y)).toBeCloseTo(.06)
    expect(uniforms(legacy.group).uB.value[1].z).toBeCloseTo(0,2)
    walking.setLocomotion(0)
    for(let i=0; i<30; i++) walking.update(1/60)
    expect(uniforms(walking.group).uB.value[1].z).toBeCloseTo(0,2)
    walking.dispose(); legacy.dispose()
  })

  it('drives the real rig from world movement and emits each attack, death and respawn once', async () => {
    const { mesh, animator } = await createMonsterMesh('cave_goblin')
    expect(animator?.kind).toBe('proc')
    if (animator?.kind !== 'proc') throw Error('Expected goblin procedural animator')
    const spec = creatureSpecFor('cave_goblin')!
    const leg = spec.parts.findIndex(p => (p as {id?:string}).id === 'legL')
    const before = uniforms(mesh).uB.value[leg].z
    const trigger = vi.spyOn(animator.proc,'trigger')
    const entity = createEntity('goblin',0,0,mesh,animator)
    applyEntityDiff(entity,{id:'goblin',kind:'npc',x:0,z:1,anim:'walk'})
    for(let i=0; i<10; i++) updateEntity(entity,i*16,1/60)
    expect(uniforms(mesh).uB.value[leg].z).not.toBeCloseTo(before,2)
    updateEntity(entity,700,1/60)
    applyEntityDiff(entity,{id:'goblin',kind:'npc',x:0,z:1,anim:'attack'})
    for(let i=0;i<4;i++) updateEntity(entity,720+i*16,1/60)
    expect(trigger.mock.calls.filter(c=>c[0]==='attack')).toHaveLength(1)
    applyEntityDiff(entity,{id:'goblin',kind:'npc',x:0,z:1,anim:'die'})
    for(let i=0;i<4;i++) updateEntity(entity,800+i*16,1/60)
    expect(trigger.mock.calls.filter(c=>c[0]==='death')).toHaveLength(1)
    applyEntityDiff(entity,{id:'goblin',kind:'npc',x:0,z:1,anim:'idle'})
    for(let i=0;i<4;i++) updateEntity(entity,900+i*16,1/60)
    expect(trigger.mock.calls.filter(c=>c[0]==='respawn')).toHaveLength(1)
    animator.proc.dispose()
  })
})
