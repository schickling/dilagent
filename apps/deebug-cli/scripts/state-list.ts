import { HttpClient, HttpClientRequest } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { getFreePort } from '../src/services/free-port.ts'
import { createMcpServerLayer } from '../src/services/mcp-server.ts'
import { StateStore } from '../src/services/state-store.ts'

// Start a temporary MCP server and call the deebug_state_list tool via HTTP JSON-RPC
const program = (port: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    // Give the server a brief moment to start
    yield* Effect.sleep('100 millis')

    // List tools first (useful for troubleshooting)
    const listReq = HttpClientRequest.post(`http://localhost:${port}/mcp`).pipe(
      HttpClientRequest.bodyText(
        JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 }),
        'application/json',
      ),
    )
    const listRes = yield* client.execute(listReq)
    const listJson: any = yield* listRes.json

    // Call the list tool
    const callBody = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'deebug_state_list', arguments: {} },
      id: 2,
    })

    const callReq = HttpClientRequest.post(`http://localhost:${port}/mcp`).pipe(
      HttpClientRequest.bodyText(callBody, 'application/json'),
    )
    const callRes = yield* client.execute(callReq)
    const callJson: any = yield* callRes.json

    // Server responses are wrapped in an array; unwrap if needed
    const unwrap = (x: any) => (Array.isArray(x) ? x[0] : x)
    const listResp = unwrap(listJson)
    const callResp = unwrap(callJson)

    if (callResp?.error) {
      console.error('Tool call error:', callResp.error)
      process.exit(1)
    }

    // The result shape depends on MCP server implementation; print raw result for clarity
    console.log(JSON.stringify({ tools: listResp?.result?.tools ?? null, result: callResp?.result ?? null }, null, 2))
  })

// Provide the server layer with a free port dynamically and scope the server lifetime
const main = Effect.flatMap(getFreePort, (port) =>
  program(port).pipe(
    Effect.provide(Layer.mergeAll(createMcpServerLayer(port), StateStore.Default, NodeContext.layer)),
    Effect.scoped,
  ),
)

Effect.runPromise(main).catch((err) => {
  console.error(err)
  process.exit(1)
})
