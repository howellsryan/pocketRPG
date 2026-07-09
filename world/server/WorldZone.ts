import { Server, type Connection } from 'partyserver'

export class WorldZone extends Server {
  onConnect(connection: Connection) {
    connection.send(JSON.stringify({ t: 'error', code: 'not_implemented', msg: 'World placeholder' }))
  }
}
