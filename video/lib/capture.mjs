/**
 * Screen capture via CDP `Page.startScreencast`, encoded to H.264 by ffmpeg.
 *
 * Why not Playwright's `recordVideo`: it ignores `deviceScaleFactor` (a 2x
 * context still records 1x content padded into the frame), its Chromium bitrate
 * is hardcoded ~1 Mbit/s with no quality option, and the output is variable
 * frame rate. All three are disqualifying at 1080x1920. Playwright exposes no
 * public screencast API (checked 1.62 types), so we drive CDP directly.
 *
 * Screencast pushes a frame only when the page repaints. PocketRPG's UI is
 * tick-driven and repaints roughly once or twice a second, so the raw stream is
 * far below any usable frame rate. The pump below holds the most recent frame
 * and emits it on a fixed cadence, converting that VFR stream into true CFR.
 *
 * The pump is wall-clock authoritative: each tick it computes how many frames
 * *should* exist by now and writes the shortfall. An event-loop stall therefore
 * costs no duration — output length always matches real elapsed time, which is
 * what keeps captions aligned with what is on screen.
 */
import { spawn } from 'node:child_process'

export function createCapture({ page, cdpSession, fps = 30, out, ffmpegPath, crf = 20, quality = 92, width, height }) {
  if (!page || !cdpSession) throw new Error('capture: page and cdpSession are required')
  if (!out) throw new Error('capture: out path is required')
  if (!ffmpegPath) throw new Error('capture: ffmpegPath is required')
  // Screencast defaults to CSS-pixel frames — unlike page.screenshot() it does
  // NOT apply deviceScaleFactor on its own. Without an explicit max the capture
  // silently comes out at the CSS viewport (390x694) instead of 1080x1920.
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('capture: explicit integer width/height are required (screencast ignores deviceScaleFactor)')
  }

  const frameMs = 1000 / fps
  let lastFrame = null
  let written = 0
  let startedAt = 0
  let pausedAt = 0
  let timer = null
  let ffmpeg = null
  let stderr = ''

  const onFrame = async ({ data, sessionId }) => {
    lastFrame = Buffer.from(data, 'base64')
    // Chromium stops sending frames until each one is acked.
    try { await cdpSession.send('Page.screencastFrameAck', { sessionId }) } catch { /* torn down */ }
  }

  async function start() {
    ffmpeg = spawn(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
      // Chromium sizes screencast frames to fit maxWidth/maxHeight preserving
      // aspect, so they can land a pixel short. Pin the output exactly, and
      // reset the sample aspect: scaling a slightly-off source leaves a
      // non-square SAR, which encodes 1080x1920 but *displays* as not-quite-9:16.
      '-vf', `scale=${width}:${height}:flags=lanczos,setsar=1`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf),
      // TikTok re-encodes anyway; yuv420p + faststart is what it expects to get.
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps),
      out,
    ], { stdio: ['pipe', 'ignore', 'pipe'] })
    ffmpeg.stderr.on('data', (d) => { stderr += d })
    ffmpeg.stdin.on('error', () => { /* closed early; surfaced via exit code */ })

    cdpSession.on('Page.screencastFrame', onFrame)
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg', quality, everyNthFrame: 1, maxWidth: width, maxHeight: height,
    })

    // A first frame is not guaranteed until something paints; force one so the
    // pump never opens the stream with an empty buffer.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))).catch(() => {})
    const deadline = Date.now() + 5000
    while (!lastFrame && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    if (!lastFrame) throw new Error('capture: no screencast frame arrived within 5s')

    startedAt = Date.now()
    timer = setInterval(pump, frameMs / 2)
    pump()
  }

  function pump() {
    if (!lastFrame || !ffmpeg?.stdin.writable) return
    const due = Math.floor((Date.now() - startedAt) / frameMs) + 1
    while (written < due) { ffmpeg.stdin.write(lastFrame); written++ }
  }

  /**
   * Stop writing frames without tearing the encoder down. A reseed reloads the
   * page, and several seconds of boot screen between two progression states is
   * dead air; pausing across it turns the transition into a jump cut.
   */
  function pause() {
    if (!timer) return
    pump()
    clearInterval(timer)
    timer = null
    pausedAt = Date.now()
  }

  /** Resume, discounting the paused span so the pump's wall clock stays true. */
  function resume() {
    if (timer || !pausedAt) return
    startedAt += Date.now() - pausedAt
    pausedAt = 0
    timer = setInterval(pump, frameMs / 2)
  }

  async function stop() {
    if (timer) { pump(); clearInterval(timer); timer = null }
    cdpSession.off?.('Page.screencastFrame', onFrame)
    await cdpSession.send('Page.stopScreencast').catch(() => {})
    const wallMs = Date.now() - startedAt
    await new Promise((resolve, reject) => {
      ffmpeg.on('close', (code) => code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-1500)}`)))
      ffmpeg.stdin.end()
    })
    return { frames: written, wallMs, durationMs: Math.round((written / fps) * 1000) }
  }

  /** Tear the encoder down without waiting for a clean file (failure paths). */
  function abort() {
    if (timer) { clearInterval(timer); timer = null }
    ffmpeg?.kill('SIGKILL')
  }

  return { start, stop, pause, resume, abort, get frames() { return written } }
}
