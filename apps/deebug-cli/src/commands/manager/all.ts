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
  generateHypotheses,
  llmOption,
  portOption,
  promptOption,
  replOption,
  runHypothesisWorker,
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

        const hypothesisCount = Option.getOrElse(count, () => undefined)

        yield* Effect.log(`Context directory: ${resolvedContextDirectory}`)
        yield* Effect.log(`Working directory: ${resolvedWorkingDirectory}`)
        yield* Effect.log(`Problem: ${problemPrompt}`)
        if (hypothesisCount) {
          yield* Effect.log(`Generating ${hypothesisCount} hypotheses`)
        }

        // Generate hypotheses
        yield* Effect.log(`Generating hypotheses...`)
        const hypotheses = yield* generateHypotheses({
          problemPrompt,
          resolvedContextDirectory,
          resolvedWorkingDirectory,
          ...(hypothesisCount !== undefined && { hypothesisCount }),
        })

        yield* Effect.log(
          `Running ${hypotheses.length} hypotheses:\n${hypotheses.map((e) => `- ${e.hypothesisId}: ${e.problemTitle}`).join('\n')}`,
        )

        // Run hypotheses
        const fiber = yield* Effect.forEach(
          hypotheses,
          (hypothesis) =>
            runHypothesisWorker({
              resolvedWorkingDirectory,
              port,
              hypothesis,
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
