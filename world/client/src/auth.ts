export type WorldSession = { token: string; character: { id: number; name: string } }

export function getStoredSession(): WorldSession | null {
  const raw = localStorage.getItem('world_session')
  if (!raw) return null
  try {
    return JSON.parse(raw) as WorldSession
  } catch {
    return null
  }
}
