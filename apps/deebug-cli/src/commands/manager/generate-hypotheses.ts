import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Option } from 'effect'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import {
  contextDirectoryOption,
  countOption,
  cwdOption,
  generateHypotheses,
  llmOption,
  promptOption,
  workingDirectoryOption,
} from './shared.ts'

export const generateHypothesesCommand = Cli.Command.make(
  'generate-hypotheses',
  {
    contextDirectory: contextDirectoryOption,
    workingDirectory: workingDirectoryOption,
    prompt: promptOption,
    count: countOption,
    llm: llmOption,
    cwd: cwdOption,
  },
  ({ contextDirectory, workingDirectory, prompt, count, llm, cwd }) =>
    Effect.gen(function* () {
      const resolvedCwd = Option.getOrElse(cwd, () => process.cwd())
      const resolvedWorkingDirectory = path.resolve(resolvedCwd, workingDirectory)
      const resolvedContextDirectory = path.resolve(resolvedCwd, contextDirectory)

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

      const hypotheses = yield* generateHypotheses({
        problemPrompt,
        resolvedContextDirectory,
        resolvedWorkingDirectory,
        ...(hypothesisCount !== undefined && { hypothesisCount }),
      })

      yield* Effect.log(
        `Generated ${hypotheses.length} hypotheses:\n${hypotheses.map((e) => `- ${e.hypothesisId}: ${e.problemTitle}`).join('\n')}`,
      )

      yield* Effect.log(
        `Experiments saved and ready to run with: deebug manager run-hypotheses --working-directory ${workingDirectory} --llm ${llm}`,
      )
    }).pipe(Effect.provide(llm === 'claude' ? ClaudeLLMLive : CodexLLMLive)),
)
