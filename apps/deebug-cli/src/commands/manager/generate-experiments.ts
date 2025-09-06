import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Option } from 'effect'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import {
  contextDirectoryOption,
  countOption,
  cwdOption,
  generateExperiments,
  llmOption,
  promptOption,
  workingDirectoryOption,
} from './shared.ts'

export const generateExperimentsCommand = Cli.Command.make(
  'generate-experiments',
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

      const experimentCount = Option.getOrElse(count, () => undefined)

      yield* Effect.log(`Context directory: ${resolvedContextDirectory}`)
      yield* Effect.log(`Working directory: ${resolvedWorkingDirectory}`)
      yield* Effect.log(`Problem: ${problemPrompt}`)
      if (experimentCount) {
        yield* Effect.log(`Generating ${experimentCount} experiments`)
      }

      const experiments = yield* generateExperiments({
        problemPrompt,
        resolvedContextDirectory,
        resolvedWorkingDirectory,
        ...(experimentCount !== undefined && { experimentCount }),
      })

      yield* Effect.log(
        `Generated ${experiments.length} experiments:\n${experiments.map((e) => `- ${e.experimentId}: ${e.problemTitle}`).join('\n')}`,
      )

      yield* Effect.log(
        `Experiments saved and ready to run with: deebug manager run-experiments --working-directory ${workingDirectory} --llm ${llm}`,
      )
    }).pipe(Effect.provide(llm === 'claude' ? ClaudeLLMLive : CodexLLMLive)),
)
