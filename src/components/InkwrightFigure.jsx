/**
 * The Inkwright body — hood, tunic, legs, back arm. Shared by every context
 * that draws the figure: skilling (InkwrightStage.jsx) and combat
 * (InkwrightCombatStage.jsx). One character, reused everywhere, is the whole
 * point of the name — this file exists so the geometry can only ever drift
 * from itself, never from a second copy of itself.
 *
 * Deliberately NOT the front arm or whatever it's holding: those differ by
 * context (a pickaxe vs a sword vs a bow), so the caller renders them as
 * `children` inside its own `<g class="ink-arm">` (or `.inkc-arm`), matching
 * how the shoulder-pivot rotation already worked before this was extracted.
 *
 * No face, on purpose — nothing to keep consistent across every verb and
 * every weapon. The cowl drapes FORWARD over the brow; drawn peaking upward
 * it reads as an animal ear, which is what the first pass drew (CLAUDE.md's
 * action-animation skill records the same lesson for the tool heads).
 */
export default function InkwrightFigure({ children }) {
  return (
    <>
      <g class="ink-legs">
        <Limb d="M72 84 L63 96 L55 103" w={12} back />
        <Limb d="M78 84 L86 97 L95 104" w={13} />
      </g>
      <Limb d="M78 60 L68 70 L66 78" w={10} back />

      <path class="ink-cloth" d="M67 54 Q64 72 66 86 L86 86 Q88 72 86 54 Z" />
      <path class="ink-line" d="M66.5 73 L86.5 73" />

      <path class="ink-cloth" d="M65 57 Q57 45 62 32 Q69 21 81 23 Q94 26 94 41 Q94 51 89 57 Z" />
      <path class="ink-hollow" d="M85 33 Q93 36 92 45 Q90 52 84 53 Q80 43 85 33 Z" />
      <path class="ink-cloth2" d="M64 53 Q76 63 90 53 Q92 60 86 65 L68 65 Q62 60 64 53 Z" />

      {children}
    </>
  )
}

/** An outlined limb: one ink stroke with a narrower cloth stroke on top.
 * Drawn the other way round it renders a stick with a halo. */
export function Limb({ d, w, back = false }) {
  return (
    <g>
      <path class="ink-limb-ink" d={d} style={{ strokeWidth: w }} />
      <path class={back ? 'ink-limb-back' : 'ink-limb-fill'} d={d} style={{ strokeWidth: w - 6.2 }} />
    </g>
  )
}
