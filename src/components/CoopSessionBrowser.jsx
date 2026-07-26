import SkillEmblem from './SkillEmblem.jsx'
import ProgressBar from './ProgressBar.jsx'
import { getMonsterArt } from '../utils/combatArt.js'

// Every open co-op room, across every boss, with a way into each one. The
// picker's solo-or-group prompt only ever showed a headcount for the boss the
// player had already tapped, so a group already fighting something else was
// invisible. Presentation only — the screen owns the poll and the join.

function rosterLabel(session) {
  const names = (session.members || []).map((m) => m.username).filter(Boolean)
  if (names.length === 0) return 'Waiting for the roster…'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
}

export default function CoopSessionBrowser({
  sessions = [],
  monstersData,
  onJoin,
  checkBossRequirements,
  joiningSessionId = null,
  loading = false,
  activeSessionId = null,
}) {
  const rows = sessions
    .map((session) => ({ session, monster: monstersData?.[session.bossId] }))
    .filter((row) => !!row.monster)

  return (
    <div class="cb-live">
      <div class="cb-live__head">
        <span class="cb-live__title">Live Group Fights</span>
        <span class="cb-live__count">
          {loading && rows.length === 0
            ? 'Looking…'
            : `${rows.length} ${rows.length === 1 ? 'group' : 'groups'}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <div class="cb-live__empty">
          {loading
            ? 'Checking who is out there…'
            : 'Nobody is bossing together right now. Pick a boss below and choose "Fight together" to open one.'}
        </div>
      ) : (
        <div class="cb-live__list">
          {rows.map(({ session, monster }) => {
            const art = getMonsterArt(monster)
            const isMine = activeSessionId === session.sessionId
            const joining = joiningSessionId === session.sessionId
            const maxMembers = session.maxMembers || 8
            // The server gates the join anyway (§14) — this is so a boss the
            // player has not unlocked reads as locked instead of as a button
            // that only fails once tapped.
            const req = checkBossRequirements?.(monster)
            const locked = !!req?.locked && !isMine
            return (
              <div key={session.sessionId} class={'cb-live__row' + (locked ? ' cb-live__row--locked' : '')}>
                <div class="cb-live__art">
                  <SkillEmblem iconKey={art.icon} accent={art.accent} size={38} glow={0} />
                </div>
                <div class="cb-live__body">
                  <div class="cb-live__name">{monster.name}</div>
                  <div class="cb-live__meta">
                    <span class="cb-live__seats">{session.memberCount}/{maxMembers} fighting</span>
                  </div>
                  <div class="cb-live__roster">{rosterLabel(session)}</div>
                  {locked && <div class="cb-live__lock">{req.reason}</div>}
                  {session.bossMaxHP > 0 && (
                    <div class="cb-live__hp">
                      <ProgressBar
                        value={session.bossHP ?? 0}
                        max={session.bossMaxHP}
                        color="var(--color-blood-light)"
                        height="h-1.5"
                      />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  class="cb-live__join"
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
      )}
    </div>
  )
}
