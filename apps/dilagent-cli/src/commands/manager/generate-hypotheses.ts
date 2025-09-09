import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import { createFileLoggerLayer } from '../../services/file-logger.ts'
import { GitManagerService } from '../../services/git-manager.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { countOption, cwdOption, generateHypotheses, LOG_FILES, llmOption, workingDirectoryOption } from './shared.ts'

/**
 * Command to generate testable hypotheses for debugging
 *
 * This command delegates to shared.ts generateHypotheses() which handles:
 * - Recording hypothesis-generation phase timeline events
 * - Creating git worktrees for each hypothesis
 * - Updating state store with generated hypotheses
 * - Preparing experiment directories and files
 *
 * Timeline events recorded (via shared.ts):
 * - phase.started (phase: hypothesis-generation)
 * - hypothesis.generated events with count details
 * - phase.completed via StateStore.setPhase()
 *
 * Used by: all.ts workflow orchestration
 */

export const generateHypothesesCommand = Cli.Command.make(
  'generate-hypotheses',
  {
    workingDirectory: workingDirectoryOption,
    count: countOption,
    llm: llmOption,
    cwd: cwdOption,
  },
  ({ workingDirectory, count, llm, cwd }) => {
    const resolvedCwd = Option.getOrElse(cwd, () => process.cwd())
    const resolvedWorkingDirectory = path.resolve(resolvedCwd, workingDirectory)

    return Effect.gen(function* () {
      yield* Effect.logDebug('[manager generate-hypotheses] 💡 Phase 2: Generating hypotheses...')

      // Get problem prompt from persisted state
      const stateStore = yield* StateStore
      const state = yield* stateStore.getState()
      const problemPrompt = state.problemPrompt

      const hypothesisCount = Option.getOrElse(count, () => undefined)

      yield* Effect.logDebug(`[manager generate-hypotheses] Working directory: ${resolvedWorkingDirectory}`)
      yield* Effect.logDebug(`[manager generate-hypotheses] Problem: ${problemPrompt}`)
      if (hypothesisCount) {
        yield* Effect.logDebug(`[manager generate-hypotheses] Generating ${hypothesisCount} hypotheses`)
      }

      const hypotheses = yield* generateHypotheses({
        problemPrompt,
        ...(hypothesisCount !== undefined && { hypothesisCount }),
      })

      yield* Effect.logDebug(
        `[manager generate-hypotheses] Generated ${hypotheses.length} hypotheses:\n${hypotheses.map((e) => `- ${e.hypothesisId}: ${e.problemTitle}`).join('\n')}`,
      )

      yield* Effect.logDebug(
        `[manager generate-hypotheses] Experiments saved and ready to run with: dilagent manager run-hypotheses --working-directory ${workingDirectory} --llm ${llm}`,
      )
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          llm === 'claude' ? ClaudeLLMLive : CodexLLMLive,
          Layer.mergeAll(
            GitManagerService.Default,
            TimelineService.Default,
            StateStore.Default,
            createFileLoggerLayer(
              path.join(resolvedWorkingDirectory, '.dilagent', 'logs', LOG_FILES.GENERATE_HYPOTHESES),
              { replace: false, format: 'logfmt' },
            ),
          ).pipe(
            Layer.provideMerge(WorkingDirService.Default({ workingDir: resolvedWorkingDirectory, create: false })),
          ),
        ),
      ),
    )
  },
)
