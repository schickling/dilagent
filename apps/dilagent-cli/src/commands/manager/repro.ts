import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Effect, Layer, Option, Schema } from 'effect'
import {
  initialReproductionPrompt,
  refineReproductionPrompt,
  reproductionSystemPrompt,
} from '../../prompts/reproduction.ts'
import { type ReproductionResult, ReproductionResultFile } from '../../schemas/reproduction.ts'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import { GitManagerService } from '../../services/git-manager.ts'
import { LLMService } from '../../services/llm.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { generateRunSlug } from '../../utils/run-slug.ts'
import {
  contextDirectoryOption,
  cwdOption,
  flakyOption,
  llmOption,
  promptOption,
  workingDirectoryOption,
} from './shared.ts'

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
  ({ workingDirectory, contextDirectory, llm, prompt, flaky, cwd }) => {
    const resolvedCwd = Option.getOrElse(cwd, () => process.cwd())
    const resolvedContextDirectory = path.resolve(resolvedCwd, contextDirectory)
    const resolvedWorkingDirectory = path.resolve(resolvedCwd, workingDirectory)

    const runId = generateRunSlug('reproduction')

    return Effect.gen(function* () {
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
        isFlaky,
        runId,
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
          isFlaky,
          runId,
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

          yield* Effect.log(`📄 Reproduction script saved to: .dilagent/repro.ts`)
          break
        }
      }

      return result
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          llm === 'claude' ? ClaudeLLMLive : CodexLLMLive,
          Layer.mergeAll(GitManagerService.Default, TimelineService.Default(runId), StateStore.Default).pipe(
            Layer.provideMerge(WorkingDirService.Default(resolvedWorkingDirectory)),
          ),
        ),
      ),
    )
  },
).pipe(Cli.Command.withDescription('Reproduce an issue to understand its behavior and generate diagnostic information'))

const reproduceIssue = ({
  problemPrompt,
  resolvedContextDirectory,
  isFlaky,
  runId,
  userFeedback,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
  isFlaky: boolean
  runId: string
  userFeedback?: string[]
}) =>
  Effect.gen(function* () {
    const llm = yield* LLMService
    const fs = yield* FileSystem.FileSystem
    const workingDirService = yield* WorkingDirService
    const stateStore = yield* StateStore
    const timelineService = yield* TimelineService
    const gitManager = yield* GitManagerService

    // Generate run ID and setup context directory as git repository
    yield* gitManager.setupContextRepo(resolvedContextDirectory, runId)
    const contextDir = workingDirService.paths.contextRepo

    // Initialize timeline
    yield* timelineService.enableAutoPersist()
    yield* timelineService.recordEvent({
      event: 'Reproduction phase started',
      phase: 'reproduction',
    })

    // Check for existing reproduction results
    const reproductionJson = yield* fs
      .readFileString(path.join(workingDirService.paths.artifacts, 'reproduction.json'))
      .pipe(
        Effect.andThen(Schema.decode(Schema.parseJson(ReproductionResultFile))),
        Effect.catchAll(() => Effect.succeed(undefined as ReproductionResult | undefined)),
      )

    // Determine which prompt to use
    const prompt =
      reproductionJson?._tag === 'NeedMoreInfo' && userFeedback
        ? refineReproductionPrompt({
            problemPrompt,
            contextDirectory: contextDir,
            isFlaky,
            previousAttempt: reproductionJson,
            userFeedback,
          })
        : initialReproductionPrompt({
            problemPrompt,
            contextDirectory: contextDir,
            isFlaky,
          })

    yield* Effect.log('Starting issue reproduction...')
    yield* timelineService.recordEvent({
      event: 'LLM reproduction request started',
      phase: 'reproduction',
    })

    const reproductionResult = yield* llm
      .prompt(prompt, {
        systemPrompt: reproductionSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
        debugLogPath: path.join(workingDirService.paths.logs, 'reproduction.log'),
      })
      .pipe(
        Effect.timeout('20 minutes'),
        Effect.andThen(Schema.decode(ReproductionResultFile)),
        Effect.withSpan('reproduceIssue'),
      )

    // Save reproduction result as artifact
    const artifactsDir = workingDirService.paths.artifacts
    const reproductionFile = path.join(artifactsDir, 'reproduction.json')
    const reproductionJsonContent = yield* Schema.encode(Schema.parseJson(ReproductionResultFile))(reproductionResult)
    yield* fs.writeFileString(reproductionFile, reproductionJsonContent)

    // Record timeline event
    yield* timelineService.recordEvent({
      event: `Reproduction ${reproductionResult._tag.toLowerCase()}`,
      phase: 'reproduction',
      metadata:
        reproductionResult._tag === 'Success'
          ? { confidence: reproductionResult.confidence, type: reproductionResult.reproductionType }
          : undefined,
    })

    // Update StateStore with reproduction results
    yield* stateStore.updateDilagentState((state) => ({
      ...state,
      currentPhase: 'reproduction' as const,
      reproduction: {
        status:
          reproductionResult._tag === 'Success'
            ? ('success' as const)
            : reproductionResult._tag === 'NeedMoreInfo'
              ? ('failed' as const)
              : ('failed' as const),
        attempts: 1, // TODO: Track actual attempts if refined
        confidence: reproductionResult._tag === 'Success' ? reproductionResult.confidence : 0,
      },
    }))

    yield* Effect.log(`Updated state with reproduction result: ${reproductionResult._tag}`)

    // If successful, also save the repro.ts script
    if (reproductionResult._tag === 'Success') {
      const reproScriptFile = path.join(artifactsDir, 'repro.ts')
      yield* fs.writeFileString(reproScriptFile, reproductionResult.reproScript)

      const typeLabel = {
        immediate: '⚡',
        delayed: '⏳',
        environmental: '🔧',
      }[reproductionResult.reproductionType]

      yield* Effect.log(`✅ Reproduction created (${typeLabel} ${reproductionResult.reproductionType})`)

      if (reproductionResult.executionTimeMs !== undefined) {
        yield* Effect.log(`⏱️  Execution time: ${reproductionResult.executionTimeMs}ms`)
      }

      if (reproductionResult.setupRequirements?.length) {
        yield* Effect.log(`📋 Setup required: ${reproductionResult.setupRequirements.join(', ')}`)
      }

      if (reproductionResult.minimizationNotes) {
        yield* Effect.log(`📝 ${reproductionResult.minimizationNotes}`)
      }

      yield* Effect.log(`📄 Reproduction script saved to ${reproScriptFile}`)
    }

    return reproductionResult
  }).pipe(Effect.withSpan('reproduceIssue'))

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
