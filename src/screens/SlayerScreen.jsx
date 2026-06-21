import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import Modal from '../components/Modal.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import monstersData from '../data/monsters.json'
import itemsData from '../data/items.json'
import { SLAYER_UNLOCKS, getSlayerUnlockPurchaseState, ownsItem } from '../engine/slayerUnlocks.js'
import { requestCriticalPushSave } from '../cloud/sync.js'
import { DAGANNOTH_KINGS_TASK_ID, SLAYER_TASK_SKIP_POINT_COST } from '../engine/slayerTasks.js'
import { SLAYER_MASTERS, resolveTaskMonsterIds, pickSlayerMonster, buildSlayerTask, isEntryEligible } from '../engine/slayerMasters.js'
import { api, getToken, getCharacterId, CREDITS_UPDATED_EVENT } from '../cloud/api.js'
import { applyCloudSave } from '../cloud/sync.js'
import { CRITICAL_SAVE_REASONS } from '../cloud/criticalSavePolicy.js'
import { recordCollectionLogDrop } from '../cloud/collectionLog.js'
import { SCREENS } from '../utils/constants.js'

// PocketRPG combat level formula
function getPlayerCombatLevel(stats) {
  const atk = getLevelFromXP(stats.attack?.xp || 0)
  const str = getLevelFromXP(stats.strength?.xp || 0)
  const def = getLevelFromXP(stats.defence?.xp || 0)
  const hp = getLevelFromXP(stats.hitpoints?.xp || 0)
  const prayer = getLevelFromXP(stats.prayer?.xp || 0)
  const ranged = getLevelFromXP(stats.ranged?.xp || 0)
  const magic = getLevelFromXP(stats.magic?.xp || 0)

  const base = Math.floor((def + hp + Math.floor(prayer / 2)) / 4)
  const melee = Math.floor((atk + str) * 13 / 40)
  const rangedCB = Math.floor(Math.floor(ranged * 3 / 2) * 13 / 40)
  const magicCB = Math.floor(Math.floor(magic * 3 / 2) * 13 / 40)
  return base + Math.max(melee, rangedCB, magicCB)
}

const SLAYER_MONSTER_ICONS = {
  field_chicken: '🐔', cave_goblin: '👺', pasture_bull: '🐄', arcane_adept: '🧙',
  stoneback_crab: '🦀', duneback_crab: '🦀', umbral_adept: '🧙‍♂️',
  broodfang_spider: '🕷️', highland_giant: '👊', briar_giant: '🌿',
  green_dragon: '🐉', red_dragon: '🐉', lesser_fiend: '👿', nether_demon: '😈',
  warlord_grondar: '👹', commander_zephyra: '🌟', krylth_the_defiler: '🔥', skyrender_kharra: '🦅',
  [DAGANNOTH_KINGS_TASK_ID]: '👑',
  nagadoth_rex: '🦖', nagadoth_prime: '👹', nagadoth_supreme: '🏹', ember_tyrant: '🔥',
  sanguine_veld: '🩸', nether_wraith: '👻', bone_wyvern: '🐲', cinder_devil: '💨',
  deepmaw_kraken: '🦑', wailing_banshee: '👻', warped_spectre: '👁️', ash_wyrm: '🐍',
  astral_warrior: '⚔️', astral_ranger: '🏹', astral_mage: '🔮', runestone_gargoyle: '🗿',
  vicious_black_dragon: '🐉', nightfang_beast: '🦇', threefang_cerberus: '🐺', ashen_hydra: '🐲',
  dustpaw_rat: '🐀', bogling_sprite: '✨', frostbite_imp: '❄️', marshfen_toad: '🐸',
  cinderpaw_cub: '🐅', glaive_skeleton: '💀', mirebound_husk: '🪦', verdant_stalker: '🏹',
  stoneglare_basilisk: '🦎', embertongue_lizard: '🦎', hollow_reaver: '⚰️',
  briarheart_treant: '🌳', frostmaw_direwolf: '🐺', pyreclaw_demon: '👹',
  wraithgale_specter: '👻', bloodmoon_stalker: '🌙', ironfang_drake: '🐲',
  shadeglass_golem: '🗿', tidereaper_crab: '🦀',
  voidweave_stalker: '🕸️', drakthul_wyrmling: '🐉', bonelight_pyromancer: '🔥',
  cinderfang_reaver: '🗡️', ashen_marauder: '⚒️',
  sovrathar_the_ashen_sovereign: '👑',
  marshscale_shaman: '🦎', crazy_archaeologist: '🏺', adamant_dragon: '🐲', rune_dragon: '🐲',
  hellbound_gorilla: '🦍',
}

// Resolve a master's monster-pool entry into display info for the info modal.
// Composite tasks (e.g. Nagadoth Kings) resolve to several monsters; we surface
// the highest combat level / slayer requirement among them.
function getPoolEntryInfo(entry) {
  const id = typeof entry === 'object' ? entry.id : entry
  const isBoss = typeof entry === 'object' && !!entry.boss
  const resolved = resolveTaskMonsterIds(id).map(mid => monstersData[mid]).filter(Boolean)
  const name = id === DAGANNOTH_KINGS_TASK_ID
    ? 'Nagadoth Kings'
    : (monstersData[id]?.name || id.replace(/_/g, ' '))
  const combatLevel = resolved.length ? Math.max(...resolved.map(m => m.combatLevel || 0)) : 0
  const slayerReq = resolved.length ? Math.max(...resolved.map(m => m.slayerRequirement || 0)) : 0
  return { id, isBoss, name, combatLevel, slayerReq, icon: SLAYER_MONSTER_ICONS[id] || '👹' }
}

// Renders one task row inside the slayer-master info modal. Monsters the player
// can't yet be assigned (slayer level too low) are dimmed with a lock hint.
function SlayerTaskInfoRow({ entry, slayerLevel }) {
  const { name, combatLevel, slayerReq, icon } = getPoolEntryInfo(entry)
  const eligible = isEntryEligible(entry, slayerLevel)
  return (
    <div class={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-[rgba(255,255,255,0.025)] border border-[rgba(255,255,255,0.05)] ${eligible ? '' : 'opacity-50'}`}>
      <span class="text-xl flex-shrink-0 w-7 text-center">{icon}</span>
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-semibold text-[var(--color-parchment)] truncate">{name}</div>
        {slayerReq > 0 && (
          <div class={`text-[10px] font-semibold mt-0.5 ${eligible ? 'text-[var(--color-parchment)] opacity-45' : 'text-[var(--color-blood-light)]'}`}>
            {eligible ? `Requires Slayer ${slayerReq}` : `🔒 Requires Slayer ${slayerReq}`}
          </div>
        )}
      </div>
      {combatLevel > 0 && (
        <span class="text-[10px] font-[var(--font-mono)] text-[var(--color-blood-light)] flex-shrink-0">CB {combatLevel}</span>
      )}
    </div>
  )
}

export default function SlayerScreen({ onBack, onNavigate }) {
  const { stats, slayerTask, setSlayerTask, slayerPoints, updateSlayerPoints, addToast, bank, inventory, addToBank, getSnapshot, slayerTasksCompleted, loadGame, slayerPerks, updateSlayerPerk } = useGame()

  const [infoMaster, setInfoMaster] = useState(null)

  const combatLevel = getPlayerCombatLevel(stats)
  const slayerLevel = getLevelFromXP(stats.slayer?.xp || 0)


  const handleGetTask = (master) => {
    if (slayerTask) {
      addToast('Complete your current task first!', 'error')
      return
    }
    if (combatLevel < master.combatReq) {
      addToast(`Need combat level ${master.combatReq} (you are ${combatLevel})`, 'error')
      return
    }
    if (slayerLevel < master.slayerReq) {
      addToast(`Need slayer level ${master.slayerReq} (you have ${slayerLevel})`, 'error')
      return
    }

    // Evenly distributed pick across the master's eligible monsters.
    const pick = pickSlayerMonster(master, slayerLevel)
    if (!pick) {
      addToast('No tasks available — raise your slayer level for this master.', 'error')
      return
    }

    assignTask(master, pick.monsterId, pick.isBoss)
  }

  const assignTask = (master, monsterId, isBoss) => {
    const quantityMultiplier = slayerPerks?.doubleQuantity ? 2 : 1
    const task = buildSlayerTask(master, monsterId, isBoss, { quantityMultiplier })
    setSlayerTask(task)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
    addToast(`💀 Task: Kill ${task.totalCount} ${task.monsterName}`, 'info')
  }

  const handleCancelTask = () => {
    const skipCost = SLAYER_TASK_SKIP_POINT_COST
    if (slayerPoints < skipCost) {
      addToast(`Need ${skipCost} slayer points to skip a task.`, 'error')
      return
    }
    setSlayerTask(null)
    updateSlayerPoints(slayerPoints - skipCost)
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
    addToast(`Task skipped for ${skipCost} slayer points.`, 'info')
  }

  const handleSkipWithCredit = async () => {
    if (!getToken() || !getCharacterId()) {
      addToast('Credit skip requires a cloud account.', 'error')
      return
    }
    try {
      const res = await api.slayerSkip()
      const remaining = Number(res?.credits_remaining)
      if (Number.isFinite(remaining)) {
        window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT, { detail: { credits_remaining: remaining } }))
      }
      setSlayerTask(null)
      requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
      addToast('Task skipped for 1 credit.', 'info')
    } catch (err) {
      if (err?.status === 402) addToast('Not enough credits to skip.', 'error')
      else addToast(err?.message || 'Failed to skip task.', 'error')
    }
  }

  const handleUnlock = async (unlock) => {
    const item = itemsData[unlock.itemId]
    const purchaseState = getSlayerUnlockPurchaseState({ unlock, item, slayerPoints, bank, inventory })
    if (!purchaseState.allowed) {
      addToast(purchaseState.message || 'Unable to purchase unlock', 'error')
      return
    }
    if (getToken() && getCharacterId()) {
      try {
        await api.completeSlayer('slayer', { actionNonce: `slayer:${unlock.itemId}:${Date.now()}`, rewards: [{ itemId: unlock.itemId, quantity: 1 }], slayerPoints: -unlock.cost })
        const saveRes = await api.getSave()
        if (saveRes?.save?.save_data) await applyCloudSave(JSON.parse(saveRes.save.save_data), saveRes.save.updatedAt, saveRes.save.save_revision)
        await loadGame()
        addToast(`🎉 Purchased ${item.name} — sent to bank`, 'info')
        return
      } catch (e) {
        addToast(`Unlock claim failed: ${e?.message || 'server_error'}`, 'error')
        return
      }
    }
    updateSlayerPoints(slayerPoints - unlock.cost)
    addToBank(unlock.itemId, 1)
    recordCollectionLogDrop({ itemId: unlock.itemId, sourceType: 'skilling', sourceId: 'slayer' })
    requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.PURCHASE)
    addToast(`🎉 Purchased ${item.name} — sent to bank`, 'info')
  }

  const progressPct = slayerTask
    ? Math.round((1 - slayerTask.monstersRemaining / slayerTask.totalCount) * 100)
    : 0

  const handleSlayTask = () => {
    if (!slayerTask || !onNavigate) return
    const candidateIds = resolveTaskMonsterIds(slayerTask.monsterId)
    const targetId = candidateIds.find(id => monstersData[id]) || candidateIds[0]
    if (!targetId || !monstersData[targetId]) {
      addToast('Could not find target monster', 'error')
      return
    }
    onNavigate(SCREENS.COMBAT, { monsterId: targetId })
  }

  return (
    <div class="h-full overflow-y-auto p-4">
      <SkillScreenHeader
        skill="slayer"
        title="Slayer"
        xp={stats.slayer?.xp || 0}
        level={slayerLevel}
        onBack={onBack}
        right={(
          <div class="text-right flex-shrink-0">
            <div class="text-[13px] font-bold font-[var(--font-mono)] text-[var(--color-gold)]">{slayerPoints.toLocaleString()} pts</div>
            <div class="text-[11px] font-semibold text-[var(--color-parchment)] opacity-40">CB {combatLevel}</div>
          </div>
        )}
      />

      {/* Current task banner */}
      {slayerTask ? (
        <div class="mb-4 rounded-2xl p-3.5 bg-gradient-to-b from-[rgba(212,160,23,0.08)] to-[rgba(212,160,23,0.03)] border-[1.5px] border-[rgba(212,160,23,0.42)]">
          <div class="flex items-center justify-between mb-2.5">
            <div class="text-[9.5px] text-[var(--color-gold)] uppercase font-bold tracking-[0.14em]">⚔️ Current Task</div>
            {onNavigate && (
              <button
                onClick={handleSlayTask}
                class="px-3.5 py-1.5 rounded-lg bg-[var(--color-gold)] text-[#0f0f0f] text-[11px] font-bold uppercase tracking-wider active:opacity-80 min-h-[36px] min-w-[64px]"
              >
                ⚔️ Slay
              </button>
            )}
          </div>
          <div class="flex items-center gap-3 mb-2.5">
            <div class="w-[46px] h-[46px] flex-shrink-0 rounded-xl flex items-center justify-center text-2xl bg-[rgba(212,160,23,0.08)] border border-[rgba(212,160,23,0.22)]">
              {SLAYER_MONSTER_ICONS[slayerTask.monsterId] || '👹'}
            </div>
            <div class="min-w-0">
              <div class="text-[16px] font-semibold text-[var(--color-parchment)]">{slayerTask.monsterName}</div>
              <div class="text-[12px] text-[var(--color-parchment)] opacity-45 mt-0.5">
                {slayerTask.monstersRemaining} / {slayerTask.totalCount} remaining
                {slayerTask.pointsOnComplete > 0 && ` · +${slayerTask.pointsOnComplete} pts on complete`}
              </div>
            </div>
          </div>
          <div class="h-2 rounded-full bg-[rgba(255,255,255,0.07)] overflow-hidden mb-2">
            <div
              class="h-full rounded-full transition-all bg-gradient-to-r from-[var(--color-gold-dim)] to-[var(--color-gold-light)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-[var(--color-gold)]">{progressPct}% complete</span>
            <div class="flex items-center gap-3">
              <button onClick={handleCancelTask} class="text-[11px] text-[var(--color-parchment)] opacity-40 underline">
                Skip (-{SLAYER_TASK_SKIP_POINT_COST} pts)
              </button>
              <button onClick={handleSkipWithCredit} class="text-[11px] text-[var(--color-parchment)] opacity-40 underline">
                Skip (-1 credit)
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div class="mb-4 rounded-2xl p-3.5 text-center bg-[rgba(255,255,255,0.025)] border border-[rgba(255,255,255,0.06)]">
          <div class="text-[12px] text-[var(--color-parchment)] opacity-50">No active task — select a master below to get one.</div>
        </div>
      )}

      {/* Slayer masters */}
      <SectionHeader className="mb-2.5">Slayer Masters</SectionHeader>
      <div class="flex flex-col gap-2.5">
        {SLAYER_MASTERS.map(master => {
          const meetsCombat = combatLevel >= master.combatReq
          const meetsSlayer = slayerLevel >= master.slayerReq
          const meetsReq = meetsCombat && meetsSlayer
          return (
            <div key={master.id} class="flex gap-2 items-center">
              <div class="flex-1 min-w-0">
                <SkillActionRow
                  icon={<span class="text-2xl">{master.icon}</span>}
                  title={master.name}
                  meta={<>
                    {master.location} · {master.description}
                    <span class="block mt-1">
                      {master.combatReq > 0 && <span class={meetsCombat ? 'text-[var(--color-hp-green)]' : 'text-[var(--color-blood-light)]'}>CB {master.combatReq}</span>}
                      {master.slayerReq > 0 && <span class={`ml-2 ${meetsSlayer ? 'text-[var(--color-hp-green)]' : 'text-[var(--color-blood-light)]'}`}>Slayer {master.slayerReq}</span>}
                      {master.combatReq === 0 && master.slayerReq === 0 && <span class="text-[var(--color-hp-green)]">No requirement</span>}
                    </span>
                  </>}
                  chip={<>{master.pointsPerTask} pts</>}
                  disabled={!meetsReq || !!slayerTask}
                  onClick={() => handleGetTask(master)}
                />
              </div>
              <button
                onClick={() => setInfoMaster(master)}
                aria-label="Slayer master tasks info"
                class="flex-shrink-0 w-11 h-11 rounded-full border border-[var(--color-void-border)] bg-[var(--color-void-light)] text-[var(--color-gold)] text-[15px] font-bold flex items-center justify-center active:opacity-70"
                title="View assignable tasks"
              >
                ⓘ
              </button>
            </div>
          )
        })}
      </div>

      {/* Unlocks — purchasable with slayer points */}
      <SectionHeader className="mt-5 mb-2.5">Unlocks</SectionHeader>
      <div class="flex flex-col gap-2.5">
        {SLAYER_UNLOCKS.map(unlock => {
          const item = itemsData[unlock.itemId]
          if (!item) return null
          const owned = ownsItem({ itemId: unlock.itemId, bank, inventory })
          const canAfford = slayerPoints >= unlock.cost
          const disabled = owned || !canAfford
          return (
            <SkillActionRow
              key={unlock.itemId}
              icon={<span class="text-2xl">{item.icon || '🎁'}</span>}
              title={item.name}
              meta={<>
                {unlock.description}
                {item.requirements?.slayer > 0 && <span class="block mt-1 opacity-80">Requires Slayer {item.requirements.slayer} to wear</span>}
              </>}
              chip={owned
                ? <span class="text-[var(--color-hp-green)]">Owned</span>
                : <span class={canAfford ? '' : 'text-[var(--color-blood-light)]'}>{unlock.cost.toLocaleString()} pts</span>}
              disabled={disabled}
              onClick={() => handleUnlock(unlock)}
            />
          )
        })}
      </div>

      {/* Perks — point-purchased, non-item bonuses */}
      <SectionHeader className="mt-5 mb-2.5">Perks</SectionHeader>
      <div class="flex flex-col gap-2.5">
        {(() => {
          const perkOwned = slayerPerks?.doubleQuantity === true
          const cost = 250
          const canAfford = slayerPoints >= cost
          const disabled = perkOwned || !canAfford
          return (
            <SkillActionRow
              icon={<span class="text-2xl">🗡️</span>}
              title="Slayer Multitask"
              meta="Doubles the number of monsters assigned by your Slayer Master."
              chip={perkOwned
                ? <span class="text-[var(--color-hp-green)]">Active</span>
                : <span class={canAfford ? '' : 'text-[var(--color-blood-light)]'}>{cost.toLocaleString()} pts</span>}
              disabled={disabled}
              onClick={() => {
                updateSlayerPoints(slayerPoints - cost)
                updateSlayerPerk('doubleQuantity', true)
                requestCriticalPushSave(() => getSnapshot(), CRITICAL_SAVE_REASONS.SLAYER_TASK_CHANGE)
                addToast('🗡️ Slayer Multitask unlocked!', 'info')
              }}
            />
          )
        })()}
      </div>

      {/* Master task info — lists every monster / boss this master can assign */}
      {infoMaster && (() => {
        const pool = infoMaster.monsterPool || []
        const bosses = pool.filter(entry => typeof entry === 'object' && !!entry.boss)
        const monsters = pool.filter(entry => !(typeof entry === 'object' && entry.boss))
        return (
          <Modal title={`${infoMaster.icon} ${infoMaster.name} — Tasks`} onClose={() => setInfoMaster(null)}>
            <p class="mb-3 text-[11px] text-[var(--color-parchment)] opacity-60 leading-relaxed">
              {infoMaster.name} can assign any of the following tasks. Greyed-out entries require a higher Slayer level before they can be assigned to you.
            </p>
            {monsters.length > 0 && (
              <>
                <SectionHeader size="sm" className="mb-2">Monsters</SectionHeader>
                <div class="flex flex-col gap-1.5 mb-4">
                  {monsters.map(entry => (
                    <SlayerTaskInfoRow key={typeof entry === 'object' ? entry.id : entry} entry={entry} slayerLevel={slayerLevel} />
                  ))}
                </div>
              </>
            )}
            {bosses.length > 0 && (
              <>
                <SectionHeader size="sm" className="mb-2">Bosses</SectionHeader>
                <div class="flex flex-col gap-1.5">
                  {bosses.map(entry => (
                    <SlayerTaskInfoRow key={typeof entry === 'object' ? entry.id : entry} entry={entry} slayerLevel={slayerLevel} />
                  ))}
                </div>
              </>
            )}
          </Modal>
        )
      })()}
    </div>
  )
}
