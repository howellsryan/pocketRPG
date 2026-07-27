import SkillEmblem from './SkillEmblem.jsx'
import { getRaidArt } from '../utils/combatArt.js'

// Open lobbies for one raid, plus the button that opens your own.
//
// Only parties still in their lobby are ever listed — a raid is a run with a
// beginning, and dropping in on the last boss is exactly what the lobby exists
// to prevent — so this list never shows a party that has set off. Presentation
// only; the screen owns the poll and the join.
//
// Built from the picker's own .cb-area/.cb-mon classes and the kit's fm-btn so
// it wears whatever skin the shell is wearing (DESIGN.md §2).

function partyRosterLabel(party) {
  const names = (party.members || []).map((m) => m.username).filter(Boolean)
  if (names.length === 0) return 'Waiting for the roster…'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
}

export default function CoopRaidPartyList({
  raid,
  parties = null,
  onJoin,
  onHost,
  joining = null,
  activeSessionId = null,
}) {
  const art = getRaidArt(raid?.id)
  const loading = parties === null
  const rows = parties || []

  return (
    <div class="cb-live__list">
      <button
        type="button"
        class="cb-mon cb-live__row"
        onClick={() => onHost?.()}
        disabled={joining === 'new'}
      >
        <div class="cb-mon__art">
          <SkillEmblem iconKey={art.icon} accent={art.accent} size={42} glow={0} />
        </div>
        <div class="cb-mon__body">
          <div class="cb-mon__name">{joining === 'new' ? 'Opening the lobby…' : 'Start a party'}</div>
          <div class="cb-mon__stats">
            {/* .cb-live__roster is a single nowrap line — keep this short enough
                to survive it at 390px rather than losing half a sentence. */}
            <span class="cb-live__roster">You host until you start</span>
          </div>
        </div>
      </button>

      {loading && (
        <div class="cb-area__blurb cb-live__empty">Looking for parties…</div>
      )}

      {!loading && rows.length === 0 && (
        <div class="cb-area__blurb cb-live__empty">
          No parties waiting for this raid — start one and others can join you.
        </div>
      )}

      {rows.map((party) => {
        const isMine = activeSessionId === party.sessionId
        const busy = joining === party.sessionId
        const maxMembers = party.maxMembers || 8
        return (
          <div key={party.sessionId} class="cb-mon cb-live__row">
            <div class="cb-mon__art">
              <SkillEmblem iconKey={art.icon} accent={art.accent} size={42} glow={0} />
            </div>
            <div class="cb-mon__body">
              <div class="cb-mon__name">{partyRosterLabel(party)}</div>
              <div class="cb-mon__stats">
                <span class="cb-live__seats">{party.memberCount}/{maxMembers} in the lobby</span>
                <i />
                <span class="cb-live__roster">Waiting to start</span>
              </div>
            </div>
            <button
              type="button"
              class="fm-btn fm-btn--sm cb-live__join"
              onClick={() => onJoin?.(party)}
              disabled={busy || (party.full && !isMine)}
              aria-label={`Join this ${raid?.name || 'raid'} party`}
            >
              {busy ? '…' : isMine ? 'Rejoin' : party.full ? 'Full' : 'Join'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
