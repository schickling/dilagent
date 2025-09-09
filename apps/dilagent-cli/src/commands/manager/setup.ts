import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { GitManagerService } from '../../services/git-manager.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { contextDirectoryOption, cwdOption, promptOption, workingDirectoryOption } from './shared.ts'

export const setupCommand = Cli.Command.make(
  'setup',
  {
    workingDirectory: workingDirectoryOption,
    contextDirectory: contextDirectoryOption,
    prompt: promptOption,
    cwd: cwdOption,
  },
  ({ workingDirectory, contextDirectory, prompt, cwd }) => {
    const resolvedCwd = Option.getOrElse(cwd, () => process.cwd())
    const resolvedContextDirectory = path.resolve(resolvedCwd, contextDirectory)
    const resolvedWorkingDirectory = path.resolve(resolvedCwd, workingDirectory)

    return Effect.gen(function* () {
      yield* Effect.logDebug('[manager setup] 🚀 Phase 0: Setting up workspace...')

      // Get problem prompt interactively if not provided
      const problemPrompt = yield* Option.match(prompt, {
        onNone: () =>
          Cli.Prompt.text({
            message: 'Describe the problem you want to debug:',
            validate: (input) =>
              input.trim().length > 0 ? Effect.succeed(input) : Effect.fail('Problem description cannot be empty'),
          }),
        onSome: Effect.succeed,
      })

      const timelineService = yield* TimelineService
      const stateStore = yield* StateStore
      const gitManager = yield* GitManagerService

      yield* Effect.logDebug('[manager setup] 🚀 Setting up Dilagent workspace...')
      yield* Effect.logDebug(`[manager setup] Problem: ${problemPrompt}`)

      // Record setup initialization
      yield* timelineService.recordEvent({
        event: 'phase.started',
        phase: 'setup',
        details: {
          contextDirectory: resolvedContextDirectory,
          workingDirectory: resolvedWorkingDirectory,
        },
      })

      // Setup git context repository
      yield* Effect.logDebug(`[manager setup] 📁 Setting up context repository from: ${resolvedContextDirectory}`)

      // Get the workingDirId from the state for branch naming
      const state = yield* stateStore.getState()
      const contextSetupResult = yield* gitManager.setupContextRepo(resolvedContextDirectory, state.workingDirId)

      yield* Effect.logDebug(
        `[manager setup] Context setup result: contextRepoPath=${contextSetupResult.contextRepoPath}, relativePath=${contextSetupResult.relativePath}`,
      )

      // Initialize state store with initial values
      yield* stateStore.updateState((state) => ({
        ...state,
        problemPrompt,
        contextDirectory: resolvedContextDirectory,
        contextRelativePath: contextSetupResult.relativePath,
        workingDirectory: resolvedWorkingDirectory,
        currentPhase: 'setup',
        progress: {
          ...state.progress,
          phase: 'setup',
          message: 'Workspace initialized',
        },
      }))

      // Record successful setup completion
      yield* timelineService.recordEvent({
        event: 'phase.completed',
        phase: 'setup',
        details: {
          contextDirectory: resolvedContextDirectory,
          workingDirectory: resolvedWorkingDirectory,
        },
      })

      yield* Effect.logDebug('[manager setup] ✅ Dilagent workspace setup complete!')
      yield* Effect.logDebug(`[manager setup]   Working directory: ${resolvedWorkingDirectory}`)
      yield* Effect.logDebug(`[manager setup]   Context repository: ${resolvedContextDirectory}`)

      return {
        problemPrompt,
        contextDirectory: resolvedContextDirectory,
        workingDirectory: resolvedWorkingDirectory,
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(GitManagerService.Default, TimelineService.Default, StateStore.Default).pipe(
          Layer.provideMerge(WorkingDirService.Default({ workingDir: resolvedWorkingDirectory, create: true })),
        ),
      ),
    )
  },
).pipe(Cli.Command.withDescription('Initialize Dilagent workspace with git repository and directory structure'))
