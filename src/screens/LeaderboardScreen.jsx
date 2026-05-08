import { useState, useEffect } from 'preact/hooks'
import Card from '../components/Card.jsx'
import CollectionLogPanel from '../components/CollectionLogPanel.jsx'
import { formatNumber } from '../utils/helpers.js'

function LeaderboardList() {
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        setLoading(true)
        const res = await fetch('/api/leaderboard')
        if (!res.ok) throw new Error('Failed to fetch leaderboard')
        const data = await res.json()
        setCharacters(data.characters || [])
        setError(null)
      } catch (err) {
        console.error('Leaderboard fetch error:', err)
        setError(err.message || 'Failed to load leaderboard')
        setCharacters([])
      } finally {
        setLoading(false)
      }
    }
    fetchLeaderboard()
  }, [])

  if (loading) return <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">Loading leaderboard...</div>
  if (error) return <div class="text-center py-4 text-[#e57373] text-sm">Error: {error}</div>
  if (characters.length === 0) return <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">No characters found</div>

  return (
    <div class="space-y-2">
      {characters.map((char, idx) => (
        <Card key={idx} className="p-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 flex-1">
              <div class="text-lg font-semibold text-[var(--color-gold)] min-w-[2rem]">
                #{idx + 1}
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-[var(--color-parchment)] truncate">
                  {char.username}
                </div>
              </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
              <div class="text-sm font-semibold text-[var(--color-gold)]">
                {formatNumber(char.totalLevel)}
              </div>
              <div class="text-[10px] text-[var(--color-parchment)] opacity-60">
                Total Level
              </div>
              <div class="text-[10px] font-[var(--font-mono)] text-[var(--color-blood-light)] mt-1">
                Combat {formatNumber(char.combatLevel ?? 3)}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function CollapsibleSection({ icon, title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        class="w-full flex items-center justify-between gap-2 px-4 py-3 bg-transparent border-0 text-left cursor-pointer"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xl flex-shrink-0">{icon}</span>
          <span class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">{title}</span>
        </div>
        <span class="text-[var(--color-gold)] text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div class="px-4 pb-4 pt-1">
          {children}
        </div>
      )}
    </Card>
  )
}

export default function LeaderboardScreen() {
  return (
    <div class="h-full flex flex-col">
      <div class="flex-shrink-0 bg-[#111] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">Settings</h1>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <CollapsibleSection icon="🏆" title="Leaderboards">
          <LeaderboardList />
        </CollapsibleSection>
        <CollapsibleSection icon="📖" title="Collection Log">
          <CollectionLogPanel />
        </CollapsibleSection>
      </div>
    </div>
  )
}
