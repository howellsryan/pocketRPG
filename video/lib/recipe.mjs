/**
 * Recipe schema, timeline maths and caption layout — the pure half of the video
 * pipeline. No browser, no ffmpeg, no filesystem, so `tests/videoRecipe.test.ts`
 * can cover it as ordinary logic (TESTING.md: logic-only Vitest).
 *
 * A recipe is a declarative shot list. Everything the renderer needs to know
 * about timing and text lives here; video/render.mjs only executes it.
 */

// TikTok's chrome sits over every video: caption/handle bottom-left, action rail
// right, and a top band. Published safe-zone guidance varies by a few dozen px
// and shifts between app versions, so these are the conservative end of the
// 2026 range — text inside this box survives a rail that grows a button.
export const FRAME = { width: 1080, height: 1920 }
export const SAFE_ZONE = { top: 140, bottom: 480, left: 60, right: 180 }

export const DEFAULT_FPS = 30
// Must match video/lib/overlay.mjs's captionSize, or the pre-flight fit check
// validates a different size from the one actually drawn.
export const CAPTION_FONT_SIZE = 52
export const HOOK_FONT_SIZE = 76
// Below ~2s a caption cannot be read before it is gone; TikTok retention work
// puts the floor higher than feels right when reading it on a desktop.
export const MIN_CAPTION_MS = 1200

const ACTIONS = new Set(['nav', 'click', 'text', 'hold', 'reseed', 'scroll', 'back', 'demo'])
// Actions addressed by a string target. `nav`/`click` resolve an accessible
// name; `text` matches visible text, for the parts of the UI that hang onClick
// on a plain div (the mobile monster rows) where getByRole finds nothing.
const TARGETED = new Set(['nav', 'click', 'text'])

/** Usable text box in frame pixels, after TikTok's UI overlays. */
export function safeBox(frame = FRAME, zone = SAFE_ZONE) {
  const width = frame.width - zone.left - zone.right
  const height = frame.height - zone.top - zone.bottom
  if (width <= 0 || height <= 0) throw new Error('safe zone leaves no usable area')
  return { x: zone.left, y: zone.top, width, height }
}

function fail(path, msg) {
  throw new Error(`recipe${path ? ` ${path}` : ''}: ${msg}`)
}

/**
 * Validate and normalise. Throws on anything the renderer cannot execute — a
 * recipe that fails here must never reach a browser, because a silently wrong
 * shot list records the wrong screen and looks like a capture bug.
 */
export function validateRecipe(input) {
  if (!input || typeof input !== 'object') fail('', 'must be an object')
  const { id, title, scenes } = input

  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail('.id', 'must be a kebab-case slug (it names the output file)')
  }
  if (title != null && typeof title !== 'string') fail('.title', 'must be a string')
  if (!Array.isArray(scenes) || scenes.length === 0) fail('.scenes', 'must be a non-empty array')

  const fps = input.fps ?? DEFAULT_FPS
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) fail('.fps', 'must be an integer 1-60')

  // Top-level fields are validated too: a typo here is otherwise a silent no-op
  // that only shows up as missing text in a finished render.
  for (const key of ['hook', 'outro']) {
    if (input[key] != null && (typeof input[key] !== 'string' || !input[key].trim())) {
      fail(`.${key}`, 'must be a non-empty string when present')
    }
  }
  if (input.hookMs != null && (!Number.isFinite(input.hookMs) || input.hookMs < 0)) {
    fail('.hookMs', 'must be a non-negative number')
  }
  if (input.seed != null && typeof input.seed !== 'object') fail('.seed', 'must be an object')

  const normalised = scenes.map((scene, i) => {
    const at = `.scenes[${i}]`
    if (!scene || typeof scene !== 'object') fail(at, 'must be an object')
    const action = scene.action
    if (!ACTIONS.has(action)) {
      fail(`${at}.action`, `unknown action '${action}' (have: ${[...ACTIONS].join(', ')})`)
    }
    const holdMs = scene.holdMs ?? 1500
    if (!Number.isFinite(holdMs) || holdMs < 0) fail(`${at}.holdMs`, 'must be a non-negative number')

    // `target` names an accessible name (getByRole), never a CSS selector — the
    // game's nav labels are visually hidden, so text matching silently misses.
    if (TARGETED.has(action) && typeof scene.target !== 'string') {
      fail(`${at}.target`, `action '${action}' requires a target (accessible name)`)
    }
    if (action === 'reseed' && (!scene.seed || typeof scene.seed !== 'object')) {
      fail(`${at}.seed`, "action 'reseed' requires a seed object")
    }
    if (scene.caption != null) {
      if (typeof scene.caption !== 'string' || !scene.caption.trim()) {
        fail(`${at}.caption`, 'must be a non-empty string when present')
      }
      if (holdMs < MIN_CAPTION_MS) {
        fail(`${at}.holdMs`, `a captioned scene needs at least ${MIN_CAPTION_MS}ms to be readable (got ${holdMs})`)
      }
    }
    return { ...scene, action, holdMs }
  })

  return { ...input, id, fps, scenes: normalised }
}

/**
 * Absolute timing for every scene. Durations are the recipe's INTENT; the
 * renderer's frame pump remains wall-clock authoritative, so a scene that takes
 * longer than planned (a slow click) simply holds its caption longer rather
 * than desynchronising everything after it.
 */
export function planTimeline(recipe) {
  const valid = validateRecipe(recipe)
  let cursor = 0
  const scenes = valid.scenes.map((scene, index) => {
    const startMs = cursor
    cursor += scene.holdMs
    return {
      index,
      action: scene.action,
      target: scene.target ?? null,
      caption: scene.caption ?? null,
      startMs,
      endMs: cursor,
      startFrame: Math.round((startMs / 1000) * valid.fps),
      endFrame: Math.round((cursor / 1000) * valid.fps),
    }
  })
  return { fps: valid.fps, durationMs: cursor, totalFrames: Math.round((cursor / 1000) * valid.fps), scenes }
}

/**
 * Rough wrap so a caption's height can be checked against the safe box before
 * a 60-second render finds out the hard way. Deliberately conservative: it
 * assumes a wide average glyph, so it over-estimates rather than under.
 */
export function wrapCaption(text, { maxWidth, fontSize }) {
  if (!text?.trim()) return []
  const perChar = fontSize * 0.58
  const maxChars = Math.max(1, Math.floor(maxWidth / perChar))
  const lines = []
  let line = ''
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maxChars) { line = candidate; continue }
    if (line) lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines
}

/** Does this caption fit the safe box at this size? */
export function captionFits(text, { fontSize, lineHeight = 1.25, frame = FRAME, zone = SAFE_ZONE }) {
  const box = safeBox(frame, zone)
  const lines = wrapCaption(text, { maxWidth: box.width, fontSize })
  return { lines, height: lines.length * fontSize * lineHeight, fits: lines.length * fontSize * lineHeight <= box.height }
}
