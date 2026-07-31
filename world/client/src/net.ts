import { PartySocket } from 'partysocket'
import type { ClientMessage, ServerMessage } from '../../shared/protocol'

/** A 1008 (policy) close is the server rejecting THIS session — bad/expired
 * token, character absent from the world's D1, active PvP match. Reconnecting
 * re-sends the same rejected token forever (a black screen with an endless
 * "Reconnecting…"), so don't: the close handler surfaces the login screen
 * instead. Network drops close with 1006/1001 and must still auto-reconnect. */
export function shouldReconnectOnClose(event: { code: number }): boolean {
  return event.code !== 1008
}

/** A 1008 close that refuses the ROOM, not the session: an instanced boss lair
 * that filled up between being assigned and being joined. The token is still
 * good, so this must not be treated as a logout — the caller falls back to the
 * overworld instead of dropping the player at the login screen. */
export function isInstanceFullClose(event: { code: number; reason?: string }): boolean {
  return event.code === 1008 && event.reason === 'instance_full'
}

/** A 1008 close from dying in an instanced boss lair (WorldZone's
 * ejectFromInstanceDeath) — expected and deliberate, not a rejected session.
 * The `instanceDeath` message that preceded it already put up the death
 * choice screen, so this must not be treated as a logout either. */
export function isInstanceDeathClose(event: { code: number; reason?: string }): boolean {
  return event.code === 1008 && event.reason === 'instance_death'
}

export function connect(host: string, room: string): PartySocket {
  return new PartySocket({ host, party: 'world-zone', room, shouldReconnectOnClose })
}

export function send(socket: PartySocket, message: ClientMessage): void {
  socket.send(JSON.stringify(message))
}

export function onMessage(socket: PartySocket, handler: (msg: ServerMessage) => void): void {
  socket.addEventListener('message', (event) => {
    handler(JSON.parse(event.data as string) as ServerMessage)
  })
}
