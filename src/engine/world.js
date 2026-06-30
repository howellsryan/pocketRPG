/**
 * World model — pure logic over the place/road graph in `src/data/world.json`.
 *
 * No UI imports (engine layer per CLAUDE.md §3). Phase 1 uses the read helpers;
 * `shortestPath` is included now (pure + tested) so the Phase 2 travel engine can
 * build on it without re-deriving the graph.
 *
 * Geography is PLACEHOLDER (decision #4 in docs/map-driven-overhaul-plan.md): the
 * 8-place Cinder Reach is a sample world, not the canonical content map.
 */
import worldData from '../data/world.json'

/** Default location for a brand-new / un-migrated save. */
export const WORLD_START_PLACE = worldData.start

/** Raw world model (places, edges, tiers, kinds, board dimensions). */
export function getWorld() {
  return worldData
}

/** A place by id, or null. */
export function getPlace(id) {
  return worldData.places[id] || null
}

/** All places as an array (insertion order). */
export function listPlaces() {
  return Object.values(worldData.places)
}

/** Tier metadata (label, size, accent, blurb) for a place's tier. */
export function getTier(tierId) {
  return worldData.tiers[tierId] || null
}

/** Activity-kind metadata (label, colour) for an activity type. */
export function getKind(kindId) {
  return worldData.kinds[kindId] || null
}

/**
 * Coerce a stored location to a valid place id. Missing/unknown locations
 * (un-migrated saves, deleted places) fall back to the start place, so the map
 * never renders "nowhere".
 */
export function normaliseLocation(id) {
  return id && worldData.places[id] ? id : WORLD_START_PLACE
}

/** Adjacency map { placeId: [[neighbourId, ticks], ...] } from the edge list. */
function buildAdjacency() {
  const adj = {}
  for (const id of Object.keys(worldData.places)) adj[id] = []
  for (const [a, b, t] of worldData.edges) {
    if (!adj[a] || !adj[b]) continue
    adj[a].push([b, t])
    adj[b].push([a, t])
  }
  return adj
}

/**
 * Dijkstra shortest path over the undirected road graph.
 * Returns { path: [from, ...via, to], ticks } or null if unreachable.
 * `from === to` yields a zero-cost single-node path.
 */
export function shortestPath(from, to) {
  if (!worldData.places[from] || !worldData.places[to]) return null
  if (from === to) return { path: [from], ticks: 0 }
  const adj = buildAdjacency()
  const dist = {}
  const prev = {}
  const seen = {}
  for (const id of Object.keys(worldData.places)) dist[id] = Infinity
  dist[from] = 0
  for (;;) {
    let u = null
    let best = Infinity
    for (const id in dist) {
      if (!seen[id] && dist[id] < best) { best = dist[id]; u = id }
    }
    if (u === null || u === to) break
    seen[u] = true
    for (const [v, t] of adj[u]) {
      if (dist[u] + t < dist[v]) { dist[v] = dist[u] + t; prev[v] = u }
    }
  }
  if (dist[to] === Infinity) return null
  const path = [to]
  let c = to
  while (c !== from) {
    c = prev[c]
    if (c == null) return null
    path.unshift(c)
  }
  return { path, ticks: dist[to] }
}
