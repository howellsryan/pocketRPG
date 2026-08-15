// Single source of truth for toast type styling + which types the
// "show info toasts" setting is allowed to suppress. A blocking action must
// never be silenced by that setting, so only 'info' may be suppressible —
// TOAST_STYLES/TOAST_ICONS cover every type so a caller passing a type with
// no entry here falls back visually to 'info' in the UI layer, not silently.
export const TOAST_STYLES = {
  levelup: { accent: 'var(--color-gold-light)', bar: 'var(--color-gold)' },
  reward:  { accent: 'var(--color-gold-light)', bar: 'var(--color-gold)' },
  error:   { accent: 'var(--color-blood-ember)', bar: 'var(--color-blood)' },
  combat:  { accent: 'var(--color-blood-light)', bar: 'var(--color-blood-light)' },
  drop:    { accent: 'var(--color-emerald-light)', bar: 'var(--color-emerald)' },
  success: { accent: 'var(--color-emerald-light)', bar: 'var(--color-emerald)' },
  info:    { accent: 'var(--color-mana-light)', bar: 'var(--color-mana)' },
  warning: { accent: 'var(--color-amber-light)', bar: 'var(--color-amber)' },
}

export const TOAST_ICONS = {
  levelup: '⭐', reward: '🏆', error: '⚠️', combat: '⚔️', drop: '✨', success: '✓', info: 'ℹ️', warning: '⚠️',
}

// 'info' is the only toast type the showInfoToasts setting may hide — every
// other type (including 'warning', used for blocking actions) always shows.
export function isSuppressibleToastType(type) {
  return type === 'info'
}
