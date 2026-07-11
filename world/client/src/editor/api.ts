import type { ZoneDef } from '../../../shared/zone'

// Thin client for the world editor API. The base URL defaults to same-origin
// (editor served from the world Worker) but can point at another environment
// so the preview-hosted editor can publish to production (Phase D).

export type ZoneListEntry = {
  id: string
  name: string
  width: number
  height: number
  source: 'bundled' | 'stored' | 'overridden'
  revision?: number
  updatedAt?: number
}

export type RevisionEntry = { revision: number; createdAt: number }

export type ApiError = { error: string; errors?: string[] }

export class EditorApi {
  constructor(private base: string, private token: string) {}

  private url(path: string): string {
    return `${this.base.replace(/\/$/, '')}/api/world/editor${path}`
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const json = (await res.json().catch(() => ({}))) as T & Partial<ApiError>
    if (!res.ok) {
      const err = new Error(json.error || `HTTP ${res.status}`) as Error & { errors?: string[]; status: number }
      err.errors = json.errors
      err.status = res.status
      throw err
    }
    return json as T
  }

  listZones(): Promise<{ zones: ZoneListEntry[] }> {
    return this.req('GET', '/zones')
  }

  getZone(id: string): Promise<{ def: ZoneDef; source: string }> {
    return this.req('GET', `/zones/${encodeURIComponent(id)}`)
  }

  saveZone(def: ZoneDef): Promise<{ ok: true; revision: number }> {
    return this.req('PUT', `/zones/${encodeURIComponent(def.id)}`, def)
  }

  deleteZone(id: string): Promise<{ ok: true; revertedToBundled: boolean }> {
    return this.req('DELETE', `/zones/${encodeURIComponent(id)}`)
  }

  listRevisions(id: string): Promise<{ revisions: RevisionEntry[] }> {
    return this.req('GET', `/zones/${encodeURIComponent(id)}/revisions`)
  }

  restoreRevision(id: string, revision: number): Promise<{ ok: true; revision: number }> {
    return this.req('POST', `/zones/${encodeURIComponent(id)}/restore`, { revision })
  }

  teleport(characterId: number, zone: string, x: number, z: number): Promise<{ ok: true }> {
    return this.req('POST', '/teleport', { characterId, zone, x, z })
  }
}
