import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { runRepl } from '../../repl.ts'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import { getFreePort } from '../../services/free-port.ts'
import { createMcpServerLayer } from '../../services/mcp-server.js'
import {
  CONTEXT_DIR,
  cwdOption,
  DEEBUG_DIR,
  llmOption,
  loadExperiments,
  portOption,
  replOption,
  runExperiment,
  workingDirectoryOption,
} from './shared.ts'

export const runExperimentsCommand = Cli.Command.make(
  'run-experiments',
  {
    workingDirectory: workingDirectoryOption,
    port: portOption,
    llm: llmOption,
    repl: replOption,
    cwd: cwdOption,
  },
  ({ workingDirectory, port: portOption, llm, repl: replOption, cwd: cwdOption }) =>
    Effect.gen(function* () {
      const fallbackPort = yield* getFreePort
      const port = Option.getOrElse(portOption, () => fallbackPort)

      return yield* Effect.gen(function* () {
        const cwd = Option.getOrElse(cwdOption, () => process.cwd())
        const resolvedWorkingDirectory = path.resolve(cwd, workingDirectory)
        const deebugDir = path.join(resolvedWorkingDirectory, DEEBUG_DIR)
        const resolvedContextDirectory = path.join(deebugDir, CONTEXT_DIR)

        yield* Effect.log(`Working directory: ${resolvedWorkingDirectory}`)
        yield* Effect.log(`Deebug directory: ${deebugDir}`)
        yield* Effect.log(`Context directory: ${resolvedContextDirectory}`)

        // Load experiments from canonical location
        const experiments = yield* loadExperiments(resolvedWorkingDirectory)

        yield* Effect.log(
          `Running ${experiments.length} experiments:\n${experiments.map((e) => `- ${e.experimentId}: ${e.problemTitle}`).join('\n')}`,
        )

        const fiber = yield* Effect.forEach(
          experiments,
          (experiment) =>
            runExperiment({
              resolvedWorkingDirectory,
              port,
              experiment,
              llm,
              cwd,
            }),
          { concurrency: 4 },
        ).pipe(Effect.tapErrorCause(Effect.logError), Effect.forkScoped)

        yield* Effect.log(`Starting MCP server on port ${port}...`)
        yield* Effect.log(`MCP endpoint: http://localhost:${port}/mcp`)

        if (Option.isSome(replOption) && replOption.value) {
          yield* runRepl
        }

        yield* fiber
      }).pipe(
        Effect.provide(Layer.mergeAll(createMcpServerLayer(port), llm === 'claude' ? ClaudeLLMLive : CodexLLMLive)),
      )
    }),
)
