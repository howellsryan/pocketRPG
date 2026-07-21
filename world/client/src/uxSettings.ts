// Per-device open-world HUD preferences. Persisted in localStorage (key
// `world_ux`), mirroring auth.ts's run/zone prefs — the world client never
// writes /api/save, and HUD scale/dock/minimap are genuinely per-device (a
// phone and an iPad want different layouts), so these deliberately DON'T sync
// across devices. Pure helpers live here (device heuristics, mode resolution,
// sheet-snap math) so they're unit-tested in world/tests without a DOM; the
// DOM wiring lives in ui.ts.

export type MinimapMode = 'full' | 'compass' | 'off'
export type HudScale = 'compact' | 'normal' | 'large'
export type DockSide = 'left' | 'right'

export type UxSettings = {
  /** null => let the device decide (phone → compass, tablet → full). */
  minimapMode: MinimapMode | null
  hudScale: HudScale
  /** Landscape rail/panel side (handedness). */
  dock: DockSide
  /** Open-panel opacity, 0.6–1 — see the world behind an open inventory. */
  panelOpacity: number
  chatAutoFade: boolean
  haptics: boolean
}

export const DEFAULT_SETTINGS: UxSettings = {
  minimapMode: null,
  hudScale: 'normal',
  dock: 'right',
  panelOpacity: 0.92,
  chatAutoFade: true,
  haptics: true,
}

const STORAGE_KEY = 'world_ux'

/** A viewport whose short side is at least this many CSS px is treated as a
 * tablet — drives the default minimap mode (full vs compass). */
export const TABLET_MIN_SIDE = 560

const HUD_SCALE_VALUE: Record<HudScale, number> = { compact: 0.85, normal: 1, large: 1.15 }

// Bottom-sheet snap points as fractions of viewport height: peek shows the
// inventory grid, full opens the tall panes (prayer/magic), below dismiss the
// sheet closes. Kept here (not ui.ts) so the snap decision is pure + testable.
export const SHEET_PEEK_FRACTION = 0.42
export const SHEET_FULL_FRACTION = 0.68
export const SHEET_DISMISS_FRACTION = 0.22

const MINIMAP_MODES: MinimapMode[] = ['full', 'compass', 'off']
const HUD_SCALES: HudScale[] = ['compact', 'normal', 'large']
const DOCK_SIDES: DockSide[] = ['left', 'right']

export function hudScaleValue(scale: HudScale): number {
  return HUD_SCALE_VALUE[scale] ?? 1
}

export function isTabletViewport(minSide: number): boolean {
  return minSide >= TABLET_MIN_SIDE
}

/** The concrete minimap mode: an explicit setting wins; null falls back to the
 * device default (tablet → full, phone → compass). */
export function resolveMinimapMode(settings: UxSettings, isTablet: boolean): MinimapMode {
  return settings.minimapMode ?? (isTablet ? 'full' : 'compass')
}

/** Which snap a released sheet drag lands on, from its projected height. Below
 * the dismiss fraction the sheet closes; past the peek/full midpoint it opens
 * full; otherwise it rests at peek. Pure — the DOM code turns the result into a
 * pixel height via sheetHeightFor. */
export function sheetSnap(projectedPx: number, viewportPx: number): 'dismiss' | 'peek' | 'full' {
  if (viewportPx <= 0) return 'peek'
  const frac = projectedPx / viewportPx
  if (frac < SHEET_DISMISS_FRACTION) return 'dismiss'
  if (frac > (SHEET_PEEK_FRACTION + SHEET_FULL_FRACTION) / 2) return 'full'
  return 'peek'
}

/** Pixel height of the sheet body at a given snap for a viewport. */
export function sheetHeightFor(snap: 'peek' | 'full', viewportPx: number): number {
  const frac = snap === 'full' ? SHEET_FULL_FRACTION : SHEET_PEEK_FRACTION
  return Math.round(viewportPx * frac)
}

function isMinimapMode(v: unknown): v is MinimapMode {
  return typeof v === 'string' && (MINIMAP_MODES as string[]).includes(v)
}

/** Folds an untrusted stored blob onto the defaults, dropping any field that
 * isn't a valid value — a corrupt/partial/old-schema payload degrades to
 * defaults field-by-field rather than poisoning the HUD. Pure. */
export function mergeSettings(stored: unknown): UxSettings {
  const s = (stored && typeof stored === 'object') ? stored as Record<string, unknown> : {}
  const opacity = typeof s.panelOpacity === 'number' && Number.isFinite(s.panelOpacity)
    ? Math.min(1, Math.max(0.6, s.panelOpacity))
    : DEFAULT_SETTINGS.panelOpacity
  return {
    minimapMode: s.minimapMode === null || isMinimapMode(s.minimapMode) ? s.minimapMode : DEFAULT_SETTINGS.minimapMode,
    hudScale: (HUD_SCALES as string[]).includes(s.hudScale as string) ? s.hudScale as HudScale : DEFAULT_SETTINGS.hudScale,
    dock: (DOCK_SIDES as string[]).includes(s.dock as string) ? s.dock as DockSide : DEFAULT_SETTINGS.dock,
    panelOpacity: opacity,
    chatAutoFade: typeof s.chatAutoFade === 'boolean' ? s.chatAutoFade : DEFAULT_SETTINGS.chatAutoFade,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : DEFAULT_SETTINGS.haptics,
  }
}

export function loadSettings(): UxSettings {
  try {
    return mergeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: UxSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private-mode / quota — HUD still works this session, just won't persist.
  }
}
