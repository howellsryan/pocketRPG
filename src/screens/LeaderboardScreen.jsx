import { useState, useEffect } from 'preact/hooks'
import Card from '../components/Card.jsx'
import FilterToggleBar from '../components/FilterToggleBar.jsx'
import GameIcon from '../components/GameIcon.jsx'
import GildedComplete from '../components/GildedComplete.jsx'
import Pagination from '../components/Pagination.jsx'
import { formatNumber } from '../utils/helpers.js'
import { isMaxedTotal } from '../utils/completion.js'
import { getLeaderboardFilters, getLeaderboardFilterById } from '../engine/leaderboardFilters.js'
import { getRaidArt, getMonsterArt } from '../utils/combatArt.js'

const LEADERBOARD_FILTERS = getLeaderboardFilters()
const PAGE_SIZE = 50

// Minimal item shells so GameIcon resolves the full-helm glyph (crested_helmet)
// with the right tier tint — iron (grey) for Ironman, dragon (red) for accounts
// that are both Ironman and One Life. No need to pull in the full items.json.
const IRON_HELM_ITEM = { id: 'iron_full_helm', slot: 'head', type: 'armour', name: 'Iron Full Helm' }
const DRAGON_HELM_ITEM = { id: 'dragon_full_helm', slot: 'head', type: 'armour', name: 'Dragon Full Helm' }

// Resolve a game-icons glyph for each filter chip so none render blank/wrong:
// total → the progression (total level) icon, raids → their raid art, bosses →
// their monster art (falls back to crossed swords for any un-arted boss).
function filterIconKey(f) {
  if (!f) return null
  if (f.type === 'total') return 'progression'
  if (f.type === 'ironman') return null // rendered via the iron-tinted item icon
  if (f.sourceType === 'raids') return getRaidArt(f.sourceId).icon
  if (f.sourceType === 'monsters') return getMonsterArt({ id: f.sourceId }).icon
  return null
}

const LEADERBOARD_FILTER_OPTIONS = LEADERBOARD_FILTERS.map(f => ({
  id: f.id,
  label: f.label,
  iconKey: filterIconKey(f),
  icon: f.icon || null,
  item: f.type === 'ironman' ? IRON_HELM_ITEM : null,
}))

function buildLeaderboardUrl(filter, page, pageSize) {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) })
  if (!filter || filter.type === 'total') return `/api/leaderboard?${params}`
  if (filter.type === 'ironman') { params.set('metric', 'ironman'); return `/api/leaderboard?${params}` }
  params.set('metric', 'kc')
  params.set('source_type', filter.sourceType)
  params.set('source_id', filter.sourceId)
  return `/api/leaderboard?${params}`
}

function LeaderboardRow({ rank, char, metric }) {
  const isKc = metric === 'kc'
  const primaryValue = isKc ? char.killCount : char.totalLevel
  const primaryLabel = isKc ? 'Kill Count' : 'Total Level'
  // Maxed accounts (every skill at 99) get the gilded completion treatment on
  // the total-level board, matching the skills/collection-log gold tint.
  const maxed = !isKc && isMaxedTotal(char.totalLevel)
  return (
    <GildedComplete complete={maxed} className="rounded-xl">
      <Card className="p-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3 flex-1">
            <div class="text-lg font-semibold text-[var(--color-gold)] min-w-[2rem]">#{rank}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-sm font-semibold text-[var(--color-parchment)] min-w-0">
                {char.isIronman && char.isOneLife ? (
                  <GameIcon item={DRAGON_HELM_ITEM} size={26} class="flex-shrink-0" title="Ironman · One Life" />
                ) : char.isIronman ? (
                  <GameIcon item={IRON_HELM_ITEM} size={26} class="flex-shrink-0" title="Ironman" />
                ) : char.isOneLife ? (
                  <span class="flex-shrink-0 text-xl leading-none" title="One Life">☠️</span>
                ) : null}
                <span class="truncate">{char.username}</span>
              </div>
            </div>
          </div>
          <div class="text-right flex-shrink-0 ml-2">
            <div class="text-sm font-semibold text-[var(--color-gold)]">{formatNumber(primaryValue ?? 0)}</div>
            <div class="text-[10px] text-[var(--color-parchment)] opacity-60">{primaryLabel}</div>
            <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-blood-light)] mt-1">
              Combat {formatNumber(char.combatLevel ?? 3)}
            </div>
          </div>
        </div>
      </Card>
    </GildedComplete>
  )
}

// `onBack` (from App): returns to the screen the player came from.
export default function LeaderboardScreen({ onBack }) {
  const [filterId, setFilterId] = useState('total')
  const [page, setPage] = useState(0)
  const [characters, setCharacters] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const filter = getLeaderboardFilterById(filterId) || LEADERBOARD_FILTERS[0]
  const metric = filter.type === 'kc' ? 'kc' : 'total'
  const offset = page * PAGE_SIZE
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 0

  useEffect(() => {
    let cancelled = false
    async function fetchLeaderboard() {
      try {
        setLoading(true)
        const res = await fetch(buildLeaderboardUrl(filter, page, PAGE_SIZE))
        if (!res.ok) throw new Error('Failed to fetch leaderboard')
        const data = await res.json()
        if (cancelled) return
        setCharacters(data.characters || [])
        setTotal(data.pagination?.total ?? 0)
        setError(null)
      } catch (err) {
        if (cancelled) return
        console.error('Leaderboard fetch error:', err)
        setError(err.message || 'Failed to load leaderboard')
        setCharacters([])
        setTotal(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchLeaderboard()
    return () => { cancelled = true }
  }, [filterId, page])

  function handleFilterChange(id) {
    setFilterId(id)
    setPage(0)
  }

  const emptyText = metric === 'kc' ? 'No kills recorded yet' : 'No characters found'

  return (
    <div class="forge-shell h-full flex flex-col">
      <div class="flex-shrink-0 bg-[var(--color-void-light)] border-b border-[var(--color-void-border)] px-4 py-3">
        <div class="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back"
              class="flex-shrink-0 w-11 h-11 -my-2 -ml-2 flex items-center justify-center gap-1 text-[var(--color-gold)] bg-transparent border-0 cursor-pointer active:opacity-70"
            >
              <span class="text-xl leading-none">← Back</span>
            </button>
          )}
          <h1 class="flex items-center gap-2 font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">
            <GameIcon iconKey="progression" size={22} class="flex-shrink-0" />
            Leaderboard
          </h1>
        </div>
        <div class="mt-2">
          <FilterToggleBar options={LEADERBOARD_FILTER_OPTIONS} value={filterId} onChange={handleFilterChange} />
        </div>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">Loading leaderboard...</div>
        )}
        {error && !loading && (
          <div class="text-center py-4 text-[#e57373] text-sm">Error: {error}</div>
        )}
        {!loading && !error && characters.length === 0 && (
          <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">{emptyText}</div>
        )}
        {!loading && !error && characters.length > 0 && (
          <div class="space-y-2">
            {characters.map((char, idx) => (
              <LeaderboardRow key={`${filterId}:${page}:${idx}`} rank={offset + idx + 1} char={char} metric={metric} />
            ))}
          </div>
        )}
        {!loading && !error && (
          <Pagination page={page} totalPages={totalPages} totalCount={total} onPageChange={setPage} />
        )}
      </div>
    </div>
  )
}
