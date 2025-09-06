import { Effect, Layer } from 'effect'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { HttpClient, HttpClientRequest, FetchHttpClient } from '@effect/platform'
import { createMcpServerLayer } from '../src/services/mcp-server.js'
import { getFreePort } from '../src/services/free-port.ts'
import { StateStore } from '../src/services/state-store.ts'

// Seed value to make sure the key exists
const seedStore = (key: string, value: unknown) =>
  Effect.gen(function* () {
    const store = yield* StateStore
    // @ts-expect-error value schema is enforced by tools; for testing we trust value
    yield* store.set(key, value)
  })

const callTool = (port: number, name: string, args: unknown) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: 1,
    })

    const request = HttpClientRequest.post(`http://localhost:${port}/mcp`).pipe(
      HttpClientRequest.bodyText(body, 'application/json'),
    )

    const response = yield* client.execute(request)
    const json = (yield* response.json) as any

    // Some environments wrap responses in an array; normalize
    const payload = Array.isArray(json) ? json[0] : json
    if (payload.error) {
      console.error('Tool error:', payload.error)
      process.exit(1)
    }
    return payload.result
  })

const program = Effect.gen(function* () {
  const port = yield* getFreePort

  // Provide server + state store
  const layer = Layer.mergeAll(
    createMcpServerLayer(port).pipe(Layer.provideMerge(StateStore.Default)),
    NodeContext.layer,
    FetchHttpClient.layer,
  )

  // Seed known key
  const key = 'existing-key'
  const value = { _tag: 'Disproven' as const, hypothesisId: 'H002', reason: 'Test reason', evidence: 'Test evidence', newhypothesisIdeas: [] }

  // Wait a tick for server startup and then call tool
  const result = yield* Effect.gen(function* () {
    yield* seedStore(key, value)
    yield* Effect.sleep('100 millis')
    const out = yield* callTool(port, 'deebug_state_get', { key })
    return out
  }).pipe(Effect.provide(layer), Effect.scoped)

  console.log(JSON.stringify(result, null, 2))
})

NodeRuntime.runMain(program)
