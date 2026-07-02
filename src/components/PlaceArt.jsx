/**
 * PlaceArt — map art for the world map.
 *
 *   • <PlaceIcon>  — the settlement-tier medallions (city/town/village/hamlet) and the
 *                    furnace-&-anvil facility glyph. Pure SVG, 64×64 viewBox.
 *   • <PlaceScene> — a wide, per-place establishing illustration shown on the place hub
 *                    banner. If `place.image` is set (a generated static asset under
 *                    /public/world/), that photo is used directly. Otherwise falls back
 *                    to a bespoke vector scene composed from a small library of landmark
 *                    primitives keyed by place id, or a tier-themed scene so places
 *                    without either always render something.
 *   • <WorldTerrain> — the painted landscape behind the world-map graph: sea and
 *                    coastline, the northern loch, rivers, forests, mountain ranges,
 *                    the Kharid sands, the mistmarsh, Duskwood, grass, waves and chart
 *                    ornaments (compass rose, ship, region names). Deterministic: all
 *                    scatter comes from a fixed-seed PRNG laid out once at module scope,
 *                    with exclusion zones around every place node, road and road label
 *                    so the terrain never fights the interactive layer.
 *
 * Vector art uses the theme CSS variables (`var(--color-…)`) for cohesion with the rest
 * of the UI. Keep it dependency-free and self-contained — this is the single home for
 * map art.
 */
import { getWorld } from '../engine/world.js'

// ───────────────────────── tier / facility icons (64×64) ─────────────────────────

function CityIcon() {
  return (
    <g stroke="#2b2114" stroke-width="1.6" stroke-linejoin="round">
      <rect x="10" y="30" width="44" height="26" fill="#e9edf2" />
      <rect x="10" y="30" width="44" height="26" fill="url(#pa_city_shade)" />
      {/* battlements */}
      <path d="M10 30h6v-5h4v5h6v-5h4v5h4v-5h4v5h6v-5h4v5h6" fill="#f4f7fb" />
      {/* central keep */}
      <rect x="26" y="14" width="12" height="42" fill="#f4f7fb" />
      <path d="M26 14h3v-4h2v4h2v-4h2v4h3" fill="#f4f7fb" />
      <path d="M24 14l8-8 8 8z" fill="#c9a24a" stroke="#7a5a16" />
      {/* side towers */}
      <path d="M10 30l5-7 5 7z" fill="#c9a24a" stroke="#7a5a16" />
      <path d="M44 30l5-7 5 7z" fill="#c9a24a" stroke="#7a5a16" />
      {/* gate + windows */}
      <path d="M29 56v-9a3 3 0 016 0v9z" fill="#3a2c5e" />
      <rect x="14" y="40" width="4" height="6" fill="#6db3e0" />
      <rect x="46" y="40" width="4" height="6" fill="#6db3e0" />
    </g>
  )
}

function TownIcon() {
  return (
    <g stroke="#2b2114" stroke-width="1.6" stroke-linejoin="round">
      <rect x="12" y="34" width="40" height="22" fill="#cdb78a" />
      <path d="M12 34h6v-4h4v4h6v-4h4v4h6v-4h4v4h6" fill="#d8c79e" />
      <rect x="28" y="20" width="10" height="36" fill="#d8c79e" />
      <path d="M27 20l6-8 6 8z" fill="#8a5a2b" stroke="#5a3a16" />
      <path d="M48 34l4-6 4 6z" fill="#8a5a2b" stroke="#5a3a16" />
      <path d="M30 56v-8a3 3 0 016 0v8z" fill="#3a2c1e" />
      <rect x="16" y="42" width="4" height="5" fill="#f2c14e" />
      <rect x="44" y="42" width="4" height="5" fill="#f2c14e" />
    </g>
  )
}

function VillageIcon() {
  return (
    <g stroke="#2b2114" stroke-width="1.6" stroke-linejoin="round">
      <rect x="14" y="36" width="24" height="20" fill="#caa36a" />
      <path d="M12 36l14-12 14 12z" fill="#7c4a28" stroke="#4a2c14" />
      <rect x="38" y="42" width="14" height="14" fill="#b78f56" />
      <path d="M36 42l9-7 9 7z" fill="#5e3a1e" stroke="#3a2310" />
      <rect x="22" y="44" width="7" height="12" fill="#3a2c1e" />
      <rect x="42" y="46" width="5" height="5" fill="#f2c14e" />
    </g>
  )
}

function HamletIcon() {
  return (
    <g stroke="#2b2114" stroke-width="1.6" stroke-linejoin="round">
      <rect x="20" y="38" width="24" height="18" fill="#b89066" />
      <path d="M17 38l15-12 15 12z" fill="#6e4524" stroke="#43290f" />
      <rect x="28" y="44" width="8" height="12" fill="#3a2c1e" />
      <path d="M40 26l3-2v6" fill="none" stroke="#6e4524" stroke-width="2" />
    </g>
  )
}

function FurnaceAnvilIcon() {
  return (
    <g stroke="#1c140c" stroke-width="1.6" stroke-linejoin="round">
      {/* furnace */}
      <path d="M8 54V30a10 10 0 0120 0v24z" fill="#4a3526" />
      <path d="M14 54v-9h8v9z" fill="#1a1008" />
      <path d="M18 45c-3-4 1-6-1-10 4 3 5 7 1 10z" fill="#ff8a2b" stroke="none" />
      <path d="M18 43c-1.5-2 .5-3-.5-5 2 1.5 2.5 3.5.5 5z" fill="#ffe08a" stroke="none" />
      {/* anvil */}
      <path d="M34 56v-3h22v3z" fill="#2b2b30" />
      <path d="M37 53v-4h16v4z" fill="#3c3c44" />
      <path d="M40 49v-5h6l2-4h8c-2 6-7 9-12 9z" fill="#52525c" />
      <path d="M40 49v-5h6l2-4h8c-2 6-7 9-12 9z" fill="url(#pa_anvil_shine)" />
    </g>
  )
}

const TIER_ICON = { city: CityIcon, town: TownIcon, village: VillageIcon, hamlet: HamletIcon }

/**
 * Settlement-tier or facility glyph. Pass `tier` (city/town/village/hamlet) or
 * `facility` (furnace_anvil). Returns null for anything else (e.g. bank, which reuses
 * the existing coins glyph via <GameIcon>).
 */
export function PlaceIcon({ tier, facility, size = 40, class: cls = '' }) {
  let Glyph = null
  if (facility === 'furnace_anvil') Glyph = FurnaceAnvilIcon
  else if (tier) Glyph = TIER_ICON[tier]
  if (!Glyph) return null
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} class={cls} role="img" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="pa_city_shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0" />
          <stop offset="1" stop-color="#9fb0c4" stop-opacity="0.5" />
        </linearGradient>
        <linearGradient id="pa_anvil_shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.35" />
          <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <Glyph />
    </svg>
  )
}

// ───────────────────────── scene landmark primitives ─────────────────────────
// All primitives draw on a 400×220 banner. y≈150 is the ground line.

const Sun = ({ x = 320, y = 54, c = '#ffe9a8' }) => <circle cx={x} cy={y} r="22" fill={c} opacity="0.9" />
const Moon = ({ x = 320, y = 50 }) => (
  <g>
    <circle cx={x} cy={y} r="24" fill="#eef3ff" opacity="0.18" />
    <circle cx={x} cy={y} r="17" fill="#eef3ff" opacity="0.95" />
    <circle cx={x - 5} cy={y - 4} r="3" fill="#cfd8ea" opacity="0.7" />
    <circle cx={x + 4} cy={y + 3} r="2.4" fill="#cfd8ea" opacity="0.6" />
  </g>
)

const Hills = ({ c = '#3c6b3a', c2 = '#2f5630' }) => (
  <g>
    <path d="M0 150 Q90 116 200 142 T400 138 V220 H0 Z" fill={c2} />
    <path d="M0 158 Q120 132 240 152 T400 150 V220 H0 Z" fill={c} />
  </g>
)

const Water = ({ y = 168, c = '#2f6f9e' }) => (
  <g>
    <rect x="0" y={y} width="400" height={220 - y} fill={c} />
    <path d={`M0 ${y + 8} q30 -4 60 0 t60 0 t60 0 t60 0 t60 0 t60 0`} fill="none" stroke="#bfe3ff" stroke-width="1.4" opacity="0.5" />
    <path d={`M0 ${y + 18} q40 -4 80 0 t80 0 t80 0 t80 0 t80 0`} fill="none" stroke="#bfe3ff" stroke-width="1.2" opacity="0.35" />
  </g>
)

const Trees = ({ x = 30, n = 4, c = '#2c5a2e' }) => (
  <g>
    {Array.from({ length: n }).map((_, i) => {
      const tx = x + i * 22
      return (
        <g key={i}>
          <rect x={tx - 2} y="138" width="4" height="14" fill="#4a3320" />
          <path d={`M${tx} 116 l11 26 h-22 z`} fill={c} />
          <path d={`M${tx} 126 l9 18 h-18 z`} fill={c} opacity="0.8" />
        </g>
      )
    })}
  </g>
)

const Dunes = ({ c = '#e0c074', c2 = '#cBa253' }) => (
  <g>
    <path d="M0 150 Q100 128 200 150 T400 150 V220 H0 Z" fill={c2} />
    <path d="M0 162 Q120 146 220 164 T400 160 V220 H0 Z" fill={c} />
  </g>
)

const Volcano = ({ x = 70 }) => (
  <g>
    <path d={`M${x - 48} 152 L${x - 14} 78 h28 L${x + 48} 152 z`} fill="#4a3a38" stroke="#2a201f" stroke-width="1.5" />
    <path d={`M${x - 14} 78 h28 l-6 10 h-16 z`} fill="#1a1210" />
    <path d={`M${x - 12} 80 q12 -18 24 0 q-6 -6 -12 0 q-6 -6 -12 0z`} fill="#ff6a2b" />
    <path d={`M${x - 6} 74 q6 -12 12 0z`} fill="#ffd14e" />
    <path d={`M${x - 30} 152 l10 -22 8 12 8 -16 10 26z`} fill="#6b4a44" opacity="0.7" />
  </g>
)

const Bridge = ({ x = 150, w = 110, white = false }) => {
  const stone = white ? '#eef2f7' : '#b79a6b'
  const dark = white ? '#cdd6e2' : '#8a6f47'
  return (
    <g stroke={dark} stroke-width="1.4">
      <path d={`M${x} 168 q${w / 2} -34 ${w} 0`} fill="none" stroke={stone} stroke-width="7" />
      <path d={`M${x} 168 q${w / 2} -34 ${w} 0`} fill="none" stroke={dark} stroke-width="2" opacity="0.6" />
      {Array.from({ length: 5 }).map((_, i) => {
        const px = x + (w / 5) * (i + 0.5)
        const py = 168 - Math.sin(((i + 0.5) / 5) * Math.PI) * 30 + 4
        return <line key={i} x1={px} y1={py} x2={px} y2={py + 18} stroke={dark} stroke-width="2" />
      })}
    </g>
  )
}

// A keep/castle. `white` makes it Faloden/Camelot-style alabaster; otherwise warm stone.
const Castle = ({ x = 150, white = false, scale = 1 }) => {
  const wall = white ? '#eef2f7' : '#c9b48a'
  const wall2 = white ? '#dbe3ee' : '#b39c6e'
  const roof = white ? '#7fa8d8' : '#9a4b2e'
  const s = scale
  const block = (bx, by, bw, bh, f) => <rect x={x + bx * s} y={by} width={bw * s} height={bh} fill={f} stroke="#2b2114" stroke-width="1.2" />
  const tower = (tx, top, ht, f) => (
    <g>
      <rect x={x + tx * s} y={top} width={16 * s} height={ht} fill={f} stroke="#2b2114" stroke-width="1.2" />
      <path d={`M${x + tx * s} ${top} l${8 * s} ${-14} l${8 * s} 14 z`} fill={roof} stroke="#2b2114" stroke-width="1.2" />
    </g>
  )
  return (
    <g>
      {block(-40, 110, 80, 42, wall)}
      <path d={`M${x - 40 * s} 110 h${8 * s}v-5h${5 * s}v5h${10 * s}v-5h${5 * s}v5h${10 * s}v-5h${5 * s}v5h${10 * s}v-5h${5 * s}v5h${8 * s}`} fill={wall2} stroke="#2b2114" stroke-width="1" />
      {tower(-44, 92, 60, wall2)}
      {tower(28, 92, 60, wall2)}
      {tower(-9, 72, 80, wall)}
      <rect x={x - 7 * s} y="132" width={14 * s} height="20" fill="#3a2c5e" stroke="#2b2114" stroke-width="1.2" />
      <rect x={x - 38 * s} y="120" width={5 * s} height="7" fill="#6db3e0" />
      <rect x={x + 33 * s} y="120" width={5 * s} height="7" fill="#6db3e0" />
    </g>
  )
}

const Manor = ({ x = 150, c = '#6b5a44', roof = '#3a2c22' }) => (
  <g stroke="#1c140c" stroke-width="1.2">
    <rect x={x - 30} y="118" width="60" height="34" fill={c} />
    <path d={`M${x - 34} 118 l34 -20 l34 20 z`} fill={roof} />
    <rect x={x - 8} y="134" width="16" height="18" fill="#2a1f16" />
    <rect x={x - 24} y="124" width="8" height="8" fill="#f2c14e" />
    <rect x={x + 16} y="124" width="8" height="8" fill="#f2c14e" />
  </g>
)

const Tower = ({ x = 150, c = '#cdb78a', roof = '#5a73a8' }) => (
  <g stroke="#1c140c" stroke-width="1.2">
    <rect x={x - 12} y="92" width="24" height="60" fill={c} />
    <path d={`M${x - 16} 92 l16 -22 l16 22 z`} fill={roof} />
    <rect x={x - 5} y="118" width="10" height="10" fill="#6db3e0" />
  </g>
)

const Cottages = ({ x = 60, n = 3 }) => (
  <g stroke="#1c140c" stroke-width="1.1">
    {Array.from({ length: n }).map((_, i) => {
      const cx = x + i * 46
      return (
        <g key={i}>
          <rect x={cx} y="126" width="34" height="26" fill={i % 2 ? '#b78f56' : '#caa36a'} />
          <path d={`M${cx - 3} 126 l20 -14 l20 14 z`} fill={i % 2 ? '#5e3a1e' : '#7c4a28'} />
          <rect x={cx + 12} y="136" width="10" height="16" fill="#3a2c1e" />
        </g>
      )
    })}
  </g>
)

const Docks = ({ x = 230 }) => (
  <g stroke="#2a1f14" stroke-width="1.2">
    <rect x={x} y="166" width="70" height="6" fill="#6b4a2c" />
    <line x1={x + 12} y1="172" x2={x + 12} y2="184" stroke="#4a3320" stroke-width="3" />
    <line x1={x + 40} y1="172" x2={x + 40} y2="184" stroke="#4a3320" stroke-width="3" />
    {/* boat */}
    <path d={`M${x + 44} 162 h34 l-6 10 h-22 z`} fill="#7c5a34" />
    <line x1={x + 60} y1="162" x2={x + 60} y2="128" stroke="#4a3320" stroke-width="2" />
    <path d={`M${x + 60} 130 l18 22 h-18 z`} fill="#f3ede0" />
  </g>
)

const Windmill = ({ x = 320 }) => (
  <g stroke="#1c140c" stroke-width="1.2">
    <path d={`M${x - 14} 152 L${x - 9} 104 h18 l5 48 z`} fill="#cdb78a" />
    <circle cx={x} cy="104" r="4" fill="#5a3a1e" />
    <g stroke="#5a3a1e" stroke-width="3">
      <line x1={x} y1="104" x2={x - 22} y2="86" /><line x1={x} y1="104" x2={x + 22} y2="122" />
      <line x1={x} y1="104" x2={x - 18} y2="124" /><line x1={x} y1="104" x2={x + 18} y2="84" />
    </g>
  </g>
)

const Ruins = ({ x = 150 }) => (
  <g stroke="#1c140c" stroke-width="1.2" fill="#9a9486">
    <path d={`M${x - 30} 152 v-30 h10 v12 h8 v-20 h10 v34 z`} />
    <rect x={x + 6} y="120" width="10" height="32" />
    <rect x={x + 22} y="132" width="8" height="20" />
  </g>
)

// ───────────────────────── per-place scene composition ─────────────────────────
// Each entry: { sky:[top,bottom], parts:[<fn keys>] }. Composed in array order so later
// items draw in front. Falls back to a tier-themed scene via TIER_SCENE.

function SkyGrad({ id, top, bottom }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color={top} />
      <stop offset="1" stop-color={bottom} />
    </linearGradient>
  )
}

const SCENES = {
  lumbright: { sky: ['#9fc7e8', '#dcecf5'], render: () => (<g><Hills /><Water y={172} /><Bridge x={150} w={110} /><Castle x={250} /><Trees x={20} n={3} /><Sun /></g>) },
  varrick:   { sky: ['#8aa0c4', '#d7dce6'], render: () => (<g><Hills c="#566275" c2="#454f5e" /><Castle x={120} scale={1.05} /><Tower x={250} c="#9aa3b2" roof="#6b2f1e" /><Cottages x={290} n={2} /><Sun c="#fff0c8" /></g>) },
  faloden:   { sky: ['#bcd4ee', '#eef4fb'], render: () => (<g><Hills c="#4e7e4a" c2="#3c6238" /><Water y={174} c="#3f86b8" /><Bridge x={60} w={120} white /><Castle x={250} white scale={1.1} /><Sun /></g>) },
  ardounne:  { sky: ['#a7bfe0', '#e6ddf0'], render: () => (<g><Hills c="#5a7a46" c2="#475f37" /><Tower x={90} c="#d8c79e" roof="#7a8fc0" /><Castle x={250} /><Cottages x={300} n={2} /><Sun /></g>) },
  draynar:   { sky: ['#5b6a7e', '#9aa7b6'], render: () => (<g><Hills c="#3a4a3a" c2="#2c3a2c" /><Water y={176} c="#39505a" /><Manor x={150} /><Trees x={250} n={3} c="#27331f" /><Moon /></g>) },
  alkarid:   { sky: ['#f4c97a', '#fbe9c2'], render: () => (<g><Dunes /><Castle x={150} white={false} /><g stroke="#3a2310"><rect x="282" y="120" width="6" height="32" fill="#6e4a24" /><path d="M285 120 q-16 -6 -24 6 q14 -2 24 2 q10 -8 24 -2 q-8 -12 -24 -6z" fill="#3c7a3a" /></g><Sun c="#fff2c0" x={330} y={46} /></g>) },
  edgevale:  { sky: ['#7e8aa0', '#c7cdd8'], render: () => (<g><Hills c="#4a5a48" c2="#3a463a" /><Water y={176} c="#46606c" /><Ruins x={120} /><Bridge x={210} w={90} /><Moon x={320} y={52} /></g>) },
  barlock:   { sky: ['#9ab0c0', '#dde6ec'], render: () => (<g><Hills c="#4e6a4a" c2="#3c543a" /><Cottages x={50} n={2} /><g stroke="#1c140c" stroke-width="1.2"><rect x="220" y="120" width="46" height="32" fill="#5a4636" /><path d="M216 120 l27 -16 l27 16 z" fill="#3a2c22" /><path d="M236 140 c-4 -5 2 -7 -1 -12 5 4 6 9 1 12z" fill="#ff8a2b" stroke="none" /></g><Sun /></g>) },
  catherra:  { sky: ['#a9d4ec', '#e8f5fb'], render: () => (<g><Hills c="#5a8a4e" c2="#46703c" /><Water y={166} c="#2f8fb8" /><Docks x={130} /><Cottages x={250} n={2} /><Sun /></g>) },
  seerhold:  { sky: ['#9fb6d0', '#e0e7ef'], render: () => (<g><Hills c="#4a6a4e" c2="#39543c" /><Tower x={120} c="#cdd2da" roof="#5a73a8" /><Cottages x={200} n={3} /><Sun c="#fff0c8" /></g>) },
  brimhollow:{ sky: ['#e7a86a', '#f7ddb0'], render: () => (<g><Volcano x={80} /><Water y={170} c="#2f7f9e" /><Docks x={210} /><Trees x={300} n={2} c="#2c5a2e" /><Sun c="#ffd98a" x={340} y={48} /></g>) },
  canifel:   { sky: ['#3e3550', '#6b5e78'], render: () => (<g><Hills c="#2e2a3a" c2="#23202e" /><Trees x={20} n={3} c="#221b2e" /><Manor x={170} c="#4a4256" roof="#241f30" /><Trees x={300} n={3} c="#221b2e" /><Moon x={320} y={48} /></g>) },
  camlann:   { sky: ['#a9c2ea', '#eaf0fa'], render: () => (<g><Hills c="#4e7e4a" c2="#3c6238" /><Water y={176} c="#3f86b8" /><Castle x={200} white scale={1.18} /><Sun /></g>) },
  portsarin: { sky: ['#9ec6e4', '#e0eef6'], render: () => (<g><Hills c="#52764a" c2="#3f5d3a" /><Water y={162} c="#2f6f9e" /><Docks x={70} /><Docks x={250} /><Cottages x={170} n={1} /><Sun /></g>) },
}

const TIER_SCENE = {
  city:    { sky: ['#a9c2ea', '#eaf0fa'], render: () => (<g><Hills /><Castle x={200} scale={1.1} /><Sun /></g>) },
  town:    { sky: ['#9ab0c0', '#dde6ec'], render: () => (<g><Hills /><Tower x={150} /><Cottages x={210} n={2} /><Sun /></g>) },
  village: { sky: ['#a9d4ec', '#e8f5fb'], render: () => (<g><Hills /><Cottages x={120} n={3} /><Trees x={30} n={2} /><Sun /></g>) },
  hamlet:  { sky: ['#9ab0c0', '#dde6ec'], render: () => (<g><Hills /><Cottages x={150} n={1} /><Trees x={60} n={3} /><Sun /></g>) },
}

/**
 * Wide establishing illustration for a place hub banner. `place` is the world.json place
 * object (needs id + tier). Responsive: fills its container width, fixed 400×220 aspect.
 * Prefers a real generated photo (`place.image`) over the bespoke vector scene.
 */
export function PlaceScene({ place, class: cls = '' }) {
  if (place?.image) {
    return (
      <img
        src={place.image}
        alt={`View of ${place.name}`}
        class={cls}
        loading="lazy"
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
    )
  }
  const scene = (place && SCENES[place.id]) || TIER_SCENE[place?.tier] || TIER_SCENE.village
  const id = `pa_sky_${place?.id || place?.tier || 'x'}`
  return (
    <svg
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMid slice"
      class={cls}
      width="100%"
      role="img"
      aria-label={`View of ${place?.name || 'the settlement'}`}
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <defs>
        <SkyGrad id={id} top={scene.sky[0]} bottom={scene.sky[1]} />
      </defs>
      <rect x="0" y="0" width="400" height="220" fill={`url(#${id})`} />
      {scene.render()}
    </svg>
  )
}

// ───────────────────────── world terrain (map background) ─────────────────────────
// Painted-chart landscape for the 1640×1160 board in src/data/world.json. Geography is
// hand-authored to match the place scenes above (Port Sarin/Brimhollow on the south
// coast, the loch by Camlann/Catherra, the river bridges at Faloden and Lumbright, the
// desert around Al-Karid, the marsh at Draynar, the haunted wood at Canifel).

const WT_W = 1640
const WT_H = 1160

// South coastline, west→east. Everything below it is the Sarin Sea.
const WT_COAST = [
  [0, 795], [120, 825], [250, 845], [360, 875], [440, 900], [530, 895],
  [640, 930], [760, 965], [880, 1000], [990, 1020], [1080, 1000],
  [1180, 1055], [1290, 1030], [1400, 980], [1520, 950], [1640, 930],
]

// Loch Camlann (closed blob), and the two rivers that meet the sea by Port Sarin.
const WT_LAKE = [[180, 215], [225, 160], [300, 145], [370, 170], [412, 225], [370, 275], [290, 295], [215, 270]]
const WT_RIVER = [[382, 262], [420, 340], [462, 420], [492, 500], [520, 585], [560, 665], [598, 745], [600, 810], [560, 860], [520, 902]]
const WT_RIVER2 = [[858, 652], [800, 690], [740, 730], [672, 772], [612, 800]]

// Biome regions (ellipses: cx, cy, rx, ry) — used both to paint the wash and to route
// the right scatter species into each.
const WT_DESERT = { cx: 1150, cy: 800, rx: 300, ry: 185 }
const WT_SWAMP = { cx: 668, cy: 838, rx: 130, ry: 78 }
const WT_DUSK = { cx: 1330, cy: 440, rx: 160, ry: 115 }
const WT_ASH = { cx: 1210, cy: 1000, rx: 150, ry: 100 }

// Mountain peaks [x, y, size] — the Eldern Peaks (NE) and the Westwall (NW corner).
const WT_PEAKS = [
  [1040, 205, 44], [1125, 165, 52], [1215, 205, 46], [1300, 160, 56], [1390, 215, 48], [1480, 180, 54], [1565, 235, 44],
  [1090, 265, 30], [1190, 285, 28], [1295, 270, 32], [1405, 300, 28], [1505, 290, 30],
  [80, 165, 34], [150, 115, 40], [230, 165, 32],
]

// Forest clusters: deterministic scatter inside each ellipse. `kind` picks the glyph.
const WT_FORESTS = [
  { cx: 620, cy: 290, rx: 115, ry: 65, n: 15, kind: 'pine' },   // Seerhold pines
  { cx: 1240, cy: 355, rx: 190, ry: 45, n: 9, kind: 'pine' },   // Eldern foothills
  { cx: 300, cy: 620, rx: 130, ry: 80, n: 13, kind: 'oak' },    // Ardounne oakwood
  { cx: 330, cy: 745, rx: 90, ry: 55, n: 8, kind: 'oak' },
  { cx: 890, cy: 865, rx: 105, ry: 55, n: 9, kind: 'oak' },     // south of Lumbright
  { cx: 1330, cy: 440, rx: 150, ry: 105, n: 17, kind: 'dead' }, // Duskwood
  { cx: 668, cy: 838, rx: 120, ry: 70, n: 7, kind: 'reed' },    // mistmarsh reeds
  { cx: 668, cy: 838, rx: 120, ry: 70, n: 5, kind: 'dead' },
]

function wtMulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Smooth open/closed paths through control points (quadratics through midpoints).
function wtSmoothOpen(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`
  }
  const last = pts[pts.length - 1]
  return d + ` L ${last[0]} ${last[1]}`
}
function wtSmoothClosed(pts) {
  const n = pts.length
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let m = mid(pts[n - 1], pts[0])
  let d = `M${m[0]} ${m[1]}`
  for (let i = 0; i < n; i++) {
    m = mid(pts[i], pts[(i + 1) % n])
    d += ` Q ${pts[i][0]} ${pts[i][1]} ${m[0]} ${m[1]}`
  }
  return d + ' Z'
}

// Linear-interp y of the coastline at x (close enough to the smoothed curve).
function wtCoastY(x) {
  const c = WT_COAST
  if (x <= c[0][0]) return c[0][1]
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][0]) {
      const f = (x - c[i - 1][0]) / (c[i][0] - c[i - 1][0])
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f
    }
  }
  return c[c.length - 1][1]
}

const wtInEllipse = (x, y, e, pad = 0) => {
  const dx = (x - e.cx) / (e.rx + pad)
  const dy = (y - e.cy) / (e.ry + pad)
  return dx * dx + dy * dy <= 1
}

function wtSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  const cx = x1 + t * dx, cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

function wtNearPolyline(x, y, pts, r) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (wtSegDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < r) return true
  }
  return false
}

// Everything scattered is computed once and cached — the world graph is static data.
let WT_LAYOUT = null
function wtLayout() {
  if (WT_LAYOUT) return WT_LAYOUT
  const world = getWorld()
  const places = Object.values(world.places)
  const roads = world.edges
    .map(([a, b]) => {
      const pa = world.places[a], pb = world.places[b]
      return pa && pb ? [pa.x, pa.y, pb.x, pb.y] : null
    })
    .filter(Boolean)

  // Clear of the interactive layer: place medallions + name plates, roads and the
  // tick labels at each road's midpoint.
  const clear = (x, y) => {
    for (const p of places) {
      const sz = (world.tiers?.[p.tier]?.size || 56) / 2
      if (Math.hypot(x - p.x, y - p.y) < sz + 62) return false
    }
    for (const [x1, y1, x2, y2] of roads) {
      if (wtSegDist(x, y, x1, y1, x2, y2) < 30) return false
      if (Math.hypot(x - (x1 + x2) / 2, y - (y1 + y2) / 2) < 46) return false
    }
    return true
  }
  const onLand = (x, y, pad = 18) =>
    y < wtCoastY(x) - pad &&
    !wtInEllipse(x, y, { cx: 296, cy: 222, rx: 118, ry: 82 }, pad) && // loch
    !wtNearPolyline(x, y, WT_RIVER, 24) &&
    !wtNearPolyline(x, y, WT_RIVER2, 20)
  const nearPeak = (x, y) => WT_PEAKS.some(([px, py, s]) => Math.hypot(x - px, y - py) < s + 14)

  const rand = wtMulberry32(20260701)
  const trees = []
  for (const f of WT_FORESTS) {
    for (let i = 0, made = 0; i < f.n * 30 && made < f.n; i++) {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand())
      const x = f.cx + Math.cos(a) * f.rx * r
      const y = f.cy + Math.sin(a) * f.ry * r
      if (!clear(x, y) || !onLand(x, y) || nearPeak(x, y)) continue
      if (f.kind === 'reed' && !wtInEllipse(x, y, WT_SWAMP)) continue // reeds stay in the marsh
      trees.push({ kind: f.kind, x, y, s: 0.8 + rand() * 0.5 })
      made++
    }
  }
  // Lone trees across the plains (skip the authored biomes — they have their own flora).
  for (let i = 0, made = 0; i < 400 && made < 34; i++) {
    const x = 30 + rand() * (WT_W - 60)
    const y = 60 + rand() * (WT_H - 120)
    if (!clear(x, y) || !onLand(x, y) || nearPeak(x, y)) continue
    if (wtInEllipse(x, y, WT_DESERT) || wtInEllipse(x, y, WT_SWAMP) || wtInEllipse(x, y, WT_DUSK, 30)) continue
    trees.push({ kind: y < 420 ? 'pine' : 'oak', x, y, s: 0.75 + rand() * 0.5 })
    made++
  }
  // A few desert palms + the oasis stand.
  const palms = [[1002, 852], [1032, 868], [986, 880]]
  for (let i = 0, made = 0; i < 200 && made < 5; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand())
    const x = WT_DESERT.cx + Math.cos(a) * WT_DESERT.rx * 0.9 * r
    const y = WT_DESERT.cy + Math.sin(a) * WT_DESERT.ry * 0.9 * r
    if (!clear(x, y) || !onLand(x, y) || wtInEllipse(x, y, WT_ASH, 10)) continue
    palms.push([x, y])
    made++
  }
  for (const [x, y] of palms) trees.push({ kind: 'palm', x, y, s: 0.85 + rand() * 0.35 })
  trees.sort((a, b) => a.y - b.y)

  // Grass tufts on the open plains.
  const grass = []
  for (let gx = 50; gx < WT_W - 40; gx += 72) {
    for (let gy = 70; gy < WT_H - 60; gy += 62) {
      const x = gx + (rand() - 0.5) * 56
      const y = gy + (rand() - 0.5) * 48
      if (!clear(x, y) || !onLand(x, y) || nearPeak(x, y)) continue
      if (wtInEllipse(x, y, WT_DESERT) || wtInEllipse(x, y, WT_SWAMP) || wtInEllipse(x, y, WT_DUSK)) continue
      if (rand() < 0.3) continue
      grass.push({ x, y, s: 1.15 + rand() * 0.6 })
    }
  }

  // Waves in open water; dune ridges in the sands.
  const waves = []
  for (let gx = 40; gx < WT_W; gx += 118) {
    for (let gy = 0; gy < 4; gy++) {
      const x = gx + (rand() - 0.5) * 56
      const y = wtCoastY(gx) + 52 + gy * 62 + (rand() - 0.5) * 30
      if (y > WT_H - 26 || y < wtCoastY(x) + 34) continue
      if (Math.hypot(x - 150, y - 1005) < 92) continue // compass rose
      if (Math.hypot(x - 760, y - 1052) < 70) continue // ship
      waves.push({ x, y, s: 0.8 + rand() * 0.6 })
    }
  }
  waves.push({ x: 250, y: 218, s: 0.7 }, { x: 320, y: 245, s: 0.8 }, { x: 300, y: 190, s: 0.6 })
  const dunes = []
  for (let i = 0, made = 0; i < 300 && made < 11; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand())
    const x = WT_DESERT.cx + Math.cos(a) * WT_DESERT.rx * 0.85 * r
    const y = WT_DESERT.cy + Math.sin(a) * WT_DESERT.ry * 0.85 * r
    if (!clear(x, y) || !onLand(x, y) || wtInEllipse(x, y, WT_ASH, 20)) continue
    dunes.push({ x, y, s: 0.8 + rand() * 0.7 })
    made++
  }
  // Boulders below the peaks and on the moors.
  const rocks = []
  for (let i = 0, made = 0; i < 200 && made < 9; i++) {
    const x = 60 + rand() * (WT_W - 120)
    const y = 100 + rand() * 340
    if (!clear(x, y) || !onLand(x, y) || nearPeak(x, y) || wtInEllipse(x, y, WT_DUSK, 20)) continue
    rocks.push({ x, y, s: 0.7 + rand() * 0.7 })
    made++
  }

  WT_LAYOUT = { trees, grass, waves, dunes, rocks }
  return WT_LAYOUT
}

const wtEllipseBlob = (e, shrink = 0, seed = 1) => {
  // Irregular closed blob approximating the ellipse (8 jittered spokes).
  const rand = wtMulberry32(seed)
  const pts = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const j = 0.82 + rand() * 0.3
    pts.push([e.cx + Math.cos(a) * (e.rx - shrink) * j, e.cy + Math.sin(a) * (e.ry - shrink) * j])
  }
  return wtSmoothClosed(pts)
}

function WtPeak({ x, y, s }) {
  return (
    <g>
      <path d={`M${x - s} ${y + s * 0.62} L${x} ${y - s * 0.55} L${x + s} ${y + s * 0.62} Z`} fill="#c6b492" stroke="#6b5636" stroke-width="1.6" stroke-linejoin="round" />
      <path d={`M${x} ${y - s * 0.55} L${x + s} ${y + s * 0.62} H${x} Z`} fill="#a8946f" opacity="0.5" />
      <path d={`M${x} ${y - s * 0.55} L${x + s * 0.3} ${y - s * 0.17} L${x + s * 0.13} ${y - s * 0.23} L${x + s * 0.02} ${y - s * 0.1} L${x - s * 0.14} ${y - s * 0.22} L${x - s * 0.3} ${y - s * 0.17} Z`} fill="#f4eedd" stroke="none" />
    </g>
  )
}

function WtCompass({ x, y }) {
  const spoke = (a, len, w, f) => {
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len
    const px = Math.cos(a + Math.PI / 2) * w, py = Math.sin(a + Math.PI / 2) * w
    return <path d={`M${x + dx} ${y + dy} L${x + px} ${y + py} L${x - px} ${y - py} Z`} fill={f} stroke="#33544c" stroke-width="0.8" />
  }
  const arms = []
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2
    arms.push(spoke(a, 44, 7, '#e9dfc0'), spoke(a + Math.PI / 4, 26, 5, '#33544c'))
  }
  return (
    <g opacity="0.85">
      <circle cx={x} cy={y} r="50" fill="none" stroke="#33544c" stroke-width="1.4" opacity="0.7" />
      <circle cx={x} cy={y} r="42" fill="none" stroke="#33544c" stroke-width="0.8" opacity="0.5" />
      {arms}
      <circle cx={x} cy={y} r="4.5" fill="#33544c" />
      <text x={x} y={y - 56} text-anchor="middle" font-size="15" fill="#33544c" font-weight="700" style={{ fontFamily: 'var(--fm-fell)' }}>N</text>
    </g>
  )
}

function WtShip({ x, y }) {
  return (
    <g stroke="#2f4a42" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.9">
      <path d={`M${x - 22} ${y} h44 l-8 10 h-28 z`} fill="#8a6a40" />
      <line x1={x} y1={y} x2={x} y2={y - 30} />
      <path d={`M${x} ${y - 30} l20 24 h-20 z`} fill="#efe6cb" />
      <path d={`M${x} ${y - 26} l-14 18 h14 z`} fill="#e3d5ae" />
      <path d={`M${x - 34} ${y + 14} q10 5 20 0 q10 -5 20 0 q10 5 20 0`} opacity="0.6" />
    </g>
  )
}

function WtSerpent({ x, y }) {
  return (
    <g stroke="#31584e" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.75">
      <path d={`M${x - 44} ${y} q10 -18 22 0`} />
      <path d={`M${x - 4} ${y} q10 -22 22 0`} />
      <path d={`M${x + 34} ${y} q6 -14 14 -2 l6 -8`} />
      <circle cx={x + 52} cy={y - 12} r="2" fill="#31584e" stroke="none" />
    </g>
  )
}

// Region names, drawn in the chart's engraved italic. [x, y, text, size, color, opacity, rotate?]
const WT_LABELS = [
  [560, 1084, 'The Sarin Sea', 36, '#2f544a', 0.8, -1],
  [296, 228, 'Loch Camlann', 16, '#2f5a52', 0.75, -4],
  [1155, 668, 'The Kharid Sands', 21, '#8a6428', 0.6, -3],
  [1310, 92, 'The Eldern Peaks', 21, '#6b5636', 0.65, -2],
  [748, 908, 'Mistmarsh', 15, '#4f5f42', 0.7, -4],
  [1442, 552, 'Duskwood', 18, '#494258', 0.7, -3],
]

/**
 * The full painted terrain layer for the world map. Sized to the world board and
 * rendered once under `.wm-routes`/the place nodes inside `.wm-board`.
 */
export function WorldTerrain() {
  const { trees, grass, waves, dunes, rocks } = wtLayout()
  const coastOpen = wtSmoothOpen(WT_COAST)
  const seaPath = `${coastOpen} L ${WT_W} ${WT_H} L 0 ${WT_H} Z`
  const landPath = `${coastOpen} L ${WT_W} 0 L 0 0 Z`
  const use = (href) => (p, i) => <use key={i} href={href} transform={`translate(${p.x} ${p.y}) scale(${p.s})`} />
  return (
    <svg class="wm-terrain" viewBox={`0 0 ${WT_W} ${WT_H}`} width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="wt-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#93b5a9" />
          <stop offset="1" stop-color="#7aa094" />
        </linearGradient>
        <g id="wt-pine">
          <path d="M-1.6 0 h3.2 v-5 h-3.2 z" fill="#54412a" />
          <path d="M0 -26 L8.5 -10 H-8.5 Z" fill="#4f7040" />
          <path d="M0 -17 L10.5 -1 H-10.5 Z" fill="#43613a" />
        </g>
        <g id="wt-oak">
          <path d="M-1.7 0 h3.4 v-6 h-3.4 z" fill="#5d4527" />
          <circle cx="-6" cy="-10" r="6.5" fill="#5d7a44" />
          <circle cx="6" cy="-10" r="6.5" fill="#557141" />
          <circle cx="0" cy="-15" r="7.5" fill="#63834a" />
        </g>
        <g id="wt-dead" stroke="#4a4150" stroke-width="2.3" fill="none" stroke-linecap="round">
          <path d="M0 0 V-19 M0 -9 L-8 -16 M0 -14 L7 -22 M0 -18 L-5 -25" />
        </g>
        <g id="wt-palm">
          <path d="M0 0 q3 -10 1 -19" stroke="#7a5a30" stroke-width="2.6" fill="none" />
          <g stroke="#4f7a40" stroke-width="2" fill="none" stroke-linecap="round">
            <path d="M1 -19 q-9 -2 -14 4" /><path d="M1 -19 q9 -2 14 4" />
            <path d="M1 -19 q-7 -7 -13 -6" /><path d="M1 -19 q7 -7 13 -6" />
            <path d="M1 -19 q0 -9 -3 -12" />
          </g>
        </g>
        <g id="wt-reed" stroke="#6d7a4e" stroke-width="1.6" fill="none" stroke-linecap="round">
          <path d="M-4 0 q-1 -6 -3 -9 M0 0 q0 -8 -1 -11 M4 0 q1 -6 3 -10" />
        </g>
        <g id="wt-tuft" stroke="#7d8a56" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.6">
          <path d="M-3 0 q-1 -3 -2 -5 M0 0 q0 -4 0 -6 M3 0 q1 -3 2 -5" />
        </g>
        <path id="wt-wave" d="M-11 0 q5.5 -6 11 0 q5.5 6 11 0" stroke="#e7f0e6" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.55" />
        <path id="wt-dune" d="M-16 0 q8 -8 16 0 q4 4 10 2" stroke="#b3924f" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.6" />
        <g id="wt-rock">
          <path d="M-7 0 L-4 -6 L2 -7 L7 -2 L6 0 Z" fill="#b9a988" stroke="#6b5a3a" stroke-width="1" stroke-linejoin="round" />
        </g>
      </defs>

      {/* land wash over the parchment, then the biome tints */}
      <path d={landPath} fill="#adbe7c" opacity="0.42" />
      <path d={wtEllipseBlob(WT_DESERT, 0, 11)} fill="#e3cd96" opacity="0.85" />
      <path d={wtEllipseBlob(WT_DESERT, 40, 12)} fill="#ead7a2" opacity="0.6" />
      <path d={wtEllipseBlob(WT_DUSK, 0, 13)} fill="#a5a1b2" opacity="0.32" />
      <path d={wtEllipseBlob(WT_SWAMP, 0, 14)} fill="#9fae83" opacity="0.55" />
      <path d={wtEllipseBlob({ ...WT_ASH, ry: 80 }, 0, 15)} fill="#a08a7c" opacity="0.38" />

      {/* shoreline: beach under the waterline, then the sea, shallows and ink line */}
      <path d={coastOpen} fill="none" stroke="#efe4bd" stroke-width="12" opacity="0.8" />
      <path d={seaPath} fill="url(#wt-sea)" />
      <path d={coastOpen} fill="none" stroke="#a9c6ba" stroke-width="10" opacity="0.45" transform="translate(0 6)" />
      <path d={coastOpen} fill="none" stroke="#3f5a4e" stroke-width="1.8" opacity="0.55" />

      {/* loch + rivers */}
      <path d={wtSmoothClosed(WT_LAKE)} fill="url(#wt-sea)" stroke="#3f5a4e" stroke-width="1.6" opacity="0.95" />
      <g fill="none" stroke-linecap="round">
        <path d={wtSmoothOpen(WT_RIVER)} stroke="#5f4a28" stroke-width="12" opacity="0.25" />
        <path d={wtSmoothOpen(WT_RIVER)} stroke="#86ac9f" stroke-width="8" opacity="0.95" />
        <path d={wtSmoothOpen(WT_RIVER2)} stroke="#5f4a28" stroke-width="10" opacity="0.22" />
        <path d={wtSmoothOpen(WT_RIVER2)} stroke="#86ac9f" stroke-width="6.5" opacity="0.95" />
      </g>

      {/* oasis pool in the sands */}
      <ellipse cx="1008" cy="866" rx="26" ry="12" fill="#86ac9f" stroke="#3f5a4e" stroke-width="1.2" opacity="0.95" />

      {/* mountains, then flora sorted by y so overlaps stack naturally */}
      {WT_PEAKS.map(([x, y, s], i) => <WtPeak key={i} x={x} y={y} s={s} />)}
      {rocks.map(use('#wt-rock'))}
      {grass.map(use('#wt-tuft'))}
      {dunes.map(use('#wt-dune'))}
      {trees.map((t, i) => <use key={i} href={`#wt-${t.kind}`} transform={`translate(${t.x} ${t.y}) scale(${t.s})`} />)}

      {/* fields by Lumbright (the cabbage farms of its lore): furrows + cabbage rows */}
      {[[788, 645, -10, 68, 40], [906, 792, 7, 60, 36]].map(([fx, fy, rot, fw, fh], fi) => (
        <g key={fi} transform={`translate(${fx} ${fy}) rotate(${rot})`} opacity="0.85">
          <rect x={-fw / 2} y={-fh / 2} width={fw} height={fh} rx="4" fill="#cdbd7e" stroke="#7c6434" stroke-width="1.3" />
          {[-1, 0, 1].map((row) => (
            <g key={row}>
              <line x1={-fw / 2 + 6} y1={row * 11 + 5} x2={fw / 2 - 6} y2={row * 11 + 5} stroke="#7c6434" stroke-width="1.1" opacity="0.6" />
              {[-2, -1, 0, 1, 2].map((col) => (
                <circle key={col} cx={col * (fw / 5.6)} cy={row * 11} r="2.6" fill="#6f8a48" stroke="#4c6132" stroke-width="0.7" />
              ))}
            </g>
          ))}
        </g>
      ))}

      {/* Brimhollow's smoking cone on the headland */}
      <g>
        <path d="M1222 1043 L1252 973 h24 L1306 1043 Z" fill="#5a4640" stroke="#32241f" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M1252 973 h24 l-5 9 h-14 z" fill="#22140f" />
        <path d="M1256 968 q8 -12 16 0 q-4 -4 -8 0 q-4 -4 -8 0z" fill="#e06a2b" />
        <path d="M1268 950 q10 -10 4 -22" stroke="#8a7a70" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.6" />
      </g>

      {/* sea ornaments + waves */}
      {waves.map(use('#wt-wave'))}
      <WtCompass x={150} y={1005} />
      <WtShip x={760} y={1046} />
      <WtSerpent x={1420} y={1090} />

      {/* engraved region names */}
      {WT_LABELS.map(([x, y, text, size, fill, op, rot], i) => (
        <text
          key={i}
          x={x}
          y={y}
          text-anchor="middle"
          font-size={size}
          fill={fill}
          opacity={op}
          font-style="italic"
          transform={rot ? `rotate(${rot} ${x} ${y})` : undefined}
          style={{ fontFamily: 'var(--fm-fell)', letterSpacing: '0.14em' }}
        >{text}</text>
      ))}
    </svg>
  )
}
