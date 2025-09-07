import * as Cli from '@effect/cli'
import { HttpClient, HttpClientRequest } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { getFreePort } from '../../services/free-port.ts'
import { createMcpServerLayer } from '../../services/mcp-server.js'

// Invokes the MCP tool to clear the state store
export const stateClearCommand = Cli.Command.make('state-clear', {}, () =>
  Effect.flatMap(getFreePort, (port) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      // Allow the server to bind
      yield* Effect.sleep('100 millis')

      const request = HttpClientRequest.post(`http://localhost:${port}/mcp`).pipe(
        HttpClientRequest.bodyText(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'dilagent_state_clear',
              arguments: {},
            },
          }),
          'application/json',
        ),
      )

      const response = yield* client.execute(request)
      const data = yield* response.json

      // Print succinct confirmation; fall back to raw data if unexpected
      if (data && typeof data === 'object' && 'result' in data) {
        console.log('State store cleared')
      } else if (Array.isArray(data) && data[0] && typeof data[0] === 'object' && 'result' in data[0]) {
        console.log('State store cleared')
      } else {
        console.log(JSON.stringify(data, null, 2))
      }
    }).pipe(
      Effect.withSpan('state-clear'),
      Effect.provide(Layer.mergeAll(createMcpServerLayer(port), NodeContext.layer)),
      Effect.scoped,
    ),
  ),
)
