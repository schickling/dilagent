import { Effect, Ref, Schema } from 'effect'
import type { DilagentState } from '../schemas/file-management.ts'
import { WorkingDirService } from './working-dir.ts'

// Error types for StateStore
export class StateStoreError extends Schema.TaggedError<StateStoreError>()('StateStoreError', {
  cause: Schema.Defect,
  message: Schema.String,
}) {}

export class StateStoreInitializationError extends Schema.TaggedError<StateStoreInitializationError>()(
  'StateStoreInitializationError',
  {
    cause: Schema.Defect,
    message: Schema.String,
    statePath: Schema.String,
  },
) {}

export class StateStoreFlushError extends Schema.TaggedError<StateStoreFlushError>()('StateStoreFlushError', {
  cause: Schema.Defect,
  message: Schema.String,
  statePath: Schema.String,
}) {}

export class StateStore extends Effect.Service<StateStore>()('StateStore', {
  effect: Effect.gen(function* () {
    const workingDirService = yield* WorkingDirService

    // DilagentState store with auto-flush
    const dilagentStateStore = yield* Ref.make<DilagentState | undefined>(undefined)
    const autoFlushEnabled = yield* Ref.make<boolean>(false)
    const workingDirPath = yield* Ref.make<string | undefined>(undefined)

    /**
     * Initialize DilagentState from file or create new state
     *
     * @param workingDir - Working directory containing .dilagent
     * @param initialState - Initial state if file doesn't exist
     * @returns Effect that succeeds when state is initialized
     */
    const initializeDilagentState = Effect.fn('StateStore.initializeDilagentState')(function* (
      workingDir: string,
      initialState?: DilagentState,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      // Store working directory for auto-flush
      yield* Ref.set(workingDirPath, workingDir)

      // Try to load existing state
      const existingState = yield* workingDirService.readState(workingDir).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            // If file doesn't exist, that's okay - we'll use initial state
            yield* Effect.log(`No existing state found, using initial state: ${error.message}`)
            return undefined
          }),
        ),
      )

      const stateToUse = existingState ?? initialState
      if (!stateToUse) {
        return yield* new StateStoreInitializationError({
          cause: new Error('No existing state and no initial state provided'),
          message: `Failed to initialize state: no existing state found and no initial state provided`,
          statePath: workingDir,
        })
      }

      yield* Ref.set(dilagentStateStore, stateToUse)
      yield* Effect.log(`Initialized DilagentState from ${existingState ? 'file' : 'initial state'}`)
    })

    /**
     * Enable auto-flush - state will be written to file on every update
     *
     * @returns Effect that succeeds when auto-flush is enabled
     */
    const enableAutoFlush = Effect.fn('StateStore.enableAutoFlush')(function* () {
      yield* Ref.set(autoFlushEnabled, true)
      yield* Effect.log('Auto-flush enabled for DilagentState')
    })

    /**
     * Disable auto-flush
     *
     * @returns Effect that succeeds when auto-flush is disabled
     */
    const disableAutoFlush = Effect.fn('StateStore.disableAutoFlush')(function* () {
      yield* Ref.set(autoFlushEnabled, false)
      yield* Effect.log('Auto-flush disabled for DilagentState')
    })

    /**
     * Get current DilagentState
     *
     * @returns Effect that succeeds with current DilagentState
     */
    const getDilagentState = Effect.fn('StateStore.getDilagentState')(function* () {
      const state = yield* Ref.get(dilagentStateStore)
      if (!state) {
        return yield* new StateStoreError({
          cause: new Error('DilagentState not initialized'),
          message: 'DilagentState has not been initialized. Call initializeDilagentState first.',
        })
      }
      return state
    })

    /**
     * Update DilagentState with auto-flush
     *
     * @param updateFn - Function to update the state
     * @returns Effect that succeeds when state is updated
     */
    const updateDilagentState = Effect.fn('StateStore.updateDilagentState')(function* (
      updateFn: (state: DilagentState) => DilagentState,
    ) {
      const currentState = yield* getDilagentState()
      const newState = {
        ...updateFn(currentState),
        lastUpdated: new Date().toISOString(),
      }

      yield* Ref.set(dilagentStateStore, newState)

      // Auto-flush if enabled
      const shouldAutoFlush = yield* Ref.get(autoFlushEnabled)
      if (shouldAutoFlush) {
        yield* flushToFile()
      }

      yield* Effect.log('Updated DilagentState')
    })

    /**
     * Manually flush current state to file
     *
     * @returns Effect that succeeds when state is flushed
     */
    const flushToFile = Effect.fn('StateStore.flushToFile')(function* () {
      const state = yield* getDilagentState()
      const workingDir = yield* Ref.get(workingDirPath)

      if (!workingDir) {
        return yield* new StateStoreFlushError({
          cause: new Error('Working directory not set'),
          message: 'Cannot flush state: working directory not initialized',
          statePath: 'unknown',
        })
      }

      yield* workingDirService.writeState(workingDir, state).pipe(
        Effect.catchAll(
          (error) =>
            new StateStoreFlushError({
              cause: error,
              message: `Failed to flush DilagentState to file`,
              statePath: workingDir,
            }),
        ),
      )

      yield* Effect.log(`Flushed DilagentState to ${workingDir}/.dilagent/state.json`)
    })

    /**
     * Update hypothesis status in DilagentState
     *
     * @param hypothesisId - Hypothesis ID to update
     * @param updates - Partial updates to apply
     * @returns Effect that succeeds when hypothesis is updated
     */
    const updateHypothesis = Effect.fn('StateStore.updateHypothesis')(function* (
      hypothesisId: string,
      updates: Partial<
        Pick<
          (typeof DilagentState.Type.hypotheses)[0],
          'status' | 'result' | 'startedAt' | 'completedAt' | 'confidence' | 'executionTimeMs'
        >
      >,
    ) {
      yield* updateDilagentState((state) => ({
        ...state,
        hypotheses: state.hypotheses.map((h) => (h.id === hypothesisId ? { ...h, ...updates } : h)),
      }))

      yield* Effect.log(`Updated hypothesis ${hypothesisId}`)
    })

    return {
      initializeDilagentState,
      enableAutoFlush,
      disableAutoFlush,
      getDilagentState,
      updateDilagentState,
      flushToFile,
      updateHypothesis,
    } as const
  }),

  dependencies: [WorkingDirService.Default],
}) {}
