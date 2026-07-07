import { useState } from 'preact/hooks'
import BackLink from '../components/BackLink.jsx'
import SectionHeader from '../components/SectionHeader.jsx'
import GameIcon from '../components/GameIcon.jsx'
import SkillEmblem from '../components/SkillEmblem.jsx'
import Modal from '../components/Modal.jsx'
import monstersData from '../data/monsters.json'
import raidsData from '../data/raids.json'
import placeMapsData from '../data/placeMaps.json'
import { getMonsterArt, getCategoryArt } from '../utils/combatArt.js'
import { getPlace } from '../engine/world.js'
import { COMBAT_CATEGORIES } from './CombatScreen.jsx'

// Monster/raid locations are derived from the world map's own "combat"/"raid"
// spots (placeMaps.json) rather than a separately authored table, so they can
// never drift out of sync with where the world map actually sends players.
function buildLocationIndex() {
  const byMonster = {}
  const raidPlace = {}
  for (const [placeId, place] of Object.entries(placeMapsData)) {
    for (const spot of place.spots || []) {
      if (spot.kind === 'combat' && spot.ref) {
        (byMonster[spot.ref] ||= new Set()).add(placeId)
      } else if (spot.kind === 'raid' && spot.ref) {
        raidPlace[spot.ref] = placeId
      }
    }
  }
  return { byMonster, raidPlace }
}
const { byMonster: MONSTER_PLACES, raidPlace: RAID_PLACES } = buildLocationIndex()

// Raid encounter monsters (Theatre/Chambers/Barrows/Tombs-style bosses) have no
// standalone world-map spot of their own — they're only reachable by entering
// the raid, so their "location" is the raid's entry place instead.
function raidFor(monsterId) {
  return Object.values(raidsData).find(r => r.bosses?.includes(monsterId) && RAID_PLACES[r.id])
}

function locationLabel(monster) {
  const places = MONSTER_PLACES[monster.id]
  if (places?.size) return [...places].map(id => getPlace(id)?.name || id).join(' · ')
  const raid = raidFor(monster.id)
  if (raid) {
    const placeName = getPlace(RAID_PLACES[raid.id])?.name
    return placeName ? `${raid.name} (via ${placeName})` : raid.name
  }
  return 'Unknown'
}

// COMBAT_CATEGORIES only lists overworld/dungeon monsters; raid bosses are
// grouped in here separately so every monster in the game shows up somewhere.
// Static data (no props/state involved) — built once at module load.
function buildCategories() {
  const cats = COMBAT_CATEGORIES.map(cat => ({
    key: cat.key,
    label: cat.label,
    monsters: cat.ids.map(id => monstersData[id]).filter(Boolean)
      .sort((a, b) => a.combatLevel - b.combatLevel),
  }))
  const seenRaidNames = new Set()
  for (const raid of Object.values(raidsData)) {
    if (seenRaidNames.has(raid.name) || !RAID_PLACES[raid.id]) continue
    const monsters = (raid.bosses || []).map(id => monstersData[id]).filter(Boolean)
    if (!monsters.length) continue
    seenRaidNames.add(raid.name)
    cats.push({ key: `raid_${raid.id}`, label: raid.name, monsters })
  }
  return cats.filter(cat => cat.monsters.length > 0)
}
const BESTIARY_CATEGORIES = buildCategories()

export default function BestiaryScreen({ onBack }) {
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(BESTIARY_CATEGORIES.map(cat => [cat.key, true])))
  const [selected, setSelected] = useState(null)
  const categories = BESTIARY_CATEGORIES

  const toggle = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="px-4 pt-4 pb-2 flex-shrink-0">
        <BackLink onClick={onBack} className="mb-3" />
        <h1 class="flex items-center gap-2 font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">
          <GameIcon iconKey="dragon_head" size={22} class="flex-shrink-0" />
          Bestiary
        </h1>
        <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mt-[2px]">
          Every foe in Eldermoor, and where to find them.
        </p>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {categories.map(cat => {
          const isCollapsed = collapsed[cat.key] ?? true
          const categoryArt = getCategoryArt(cat.key)
          return (
            <div key={cat.key}>
              <button
                type="button"
                onClick={() => toggle(cat.key)}
                class="w-full flex items-center gap-2 mb-2 px-1 py-1 text-left rounded-lg active:bg-[var(--color-void-light)]"
              >
                <SkillEmblem iconKey={categoryArt.icon} accent={categoryArt.accent} size={22} glow={0} />
                <span class="flex-1 text-[13px] font-semibold text-[var(--color-parchment)]">{cat.label}</span>
                <span class="text-[11px] text-[var(--color-parchment)] opacity-40">{cat.monsters.length}</span>
                <span class="text-[var(--color-parchment)] opacity-40">{isCollapsed ? '▸' : '▾'}</span>
              </button>
              {!isCollapsed && (
                <div class="flex flex-col gap-1.5">
                  {cat.monsters.map(monster => {
                    const art = getMonsterArt(monster, cat.key)
                    return (
                      <button
                        key={monster.id}
                        type="button"
                        onClick={() => setSelected(monster)}
                        class="flex items-center gap-3 w-full min-h-[48px] px-2 rounded-xl bg-[var(--color-void-light)] border border-[var(--color-void-border)] text-left active:opacity-70"
                      >
                        <SkillEmblem iconKey={art.icon} accent={art.accent} size={32} glow={0} />
                        <div class="flex-1 min-w-0">
                          <div class="text-[13px] font-semibold text-[var(--color-parchment)] truncate">{monster.name}</div>
                          <div class="text-[10px] text-[var(--color-parchment)] opacity-50 truncate">
                            📍 {locationLabel(monster)}
                          </div>
                        </div>
                        <span class="text-[11px] font-[var(--font-mono)] text-[var(--color-gold)] flex-shrink-0">Lvl {monster.combatLevel}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div class="flex items-center gap-2 mb-3">
            <SkillEmblem iconKey={getMonsterArt(selected).icon} accent={getMonsterArt(selected).accent} size={32} glow={0} />
            <div class="text-[12px] text-[var(--color-parchment)] opacity-70">
              📍 <span class="text-[var(--color-gold)]">{locationLabel(selected)}</span>
            </div>
          </div>
          <SectionHeader size="sm" className="mb-2">Stats</SectionHeader>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[var(--color-parchment)]">
            <div class="flex justify-between"><span class="opacity-60">Combat Level</span><span class="font-[var(--font-mono)] text-[var(--color-gold)]">{selected.combatLevel}</span></div>
            <div class="flex justify-between"><span class="opacity-60">HP</span><span class="font-[var(--font-mono)] text-[var(--color-hp-green)]">{selected.hitpoints}</span></div>
            <div class="flex justify-between"><span class="opacity-60">Attack</span><span class="font-[var(--font-mono)]">{selected.stats?.attack}</span></div>
            <div class="flex justify-between"><span class="opacity-60">Strength</span><span class="font-[var(--font-mono)]">{selected.stats?.strength}</span></div>
            <div class="flex justify-between"><span class="opacity-60">Defence</span><span class="font-[var(--font-mono)]">{selected.stats?.defence}</span></div>
            <div class="flex justify-between"><span class="opacity-60">Magic</span><span class="font-[var(--font-mono)]">{selected.stats?.magic}</span></div>
            <div class="flex justify-between"><span class="opacity-60">Ranged</span><span class="font-[var(--font-mono)]">{selected.stats?.ranged}</span></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
