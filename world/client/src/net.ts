import { PartySocket } from 'partysocket'
import type { ClientMessage, ServerMessage } from '../../shared/protocol'

export function connect(host: string, room: string): PartySocket {
  return new PartySocket({ host, party: 'world-zone', room })
}

export function send(socket: PartySocket, message: ClientMessage): void {
  socket.send(JSON.stringify(message))
}

export function onMessage(socket: PartySocket, handler: (msg: ServerMessage) => void): void {
  socket.addEventListener('message', (event) => {
    handler(JSON.parse(event.data as string) as ServerMessage)
  })
}
