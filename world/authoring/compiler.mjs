export function deriveContract(place, context) {
  void place; void context
  return { resources: [], monsters: [], facilities: [] }
}
export function compileRegion(source, context) {
  void context
  return { zone: { id: source.id, objects: [], npcs: [], collision: [], ambient: {} }, report: { parity: { missing: [], unexpected: [] } } }
}
