import { json } from '../../_lib/auth.js'
import { auditLog } from '../../_lib/game/audit.js'
import { createSunspireRun, getLatestSunspireRun, getOpenSunspireRun } from '../../_lib/game/sunspireStore.js'
import { sunspireCharacter, sunspireError } from '../../_lib/game/sunspireApi.js'

export async function onRequestGet({ request, env }) {
  const ctx = await sunspireCharacter(request, env, { requireSoloLock: false })
  if (ctx.response) return ctx.response
  try {
    const run = await getOpenSunspireRun(env, ctx.character.id) || await getLatestSunspireRun(env, ctx.character.id)
    return json({ ok: true, run })
  } catch (err) {
    return sunspireError(err)
  }
}

export async function onRequestPost({ request, env }) {
  const ctx = await sunspireCharacter(request, env)
  if (ctx.response) return ctx.response
  try {
    const run = await createSunspireRun(env, ctx.character.id)
    await auditLog(env, 'sunspire.run.start', {
      characterId: ctx.character.id, identityId: ctx.auth.identity.id, runId: run.run_id,
    }, { swallow: true })
    return json({ ok: true, run })
  } catch (err) {
    return sunspireError(err)
  }
}
