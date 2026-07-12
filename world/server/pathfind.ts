export type Tile = { x: number; z: number }

const DIRECTIONS: Tile[] = [
  { x: -1, z: -1 }, { x: 0, z: -1 }, { x: 1, z: -1 },
  { x: -1, z: 0 }, { x: 1, z: 0 },
  { x: -1, z: 1 }, { x: 0, z: 1 }, { x: 1, z: 1 },
]

// Secondary cost per diagonal step. Small enough that it can never outweigh a
// whole step (paths are capped well under 1/EPS tiles), so step count stays
// the primary metric — matching the tick model where every step costs one tick.
const DIAG_EPS = 0.001

function inBounds(collision: string[], x: number, z: number): boolean {
  return z >= 0 && z < collision.length && x >= 0 && x < (collision[z]?.length ?? 0)
}

function isWalkable(collision: string[], x: number, z: number): boolean {
  return inBounds(collision, x, z) && collision[z][x] === '.'
}

function tileKey(x: number, z: number): string {
  return `${x},${z}`
}

/** Admissible under g = steps + DIAG_EPS·diagonals: any route needs at least
 * Chebyshev-many steps, and covering the shorter axis costs either a diagonal
 * (EPS each) or a whole extra step. */
function heuristic(x: number, z: number, to: Tile): number {
  const dx = Math.abs(to.x - x)
  const dz = Math.abs(to.z - z)
  return Math.max(dx, dz) + DIAG_EPS * Math.min(dx, dz)
}

type HeapNode = { x: number; z: number; g: number; f: number }

function heapPush(heap: HeapNode[], node: HeapNode): void {
  heap.push(node)
  let i = heap.length - 1
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent].f <= heap[i].f) break
    ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
    i = parent
  }
}

function heapPop(heap: HeapNode[]): HeapNode {
  const top = heap[0]
  const last = heap.pop()!
  if (heap.length > 0) {
    heap[0] = last
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let min = i
      if (l < heap.length && heap[l].f < heap[min].f) min = l
      if (r < heap.length && heap[r].f < heap[min].f) min = r
      if (min === i) break
      ;[heap[min], heap[i]] = [heap[i], heap[min]]
      i = min
    }
  }
  return top
}

/** A* over 8-directional movement. Primary cost is step count (one tick per
 * step, diagonal or not); diagonals carry a tiny secondary cost so among
 * equal-step routes the one with fewest diagonals wins — that pins paths
 * inside the start→destination rectangle instead of the wild equal-length
 * arcs plain BFS produced. Diagonal steps are only legal when both adjacent
 * cardinal tiles are walkable — no corner cutting. */
function astar(collision: string[], from: Tile, to: Tile): Tile[] | null {
  if (!inBounds(collision, to.x, to.z) || !isWalkable(collision, to.x, to.z)) return null
  if (from.x === to.x && from.z === to.z) return [from]

  const cameFrom = new Map<string, Tile>()
  const gScore = new Map<string, number>([[tileKey(from.x, from.z), 0]])
  const heap: HeapNode[] = [{ x: from.x, z: from.z, g: 0, f: heuristic(from.x, from.z, to) }]

  while (heap.length > 0) {
    const current = heapPop(heap)
    const currentKey = tileKey(current.x, current.z)
    if (current.g > (gScore.get(currentKey) ?? Infinity)) continue
    if (current.x === to.x && current.z === to.z) {
      const path: Tile[] = [{ x: current.x, z: current.z }]
      let key = currentKey
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
      const diagonal = dir.x !== 0 && dir.z !== 0
      if (diagonal) {
        if (!isWalkable(collision, current.x + dir.x, current.z) || !isWalkable(collision, current.x, current.z + dir.z)) {
          continue
        }
      }
      const key = tileKey(nx, nz)
      const g = current.g + 1 + (diagonal ? DIAG_EPS : 0)
      if (g >= (gScore.get(key) ?? Infinity)) continue
      gScore.set(key, g)
      cameFrom.set(key, { x: current.x, z: current.z })
      heapPush(heap, { x: nx, z: nz, g, f: g + heuristic(nx, nz, to) })
    }
  }
  return null
}

function pathCost(path: Tile[]): number {
  let cost = 0
  for (let i = 1; i < path.length; i++) {
    const diagonal = path[i].x !== path[i - 1].x && path[i].z !== path[i - 1].z
    cost += 1 + (diagonal ? DIAG_EPS : 0)
  }
  return cost
}

/** Direct walk to `to`. Returns null if `to` is out of bounds, blocked, or unreachable. */
export function findPath(collision: string[], from: Tile, to: Tile, maxLen = 64): Tile[] | null {
  const path = astar(collision, from, to)
  if (!path) return null
  return path.length > maxLen ? path.slice(0, maxLen) : path
}

/** Paths to whichever walkable tile 8-adjacent to `to` is cheapest to reach —
 * for interacting with a rock/npc/object tile, which is itself never walkable. */
export function findPathAdjacent(collision: string[], from: Tile, to: Tile, maxLen = 64): Tile[] | null {
  let best: Tile[] | null = null
  let bestCost = Infinity
  for (const dir of DIRECTIONS) {
    const candidate = { x: to.x + dir.x, z: to.z + dir.z }
    if (!isWalkable(collision, candidate.x, candidate.z)) continue
    const path = astar(collision, from, candidate)
    if (!path) continue
    const cost = pathCost(path)
    if (cost < bestCost) {
      best = path
      bestCost = cost
    }
  }
  if (!best) return null
  return best.length > maxLen ? best.slice(0, maxLen) : best
}
