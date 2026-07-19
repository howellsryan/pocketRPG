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
