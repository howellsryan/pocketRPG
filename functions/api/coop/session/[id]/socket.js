// The live transport for a co-op boss fight or a raid.
//
// POST mints a ticket, GET spends it on a WebSocket. Two verbs on one path
// because they are one act: a browser's WebSocket constructor cannot set an
// Authorization header, so the session JWT is exchanged — over an ordinary
// authenticated request — for a 60s, single-purpose token the socket URL may
// carry. That is the same shape as the open world's `world_handoff`
// (functions/api/world-token.js), and for the same reason.
//
// The ticket is verified HERE, before the upgrade is handed to the Durable
// Object, so an unauthenticated socket never costs a room anything. It is also
// the last D1 read the fight needs: polling ran `getOwnedCharacter` on every
// beat, which for a full room was ~800 `characters` reads a minute purely to
// re-learn who was asking.

import { requireAuth, json } from '../../../../_lib/auth.js'
import { getOwnedCharacter } from '../../../../_lib/pvp.js'
import { signJWT, verifyJWT } from '../../../../_lib/jwt.js'
import { openCoopRoomSocket } from '../../../../_lib/game/coopRoom.js'
import { parseCoopSessionId } from '../../../../_lib/game/coopBoss.js'
import { toErrorResponse } from '../../../../_lib/game/errors.js'

const TICKET_EXPIRES_SECONDS = 60
const TICKET_SCOPE = 'coop_socket'

export async function onRequestPost({ request, env, params }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const ch = await getOwnedCharacter(request, env, auth.identity.id)
  if (ch.error) return json({ error: ch.error }, ch.status)

  const sessionId = parseCoopSessionId(params.id)
  if (sessionId === null) return json({ error: 'Invalid session id' }, 400)

  // Bound to this character AND this session: a ticket is a key to one fight,
  // not a bearer token for the co-op surface.
  const ticket = await signJWT(
    { sub: auth.identity.id, character_id: ch.id, session_id: sessionId, scope: TICKET_SCOPE },
    env.JWT_SECRET,
    TICKET_EXPIRES_SECONDS,
  )
  return json({ ticket, expires_in: TICKET_EXPIRES_SECONDS })
}

export async function onRequestGet({ request, env, params }) {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return json({ error: 'expected_websocket' }, 426)
  }

  const sessionId = parseCoopSessionId(params.id)
  if (sessionId === null) return json({ error: 'Invalid session id' }, 400)

  const url = new URL(request.url)
  const payload = await verifyJWT(url.searchParams.get('ticket') || '', env.JWT_SECRET)
  if (!payload || payload.scope !== TICKET_SCOPE || !payload.character_id) {
    return json({ error: 'Invalid or expired ticket' }, 401)
  }
  // A ticket for another fight is not a ticket for this one, even though the
  // signature is good — the room would happily seat a valid member of a
  // different session otherwise.
  if (Number(payload.session_id) !== sessionId) return json({ error: 'Invalid or expired ticket' }, 401)

  const sinceTick = Number(url.searchParams.get('sinceTick'))

  try {
    const res = await openCoopRoomSocket(env, sessionId, {
      characterId: Number(payload.character_id),
      sinceTick: Number.isFinite(sinceTick) ? sinceTick : undefined,
    })
    // Passed straight through: a 101 carries the socket the runtime splices to
    // the client, and anything else is the room's own refusal — including the
    // 404 an older Worker gives an action it has never heard of, which is what
    // sends a client back to polling.
    if (res.status === 101) return res
    const body = await res.json().catch(() => null)
    return json(body ?? { error: 'coop_room_unavailable' }, res.status)
  } catch (err) {
    const mapped = toErrorResponse(err)
    return json(mapped.body, mapped.status)
  }
}
