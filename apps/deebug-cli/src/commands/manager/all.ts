import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { runRepl } from '../../repl.ts'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import { getFreePort } from '../../services/free-port.ts'
import { createMcpServerLayer } from '../../services/mcp-server.js'
import {
  contextDirectoryOption,
  countOption,
  cwdOption,
  generateExperiments,
  llmOption,
  portOption,
  promptOption,
  replOption,
  runExperiment,
  workingDirectoryOption,
} from './shared.ts'

export const allCommand = Cli.Command.make(
  'all',
  {
    contextDirectory: contextDirectoryOption,
    workingDirectory: workingDirectoryOption,
    prompt: promptOption,
    count: countOption,
    llm: llmOption,
    port: portOption,
    repl: replOption,
    cwd: cwdOption,
  },
  ({ contextDirectory, workingDirectory, prompt, count, llm, port: portOption, repl: replOption, cwd: cwdOption }) =>
    Effect.gen(function* () {
      const fallbackPort = yield* getFreePort
      const port = Option.getOrElse(portOption, () => fallbackPort)

      return yield* Effect.gen(function* () {
        const cwd = Option.getOrElse(cwdOption, () => process.cwd())
        const resolvedWorkingDirectory = path.resolve(cwd, workingDirectory)
        const resolvedContextDirectory = path.resolve(cwd, contextDirectory)

        // Get prompt interactively if not provided
        const problemPrompt = yield* Option.match(prompt, {
          onNone: () =>
            Cli.Prompt.text({
              message: 'Enter problem description:',
              validate: (input) =>
                input.trim().length > 0 ? Effect.succeed(input) : Effect.fail('Problem description cannot be empty'),
            }),
          onSome: Effect.succeed,
        })

        const experimentCount = Option.getOrElse(count, () => undefined)

        yield* Effect.log(`Context directory: ${resolvedContextDirectory}`)
        yield* Effect.log(`Working directory: ${resolvedWorkingDirectory}`)
        yield* Effect.log(`Problem: ${problemPrompt}`)
        if (experimentCount) {
          yield* Effect.log(`Generating ${experimentCount} experiments`)
        }

        // Generate experiments
        yield* Effect.log(`Generating experiments...`)
        const experiments = yield* generateExperiments({
          problemPrompt,
          resolvedContextDirectory,
          resolvedWorkingDirectory,
          ...(experimentCount !== undefined && { experimentCount }),
        })

        yield* Effect.log(
          `Running ${experiments.length} experiments:\n${experiments.map((e) => `- ${e.experimentId}: ${e.problemTitle}`).join('\n')}`,
        )

        // Run experiments
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
