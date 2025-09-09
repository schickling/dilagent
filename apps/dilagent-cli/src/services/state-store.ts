import * as crypto from 'node:crypto'
import * as Path from 'node:path'
import { FileSystem } from '@effect/platform'
import { Effect, type ParseResult, Ref, Schema } from 'effect'
import type { DilagentState, HypothesisId, HypothesisState } from '../schemas/file-management.ts'
import { DilagentState as DilagentStateSchema } from '../schemas/file-management.ts'
import { WorkingDirService } from './working-dir.ts'

// Error types for StateStore
export class StateStoreError extends Schema.TaggedError<StateStoreError>()('StateStoreError', {
  cause: Schema.Defect,
  message: Schema.String,
}) {}

export class StatePersistenceError extends Schema.TaggedError<StatePersistenceError>()('StatePersistenceError', {
  cause: Schema.Defect,
  message: Schema.String,
  stateFile: Schema.String,
}) {}

/**
 * Service for managing application state
 *
 * Responsibilities:
 * - Owns the complete state lifecycle
 * - Reads existing state OR creates default on initialization
 * - Auto-persists all state changes
 * - Provides business logic for state mutations
 */
export class StateStore extends Effect.Service<StateStore>()('StateStore', {
  effect: Effect.gen(function* () {
    const workingDir = yield* WorkingDirService
    const fs = yield* FileSystem.FileSystem

    // Helper to create default state
    const createDefaultState = (): DilagentState => ({
      workingDirId: crypto.randomUUID(),
      problemPrompt: '', // Will be set during setup
      contextDirectory: workingDir.workingDir,
      contextRelativePath: undefined,
      workingDirectory: workingDir.workingDir,
      hypotheses: {} as DilagentState['hypotheses'],
      currentPhase: 'setup',
      completedPhases: [],
      metrics: {
        startTime: new Date().toISOString(),
        endTime: undefined,
        hypothesesGenerated: 0,
        hypothesesCompleted: 0,
        hypothesesSuccessful: 0,
        hypothesesFailed: 0,
        hypothesesSkipped: 0,
      },
      progress: {
        current: 0,
        total: 0,
        phase: 'setup',
        message: 'Starting dilagent',
      },
    })

    // Read existing state or create default - happens ONCE during init
    const initialState = yield* fs.readFileString(workingDir.paths.stateFile).pipe(
      Effect.flatMap((content) => Schema.decodeUnknown(Schema.parseJson(DilagentStateSchema))(content)),
      Effect.catchIf(
        (_) => _._tag === 'SystemError' && _.reason === 'NotFound',
        () =>
          Effect.succeed(createDefaultState()).pipe(
            Effect.tap(Effect.logDebug('[StateStore] No existing state found, creating default')),
          ),
      ),
      Effect.withSpan('StateStore.initialState'),
    )

    // Internal mutable reference
    const stateRef = yield* Ref.make(initialState)

    // Helper to persist current state
    const persist = Effect.gen(function* () {
      const currentState = yield* Ref.get(stateRef)
      const encoded = yield* Schema.encode(Schema.parseJson(DilagentStateSchema, { space: 2 }))(currentState)
      yield* fs.writeFileString(workingDir.paths.stateFile, encoded).pipe(
        Effect.catchAll(
          (error) =>
            new StatePersistenceError({
              cause: error,
              message: 'Failed to persist state to file',
              stateFile: workingDir.paths.stateFile,
            }),
        ),
      )
      yield* Effect.logDebug('[StateStore] State persisted')
    }).pipe(Effect.withSpan('StateStore.persist'))

    // Do initial persist
    yield* persist

    // Public API - all mutations auto-persist
    const getState = () => Ref.get(stateRef)

    const updateState = (
      updater: (state: DilagentState) => DilagentState,
    ): Effect.Effect<DilagentState, ParseResult.ParseError | StatePersistenceError> =>
      Effect.gen(function* () {
        const newState = yield* Ref.updateAndGet(stateRef, updater)
        yield* persist
        return newState
      }).pipe(Effect.withSpan('StateStore.updateState'))

    const registerHypothesis = ({
      id: hypothesisId,
      slug,
      description,
    }: {
      id: HypothesisId
      slug: string
      description: string
    }) =>
      updateState((s) => ({
        ...s,
        hypotheses: {
          ...s.hypotheses,
          [hypothesisId]: {
            id: hypothesisId,
            slug,
            description,
            status: 'pending',
            worktreePath: Path.join(s.workingDirectory, `worktree-${hypothesisId}-${slug}`),
            metadataPath: Path.join(s.workingDirectory, '.dilagent', `${hypothesisId}-${slug}`),
            branchName: `dilagent/${s.workingDirId}/${hypothesisId}-${slug}`,
            startedAt: undefined,
            completedAt: undefined,
            result: undefined,
          },
        },
        metrics: {
          ...s.metrics,
          hypothesesGenerated: s.metrics.hypothesesGenerated + 1,
        },
      })).pipe(Effect.withSpan('StateStore.updateHypothesis'))

    const updateHypothesis = ({ id, update }: { id: HypothesisId; update: Partial<HypothesisState> }) =>
      updateState((s) => {
        // Validation: completed hypotheses must have a result
        if (update.status === 'completed' && !update.result) {
          throw new Error(`Cannot mark hypothesis ${id} as completed without a result`)
        }

        return {
          ...s,
          hypotheses: {
            ...s.hypotheses,
            [id]: { ...s.hypotheses[id]!, ...update },
          },
          // Update metrics based on status changes
          metrics: (() => {
            const oldStatus = s.hypotheses[id]?.status
            const newStatus = update.status

            if (oldStatus !== newStatus && newStatus) {
              const metrics = { ...s.metrics }

              // Only increment counters when transitioning TO these states
              if (newStatus === 'completed') {
                metrics.hypothesesCompleted += 1
                // Only count as success/failure based on result
                if (update.result?._tag === 'Proven') {
                  metrics.hypothesesSuccessful += 1
                } else if (update.result) {
                  // Only increment failed if we have a result (not Proven)
                  metrics.hypothesesFailed += 1
                }
              } else if (newStatus === 'failed') {
                metrics.hypothesesFailed += 1
              } else if (newStatus === 'skipped') {
                metrics.hypothesesSkipped += 1
              }

              return metrics
            }

            return s.metrics
          })(),
        }
      }).pipe(Effect.withSpan('StateStore.updateHypothesis'))

    const setPhase = (phase: DilagentState['currentPhase']) =>
      updateState((s) => {
        // Mark previous phase as completed when transitioning
        const newCompletedPhases =
          s.currentPhase && s.currentPhase !== phase && !s.completedPhases.includes(s.currentPhase)
            ? [...s.completedPhases, s.currentPhase]
            : s.completedPhases

        return {
          ...s,
          currentPhase: phase,
          completedPhases: newCompletedPhases,
          progress: {
            ...s.progress,
            phase: phase,
          },
        }
      })

    const updateProgress = (progress: Partial<DilagentState['progress']>) =>
      updateState((s) => ({
        ...s,
        progress: {
          ...s.progress,
          ...progress,
        },
      })).pipe(Effect.withSpan('StateStore.updateProgress'))

    const completeRun = () =>
      updateState((s) => ({
        ...s,
        currentPhase: 'completed',
        metrics: {
          ...s.metrics,
          endTime: new Date().toISOString(),
        },
      })).pipe(Effect.withSpan('StateStore.completeRun'))

    return {
      getState,
      updateState,
      registerHypothesis,
      updateHypothesis,
      setPhase,
      updateProgress,
      completeRun,
    } as const
  }),
}) {}
