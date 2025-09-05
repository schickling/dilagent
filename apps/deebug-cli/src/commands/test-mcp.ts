import * as Cli from '@effect/cli'
import { Effect, Layer, Option, Console } from 'effect'
import { createMcpServerLayer } from '../services/mcp-server.js'
import { StateStore } from '../services/state-store.js'

export const testMcpCommand = Cli.Command.make(
  'test-mcp',
  {
    port: Cli.Options.integer('port').pipe(
      Cli.Options.optional,
      Cli.Options.withAlias('p'),
      Cli.Options.withDescription('Port to run the MCP server on'),
      Cli.Options.withDefault(3002)
    ),
  },
  (args) => Effect.gen(function* () {
    const actualPort = Option.isOption(args.port) 
      ? Option.getOrElse(args.port, () => 3002)
      : args.port
    
    yield* Console.log(`Starting MCP server on port ${actualPort}...`)
    yield* Console.log(`MCP endpoint: http://localhost:${actualPort}/mcp`)
    yield* Console.log(`Test with: curl -X POST http://localhost:${actualPort}/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0.0"}}}'`)
    yield* Console.log('')
    
    const serverLayer = createMcpServerLayer(actualPort)
    
    // Launch the server with StateStore and wait
    yield* Layer.launch(
      serverLayer.pipe(Layer.provide(StateStore.Live))
    ).pipe(Effect.fork)
    yield* Effect.never
  })
)