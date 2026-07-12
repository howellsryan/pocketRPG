import type { EditorApi } from './api'
import type { ZoneDef } from '../../../shared/zone'

// Arrival-tile picker: fetches the destination zone and renders it read-only in
// a modal so you click the exact tile the player lands on. Rejecting exit tiles
// (ping-pong) is left to server validation; here we just refuse blocked tiles.

const DEFAULT_PALETTE = { walkableA: '#4a7c3a', walkableB: '#568c44', blockedA: '#3a3428', blockedB: '#443d30' }
const MODAL_MAX = 560

export async function openArrivalPicker(api: EditorApi, zoneId: string, onPick: (x: number, z: number) => void): Promise<void> {
  const modal = document.getElementById('pickerModal')!
  const title = document.getElementById('pickerTitle')!
  const canvas = document.getElementById('pickerCanvas') as HTMLCanvasElement
  const cancel = document.getElementById('pickerCancel')!

  let def: ZoneDef
  try {
    def = (await api.getZone(zoneId)).def
  } catch {
    title.textContent = `Could not load zone '${zoneId}'`
    return
  }

  const tile = Math.max(4, Math.floor(MODAL_MAX / Math.max(def.width, def.height)))
  canvas.width = def.width * tile
  canvas.height = def.height * tile
  title.textContent = `Arrival tile in ${def.name} (${def.id})`
  const ctx = canvas.getContext('2d')!
  const pal = def.palette ?? DEFAULT_PALETTE
  const exitTiles = new Set((def.exits ?? []).map((e) => `${e.x},${e.z}`))

  const draw = (hover?: { x: number; z: number }) => {
    for (let z = 0; z < def.height; z++) {
      for (let x = 0; x < def.width; x++) {
        const blocked = def.collision[z]?.[x] === '#'
        const even = (x + z) % 2 === 0
        ctx.fillStyle = blocked ? (even ? pal.blockedA : pal.blockedB) : (even ? pal.walkableA : pal.walkableB)
        ctx.fillRect(x * tile, z * tile, tile, tile)
      }
    }
    ctx.fillStyle = '#ffe27a'
    ctx.font = `${Math.floor(tile * 0.8)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('◎', (def.spawn.x + 0.5) * tile, (def.spawn.z + 0.5) * tile)
    ctx.fillStyle = '#8ab4ff'
    for (const e of def.exits ?? []) ctx.fillText('🚪', (e.x + 0.5) * tile, (e.z + 0.5) * tile)
    if (hover) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(hover.x * tile + 1, hover.z * tile + 1, tile - 2, tile - 2)
    }
  }
  draw()

  const tileAt = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect()
    return { x: Math.floor((e.clientX - r.left) / tile), z: Math.floor((e.clientY - r.top) / tile) }
  }

  const onMove = (e: MouseEvent) => draw(tileAt(e))
  const onClick = (e: MouseEvent) => {
    const { x, z } = tileAt(e)
    if (def.collision[z]?.[x] !== '.') return
    if (exitTiles.has(`${x},${z}`)) return
    onPick(x, z)
    close()
  }
  const close = () => {
    modal.style.display = 'none'
    canvas.removeEventListener('mousemove', onMove)
    canvas.removeEventListener('click', onClick)
    cancel.removeEventListener('click', close)
  }
  canvas.addEventListener('mousemove', onMove)
  canvas.addEventListener('click', onClick)
  cancel.addEventListener('click', close)
  modal.style.display = 'flex'
}
