import { useState } from 'preact/hooks'
import SkillEmblem from '../components/SkillEmblem.jsx'
import GameIcon from '../components/GameIcon.jsx'
import collectionLogData from '../data/collectionLog.json'
import { formatDropChance } from '../utils/constants.js'
import { getMonsterSeedDrops } from '../engine/seedDrops.js'
import { getMonsterCharmDrops } from '../engine/summoning.js'
import {
  getMonsterArt,
  getRaidArt,
  getStyleArt,
  getMonsterWeakness,
  getMonsterAttackStyles,
  getMonsterMaxHitLabel,
  getMonsterLocationLabel,
  getMonsterAddInfo,
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
        <GameIcon item={item} iconKey={key} size={44} />
        <span class="cb-droprow__name">{item?.name || drop.itemId}</span>
      </div>
      <div class="cb-droprow__r">
        <span class={'cb-droprow__rate ' + rarityClass(drop.chance)}>
          {formatDropChance(drop.chance)}{drop.taskOnly ? ' · task only' : ''}
        </span>
        <span class="cb-droprow__qty">{qtyLabel(drop.quantity)}</span>
      </div>
    </div>
  )
}

function UniquePanel({ items, itemsData, sharedChance, drops }) {
  if (!items || items.length === 0) return null
  const [showRates, setShowRates] = useState(false)
  // Per-unique drop rate sourced from the monster's drop table (when supplied).
  const chanceById = {}
  for (const d of (drops || [])) chanceById[d.itemId] = d.chance
  const hasRates = (drops || []).length > 0
  return (
    <div class="cb-unique">
      <div class="cb-unique__head">
        <span class="cb-unique__spark">✦</span>
        <span>Unique Drops</span>
        {hasRates && (
          <button class="cb-unique__info" onClick={() => setShowRates(true)} aria-label="View drop rates">
            <GameIcon iconKey="info" color="var(--accent)" size={16} />
          </button>
        )}
      </div>
      <div class="cb-unique__grid">
        {items.map(itemId => {
          const item = itemsData[itemId]
          return (
            <div key={itemId} class="cb-unique__item">
              <GameIcon item={item} iconKey={item?.iconId} size={40} color="#f0c040" />
              <span>{item?.name || itemId}</span>
            </div>
          )
        })}
      </div>

      {showRates && (
        <div class="cb-rates-overlay" onClick={() => setShowRates(false)}>
          <div class="cb-rates" onClick={e => e.stopPropagation()}>
            <div class="cb-rates__head">
              <span>Drop Rates</span>
              <button class="cb-x" onClick={() => setShowRates(false)} aria-label="Close">
                <GameIcon iconKey="cancel" color="var(--text-soft)" size={14} />
              </button>
            </div>
            {sharedChance != null && (
              <div class="cb-rates__note">Any unique: {formatDropChance(sharedChance)}</div>
            )}
            <div class="cb-rates__list">
              {items.map(itemId => {
                const item = itemsData[itemId]
                const chance = chanceById[itemId]
                const taskOnly = (drops || []).find(d => d.itemId === itemId)?.taskOnly
                return (
                  <div key={itemId} class="cb-rates__row">
                    <div class="cb-rates__l">
                      <GameIcon item={item} iconKey={item?.iconId} size={40} color="#f0c040" />
                      <span>{item?.name || itemId}</span>
                    </div>
                    {chance != null && (
                      <span class="cb-rates__rate">
                        {formatDropChance(chance)}{taskOnly ? ' · task only' : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Mobile monster bestiary sheet (slide-up). Desktop keeps the <Modal>. */
export function CombatMonsterInfoSheet({ monster, categoryKey, itemsData, onClose }) {
  const art = getMonsterArt(monster, categoryKey)
  const attackStyles = getMonsterAttackStyles(monster)
  const weakness = getMonsterWeakness(monster)
  const maxHit = getMonsterMaxHitLabel(monster)
  const uniques = loggedUniques('monsters', monster.id)
  const addInfo = getMonsterAddInfo(monster)
  const regularDrops = [
    ...(monster.drops || []).filter(d => !uniques.includes(d.itemId)),
    ...getMonsterSeedDrops(monster),
    ...getMonsterCharmDrops(monster),
  ]
  const location = getMonsterLocationLabel(monster)

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
            <SkillEmblem iconKey={art.icon} accent={art.accent} size={56} glow={0} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 class="cb-sheet__name">{monster.name}</h2>
            <div class="cb-sheet__chips">
              <MultiStyleChip chip={attackStyles} prefix="Uses " />
              <MultiStyleChip chip={weakness} prefix="Weak: " kind="!" />
            </div>
          </div>
          <button class="cb-x" onClick={onClose} aria-label="Close"><GameIcon iconKey="cancel" color="var(--text-soft)" size={16} /></button>
        </div>
        <div class="cb-sheet__scroll">
          {location && <div class="cb-mon__location" style={{ marginBottom: '8px' }}>📍 {location}</div>}
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
                <span class="cb-stat__v" style={{ color: (monster.defenceBonus?.[s] ?? 0) >= 0 ? '#2e7d32' : '#a93226' }}>
                  {(monster.defenceBonus?.[s] ?? 0) >= 0 ? '+' : ''}{monster.defenceBonus?.[s] ?? 0}
                </span>
              </div>
            ))}
          </div>

          {monster.multiForm && monster.forms && (
            <>
              <div class="cb-sheet__sec">Phases</div>
              <div class="cb-phases">
                {Object.entries(monster.forms).map(([formKey, form]) => (
                  <div key={formKey} class="cb-phase">
                    <div class="cb-phase__head">
                      <span class="cb-phase__name" style={{ color: getStyleArt(form.attackStyle).color }}>
                        {form.icon} {form.displayName || formKey}
                      </span>
                      <span class="cb-phase__maxhit">Max Hit {form.maxHit ?? '—'}</span>
                    </div>
                    <div class="cb-phase__bonuses">
                      <span>ATK <span class="cb-phase__v">{form.attackBonus ?? 0}</span></span>
                      <span>STR <span class="cb-phase__v">{form.strengthBonus ?? 0}</span></span>
                    </div>
                    <div class="cb-statgrid cb-statgrid--tight">
                      {['stab', 'slash', 'crush', 'magic', 'ranged'].map(s => (
                        <div key={s} class="cb-stat">
                          <span class="cb-stat__k">{s}</span>
                          <span class="cb-stat__v" style={{ color: (form.defenceBonus?.[s] ?? 0) >= 0 ? '#2e7d32' : '#a93226' }}>
                            {(form.defenceBonus?.[s] ?? 0) >= 0 ? '+' : ''}{form.defenceBonus?.[s] ?? 0}
                          </span>
                        </div>
                      ))}
                    </div>
                    {form.weakness && <div class="cb-phase__weak">Weak to: {form.weakness}</div>}
                  </div>
                ))}
              </div>
            </>
          )}

          {addInfo && (
            <>
              <div class="cb-sheet__sec">Summoned</div>
              <div class="cb-phases">
                <div class="cb-phase">
                  <div class="cb-phase__head">
                    <span class="cb-phase__name" style={{ color: getStyleArt(addInfo.add.attackStyle).color }}>
                      {addInfo.add.icon ? `${addInfo.add.icon} ` : ''}{addInfo.add.name}
                    </span>
                    <span class="cb-phase__maxhit">Max Hit {addInfo.maxHit}</span>
                  </div>
                  <div class="cb-phase__bonuses">
                    <span>CB <span class="cb-phase__v">{addInfo.add.combatLevel}</span></span>
                    <span>HP <span class="cb-phase__v">{addInfo.add.hitpoints}</span></span>
                    <span>ATK <span class="cb-phase__v">{addInfo.add.attackBonus ?? 0}</span></span>
                  </div>
                  <div class="cb-statgrid cb-statgrid--tight">
                    {['stab', 'slash', 'crush', 'magic', 'ranged'].map(s => (
                      <div key={s} class="cb-stat">
                        <span class="cb-stat__k">{s}</span>
                        <span class="cb-stat__v" style={{ color: (addInfo.add.defenceBonus?.[s] ?? 0) >= 0 ? '#2e7d32' : '#a93226' }}>
                          {(addInfo.add.defenceBonus?.[s] ?? 0) >= 0 ? '+' : ''}{addInfo.add.defenceBonus?.[s] ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                  {addInfo.add.weakness && <div class="cb-phase__weak">Weak to: {addInfo.add.weakness}</div>}
                  {addInfo.spawnLabel && <div class="cb-phase__note">{addInfo.spawnLabel}</div>}
                </div>
              </div>
            </>
          )}

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
              <UniquePanel items={uniques} itemsData={itemsData} drops={monster.drops} />
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
  const uniqueChance = raid.rewards?.unique?.chance ?? null

  return (
    <div class="cb-overlay" onClick={onClose}>
      <div class="cb-sheet cb-sheet--raid" onClick={e => e.stopPropagation()}>
        <div class="cb-sheet__grab" />
        <div class="cb-sheet__hero">
          <div class="cb-sheet__emblem">
            <SkillEmblem iconKey={art.icon} accent={art.accent} size={56} glow={0} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div class="cb-raid__tag">RAID</div>
            <h2 class="cb-sheet__name">{raid.name}</h2>
            <div class="cb-sheet__sub">{raid.bosses.length} chambers</div>
          </div>
          <button class="cb-x" onClick={onClose} aria-label="Close"><GameIcon iconKey="cancel" color="var(--text-soft)" size={16} /></button>
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
                    <SkillEmblem iconKey={getMonsterArt(boss).icon} accent={art.accent} size={26} glow={0} />
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
              <UniquePanel items={uniques} itemsData={itemsData} sharedChance={uniqueChance} />
            </>
          )}
        </div>
        <button class="cb-raid__enter" onClick={() => onStartRaid(raid)}>Enter Raid</button>
      </div>
    </div>
  )
}
