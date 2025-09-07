import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { runRepl } from '../../repl.ts'
import { getFreePort } from '../../services/free-port.ts'
import { createMcpServerLayer } from '../../services/mcp-server.js'
import { portOption } from './shared.ts'

export const replCommand = Cli.Command.make(
  'repl',
  {
    port: portOption,
  },
  ({ port: portOpt }) =>
    Effect.gen(function* () {
      const fallbackPort = yield* getFreePort
      const port = Option.getOrElse(portOpt, () => fallbackPort)

      return yield* Effect.gen(function* () {
        yield* Effect.log(`Starting MCP server on port ${port}...`)
        yield* Effect.log(`MCP endpoint: http://localhost:${port}/mcp`)

        yield* runRepl
      }).pipe(Effect.provide(Layer.mergeAll(createMcpServerLayer(port))))
    }),
)
