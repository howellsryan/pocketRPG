import { useState } from 'preact/hooks'
import GameIcon from './GameIcon.jsx'
import Modal from './Modal.jsx'
import SkillEmblem from './SkillEmblem.jsx'
import EquipmentPaperdoll from './EquipmentPaperdoll.jsx'
import InventoryGrid from './InventoryGrid.jsx'
import { combatLevelFromLevels } from '../engine/combatLevel.js'
import { isCoopHost, raidReadyCount } from '../engine/coopRaidEngine.js'
import { getRaidArt } from '../utils/combatArt.js'

// The raid lobby: who is coming, what they are bringing, and the host's Start
// button.
//
// It exists because a raid is a run with a beginning — a party sizes itself up
// before it sets off, which is something a drop-in boss room never has to do.
// The roster is an illuminated ledger (fm-ledger/fm-row) rather than a card
// grid, and the ember Start Raid is the only saturated thing on the screen
// (DESIGN.md §3, the Brass Carries Brand Rule). New classes here carry layout
// only; every colour comes from an existing cb-*/fm-* class (§2, the Two-Skin
// Trap).

function memberCombatLevel(member) {
  if (member?.levels) return combatLevelFromLevels(member.levels)
  if (member?.stats) return combatLevelFromLevels(member.stats)
  return null
}

function packedItemCount(inventory) {
  return (Array.isArray(inventory) ? inventory : []).filter(Boolean).length
}

/** What one party member is bringing. Read-only: the grid takes no reorder or
 * click handler, so a lobby can inspect a pack without editing it. */
function MemberKitModal({ member, itemsData, onClose }) {
  const level = memberCombatLevel(member)
  return (
    <Modal onClose={onClose}>
      <div class="cb-prayhead">
        <h3>{member.username || 'Raider'}{level ? ` · Combat ${level}` : ''}</h3>
        <button onClick={onClose} class="cb-x" aria-label="Close">
          <GameIcon iconKey="cancel" color="var(--fm-ink-soft)" size={16} />
        </button>
      </div>
      <div class="max-h-96 overflow-y-auto">
        <div class="fm-eyebrow mb-2">Worn</div>
        <EquipmentPaperdoll
          equipment={member.equipment || {}}
          itemsData={itemsData}
          size="sm"
          asCard={false}
        />
        <div class="fm-eyebrow mt-4 mb-2">
          Carried · {packedItemCount(member.inventory)}/28
        </div>
        <InventoryGrid
          inventory={member.inventory || []}
          size="small"
          showName={false}
          gridClass="grid grid-cols-4 sm:grid-cols-6 gap-2 justify-items-center"
        />
      </div>
    </Modal>
  )
}

export default function CoopRaidLobby({
  state,
  characterId,
  itemsData,
  raidName,
  bossNames = [],
  onStart,
  onLeave,
  onReady,
  // Own readiness comes from the caller, not the roster: the screen shows the
  // tap immediately and the room confirms it a beat later.
  ready = false,
  starting = false,
}) {
  const [inspecting, setInspecting] = useState(null)
  const raidId = state?.raid?.raidId
  const art = getRaidArt(raidId)
  const members = Object.values(state?.members || {})
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || Number(a.characterId) - Number(b.characterId))
  const iAmHost = isCoopHost(state, characterId)
  const hostName = members.find((m) => Number(m.characterId) === Number(state?.hostCharacterId))?.username || 'the host'
  const maxMembers = 8
  const readiness = raidReadyCount(state)

  return (
    <div class="cb-party">
      <div class="cb-area cb-party__head">
        <div class="cb-area__head">
          <div class="cb-area__glow" style={{ background: art.accent }} />
          <div class="cb-area__icon">
            <SkillEmblem iconKey={art.icon} accent={art.accent} size={30} glow={0} />
          </div>
          <div class="cb-area__txt">
            <div class="cb-area__name">{raidName || state?.raid?.name || 'Raid'}</div>
            <div class="cb-area__blurb">
              {members.length}/{maxMembers} in the party · {bossNames.length} bosses
            </div>
          </div>
        </div>
      </div>

      <div class="fm-eyebrow cb-party__label">Your party</div>
      <div class="fm-ledger cb-party__roster">
        {members.map((member) => {
          const level = memberCombatLevel(member)
          const isHost = Number(member.characterId) === Number(state?.hostCharacterId)
          const isMe = Number(member.characterId) === Number(characterId)
          // Own record is always full; everyone else's kit is only projected in
          // the lobby, so the inspect button appears exactly when it works.
          const inspectable = Array.isArray(member.inventory) || member.equipment
          return (
            <div key={member.characterId} class="fm-row fm-row--alt cb-party__row">
              <span class="fm-row__label cb-party__name">
                {/* Only the username truncates. The tags sit outside it because a
                    clipped "HOST" reads as a rendering fault, where a shortened
                    long name reads as a long name. */}
                <span class="cb-party__who">{member.username || 'Raider'}</span>
                {/* One tag, not two. Both at once only ever happens on "I am the
                    host", where "You" says nothing the enabled Start Raid button
                    has not already said — and it cost the name half its room. */}
                {isHost
                  ? <span class="fm-tag fm-tag--ember cb-party__tag">{isMe ? 'You · Host' : 'Host'}</span>
                  : isMe && <span class="fm-tag fm-tag--brass cb-party__tag">You</span>}
              </span>
              <span class="fm-row__val cb-party__lvl">
                {/* The host's answer is the Start button, so a "waiting" mark
                    against their name would be reading the wrong thing. */}
                {!isHost && (() => {
                  // Verdigris is already this screen family's "settled" colour —
                  // it is what the loot-share bar turns when a drop is secured.
                  const rowReady = isMe ? ready : !!member.ready
                  return (
                    <span class={'fm-tag cb-party__ready' + (rowReady ? ' fm-tag--verdigris' : '')}>
                      {rowReady ? 'Ready' : 'Waiting'}
                    </span>
                  )
                })()}
                {level ? `Cmb ${level}` : '—'}
              </span>
              <button
                type="button"
                class="fm-btn fm-btn--sm cb-party__peek"
                disabled={!inspectable}
                onClick={() => setInspecting(member)}
                aria-label={`Inspect ${member.username || 'this raider'}'s gear and inventory`}
              >
                Gear
              </button>
            </div>
          )
        })}
      </div>

      <p class="cb-area__blurb cb-party__note">
        {iAmHost
          ? (readiness.total > 0
            // Readiness informs the host, it does not gate them: a party must
            // never be stranded by one member who walked away from their phone.
            ? `${readiness.ready}/${readiness.total} ready. Nobody can join once you set off.`
            : 'Nobody can join once you set off, so wait for your party before you start.')
          : `Waiting for ${hostName} to start the raid. Eat, drink and swap gear while you wait.`}
      </p>

      <div class="cb-actions cb-actions--two cb-party__actions">
        <button class="cb-act" onClick={onLeave}>
          <GameIcon iconKey="cancel" color="currentColor" size={18} />
          <span>Leave party</span>
        </button>
        {iAmHost ? (
          <button class="cb-act is-on" disabled={starting} onClick={starting ? undefined : onStart}>
            <GameIcon iconKey="temple_gate" color="currentColor" size={18} />
            <span>{starting ? 'Starting…' : 'Start Raid'}</span>
          </button>
        ) : (
          // The slot a non-host used to lose to a dead "Host starts" button.
          // Telling the party you have finished restocking is the one thing a
          // guest in a lobby actually has to do.
          <button class={'cb-act' + (ready ? ' is-on' : '')} onClick={() => onReady?.(!ready)}>
            <GameIcon iconKey="check_mark" color="currentColor" size={18} />
            <span>{ready ? "I'm Ready" : 'Not ready'}</span>
          </button>
        )}
      </div>

      {bossNames.length > 0 && (
        <>
          <div class="fm-eyebrow cb-party__label">The run</div>
          <div class="fm-ledger cb-party__roster">
            {bossNames.map((name, idx) => (
              <div key={`${name}-${idx}`} class="fm-row cb-party__row">
                <span class="fm-row__label">{name}</span>
                <span class="fm-row__val">{idx + 1}/{bossNames.length}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {inspecting && (
        <MemberKitModal
          member={inspecting}
          itemsData={itemsData}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  )
}
