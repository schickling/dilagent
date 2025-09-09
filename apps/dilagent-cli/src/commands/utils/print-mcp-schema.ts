import * as os from 'node:os'
import * as Cli from '@effect/cli'
import { HttpClient, HttpClientRequest } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { Effect, Layer, Logger } from 'effect'
import { getFreePort } from '../../services/free-port.ts'
import { createMcpServerLayer } from '../../services/mcp-server.ts'
import { StateStore } from '../../services/state-store.ts'
import { WorkingDirService } from '../../services/working-dir.ts'

export const printMcpSchemaCommand = Cli.Command.make('print-mcp-schema', {}, () =>
  Effect.flatMap(getFreePort, (port) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      // Wait a bit for the server to start
      yield* Effect.sleep('100 millis')

      // Make request to list tools
      const request = HttpClientRequest.post(`http://localhost:${port}/mcp`).pipe(
        HttpClientRequest.bodyText(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/list',
            params: {},
            id: 1,
          }),
          'application/json',
        ),
      )

      const response = yield* client.execute(request)
      const responseData = yield* response.json

      // Extract and format the schema for cleaner output
      if (Array.isArray(responseData)) {
        // Handle array response format
        const firstResponse = responseData[0]
        if (firstResponse && typeof firstResponse === 'object' && 'result' in firstResponse) {
          const result = firstResponse.result as { tools?: unknown[] }
          if (result.tools) {
            console.log(JSON.stringify({ tools: result.tools }, null, 2))
          } else {
            console.log(JSON.stringify(responseData, null, 2))
          }
        } else {
          console.log(JSON.stringify(responseData, null, 2))
        }
      } else if (responseData && typeof responseData === 'object' && 'result' in responseData) {
        // Handle single response format
        const result = responseData.result as { tools?: unknown[] }
        if (result.tools) {
          console.log(JSON.stringify({ tools: result.tools }, null, 2))
        } else {
          console.log(JSON.stringify(responseData, null, 2))
        }
      } else {
        console.log(JSON.stringify(responseData, null, 2))
      }
    }).pipe(
      Effect.withSpan('print-mcp-schema'),
      Effect.provide(
        Layer.mergeAll(
          Layer.provide(createMcpServerLayer(port), Layer.mergeAll(StateStore.Default)).pipe(
            Layer.provideMerge(WorkingDirService.Default({ workingDirectory: os.tmpdir(), create: true })),
          ),
          NodeContext.layer,
        ).pipe(Layer.provide(Logger.remove(Logger.prettyLoggerDefault))),
      ),
      Effect.scoped,
    ),
  ),
)
