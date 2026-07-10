import * as THREE from 'three'
import itemsData from '../../../src/data/items.json'
import { tileToWorld } from './scene'
import { lootExamine } from './ui'
import type { LootItem } from '../../shared/protocol'
import type { Pickable } from './picking'

type Items = Record<string, { name?: string; icon?: string } | undefined>
const items = itemsData as unknown as Items

const MARKER_SIZE = 0.5
const MARKER_Y = 0.5
const SPIN_SPEED = 1.6

export type LootLayer = {
  pickables: THREE.Object3D[]
  apply: (added?: LootItem[], removed?: string[]) => void
  update: (deltaSeconds: number) => void
}

function itemName(itemId: string): string {
  return items[itemId]?.name ?? itemId
}

function lootOrder(id: string): number {
  const n = Number(id.split('_').pop())
  return Number.isFinite(n) ? n : 0
}

/** Floor-loot renderer: one spinning emoji marker per tile (showing the most
 * recent drop), and one loot Pickable per tile whose actions list every item on
 * it (most recent first) so left-click takes the top and the menu lists them all. */
export function createLootLayer(scene: THREE.Scene): LootLayer {
  const byId = new Map<string, LootItem>()
  const tiles = new Map<string, THREE.Object3D>()
  const pickables: THREE.Object3D[] = []
  const textures = new Map<string, THREE.Texture>()

  function iconTexture(itemId: string): THREE.Texture {
    let tex = textures.get(itemId)
    if (tex) return tex
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.font = '48px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(items[itemId]?.icon ?? '❔', 32, 36)
    tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    textures.set(itemId, tex)
    return tex
  }

  function key(x: number, z: number): string {
    return `${x},${z}`
  }

  function rebuildTile(x: number, z: number): void {
    const k = key(x, z)
    const existing = tiles.get(k)
    if (existing) {
      scene.remove(existing)
      const idx = pickables.indexOf(existing)
      if (idx >= 0) pickables.splice(idx, 1)
      tiles.delete(k)
    }
    const here = [...byId.values()].filter((l) => l.x === x && l.z === z).sort((a, b) => lootOrder(b.id) - lootOrder(a.id))
    if (here.length === 0) return

    const top = here[0]
    const marker = new THREE.Group()
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(MARKER_SIZE, MARKER_SIZE),
      new THREE.MeshBasicMaterial({ map: iconTexture(top.itemId), transparent: true, side: THREE.DoubleSide })
    )
    plane.position.y = MARKER_Y
    marker.add(plane)
    marker.position.copy(tileToWorld(x, z))
    marker.userData.pick = {
      kind: 'loot',
      id: k,
      name: itemName(top.itemId),
      actions: here.map((l) => ({ label: 'Take', name: itemName(l.itemId), action: 'take', id: l.id })),
      examine: lootExamine(itemName(top.itemId)),
    } satisfies Pickable
    scene.add(marker)
    tiles.set(k, marker)
    pickables.push(marker)
  }

  function apply(added?: LootItem[], removed?: string[]): void {
    const dirty = new Set<string>()
    for (const id of removed ?? []) {
      const l = byId.get(id)
      if (l) {
        byId.delete(id)
        dirty.add(key(l.x, l.z))
      }
    }
    for (const l of added ?? []) {
      byId.set(l.id, l)
      dirty.add(key(l.x, l.z))
    }
    for (const k of dirty) {
      const [x, z] = k.split(',').map(Number)
      rebuildTile(x, z)
    }
  }

  function update(deltaSeconds: number): void {
    for (const marker of tiles.values()) marker.rotation.y += SPIN_SPEED * deltaSeconds
  }

  return { pickables, apply, update }
}
