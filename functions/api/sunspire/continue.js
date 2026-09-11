import { json } from '../../_lib/auth.js'
import { auditLog } from '../../_lib/game/audit.js'
import { claimActionNonce } from '../../_lib/game/nonces.js'
import { chooseSunspireModifier } from '../../_lib/game/sunspireRun.js'
import { getOpenSunspireRun, persistSunspireRun } from '../../_lib/game/sunspireStore.js'
import { sunspireBody, sunspireCharacter, sunspireError } from '../../_lib/game/sunspireApi.js'
import { GameApiError } from '../../_lib/game/errors.js'

export async function onRequestPost({ request, env }) {
  const ctx = await sunspireCharacter(request, env)
  if (ctx.response) return ctx.response
  try {
    const body = await sunspireBody(request)
    const nonce = typeof body?.actionNonce === 'string' ? body.actionNonce : null
    const modifierId = typeof body?.modifierId === 'string' ? body.modifierId : null
    const run = await getOpenSunspireRun(env, ctx.character.id)
    if (!run) throw new GameApiError('SUNSPIRE_RUN_MISSING', 'No active Sunspire run', 404)
    if (run.status === 'active' && run.last_action_nonce === nonce) return json({ ok: true, replayed: true, run })
    if (run.status !== 'decision') throw new GameApiError('SUNSPIRE_NOT_DECISION', 'Sunspire run is not awaiting a modifier', 409)

    await claimActionNonce(env, ctx.character.id, nonce)
    const next = chooseSunspireModifier(run, modifierId)
    next.last_action_nonce = nonce
    const persisted = await persistSunspireRun(env, ctx.character.id, next)
    await auditLog(env, 'sunspire.modifier.choose', {
      characterId: ctx.character.id, runId: persisted.run_id, modifierId, tier: persisted.modifierState?.[modifierId] || 0,
    }, { swallow: true })
    return json({ ok: true, run: persisted })
  } catch (err) {
    return sunspireError(err)
  }
}
