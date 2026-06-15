import { useState, useEffect, useMemo } from 'preact/hooks'
import itemsData from '../data/items.json'
import { getItemIconKey } from '../utils/itemIcons'
import { skillEmblemMask, skillArtTreatment } from '../utils/skillArt.js'
import GildedComplete from './GildedComplete.jsx'
import {
  getCollectionLogData,
  getCollectionLogTotal,
  summarizeProgress,
  summarizeSection,
  isSlotObtained,
} from '../engine/collectionLog.js'
import {
  fetchCollectionLog,
  getCachedEntries,
  getCachedTotal,
  subscribe,
} from '../cloud/collectionLog.js'

// Per-category presentation (accent colour, emblem glyph, flavour blurb). Keyed
// by collection-log category id; falls back to a neutral gold treatment for any
// future category that isn't listed here.
const CATEGORY_META = {
  monsters:  { accent: '#e0564b', glyph: 'death_skull',    blurb: 'Trophies from the hunt' },
  raids:     { accent: '#9b6cff', glyph: 'temple_gate',    blurb: 'Treasures from the deep vaults' },
  minigames: { accent: '#46a0e0', glyph: 'castle',         blurb: 'Spoils from the arenas & games' },
  clues:     { accent: '#e0b765', glyph: 'scroll_unfurled', blurb: 'Rewards from the trail of riddles' },
  skilling:  { accent: '#3fb56b', glyph: 'anvil',          blurb: 'Rare finds from honest work' },
  pvp:       { accent: '#d23b2f', glyph: 'crossed_swords', blurb: 'Spoils of the arena duels' },
}
const DEFAULT_META = { accent: '#d4a017', glyph: 'default', blurb: 'A hall of trophies' }
function metaFor(category) {
  return CATEGORY_META[category.id] || DEFAULT_META
}

// Gilded gradient/glow treatment for completed (gold) art.
const GOLD = {
  gradient: 'linear-gradient(140deg,#fcecb0 0%,#e7b53e 46%,#a9781a 100%)',
  glow: 'rgba(240,192,64,0.92)',
}

function itemLabel(itemId) {
  return itemsData[itemId]?.name || itemId
}

// Masked, gradient-filled glowing glyph art (mirrors SkillEmblem / .cb-art). The
// glyph silhouette masks an accent (or gold) gradient with a coloured glow halo.
// Falls back to a neutral box before the icon chunk loads (see GameIcon docs).
function CollogArt({ glyphKey, accent, gold, size = 40, glow = 1, locked = false }) {
  const mask = skillEmblemMask(glyphKey)
  if (!mask) {
    return <div class="clog-art clog-art--fallback" style={{ width: size, height: size }} aria-hidden="true" />
  }
  const maskStyle = {
    WebkitMaskImage: mask, maskImage: mask,
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center', maskPosition: 'center',
    WebkitMaskSize: 'contain', maskSize: 'contain',
  }
  if (locked) {
    return <div class="clog-art clog-art--locked" style={{ width: size, height: size, ...maskStyle }} aria-hidden="true" />
  }
  const t = gold ? GOLD : skillArtTreatment(accent)
  return (
    <div
      class="clog-art"
      style={{
        width: size, height: size, ...maskStyle, background: t.gradient,
        filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.5)) drop-shadow(0 0 ${10 * glow}px ${t.glow})`,
      }}
      aria-hidden="true"
    />
  )
}

// Gold completion ring with the crossed-swords crest in the centre.
function MasterRing({ pct, size = 148, stroke = 9, complete }) {
  const r = (size - stroke) / 2 - 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.min(1, Math.max(0, pct)))
  const crest = Math.round(size * 0.42)
  return (
    <div class={'clog-ring' + (complete ? ' is-complete' : '')} style={{ width: size, height: size }}>
      <div class="clog-ring__glow" />
      <svg width={size} height={size} class="clog-ring__svg">
        <defs>
          <linearGradient id="clogRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#fcecb0" />
            <stop offset="50%" stop-color="#e7b53e" />
            <stop offset="100%" stop-color="#a9781a" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" stroke-width={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#clogRingGrad)" stroke-width={stroke}
          stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.22,1,.36,1)', filter: 'drop-shadow(0 0 6px rgba(240,192,64,0.6))' }}
        />
      </svg>
      <div class="clog-ring__crest">
        <CollogArt glyphKey="crossed_swords" gold size={crest} glow={1.2} />
      </div>
      <div class="clog-ring__pct">{Math.round(pct * 100)}%</div>
    </div>
  )
}

function Hero({ items, totalItems, logs, totalLogs, allDone }) {
  const pct = totalItems > 0 ? items / totalItems : 0
  return (
    <div class="clog-hero">
      <div class="clog-hero__ring">
        <MasterRing pct={pct} complete={allDone} />
      </div>
      <div class="clog-hero__side">
        <div class="clog-hero__stat">
          <span class="clog-hero__k">Logs Completed</span>
          <span class="clog-hero__v"><b>{logs}</b> / {totalLogs}</span>
        </div>
        <div class="clog-hero__div" />
        <div class="clog-hero__stat">
          <span class="clog-hero__k">Items Unlocked</span>
          <span class="clog-hero__v"><b>{items}</b> / {totalItems}</span>
        </div>
        {allDone && <div class="clog-hero__mastered">★ Collection Mastered ★</div>}
      </div>
    </div>
  )
}

function barFill(accent, gold) {
  return gold
    ? 'linear-gradient(90deg,#a9781a,#f0c040 60%,#fcecb0)'
    : `linear-gradient(90deg, color-mix(in srgb, ${accent} 78%, #000), ${accent} 55%, color-mix(in srgb, ${accent} 55%, #fff))`
}
function barGlow(accent, gold) {
  return gold ? '0 0 9px rgba(240,192,64,0.55)' : `0 0 8px ${accent}66`
}

function CategoryCard({ category, meta, obtained, total, onOpen }) {
  const done = total > 0 && obtained >= total
  const pct = total > 0 ? obtained / total : 0
  return (
    <GildedComplete complete={done} className="rounded-[16px]">
      <button type="button" class={'clog-cat' + (done ? ' is-done' : '')} onClick={() => onOpen(category.id)}>
        <div class="clog-cat__body">
        <div class="clog-cat__top">
          <div class="clog-cat__id">
            <CollogArt glyphKey={meta.glyph} accent={meta.accent} gold={done} size={26} glow={0.7} />
            <div>
              <div class="clog-cat__name">{category.label}</div>
              <div class="clog-cat__blurb">{meta.blurb}</div>
            </div>
          </div>
          <div class="clog-cat__count"><b>{obtained}</b><span>/{total}</span></div>
        </div>
        <div class="clog-bar">
          <div class="clog-bar__fill" style={{ width: `${Math.round(pct * 100)}%`, background: barFill(meta.accent, done), boxShadow: barGlow(meta.accent, done) }} />
        </div>
        <div class="clog-cat__foot">
          {done ? (
            <span class="clog-done-tag">✦&nbsp;&nbsp;LOG COMPLETE&nbsp;&nbsp;✦</span>
          ) : (
            <>
              <span>{total - obtained} remaining</span>
              <span>{Math.round(pct * 100)}%</span>
            </>
          )}
        </div>
        </div>
      </button>
    </GildedComplete>
  )
}

function ClogItemSlot({ itemId, accent, gold }) {
  const item = itemsData[itemId]
  const glyphKey = getItemIconKey(item) || 'default'
  return (
    <div class="clog-slot is-got gold-card">
      <CollogArt glyphKey={glyphKey} accent={accent} gold={gold} size={38} glow={1} />
      <div class="clog-slot__name">{itemLabel(itemId)}</div>
    </div>
  )
}

function LockedSlot({ itemId, accent }) {
  const item = itemsData[itemId]
  const glyphKey = getItemIconKey(item) || 'default'
  return (
    <div class="clog-slot is-locked">
      <CollogArt glyphKey={glyphKey} accent={accent} locked size={38} />
      <div class="clog-slot__name">???</div>
      <span class="clog-slot__lock">🔒</span>
    </div>
  )
}

function DetailSheet({ category, meta, entries, obtained, total, desktop, onClose }) {
  const done = total > 0 && obtained >= total
  const t = skillArtTreatment(meta.accent)
  const pct = total > 0 ? obtained / total : 0
  return (
    <div class={'clog-overlay' + (desktop ? ' clog-overlay--center' : '')} onClick={onClose}>
      <div class={'clog-sheet' + (done ? ' is-done' : '')} onClick={e => e.stopPropagation()}>
        <div class="clog-sheet__grab" />
        <button type="button" class="clog-sheet__close" onClick={onClose} aria-label="Close">×</button>
        <div class="clog-sheet__hero">
          <div class="clog-sheet__emblem">
            <div class="glow" style={{ background: `radial-gradient(circle, ${done ? 'rgba(240,192,64,0.6)' : t.glow}, transparent 64%)` }} />
            <CollogArt glyphKey={meta.glyph} accent={meta.accent} gold={done} size={54} glow={done ? 1.4 : 1} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 class="clog-sheet__name" style={done ? { color: '#fcecb0' } : null}>{category.label}</h2>
            <div class="clog-sheet__sub">{meta.blurb}</div>
          </div>
          <div class="clog-sheet__count">
            <div><b>{obtained}</b><span>/{total}</span></div>
            <em>{Math.round(pct * 100)}%</em>
          </div>
        </div>
        <div class="clog-bar" style={{ marginTop: 0, marginBottom: 14 }}>
          <div class="clog-bar__fill" style={{ width: `${Math.round(pct * 100)}%`, background: barFill(meta.accent, done), boxShadow: barGlow(meta.accent, done) }} />
        </div>
        <div class="clog-sheet__scroll">
          {category.sections.map(sec => {
            const s = summarizeSection(entries, category.id, sec.id, sec.items)
            const secDone = s.total > 0 && s.obtained >= s.total
            return (
              <div key={sec.id}>
                <div class="clog-sec">
                  <span class="clog-sec__name">{sec.label}</span>
                  <span class="clog-sec__rule" />
                  <span class={'clog-sec__count' + (secDone ? ' is-done' : '')}>{s.obtained}/{s.total}</span>
                </div>
                <div class="clog-slotgrid">
                  {sec.items.map(itemId => {
                    const has = isSlotObtained(entries, category.id, sec.id, itemId)
                    return has
                      ? <ClogItemSlot key={itemId} itemId={itemId} accent={meta.accent} gold={done || secDone} />
                      : <LockedSlot key={itemId} itemId={itemId} accent={meta.accent} />
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function CollectionLogPanel() {
  const data = getCollectionLogData()
  const [entries, setEntries] = useState(getCachedEntries())
  const [serverTotal, setServerTotal] = useState(getCachedTotal())
  const [loading, setLoading] = useState(!entries)
  const [openId, setOpenId] = useState(null)
  const [desktop, setDesktop] = useState(typeof window !== 'undefined' && window.innerWidth >= 1024)

  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const unsub = subscribe(({ entries, total }) => {
      setEntries(entries ? new Set(entries) : null)
      setServerTotal(total)
    })
    if (!getCachedEntries()) {
      setLoading(true)
      fetchCollectionLog().then(res => {
        if (res?.entries) setEntries(new Set(res.entries))
        if (typeof res?.total === 'number') setServerTotal(res.total)
      }).finally(() => setLoading(false))
    } else {
      setEntries(new Set(getCachedEntries()))
      setServerTotal(getCachedTotal())
      setLoading(false)
    }
    return unsub
  }, [])

  // Per-category obtained/total, derived from the bundled content data so the
  // card breakdown always reconciles with the displayed slots.
  const catTotals = useMemo(() => {
    const out = {}
    for (const cat of (data.categories || [])) {
      let obtained = 0, total = 0
      for (const sec of cat.sections) {
        const s = summarizeSection(entries, cat.id, sec.id, sec.items)
        obtained += s.obtained; total += s.total
      }
      out[cat.id] = { obtained, total }
    }
    return out
  }, [entries, data])

  const summary = summarizeProgress(entries)
  // Server-bundled total wins when present, in case a deploy is mid-flight and
  // client/server json disagree.
  const total = typeof serverTotal === 'number' ? serverTotal : summary.total
  const localTotal = getCollectionLogTotal()
  const obtained = Math.min(summary.obtained, total)
  const logsDone = (data.categories || []).filter(c => {
    const ct = catTotals[c.id]
    return ct && ct.total > 0 && ct.obtained >= ct.total
  }).length
  const totalLogs = (data.categories || []).length
  const allDone = totalLogs > 0 && logsDone >= totalLogs

  const openCat = openId ? data.categories.find(c => c.id === openId) : null

  return (
    <div class="h-full relative flex flex-col">
      <div class="flex-1 overflow-y-auto px-4 py-3">
        <div class="clog-pad">
          <div class="clog-header">
            <div class="clog-header__title">
              <CollogArt glyphKey="scroll_unfurled" gold size={28} glow={1} />
              <h1>Collection Log</h1>
            </div>
            <div class="clog-header__sub">Your hall of trophies</div>
          </div>

          {!loading && (
            <Hero
              items={obtained}
              totalItems={total}
              logs={logsDone}
              totalLogs={totalLogs}
              allDone={allDone}
            />
          )}

          {total !== localTotal && (
            <div class="text-[10px] text-[var(--color-parchment)] opacity-50 mt-2 px-1">
              Server has {total} entries (this build bundles {localTotal}); reload to refresh.
            </div>
          )}

          <div class="clog-secthead"><span>The Logs</span><div class="rule" /></div>

          {loading ? (
            <div class="text-center py-6 text-[var(--color-parchment)] opacity-60 text-sm">
              Loading collection log...
            </div>
          ) : (
            <div class="clog-grid">
              {data.categories.map(cat => {
                const ct = catTotals[cat.id] || { obtained: 0, total: 0 }
                return (
                  <CategoryCard
                    key={cat.id}
                    category={cat}
                    meta={metaFor(cat)}
                    obtained={ct.obtained}
                    total={ct.total}
                    onOpen={setOpenId}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {openCat && (
        <DetailSheet
          category={openCat}
          meta={metaFor(openCat)}
          entries={entries}
          obtained={(catTotals[openCat.id] || {}).obtained || 0}
          total={(catTotals[openCat.id] || {}).total || 0}
          desktop={desktop}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
