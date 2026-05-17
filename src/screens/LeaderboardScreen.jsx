import { useState, useEffect } from 'preact/hooks'
import Card from '../components/Card.jsx'
import { formatNumber } from '../utils/helpers.js'

export default function LeaderboardScreen() {
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

  return (
    <div class="h-full flex flex-col">
      <div class="flex-shrink-0 bg-[#111] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">🏆 Leaderboard</h1>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">Loading leaderboard...</div>
        )}
        {error && !loading && (
          <div class="text-center py-4 text-[#e57373] text-sm">Error: {error}</div>
        )}
        {!loading && !error && characters.length === 0 && (
          <div class="text-center py-4 text-[var(--color-parchment)] opacity-60 text-sm">No characters found</div>
        )}
        {!loading && !error && characters.length > 0 && (
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
                        {char.isOneLife ? '☠️ ' : ''}{char.username}
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
        )}
      </div>
    </div>
  )
}
