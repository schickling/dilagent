import * as readline from 'node:readline'
import * as Cli from '@effect/cli'
import { HttpClient, HttpClientRequest } from '@effect/platform'
import { NodeContext } from '@effect/platform-node'
import { Effect, Layer, Logger } from 'effect'

// Completely disable all logging to avoid interfering with JSON-RPC
const silentLogger = Logger.remove(Logger.prettyLoggerDefault).pipe(
  Layer.merge(Logger.replace(Logger.defaultLogger, Logger.none)),
)

export const mcpProxyHttpToStdioCommand = Cli.Command.make(
  'mcp-proxy-http-to-stdio',
  {
    endpoint: Cli.Options.text('endpoint').pipe(Cli.Options.withDescription('HTTP MCP endpoint to proxy to')),
  },
  ({ endpoint }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      // Create readline interface for reading stdin line by line
      const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
      })

      // Process each line from stdin
      yield* Effect.async<void, never>((resume) => {
        rl.on('line', async (line) => {
          try {
            // Parse JSON-RPC request from stdin
            const jsonRpcRequest = JSON.parse(line)

            // Forward to HTTP endpoint
            const request = HttpClientRequest.post(endpoint).pipe(HttpClientRequest.bodyText(line, 'application/json'))

            const response = await client.execute(request).pipe(Effect.provide(NodeContext.layer), Effect.runPromise)

            const responseJson = await response.json.pipe(Effect.provide(NodeContext.layer), Effect.runPromise)

            // HTTP endpoint returns an array with the JSON-RPC response
            const result = Array.isArray(responseJson) ? responseJson[0] : responseJson

            // Only write response for requests (with id), not notifications
            if (jsonRpcRequest.id !== undefined && result !== null) {
              process.stdout.write(`${JSON.stringify(result)}\n`)
            }
          } catch (error) {
            try {
              const jsonRpcRequest = JSON.parse(line)
              // Only send error response for requests (with id), not notifications
              if (jsonRpcRequest.id !== undefined) {
                const errorResponse = {
                  jsonrpc: '2.0',
                  error: {
                    code: -32603,
                    message: `Proxy error: ${error}`,
                  },
                  id: jsonRpcRequest.id,
                }
                process.stdout.write(`${JSON.stringify(errorResponse)}\n`)
              }
            } catch (_parseError) {
              // If we can't parse the original request, send a generic error
              const errorResponse = {
                jsonrpc: '2.0',
                error: {
                  code: -32700,
                  message: 'Parse error',
                },
                id: null,
              }
              process.stdout.write(`${JSON.stringify(errorResponse)}\n`)
            }
          }
        })

        rl.on('close', () => {
          resume(Effect.void)
        })
      })
    }).pipe(
      Effect.withSpan('mcp-proxy-http-to-stdio'),
      Effect.provide(Layer.mergeAll(NodeContext.layer, silentLogger)),
    ),
)
