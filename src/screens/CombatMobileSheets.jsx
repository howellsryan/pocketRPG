import SkillEmblem from '../components/SkillEmblem.jsx'
import GameIcon from '../components/GameIcon.jsx'
import collectionLogData from '../data/collectionLog.json'
import { formatDropChance } from '../utils/constants.js'
import {
  getMonsterArt,
  getRaidArt,
  getStyleArt,
  getMonsterWeakness,
  getMonsterAttackStyles,
  getMonsterMaxHit,
} from '../utils/combatArt.js'

// Rarity colour bucket from a 0–1 drop chance (mirrors the design's tiers).
function rarityClass(chance) {
  if (chance >= 0.8) return 'common'
  if (chance >= 0.35) return 'uncommon'
  if (chance >= 0.12) return 'rare'
  return 'veryrare'
}

function qtyLabel(quantity) {
  if (Array.isArray(quantity)) {
    return quantity[0] === quantity[1] ? `${quantity[0]}` : `${quantity[0]}–${quantity[1]}`
  }
  return `${quantity}`
}

// Authoritative unique-item ids for a monster/raid section, sourced from the
// collection log (never inferred from drop rarity). Returns [{itemId}].
function loggedUniques(categoryId, sectionId) {
  const cat = collectionLogData.categories.find(c => c.id === categoryId)
  const section = cat?.sections.find(s => s.id === sectionId)
  return section?.items || []
}

// Chip for a structured multi-style descriptor (from getMonsterAttackStyles /
// getMonsterWeakness): one glyph per style and the descriptor's own colour
// (style colour for one, silver for two, gold for all three).
export function MultiStyleChip({ chip, prefix = '', kind }) {
  if (!chip) return null
  const { styles, label, color } = chip
  return (
    <span class="cb-stylechip" style={{ borderColor: `${color}73`, background: `${color}1a`, color }}>
      {styles.map(s => <GameIcon key={s} iconKey={getStyleArt(s).icon} color={color} size={14} />)}
      <span>{prefix}{label}</span>
      {kind && <span class="cb-stylechip__k">{kind}</span>}
    </span>
  )
}

function DropRow({ drop, itemsData, accent }) {
  const item = itemsData[drop.itemId]
  const key = item?.iconId || (item ? undefined : 'crossed_swords')
  return (
    <div class="cb-droprow">
      <div class="cb-droprow__l">
        <GameIcon item={item} iconKey={key} size={22} />
        <span class="cb-droprow__name">{item?.name || drop.itemId}</span>
      </div>
      <div class="cb-droprow__r">
        <span class={'cb-droprow__rate ' + rarityClass(drop.chance)}>{formatDropChance(drop.chance)}</span>
        <span class="cb-droprow__qty">{qtyLabel(drop.quantity)}</span>
      </div>
    </div>
  )
}

function UniquePanel({ items, itemsData, chanceLabel }) {
  if (!items || items.length === 0) return null
  return (
    <div class="cb-unique">
      <div class="cb-unique__head">
        <span class="cb-unique__spark">✦</span>
        <span>Unique Drops</span>
        {chanceLabel && <span class="cb-unique__chance">{chanceLabel}</span>}
      </div>
      <div class="cb-unique__grid">
        {items.map(itemId => {
          const item = itemsData[itemId]
          return (
            <div key={itemId} class="cb-unique__item">
              <GameIcon item={item} iconKey={item?.iconId} size={20} color="#f0c040" />
              <span>{item?.name || itemId}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Mobile monster bestiary sheet (slide-up). Desktop keeps the <Modal>. */
export function CombatMonsterInfoSheet({ monster, categoryKey, itemsData, onClose }) {
  const art = getMonsterArt(monster, categoryKey)
  const attackStyles = getMonsterAttackStyles(monster)
  const weakness = getMonsterWeakness(monster)
  const maxHit = getMonsterMaxHit(monster)
  const uniques = loggedUniques('monsters', monster.id)
  const regularDrops = (monster.drops || []).filter(d => !uniques.includes(d.itemId))

  const stats = [
    ['Combat', monster.combatLevel],
    ['Hitpoints', monster.hitpoints],
    ['Max Hit', maxHit],
    ['Attack', monster.stats.attack],
    ['Defence', monster.stats.defence],
    ['Strength', monster.stats.strength],
  ]

  return (
    <div class="cb-overlay" onClick={onClose}>
      <div class="cb-sheet" onClick={e => e.stopPropagation()}>
        <div class="cb-sheet__grab" />
        <div class="cb-sheet__hero">
          <div class="cb-sheet__emblem">
            <div class="cb-sheet__glow" style={{ background: `radial-gradient(circle, ${art.accent}8c, transparent 64%)` }} />
            <SkillEmblem iconKey={art.icon} accent={art.accent} size={56} glow={1.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 class="cb-sheet__name">{monster.name}</h2>
            <div class="cb-sheet__chips">
              <MultiStyleChip chip={attackStyles} prefix="Uses " />
              <MultiStyleChip chip={weakness} prefix="Weak: " kind="!" />
            </div>
          </div>
          <button class="cb-x" onClick={onClose} aria-label="Close"><GameIcon iconKey="cancel" color="#cdbf9f" size={16} /></button>
        </div>
        <div class="cb-sheet__scroll">
          <div class="cb-statgrid">
            {stats.map(([k, v]) => (
              <div key={k} class="cb-stat"><span class="cb-stat__k">{k}</span><span class="cb-stat__v">{v}</span></div>
            ))}
          </div>

          <div class="cb-sheet__sec">Defence Bonuses</div>
          <div class="cb-statgrid">
            {['stab', 'slash', 'crush', 'magic', 'ranged'].map(s => (
              <div key={s} class="cb-stat">
                <span class="cb-stat__k">{s}</span>
                <span class="cb-stat__v" style={{ color: (monster.defenceBonus?.[s] ?? 0) >= 0 ? '#7ce88a' : '#e8857e' }}>
                  {(monster.defenceBonus?.[s] ?? 0) >= 0 ? '+' : ''}{monster.defenceBonus?.[s] ?? 0}
                </span>
              </div>
            ))}
          </div>

          {regularDrops.length > 0 && (
            <>
              <div class="cb-sheet__sec">Drop Table</div>
              <div class="cb-drops">
                {regularDrops.map((d, i) => <DropRow key={i} drop={d} itemsData={itemsData} accent={art.accent} />)}
              </div>
            </>
          )}

          {uniques.length > 0 && (
            <>
              <div class="cb-sheet__sec">Collection Log</div>
              <UniquePanel items={uniques} itemsData={itemsData} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Mobile raid sheet (slide-up). Desktop keeps the <Modal>. */
export function CombatRaidInfoSheet({ raid, monstersData, itemsData, raidKillCounts, onStartRaid, onClose }) {
  const art = getRaidArt(raid.id)
  const kc = raidKillCounts?.[raid.id] || 0
  const uniques = loggedUniques('raids', raid.id)
  const alwaysDrops = raid.rewards?.always || []
  const uniqueChance = raid.rewards?.unique?.chance != null
    ? formatDropChance(raid.rewards.unique.chance) + ' chance'
    : null

  return (
    <div class="cb-overlay" onClick={onClose}>
      <div class="cb-sheet cb-sheet--raid" onClick={e => e.stopPropagation()}>
        <div class="cb-sheet__grab" />
        <div class="cb-sheet__hero">
          <div class="cb-sheet__emblem">
            <div class="cb-sheet__glow" style={{ background: `radial-gradient(circle, ${art.accent}8c, transparent 64%)` }} />
            <SkillEmblem iconKey={art.icon} accent={art.accent} size={56} glow={1.3} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div class="cb-raid__tag">RAID</div>
            <h2 class="cb-sheet__name">{raid.name}</h2>
            <div class="cb-sheet__sub">{raid.bosses.length} chambers</div>
          </div>
          <button class="cb-x" onClick={onClose} aria-label="Close"><GameIcon iconKey="cancel" color="#cdbf9f" size={16} /></button>
        </div>
        <div class="cb-sheet__scroll">
          <p class="cb-idledesc" style={{ margin: '0 2px 8px' }}>{raid.description}</p>

          <div class="cb-raid__times">
            <div class="cb-raid__time"><span class="cb-raid__tk">Completions</span><span class="cb-raid__tv gold">{kc.toLocaleString()}</span></div>
          </div>

          <div class="cb-sheet__sec">Chambers</div>
          <div class="cb-rooms">
            {raid.bosses.map((bossId, i) => {
              const boss = monstersData[bossId]
              if (!boss) return null
              const cleared = kc > 0
              return (
                <div key={bossId} class={'cb-room' + (cleared ? ' is-clear' : '')}>
                  <div class="cb-room__rail">
                    <span class="cb-room__dot" />
                    {i < raid.bosses.length - 1 && <span class="cb-room__line" />}
                  </div>
                  <div class="cb-room__icon">
                    <SkillEmblem iconKey={getMonsterArt(boss).icon} accent={art.accent} size={26} glow={cleared ? 1 : 0.5} />
                  </div>
                  <div class="cb-room__body">
                    <div class="cb-room__name">{i + 1}. {boss.name}</div>
                    <div class="cb-room__boss">HP {boss.hitpoints} · CB {boss.combatLevel}</div>
                  </div>
                  <div class="cb-room__right">
                    <MultiStyleChip chip={getMonsterAttackStyles(boss)} />
                  </div>
                </div>
              )
            })}
          </div>

          {alwaysDrops.length > 0 && (
            <>
              <div class="cb-sheet__sec">Reward Table</div>
              <div class="cb-drops">
                {alwaysDrops.map((d, i) => <DropRow key={i} drop={d} itemsData={itemsData} accent={art.accent} />)}
              </div>
            </>
          )}

          {uniques.length > 0 && (
            <>
              <div class="cb-sheet__sec">Unique Rewards</div>
              <UniquePanel items={uniques} itemsData={itemsData} chanceLabel={uniqueChance} />
            </>
          )}
        </div>
        <button class="cb-raid__enter" onClick={() => onStartRaid(raid)}>Enter Raid</button>
      </div>
    </div>
  )
}
