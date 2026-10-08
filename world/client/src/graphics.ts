export type GraphicsQuality = { pixelRatio: number; shadowSize: number }

export function createGraphicsBudget(nativeDpr: number, mobile: boolean): {
  readonly current: GraphicsQuality
  observe: (frameMs: number) => boolean
  reset: () => void
} {
  const dpr = Number.isFinite(nativeDpr) && nativeDpr > 0 ? nativeDpr : 1
  const levels = (mobile ? [1.25, 1] : [2, 1.5, 1.25, 1])
    .map(ratio => Math.min(dpr, ratio)).filter((ratio, i, all) => i === 0 || ratio !== all[i - 1])
  let level = 0
  let elapsed = 0, frames = 0, slow = 0
  const reset = (): void => { elapsed = 0; frames = 0; slow = 0 }
  return {
    get current() { return { pixelRatio: levels[level], shadowSize: mobile || level > 0 ? 512 : 1024 } },
    observe(frameMs) {
      if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) { reset(); return false }
      elapsed += frameMs
      frames++
      if (frameMs > 25) slow++
      if (elapsed < 2000 || frames < 20) return false
      const lower = slow / frames > .5 && level < levels.length - 1
      reset()
      if (lower) level++
      return lower
    },
    reset,
  }
}
