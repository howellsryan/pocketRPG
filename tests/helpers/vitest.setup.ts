// Silence node:sqlite's ExperimentalWarning (used by tests/helpers/d1). Installed
// before test modules import node:sqlite, so the one-time warning is filtered.
const _emit = process.emitWarning.bind(process)
// @ts-ignore - loosen the overload for the wrapper
process.emitWarning = (warning, ...rest) => {
  const type = rest[0] && typeof rest[0] === 'object' ? (rest[0] as any).type : rest[0]
  if (type === 'ExperimentalWarning' && String(warning).includes('SQLite')) return
  return _emit(warning, ...(rest as [any]))
}
