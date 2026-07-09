export type Tile = { x: number; z: number }

const DIRECTIONS: Tile[] = [
  { x: -1, z: -1 }, { x: 0, z: -1 }, { x: 1, z: -1 },
  { x: -1, z: 0 }, { x: 1, z: 0 },
  { x: -1, z: 1 }, { x: 0, z: 1 }, { x: 1, z: 1 },
]

function inBounds(collision: string[], x: number, z: number): boolean {
  return z >= 0 && z < collision.length && x >= 0 && x < (collision[z]?.length ?? 0)
}

function isWalkable(collision: string[], x: number, z: number): boolean {
  return inBounds(collision, x, z) && collision[z][x] === '.'
}

function tileKey(x: number, z: number): string {
  return `${x},${z}`
}

/** BFS shortest path over 8-directional movement. Diagonal steps are only
 * legal when both adjacent cardinal tiles are walkable — no corner cutting. */
function bfs(collision: string[], from: Tile, to: Tile): Tile[] | null {
  if (!inBounds(collision, to.x, to.z) || !isWalkable(collision, to.x, to.z)) return null
  if (from.x === to.x && from.z === to.z) return [from]

  const cameFrom = new Map<string, Tile>()
  const visited = new Set<string>([tileKey(from.x, from.z)])
  const queue: Tile[] = [from]
  let head = 0

  while (head < queue.length) {
    const current = queue[head++]
    if (current.x === to.x && current.z === to.z) {
      const path: Tile[] = [current]
      let key = tileKey(current.x, current.z)
      let prev = cameFrom.get(key)
      while (prev) {
        path.push(prev)
        key = tileKey(prev.x, prev.z)
        prev = cameFrom.get(key)
      }
      return path.reverse()
    }

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.x
      const nz = current.z + dir.z
      if (!isWalkable(collision, nx, nz)) continue
      if (dir.x !== 0 && dir.z !== 0) {
        if (!isWalkable(collision, current.x + dir.x, current.z) || !isWalkable(collision, current.x, current.z + dir.z)) {
          continue
        }
      }
      const key = tileKey(nx, nz)
      if (visited.has(key)) continue
      visited.add(key)
      cameFrom.set(key, current)
      queue.push({ x: nx, z: nz })
    }
  }
  return null
}

/** Direct walk to `to`. Returns null if `to` is out of bounds, blocked, or unreachable. */
export function findPath(collision: string[], from: Tile, to: Tile, maxLen = 64): Tile[] | null {
  const path = bfs(collision, from, to)
  if (!path) return null
  return path.length > maxLen ? path.slice(0, maxLen) : path
}

/** Paths to whichever walkable tile 8-adjacent to `to` is closest by path length —
 * for interacting with a rock/npc/object tile, which is itself never walkable. */
export function findPathAdjacent(collision: string[], from: Tile, to: Tile, maxLen = 64): Tile[] | null {
  let best: Tile[] | null = null
  for (const dir of DIRECTIONS) {
    const candidate = { x: to.x + dir.x, z: to.z + dir.z }
    if (!isWalkable(collision, candidate.x, candidate.z)) continue
    const path = bfs(collision, from, candidate)
    if (path && (!best || path.length < best.length)) best = path
  }
  if (!best) return null
  return best.length > maxLen ? best.slice(0, maxLen) : best
}
