// Pure pick-priority + context-menu composition. No three.js — the raycast
// layer resolves hits into Pickables, these functions decide the hover line and
// the right-click menu, so the ordering rules are unit-testable in isolation.
// Spec: docs/open-world-build-guide.md §8 STEP 2.1.

export type PickKind = 'rock' | 'object' | 'npc' | 'loot' | 'exit' | 'player'

/** One selectable action on a pickable. `action` is the wire verb sent in an
 * `interact` message ('mine'/'deposit'/'attack'/'take'); `id` overrides the
 * pickable's id when the action targets a specific sub-entity (a single item in
 * a loot pile); `name` overrides the displayed target (per-item loot names). */
export type PickAction = { label: string; action: string; id?: string; name?: string }

export type Pickable = {
  kind: PickKind
  id: string
  name: string
  /** Ordered; the first is the left-click default action. */
  actions: PickAction[]
  /** Combat level for npc menu colour-coding. */
  monsterLevel?: number
  examine?: string
}

// Hover picks the highest-priority thing under the cursor; the context menu
// lists everything in ray order (near-to-far), which the caller preserves.
// 'player' has no entry deliberately — other players are menu-only (Follow),
// never a hover/left-click default, so tapping through a crowd still walks.
const HOVER_PRIORITY: Partial<Record<PickKind, number>> = { loot: 0, npc: 1, rock: 2, object: 2, exit: 3 }

/** The thing a left-click acts on: highest hover-priority, ties broken by the
 * caller's near-to-far order. Null when only the ground is under the cursor. */
export function topPick(pickables: Pickable[]): Pickable | null {
  let best: Pickable | null = null
  let bestRank = Infinity
  for (let i = 0; i < pickables.length; i++) {
    const rank = HOVER_PRIORITY[pickables[i].kind]
    if (rank !== undefined && rank < bestRank) {
      bestRank = rank
      best = pickables[i]
    }
  }
  return best
}

/** The interaction a left-click fires: the pickable's first (default) action,
 * resolving a per-item id override (loot piles) when present. */
export function defaultInteract(p: Pickable): { kind: PickKind; id: string; action: string } {
  const a = p.actions[0]
  return { kind: p.kind, id: a.id ?? p.id, action: a.action }
}

/** OSRS-style hover line: `<default action> <Name>` (with `(level-N)` appended
 * for npcs), or `Walk here` when nothing actionable is under the cursor. */
export function hoverText(pickables: Pickable[]): string {
  const pick = topPick(pickables)
  if (!pick || pick.actions.length === 0) return 'Walk here'
  const suffix = pick.kind === 'npc' && pick.monsterLevel != null ? ` (level-${pick.monsterLevel})` : ''
  const name = pick.actions[0].name ?? pick.name
  return `${pick.actions[0].label} ${name}${suffix}`
}

export type MenuRow = {
  text: string
  /** Present on rows that send a server interaction. */
  interact?: { kind: PickKind; id: string; action: string }
  /** Present on the "Follow <name>" row for a player pickable — sends
   * {t:'follow', targetId} rather than an interact (item 10). */
  followTargetId?: string
  /** Client-only rows. */
  local?: 'examine' | 'walk' | 'cancel'
  examineText?: string
  /** Rendering hints (ui.ts colours the name cyan, the level green/red). */
  targetName?: string
  targetKind?: PickKind
  monsterLevel?: number
  /** True when the player's combat level ≥ the monster's (green), else red. */
  levelFavourable?: boolean
}

/** Builds the right-click menu: every action of every pickable in the caller's
 * near-to-far order (each pickable's own Examine last within its group), then
 * `Walk here`, then `Cancel`. Header ("Choose Option") is added by the renderer. */
export function buildMenu(pickables: Pickable[], playerCombatLevel: number): MenuRow[] {
  const rows: MenuRow[] = []
  for (const pick of pickables) {
    // Players are menu-only and never attacked/interacted with here (item
    // 10) — Follow is a distinct message ({t:'follow'}, not {t:'interact'}),
    // so it gets its own row shape instead of running through `actions`.
    if (pick.kind === 'player') {
      rows.push({ text: `Follow ${pick.name}`, followTargetId: pick.id, targetName: pick.name, targetKind: pick.kind })
      continue
    }
    const favourable = pick.monsterLevel == null ? undefined : playerCombatLevel >= pick.monsterLevel
    for (const action of pick.actions) {
      const name = action.name ?? pick.name
      rows.push({
        text: `${action.label} ${name}`,
        interact: { kind: pick.kind, id: action.id ?? pick.id, action: action.action },
        targetName: name,
        targetKind: pick.kind,
        monsterLevel: pick.monsterLevel,
        levelFavourable: favourable,
      })
    }
    if (pick.examine) {
      rows.push({
        text: `Examine ${pick.name}`,
        local: 'examine',
        examineText: pick.examine,
        targetName: pick.name,
        targetKind: pick.kind,
      })
    }
  }
  rows.push({ text: 'Walk here', local: 'walk' })
  rows.push({ text: 'Cancel', local: 'cancel' })
  return rows
}
