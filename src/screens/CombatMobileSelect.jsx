import SkillEmblem from '../components/SkillEmblem.jsx'
import GameIcon from '../components/GameIcon.jsx'
import { getMonsterArt, getCategoryArt, getRaidArt } from '../utils/combatArt.js'
import { getSkillArt } from '../utils/skillArt.js'

// Mobile section display order (desktop keeps the COMBAT_CATEGORIES order).
// Categories and raids are interleaved per design; PvP renders last.
const MOBILE_CATEGORY_ORDER = [
  'training', 'slayer', 'dragons_lair', 'sunken_crypts', 'ashveil_highlands',
  'ironhold_fortress', 'verdant_wilds', 'wilderness', 'dagganoth_kings',
  'bossing', 'venomcoil_matriarch', 'blighted_gauntlet', 'fight_caves',
]
const MOBILE_RAID_ORDER = ['cryptbound_champions', 'vaults_of_xyren', 'crimson_night_theatre']

function orderBy(order, keyOf) {
  return (a, b) => {
    const ia = order.indexOf(keyOf(a))
    const ib = order.indexOf(keyOf(b))
    // Unlisted keys fall to the end, preserving their relative order.
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib)
  }
}

/**
 * Artsy mobile monster / raid select screen for combat.
 *
 * Mobile-only: rendered in CombatScreen's picker when the desktop combat layout
 * is NOT active. Desktop keeps its own responsive grid untouched. All gameplay
 * handlers (start fight/raid, info, locks, slayer/KC, idle setup, stance, PvP)
 * are passed in so this component stays purely presentational.
 */
export default function CombatMobileSelect({
  categories,
  monstersData,
  raidsData,
  collapsedSections,
  onToggleSection,
  onFight,
  onMonsterInfo,
  onStartRaid,
  onRaidInfo,
  checkBossRequirements,
  checkRaidRequirements,
  getSlayerLevel,
  doesSlayerTaskMatchMonster,
  slayerTask,
  bossKillCounts,
  raidKillCounts,
  combatStance,
  onStance,
  idleSetup,
  onOpenIdle,
  showPvp,
  onOpenPvp,
}) {
  const slayerLevel = getSlayerLevel()

  const sortedMonsters = (category) =>
    category.ids
      .map(id => monstersData[id])
      .filter(Boolean)
      .sort((a, b) =>
        category.key === 'slayer'
          ? (a.slayerRequirement || 0) - (b.slayerRequirement || 0)
          : a.combatLevel - b.combatLevel)

  const totalFoes = categories.reduce((sum, c) => sum + sortedMonsters(c).length, 0)
  const orderedCategories = [...categories].sort(orderBy(MOBILE_CATEGORY_ORDER, c => c.key))
  const uniqueRaids = Object.values(raidsData)
    .filter((raid, i, all) => all.findIndex(r => r.id === raid.id) === i)
    .sort(orderBy(MOBILE_RAID_ORDER, r => r.id))

  const idleToggles = [
    { id: 'food', label: 'Idle Eat', icon: 'meat', on: idleSetup?.food?.length > 0 },
    {
      id: 'prayer', label: 'Idle Pray', icon: 'prayer',
      on: !!(idleSetup?.prayers?.protectionPrayerId || idleSetup?.prayers?.combatPrayerId),
    },
    { id: 'potion', label: 'Idle Potion', icon: 'potion_ball', on: idleSetup?.potions?.length > 0 },
  ]

  return (
    <div class="cb-pad">
      <div class="cb-select__head" style={{ margin: '4px 2px 14px' }}>
        <h1 class="cb-h1">Choose a Foe</h1>
        <div class="cb-h1sub">{totalFoes} monsters · {uniqueRaids.length} {uniqueRaids.length === 1 ? 'raid' : 'raids'} await</div>
      </div>

      {/* Idle toggles */}
      <div class="cb-idlerow">
        {idleToggles.map(t => (
          <button key={t.id} class={'cb-idle' + (t.on ? ' is-on' : '')} onClick={() => onOpenIdle(t.id)}>
            <GameIcon iconKey={t.icon} color={t.on ? '#7ce88a' : '#9b978c'} size={17} />
            <span>{t.label}</span>
            {t.on && <GameIcon class="cb-idle__chk" iconKey="check_mark" color="#7ce88a" size={13} />}
          </button>
        ))}
      </div>

      {/* Attack-style selector */}
      <div class="cb-styles">
        {[['accurate', 'attack'], ['aggressive', 'strength'], ['defensive', 'defence']].map(([s, skill]) => {
          const art = getSkillArt(skill)
          return (
            <button key={s} class={'cb-styleseg' + (combatStance === s ? ' is-on' : '')} onClick={() => onStance(s)}>
              <GameIcon iconKey={art.icon} color={art.accent} size={15} />
              <span style={{ textTransform: 'capitalize' }}>{s}</span>
            </button>
          )
        })}
      </div>

      {/* Area list */}
      <div class="cb-arealist">
        {orderedCategories.map(category => {
          const monsters = sortedMonsters(category)
          const isCollapsed = collapsedSections[category.key] ?? true
          const art = getCategoryArt(category.key)
          const empty = monsters.length === 0
          return (
            <div key={category.key} class={'cb-area' + (!isCollapsed ? ' is-open' : '')}>
              <button class="cb-area__head" onClick={() => onToggleSection(category.key)} disabled={empty}>
                <div class="cb-area__glow" style={{ background: `radial-gradient(circle, ${art.accent}, transparent 66%)` }} />
                <div class="cb-area__icon"><SkillEmblem iconKey={art.icon} accent={art.accent} size={30} glow={0.95} /></div>
                <div class="cb-area__txt">
                  <div class="cb-area__name">{category.label}</div>
                  <div class="cb-area__blurb">{empty ? 'Coming soon' : art.blurb}</div>
                </div>
                {!empty && <span class="cb-area__count">{monsters.length}</span>}
                <span class="cb-area__chev"><span class={'cb-chev' + (!isCollapsed ? ' down' : '')} /></span>
              </button>
              {!isCollapsed && !empty && (
                <div class="cb-area__list">
                  {monsters.map(monster => {
                    const slayReq = monster.slayerRequirement
                    const slayLocked = slayReq && slayerLevel < slayReq
                    const bossReq = checkBossRequirements(monster)
                    const isLocked = slayLocked || bossReq.locked
                    const isOnTask = doesSlayerTaskMatchMonster(slayerTask?.monsterId, monster.id)
                    const mArt = getMonsterArt(monster, category.key)
                    const lockText = slayLocked
                      ? `Slayer ${slayReq}`
                      : bossReq.locked ? bossReq.reason
                      : null
                    return (
                      <div
                        key={monster.id}
                        class={'cb-mon' + (isLocked ? ' cb-mon--locked' : '') + (isOnTask ? ' cb-mon--task' : '')}
                        onClick={() => !isLocked && onFight(monster)}
                        title={isLocked && bossReq.locked ? bossReq.reason : ''}
                      >
                        <div class="cb-mon__art"><SkillEmblem iconKey={mArt.icon} accent={mArt.accent} size={42} glow={0.95} /></div>
                        <div class="cb-mon__body">
                          <div class="cb-mon__name">
                            {monster.name}
                            {isOnTask && <span class="cb-mon__tasktag">TASK</span>}
                          </div>
                          <div class="cb-mon__stats">
                            <span>HP {monster.hitpoints}</span><i /><span>Att {monster.stats.attack}</span><i /><span>Def {monster.stats.defence}</span>
                          </div>
                          {lockText && <div class="cb-mon__lock">🔒 {lockText}</div>}
                        </div>
                        <div class="cb-mon__meta">
                          <span class="cb-mon__cb">CB {monster.combatLevel}</span>
                          {isOnTask && <span class="cb-mon__kc">{slayerTask.monstersRemaining} left</span>}
                          {monster.boss && bossKillCounts[monster.id] > 0 && (
                            <span class="cb-mon__kc">KC {bossKillCounts[monster.id].toLocaleString()}</span>
                          )}
                        </div>
                        <button
                          class="cb-mon__info"
                          onClick={(e) => { e.stopPropagation(); onMonsterInfo(monster) }}
                          aria-label={`${monster.name} info`}
                        >
                          <GameIcon iconKey="info" color="#f0c040" size={18} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Raids */}
        {uniqueRaids.map(raid => {
          const raidReq = checkRaidRequirements(raid)
          const isLocked = raidReq.locked
          const art = getRaidArt(raid.id)
          return (
            <div
              key={raid.id}
              class={'cb-area cb-area--raid' + (isLocked ? ' cb-area--locked' : '')}
              onClick={() => !isLocked && onStartRaid(raid)}
              title={isLocked ? raidReq.reason : ''}
            >
              <div class="cb-area__head" role="button">
                <div class="cb-area__glow" style={{ background: `radial-gradient(circle, ${art.accent}, transparent 66%)` }} />
                <div class="cb-area__icon"><SkillEmblem iconKey={art.icon} accent={art.accent} size={30} glow={0.95} /></div>
                <div class="cb-area__txt">
                  <div class="cb-area__name">{raid.name}</div>
                  <div class="cb-area__blurb">{isLocked ? '🔒 ' + raidReq.reason : raid.description}</div>
                </div>
                {raidKillCounts[raid.id] > 0 && <span class="cb-mon__kc">KC {raidKillCounts[raid.id].toLocaleString()}</span>}
                <span class="cb-area__raidtag">RAID</span>
                <button
                  class="cb-mon__info"
                  onClick={(e) => { e.stopPropagation(); onRaidInfo(raid) }}
                  aria-label={`${raid.name} info`}
                >
                  <GameIcon iconKey="info" color="#c9b6ff" size={18} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* PvP entry — hidden for ironman / one-life accounts */}
      {showPvp && (
        <button class="cb-raid__enter" style={{ marginTop: 18, background: 'linear-gradient(180deg,#c0392b,#8b1a1a)', color: 'var(--color-parchment)' }} onClick={onOpenPvp}>
          ⚔ Player vs Player
        </button>
      )}
    </div>
  )
}
