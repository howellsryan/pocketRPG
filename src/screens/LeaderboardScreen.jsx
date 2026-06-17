import { useState, useEffect } from 'preact/hooks'
import Card from '../components/Card.jsx'
import FilterToggleBar from '../components/FilterToggleBar.jsx'
import GildedComplete from '../components/GildedComplete.jsx'
import { formatNumber } from '../utils/helpers.js'
import { isMaxedTotal } from '../utils/completion.js'
import { getLeaderboardFilters, getLeaderboardFilterById } from '../engine/leaderboardFilters.js'

const LEADERBOARD_FILTERS = getLeaderboardFilters()
const LEADERBOARD_FILTER_OPTIONS = LEADERBOARD_FILTERS.map(f => ({ id: f.id, label: f.label, icon: f.icon || null }))

function buildLeaderboardUrl(filter) {
  if (!filter || filter.type !== 'kc') return '/api/leaderboard'
  const params = new URLSearchParams({ metric: 'kc', source_type: filter.sourceType, source_id: filter.sourceId })
  return `/api/leaderboard?${params.toString()}`
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
              <div class="text-sm font-semibold text-[var(--color-parchment)] truncate">
                {char.isOneLife ? '☠️ ' : ''}{char.username}
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

export default function LeaderboardScreen() {
  const [filterId, setFilterId] = useState('total')
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const filter = getLeaderboardFilterById(filterId) || LEADERBOARD_FILTERS[0]
  const metric = filter.type === 'kc' ? 'kc' : 'total'

  useEffect(() => {
    let cancelled = false
    async function fetchLeaderboard() {
      try {
        setLoading(true)
        const res = await fetch(buildLeaderboardUrl(filter))
        if (!res.ok) throw new Error('Failed to fetch leaderboard')
        const data = await res.json()
        if (cancelled) return
        setCharacters(data.characters || [])
        setError(null)
      } catch (err) {
        if (cancelled) return
        console.error('Leaderboard fetch error:', err)
        setError(err.message || 'Failed to load leaderboard')
        setCharacters([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchLeaderboard()
    return () => { cancelled = true }
  }, [filterId])

  const emptyText = metric === 'kc' ? 'No kills recorded yet' : 'No characters found'

  return (
    <div class="h-full flex flex-col">
      <div class="flex-shrink-0 bg-[#111] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">🏆 Leaderboard</h1>
        <div class="mt-2">
          <FilterToggleBar options={LEADERBOARD_FILTER_OPTIONS} value={filterId} onChange={setFilterId} />
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
              <LeaderboardRow key={`${filterId}:${idx}`} rank={idx + 1} char={char} metric={metric} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
