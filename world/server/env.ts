export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  WorldZone: DurableObjectNamespace
  JWT_SECRET: string
  APP_BASE_URL?: string
  /** Explicit preview-only admission; absent/false disables all world entry. */
  WORLD_BETA_ENABLED?: string
  /** Static bearer secret gating the developer-only world editor API. When
   * unset, the editor API is disabled (every route 503s) rather than open. */
  WORLD_EDITOR_TOKEN?: string
  /** Preview-only: "true" bypasses every quest requirement. Never set on the
   * production environment — see src/engine/questGates.js. */
  DISABLE_QUEST_REQUIREMENTS?: string
  WORLD_PREVIEW_TRAVEL?: string
}
