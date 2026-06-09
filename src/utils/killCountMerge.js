// Merges server-authoritative kill counts into the local cache using
// max(local, server) per id, so a transient empty/partial server response can
// never zero out locally-known KC.
export function mergeKillCounts(local, server) {
  const merged = { ...(local || {}) }
  for (const [id, count] of Object.entries(server || {})) {
    const value = Math.max(0, Math.floor(Number(count) || 0))
    merged[id] = Math.max(merged[id] || 0, value)
  }
  return merged
}
