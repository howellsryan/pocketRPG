import SkillEmblem from './SkillEmblem.jsx'
import HPBar from './HPBar.jsx'
import { getMonsterArt, getCategoryArt } from '../utils/combatArt.js'

// Every open co-op room, across every boss, with a way into each one. The
// picker's solo-or-group prompt only ever showed a headcount for the boss the
// player had already tapped, so a group already fighting was invisible.
//
// Built from the picker's own area/monster row classes and the kit's fm-btn, so
// it wears whatever skin the shell is wearing (DESIGN.md §2, the Kit
// Consumption Rule). Presentation only — the screen owns the poll and the join.

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
  const headArt = getCategoryArt('bosses')

  return (
    <div class="cb-area is-open cb-live">
      <div class="cb-area__head cb-live__head">
        <div class="cb-area__glow" style={{ background: headArt.accent }} />
        <div class="cb-area__icon">
          <SkillEmblem iconKey={headArt.icon} accent={headArt.accent} size={30} glow={0} />
        </div>
        <div class="cb-area__txt">
          <div class="cb-area__name">Live Group Fights</div>
          <div class="cb-area__blurb">Drop in on a boss someone is already fighting</div>
        </div>
        <span class="cb-area__count">
          {rows.length > 0 ? `${rows.length} open` : loading ? '…' : 'none'}
        </span>
      </div>

      <div class="cb-area__list">
        {rows.length === 0 ? (
          <div class="cb-area__blurb cb-live__empty">
            {loading
              ? 'Checking who is out there…'
              : 'Nobody is bossing together right now. Pick a boss below and choose "Fight together" to open one.'}
          </div>
        ) : rows.map(({ session, monster }) => {
          const art = getMonsterArt(monster)
          const isMine = activeSessionId === session.sessionId
          const joining = joiningSessionId === session.sessionId
          const maxMembers = session.maxMembers || 8
          // The server gates the join anyway (§14) — this is so a boss the
          // player has not unlocked reads as locked instead of as a button that
          // only fails once tapped.
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
    </div>
  )
}
