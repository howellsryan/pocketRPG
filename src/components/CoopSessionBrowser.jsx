import SkillEmblem from './SkillEmblem.jsx'
import HPBar from './HPBar.jsx'
import { getMonsterArt, getCategoryArt } from '../utils/combatArt.js'

// Every open co-op room, across every boss, with a way into each one. The
// picker's solo-or-group prompt only ever showed a headcount for the boss the
// player had already tapped, so a group already fighting was invisible.
//
// One row in the picker, full list in a modal — the same shape as the PvP
// entry, because a busy night would otherwise bury the foe list under a dozen
// group rows. Built from the picker's own area/monster classes and the kit's
// fm-btn, so it wears whatever skin the shell is wearing (DESIGN.md §2, the Kit
// Consumption Rule). Presentation only — the screen owns the poll and the join.

function rosterLabel(session) {
  const names = (session.members || []).map((m) => m.username).filter(Boolean)
  if (names.length === 0) return 'Waiting for the roster…'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
}

function playableRows(sessions, monstersData) {
  return sessions
    .map((session) => ({ session, monster: monstersData?.[session.bossId] }))
    .filter((row) => !!row.monster)
}

/** The picker row: one line whatever the server is doing, opening the list. */
export default function CoopSessionBrowser({ sessions = [], monstersData, loading = false, onOpen }) {
  const rows = playableRows(sessions, monstersData)
  const art = getCategoryArt('bosses')
  const fighters = rows.reduce((sum, { session }) => sum + (session.memberCount || 0), 0)

  const blurb = loading && rows.length === 0
    ? 'Checking who is out there…'
    : rows.length === 0
      ? 'Nobody is bossing together right now'
      : `${fighters} ${fighters === 1 ? 'player' : 'players'} across ${rows.length} ${rows.length === 1 ? 'boss fight' : 'boss fights'}`

  return (
    <div class="cb-area cb-live">
      <button class="cb-area__head" onClick={onOpen} disabled={rows.length === 0}>
        <div class="cb-area__glow" style={{ background: art.accent }} />
        <div class="cb-area__icon">
          <SkillEmblem iconKey={art.icon} accent={art.accent} size={30} glow={0} />
        </div>
        <div class="cb-area__txt">
          <div class="cb-area__name">Live Group Fights</div>
          <div class="cb-area__blurb">{blurb}</div>
        </div>
        {rows.length > 0 && (
          <>
            <span class="cb-area__count">{rows.length}</span>
            <span class="cb-area__chev"><span class="cb-chev" /></span>
          </>
        )}
      </button>
    </div>
  )
}

/** The list itself, for the modal the row opens. */
export function CoopSessionList({
  sessions = [],
  monstersData,
  onJoin,
  checkBossRequirements,
  joiningSessionId = null,
  activeSessionId = null,
}) {
  const rows = playableRows(sessions, monstersData)
  if (rows.length === 0) {
    return (
      <div class="cb-area__blurb cb-live__empty">
        Nobody is bossing together right now. Pick a boss and choose "Fight together" to open one.
      </div>
    )
  }

  return (
    <div class="cb-live__list">
      {rows.map(({ session, monster }) => {
        const art = getMonsterArt(monster)
        const isMine = activeSessionId === session.sessionId
        const joining = joiningSessionId === session.sessionId
        const maxMembers = session.maxMembers || 8
        // The server gates the join anyway (§14) — this is so a boss the player
        // has not unlocked reads as locked instead of as a button that only
        // fails once tapped.
        const req = checkBossRequirements?.(monster)
        const locked = !!req?.locked && !isMine
        return (
          <div key={session.sessionId} class={'cb-mon cb-live__row' + (locked ? ' cb-mon--locked' : '')}>
            <div class="cb-mon__art">
              <SkillEmblem iconKey={art.icon} accent={art.accent} size={42} glow={0} />
            </div>
            <div class="cb-mon__body">
              <div class="cb-mon__name">{monster.name}</div>
              <div class="cb-mon__stats">
                <span class="cb-live__seats">{session.memberCount}/{maxMembers} fighting</span>
                <i />
                <span class="cb-live__roster">{rosterLabel(session)}</span>
              </div>
              {locked && <div class="cb-mon__lock">{req.reason}</div>}
              {session.bossMaxHP > 0 && (
                <div class="cb-live__hp">
                  <HPBar current={Math.max(0, session.bossHP ?? 0)} max={session.bossMaxHP} />
                </div>
              )}
            </div>
            <button
              type="button"
              class="fm-btn fm-btn--sm cb-live__join"
              onClick={() => onJoin?.(session, monster)}
              disabled={joining || locked || (session.full && !isMine)}
              aria-label={`Join the group fighting ${monster.name}`}
            >
              {joining ? '…' : isMine ? 'Rejoin' : locked ? 'Locked' : session.full ? 'Full' : 'Join'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
