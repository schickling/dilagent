import { HttpClient, HttpClientRequest } from '@effect/platform'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { getFreePort } from '../src/services/free-port.ts'
import { createMcpServerLayer } from '../src/services/mcp-server.ts'

const program = Effect.flatMap(getFreePort, (port) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    // Give the MCP server a moment to start
    yield* Effect.sleep('100 millis')

    const req = HttpClientRequest.post(`http://localhost:${port}/mcp`).pipe(
      HttpClientRequest.bodyText(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'deebug_state_clear', arguments: {} },
        }),
        'application/json',
      ),
    )

    const res = yield* client.execute(req)
    const data = yield* res.json
    console.log('Tool response:', JSON.stringify(data))
  }).pipe(
    Effect.provide(Layer.mergeAll(createMcpServerLayer(port), NodeContext.layer)),
    Effect.scoped,
  ),
)

NodeRuntime.runMain(program)

