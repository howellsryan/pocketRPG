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
 *
 * Vector art uses the theme CSS variables (`var(--color-…)`) for cohesion with the rest
 * of the UI. Keep it dependency-free and self-contained — this is the single home for
 * map art.
 */

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
