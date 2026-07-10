import * as THREE from 'three'
import { tileToWorld } from './scene'
import { lootExamine } from './ui'
import { iconSvgString, itemEmoji, itemName } from './itemIcon'
import type { LootItem } from '../../shared/protocol'
import type { Pickable } from './picking'

const MARKER_SIZE = 0.5
const MARKER_Y = 0.5
const SPIN_SPEED = 1.6

export type LootLayer = {
  pickables: THREE.Object3D[]
  apply: (added?: LootItem[], removed?: string[]) => void
  update: (deltaSeconds: number) => void
  /** Drops every marker (reconnect resync — the intro diff repopulates). */
  clear: () => void
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
    tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const svg = iconSvgString(itemId, 64)
    if (svg) {
      // Rasterise the same bespoke art the DOM uses; inline SVG data URIs don't
      // taint the canvas, so the CanvasTexture stays readable.
      const img = new Image()
      img.onload = () => { ctx.clearRect(0, 0, 64, 64); ctx.drawImage(img, 0, 0, 64, 64); tex!.needsUpdate = true }
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    } else {
      ctx.font = '48px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(itemEmoji(itemId), 32, 36)
      tex.needsUpdate = true
    }
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
    marker.userData.spin = plane
    // Invisible full-tile hit pad so a tap anywhere on the tile picks the pile
    // (the thin spinning icon alone is hard to hit on touch). `visible:false`
    // is skipped by the raycaster, so use an opacity-0 material instead.
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.y = 0.05
    marker.add(pad)
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
    // Spin only the icon, not the whole marker, so the hit pad stays aligned.
    for (const marker of tiles.values()) {
      const icon = marker.userData.spin as THREE.Object3D | undefined
      if (icon) icon.rotation.y += SPIN_SPEED * deltaSeconds
    }
  }

  function clear(): void {
    const keys = [...tiles.keys()]
    byId.clear()
    for (const k of keys) {
      const [x, z] = k.split(',').map(Number)
      rebuildTile(x, z)
    }
  }

  return { pickables, apply, update, clear }
}
