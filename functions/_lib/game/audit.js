export function auditLog(event, details = {}) {
  console.log('[PocketRPG][AUDIT]', JSON.stringify({ event, at: Date.now(), ...details }))
}
