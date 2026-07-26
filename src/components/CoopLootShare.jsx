import { coopLootDamageRequired, coopLootProgress } from '../engine/coopBossEngine.js'

// The loot board for a co-op boss fight: who has earned a drop, and how far off
// the rest are. It exists because loot stopped being one prize for the top
// attacker — every member past 10% of the boss's max HP rolls the table — so
// "how much damage have I done" became a decision the player has to be able to
// make mid-fight rather than a scoreboard.
//
// Each row's meter fills toward the THRESHOLD, not the boss's health: a full bar
// means a drop is secured and nothing else. Parchment-only (the screen is always
// inside .forge-shell); the classes carry layout, the tokens carry the skin.

export default function CoopLootShare({ members, maxHP, characterId, targetCharId }) {
  const required = coopLootDamageRequired(maxHP)
  const rows = Object.values(members || {})
    .map((m) => ({ member: m, progress: coopLootProgress(m, maxHP) }))
    .sort((a, b) => {
      const mine = Number(b.member.characterId === characterId) - Number(a.member.characterId === characterId)
      return mine || b.progress.damage - a.progress.damage
    })

  return (
    <div class="cb-qa" style={{ marginBottom: 12 }}>
      <div class="cb-hplabel">
        <span>Loot Share</span>
        <span class="cb-hplabel__v">{required.toLocaleString()} dmg to qualify</span>
      </div>
      <div class="cb-share">
        {rows.map(({ member, progress }) => (
          <div
            key={member.characterId}
            class={'cb-share__row'
              + (member.characterId === characterId ? ' is-me' : '')
              + (progress.qualified ? ' is-paid' : '')}
          >
            <div class="cb-share__head">
              <span class="cb-share__name">
                {member.characterId === characterId ? 'You' : member.username}
                {String(member.characterId) === String(targetCharId) && <span class="cb-share__aggro">Targeted</span>}
              </span>
              <span class="cb-share__v">{progress.damage.toLocaleString()}</span>
            </div>
            <div class="cb-share__track">
              <div class="cb-share__fill" style={{ width: `${progress.pct}%` }} />
            </div>
            {/* Kept to one line at a phone's column width — a wrapping note
                doubles the height of all eight rows. */}
            <div class="cb-share__note">
              {progress.qualified ? `Drop secured · ${Math.round(progress.sharePct)}%`
                : member.status === 'dead' ? 'Defeated — no drop'
                  : `${progress.remaining.toLocaleString()} dmg to go`}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
