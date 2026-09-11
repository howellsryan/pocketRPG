import { json } from '../../_lib/auth.js'
import { auditLog } from '../../_lib/game/audit.js'
import { claimActionNonce } from '../../_lib/game/nonces.js'
import { forfeitSunspireRunState } from '../../_lib/game/sunspireRun.js'
import { getLatestSunspireRun, getOpenSunspireRun, persistSunspireRun } from '../../_lib/game/sunspireStore.js'
import { sunspireBody, sunspireCharacter, sunspireError } from '../../_lib/game/sunspireApi.js'
import { GameApiError } from '../../_lib/game/errors.js'

export async function onRequestPost({ request, env }) {
  const ctx = await sunspireCharacter(request, env)
  if (ctx.response) return ctx.response
  try {
    const body = await sunspireBody(request)
    const nonce = typeof body?.actionNonce === 'string' ? body.actionNonce : null
    let run = await getOpenSunspireRun(env, ctx.character.id)
    if (!run) {
      const latest = await getLatestSunspireRun(env, ctx.character.id)
      if (latest?.status === 'forfeited' && latest.last_action_nonce === nonce) return json({ ok: true, replayed: true, run: latest })
      throw new GameApiError('SUNSPIRE_RUN_MISSING', 'No active Sunspire run', 404)
    }
    await claimActionNonce(env, ctx.character.id, nonce)
    const next = forfeitSunspireRunState(run)
    next.last_action_nonce = nonce
    run = await persistSunspireRun(env, ctx.character.id, next)
    await auditLog(env, 'sunspire.run.forfeit', {
      characterId: ctx.character.id, runId: run.run_id, clearedWave: run.cleared_wave,
    }, { swallow: true })
    return json({ ok: true, run })
  } catch (err) {
    return sunspireError(err)
  }
}
