import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Option } from 'effect'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import {
  contextDirectoryOption,
  cwdOption,
  flakyOption,
  llmOption,
  promptOption,
  reproduceIssue,
  workingDirectoryOption,
} from './shared.ts'

const askUserQuestions = (questions: string[]) =>
  Effect.gen(function* () {
    const answers: string[] = []

    for (const [i, question] of questions.entries()) {
      const answer = yield* Cli.Prompt.text({
        message: `Q${i + 1}: ${question}`,
        validate: (input) => Effect.succeed(input), // Accept any input
      })
      answers.push(answer.trim())
    }

    return answers
  }).pipe(Effect.withSpan('askUserQuestions'))

export const reproCommand = Cli.Command.make(
  'repro',
  {
    workingDirectory: workingDirectoryOption,
    contextDirectory: contextDirectoryOption,
    llm: llmOption,
    prompt: promptOption,
    flaky: flakyOption,
    cwd: cwdOption,
  },
  ({ workingDirectory, contextDirectory, llm, prompt, flaky, cwd }) =>
    Effect.gen(function* () {
      const resolvedCwd = Option.getOrElse(cwd, () => process.cwd())
      const resolvedWorkingDirectory = path.resolve(resolvedCwd, workingDirectory)
      const resolvedContextDirectory = path.resolve(resolvedCwd, contextDirectory)

      // Get problem prompt if not provided
      const problemPrompt = yield* Option.match(prompt, {
        onNone: () =>
          Cli.Prompt.text({
            message: 'Describe the problem you want to reproduce:',
            validate: (input) =>
              input.trim().length > 0 ? Effect.succeed(input) : Effect.fail('Problem description cannot be empty'),
          }),
        onSome: Effect.succeed,
      })

      const isFlaky = flaky._tag === 'Some' ? flaky.value : false

      // Run reproduction
      let result = yield* reproduceIssue({
        problemPrompt,
        resolvedContextDirectory,
        resolvedWorkingDirectory,
        isFlaky,
      })

      // Handle iterative feedback loop
      while (result._tag === 'NeedMoreInfo') {
        yield* Effect.log('🤔 The reproduction process needs more information:')
        yield* Effect.log(result.context)

        if (result.blockers?.length) {
          yield* Effect.log('🚧 Blockers encountered:')
          for (const blocker of result.blockers) {
            yield* Effect.log(`  • ${blocker}`)
          }
        }

        if (result.suggestions?.length) {
          yield* Effect.log('💡 Suggestions to help:')
          for (const suggestion of result.suggestions) {
            yield* Effect.log(`  • ${suggestion}`)
          }
        }

        const answers = yield* askUserQuestions([...result.questions])

        result = yield* reproduceIssue({
          problemPrompt,
          resolvedContextDirectory,
          resolvedWorkingDirectory,
          isFlaky,
          userFeedback: answers,
        })
      }

      // Display final result
      switch (result._tag) {
        case 'Success': {
          const typeLabel = {
            immediate: '⚡',
            delayed: '⏳',
            environmental: '🔧',
          }[result.reproductionType]

          yield* Effect.log(`✅ Reproduction successful! (${typeLabel} ${result.reproductionType})`)
          yield* Effect.log(`📋 Expected: ${result.expectedBehavior}`)
          yield* Effect.log(`📋 Observed: ${result.observedBehavior}`)
          yield* Effect.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`)

          if (result.executionTimeMs !== undefined) {
            yield* Effect.log(`⏱️  Execution time: ${result.executionTimeMs}ms`)
          }

          if (result.setupRequirements?.length) {
            yield* Effect.log(`🔧 Setup required: ${result.setupRequirements.join(', ')}`)
          }

          if (result.minimizationNotes) {
            yield* Effect.log(`📝 ${result.minimizationNotes}`)
          }

          yield* Effect.log(`📄 Reproduction script saved to: .deebug/repro.ts`)
          break
        }
      }

      return result
    }).pipe(Effect.provide(llm === 'claude' ? ClaudeLLMLive : CodexLLMLive)),
).pipe(Cli.Command.withDescription('Reproduce an issue to understand its behavior and generate diagnostic information'))
