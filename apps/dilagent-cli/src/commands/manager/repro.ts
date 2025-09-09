import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Effect, Layer, Option, Schema } from 'effect'
import {
  initialReproductionPrompt,
  refineReproductionPrompt,
  reproductionSystemPrompt,
} from '../../prompts/reproduction.ts'
import { createPhaseEvent, createSystemEvent } from '../../schemas/file-management.ts'
import { ReproductionResult, ReproductionResultFile } from '../../schemas/reproduction.ts'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import { createFileLoggerLayer } from '../../services/file-logger.ts'
import { LLMService } from '../../services/llm.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { parseJsonLlmResponse } from '../../utils/schema-utils.ts'
import { cwdOption, flakyOption, LOG_FILES, llmOption, REPRODUCTION_FILE, workingDirectoryOption } from './shared.ts'

/**
 * Command to reproduce an issue for diagnostic understanding
 *
 * This command is responsible for:
 * - Recording setup phase timeline events (phase.started, phase.completed/failed)
 * - Creating reproducible test cases for the reported issue
 * - Updating state store with reproduction results
 *
 * Timeline events recorded:
 * - phase.started (phase: setup)
 * - phase.completed/failed (phase: setup) with confidence and type details
 *
 * Used by: all.ts workflow orchestration
 */

export const reproCommand = Cli.Command.make(
  'repro',
  {
    workingDirectory: workingDirectoryOption,
    llm: llmOption,
    flaky: flakyOption,
    cwd: cwdOption,
  },
  ({ workingDirectory, llm, flaky, cwd }) => {
    const resolvedCwd = Option.getOrElse(cwd, () => process.cwd())
    const resolvedWorkingDirectory = path.resolve(resolvedCwd, workingDirectory)

    return Effect.gen(function* () {
      yield* Effect.logDebug('[manager repro] 🔍 Phase 1: Reproducing issue...')

      const isFlaky = flaky._tag === 'Some' ? flaky.value : false

      // Get problem prompt from persisted state
      const stateStore = yield* StateStore
      const workingDirService = yield* WorkingDirService
      const state = yield* stateStore.getState()
      const problemPrompt = state.problemPrompt

      // Run reproduction
      let result = yield* reproduceIssue({
        problemPrompt,
        isFlaky,
      })

      // Handle iterative feedback loop
      while (result._tag === 'NeedMoreInfo') {
        yield* Effect.logDebug('[manager repro] 🤔 The reproduction process needs more information:')
        yield* Effect.logDebug(result.context)

        if (result.blockers?.length) {
          yield* Effect.logDebug('[manager repro] 🚧 Blockers encountered:')
          for (const blocker of result.blockers) {
            yield* Effect.logDebug(`[manager repro]   • ${blocker}`)
          }
        }

        if (result.suggestions?.length) {
          yield* Effect.logDebug('[manager repro] 💡 Suggestions to help:')
          for (const suggestion of result.suggestions) {
            yield* Effect.logDebug(`[manager repro]   • ${suggestion}`)
          }
        }

        const answers = yield* askUserQuestions([...result.questions])

        result = yield* reproduceIssue({ problemPrompt, isFlaky, userFeedback: answers })
      }

      // Display final result
      switch (result._tag) {
        case 'Success': {
          const typeLabel = {
            immediate: '⚡',
            delayed: '⏳',
            environmental: '🔧',
          }[result.reproductionType]

          yield* Effect.logDebug(
            `[manager repro] ✅ Reproduction successful! (${typeLabel} ${result.reproductionType})`,
          )
          yield* Effect.logDebug(`[manager repro] 📋 Expected: ${result.expectedBehavior}`)
          yield* Effect.logDebug(`[manager repro] 📋 Observed: ${result.observedBehavior}`)
          yield* Effect.logDebug(`[manager repro] 📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`)

          if (result.executionTimeMs !== undefined) {
            yield* Effect.logDebug(`[manager repro] ⏱️  Execution time: ${result.executionTimeMs}ms`)
          }

          if (result.setupRequirements?.length) {
            yield* Effect.logDebug(`[manager repro] 🔧 Setup required: ${result.setupRequirements.join(', ')}`)
          }

          if (result.minimizationNotes) {
            yield* Effect.logDebug(`[manager repro] 📝 ${result.minimizationNotes}`)
          }

          yield* Effect.logDebug(
            `[manager repro] 📄 Reproduction script saved to: ${workingDirService.paths.artifacts}/repro.ts`,
          )
          break
        }
      }

      return result
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          llm === 'claude' ? ClaudeLLMLive : CodexLLMLive,
          Layer.mergeAll(
            TimelineService.Default,
            StateStore.Default,
            createFileLoggerLayer(path.join(resolvedWorkingDirectory, '.dilagent', 'logs', LOG_FILES.REPRODUCTION), {
              replace: false,
              format: 'logfmt',
            }),
          ).pipe(
            Layer.provideMerge(WorkingDirService.Default({ workingDir: resolvedWorkingDirectory, create: false })),
          ),
        ),
      ),
    )
  },
).pipe(Cli.Command.withDescription('Reproduce an issue to understand its behavior and generate diagnostic information'))

const reproduceIssue = ({
  problemPrompt,
  isFlaky,
  userFeedback,
}: {
  problemPrompt: string
  isFlaky: boolean
  userFeedback?: string[]
}) =>
  Effect.gen(function* () {
    const llm = yield* LLMService
    const fs = yield* FileSystem.FileSystem
    const workingDirService = yield* WorkingDirService
    const stateStore = yield* StateStore
    const timelineService = yield* TimelineService

    // Context repo is already set up by setup command
    const contextDir = workingDirService.paths.contextRepo

    // Initialize timeline
    yield* timelineService.recordEvent(
      createPhaseEvent({
        event: 'phase.started',
        phase: 'setup',
      }),
    )

    // Check for existing reproduction results
    const reproductionJson = yield* fs
      .readFileString(path.join(workingDirService.paths.artifacts, REPRODUCTION_FILE))
      .pipe(
        Effect.andThen(Schema.decode(ReproductionResultFile)),
        Effect.catchAll(() => Effect.succeed(undefined as ReproductionResult | undefined)),
      )

    const state = yield* stateStore.getState()

    // Determine which prompt to use
    const prompt =
      reproductionJson?._tag === 'NeedMoreInfo' && userFeedback
        ? refineReproductionPrompt({
            problemPrompt,
            contextDirectory: contextDir,
            contextRelativePath: state.contextRelativePath,
            isFlaky,
            previousAttempt: reproductionJson,
            userFeedback,
          })
        : initialReproductionPrompt({
            problemPrompt,
            contextDirectory: contextDir,
            contextRelativePath: state.contextRelativePath,
            isFlaky,
          })

    yield* Effect.logDebug('[manager repro] Starting issue reproduction...')
    yield* timelineService.recordEvent(
      createSystemEvent({
        event: 'system.initialized',
        phase: 'setup',
      }),
    )

    const reproductionResult = yield* llm
      .prompt(prompt, {
        systemPrompt: reproductionSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
        debugLogPath: path.join(workingDirService.paths.logs, LOG_FILES.REPRODUCTION_PROMPT),
      })
      .pipe(
        Effect.timeout('30 minutes'),
        Effect.andThen(Schema.decode(parseJsonLlmResponse(ReproductionResult))),
        Effect.withSpan('reproduceIssue'),
      )

    // Save reproduction result as artifact
    const artifactsDir = workingDirService.paths.artifacts
    const reproductionFile = path.join(artifactsDir, REPRODUCTION_FILE)
    const reproductionJsonContent = yield* Schema.encode(ReproductionResultFile)(reproductionResult)
    yield* fs.writeFileString(reproductionFile, reproductionJsonContent)

    // Record timeline event
    const details =
      reproductionResult._tag === 'Success'
        ? { confidence: reproductionResult.confidence, type: reproductionResult.reproductionType }
        : undefined
    yield* timelineService.recordEvent(
      createPhaseEvent({
        event: reproductionResult._tag === 'Success' ? 'phase.completed' : 'phase.failed',
        phase: 'setup',
        ...(details && { details }), // Only include details if not undefined
      }),
    )

    // Update StateStore with reproduction results
    yield* stateStore.updateState((state) => ({
      ...state,
      currentPhase: reproductionResult._tag === 'Success' ? 'hypothesis-generation' : 'setup',
      completedPhases:
        reproductionResult._tag === 'Success' ? [...state.completedPhases, 'setup'] : state.completedPhases,
      progress: {
        ...state.progress,
        phase: reproductionResult._tag === 'Success' ? 'hypothesis-generation' : 'setup',
        message:
          reproductionResult._tag === 'Success'
            ? 'Reproduction successful, ready for hypothesis generation'
            : 'Reproduction failed, need more information',
      },
    }))

    yield* Effect.logDebug(`[manager repro] Updated state with reproduction result: ${reproductionResult._tag}`)

    // If successful, also save the repro.ts script
    if (reproductionResult._tag === 'Success') {
      const reproScriptFile = path.join(artifactsDir, 'repro.ts')
      yield* fs.writeFileString(reproScriptFile, reproductionResult.reproScript)

      const typeLabel = {
        immediate: '⚡',
        delayed: '⏳',
        environmental: '🔧',
      }[reproductionResult.reproductionType]

      yield* Effect.logDebug(
        `[manager repro] ✅ Reproduction created (${typeLabel} ${reproductionResult.reproductionType})`,
      )

      if (reproductionResult.executionTimeMs !== undefined) {
        yield* Effect.logDebug(`[manager repro] ⏱️  Execution time: ${reproductionResult.executionTimeMs}ms`)
      }

      if (reproductionResult.setupRequirements?.length) {
        yield* Effect.logDebug(`[manager repro] 📋 Setup required: ${reproductionResult.setupRequirements.join(', ')}`)
      }

      if (reproductionResult.minimizationNotes) {
        yield* Effect.logDebug(`[manager repro] 📝 ${reproductionResult.minimizationNotes}`)
      }

      yield* Effect.logDebug(`[manager repro] 📄 Reproduction script saved to ${reproScriptFile}`)
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
