// Marker clustering for the big world map: groups same-category statics/spawns
// that sit close together (a mining site's five rocks, a forest's sixteen
// trees) into one pin with a count, instead of a scatter of overlapping icons.
// Pure — no DOM — so it's usable from the client and testable in the node
// vitest env.

export type ClusterInput = { id: string; type: string; x: number; z: number }
export type Cluster = { type: string; x: number; z: number; count: number; ids: string[] }

/** Greedy same-type clustering: walks inputs in order, joining the first
 * existing cluster of the same type whose centroid is within `radius` tiles,
 * else starting a new cluster. The centroid is an incremental running mean, so
 * cluster position settles near the group's middle regardless of visit order —
 * good enough for map pins (small counts, tight radius), no k-means needed. */
export function clusterByType(inputs: ClusterInput[], radius: number): Cluster[] {
  const clusters: Cluster[] = []
  for (const item of inputs) {
    const near = clusters.find((c) => c.type === item.type && Math.hypot(c.x - item.x, c.z - item.z) <= radius)
    if (near) {
      const n = near.count
      near.x = (near.x * n + item.x) / (n + 1)
      near.z = (near.z * n + item.z) / (n + 1)
      near.count = n + 1
      near.ids.push(item.id)
    } else {
      clusters.push({ type: item.type, x: item.x, z: item.z, count: 1, ids: [item.id] })
    }
  }
  return clusters
}
