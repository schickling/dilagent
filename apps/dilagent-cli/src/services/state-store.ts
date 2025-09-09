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

    // Helper to migrate old state files
    const migrateState = (rawState: any): DilagentState => {
      // If workingDirId is missing, add it
      if (!rawState.workingDirId) {
        rawState.workingDirId = crypto.randomUUID()
      }
      
      // If problemPrompt is missing, add empty string
      if (!rawState.problemPrompt) {
        rawState.problemPrompt = ''
      }
      
      // If contextRelativePath is missing, set to undefined
      if (!rawState.hasOwnProperty('contextRelativePath')) {
        rawState.contextRelativePath = undefined
      }

      // Migrate old hypothesis result formats
      if (rawState.hypotheses && typeof rawState.hypotheses === 'object') {
        for (const [hypothesisId, hypothesis] of Object.entries(rawState.hypotheses as any)) {
          if (hypothesis && typeof hypothesis === 'object') {
            const h = hypothesis as any
            // If result exists but doesn't have _tag, it's an old format - remove it
            if (h.result && typeof h.result === 'object' && !h.result._tag) {
              // Clear invalid result - let it be set properly through MCP tools
              h.result = undefined
            }
          }
        }
      }
      
      return rawState as DilagentState
    }

    // Read existing state or create default - happens ONCE during init
    const initialState = yield* fs.readFileString(workingDir.paths.stateFile).pipe(
      Effect.flatMap((content) => 
        Effect.try({
          try: () => JSON.parse(content),
          catch: (error) => new StateStoreError({ cause: error, message: 'Failed to parse state file JSON' })
        }).pipe(
          Effect.map(migrateState),
          Effect.flatMap((migrated) => Schema.decodeUnknown(DilagentStateSchema)(migrated))
        )
      ),
      Effect.catchIf(
        (_) => _._tag === 'SystemError' && _.reason === 'NotFound',
        () =>
          Effect.succeed(createDefaultState()).pipe(
            Effect.tap(Effect.logDebug('[StateStore] No existing state found, creating default')),
          ),
      ),
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
    })

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
      })

    const registerHypothesis = ({ id, slug, description }: { id: HypothesisId; slug: string; description: string }) =>
      updateState((s) => ({
        ...s,
        hypotheses: {
          ...s.hypotheses,
          [id]: {
            id,
            slug,
            description,
            status: 'pending',
            worktreePath: Path.join(s.workingDirectory, `${id}-${slug}`),
            branchName: `dilagent/${s.workingDirId}/${id}-${slug}`,
            startedAt: undefined,
            completedAt: undefined,
            result: undefined,
          },
        },
        metrics: {
          ...s.metrics,
          hypothesesGenerated: s.metrics.hypothesesGenerated + 1,
        },
      }))

    const updateHypothesis = ({ id, update }: { id: HypothesisId; update: Partial<HypothesisState> }) =>
      updateState((s) => ({
        ...s,
        hypotheses: {
          ...s.hypotheses,
          [id]: { ...s.hypotheses[id]!, ...update },
        },
        // Update metrics based on status changes
        metrics: (() => {
          const oldStatus = s.hypotheses[id]?.status
          const newStatus = update.status

          if (oldStatus !== newStatus) {
            const metrics = { ...s.metrics }

            if (newStatus === 'completed') {
              metrics.hypothesesCompleted += 1
              if (update.result?._tag === 'Proven') {
                metrics.hypothesesSuccessful += 1
              } else {
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
      }))

    const setPhase = (phase: DilagentState['currentPhase']) =>
      updateState((s) => ({
        ...s,
        currentPhase: phase,
        completedPhases: s.completedPhases.includes(phase) ? s.completedPhases : [...s.completedPhases, phase],
        progress: {
          ...s.progress,
          phase: phase,
        },
      }))

    const updateProgress = (progress: Partial<DilagentState['progress']>) =>
      updateState((s) => ({
        ...s,
        progress: {
          ...s.progress,
          ...progress,
        },
      }))

    const completeRun = () =>
      updateState((s) => ({
        ...s,
        currentPhase: 'completed',
        metrics: {
          ...s.metrics,
          endTime: new Date().toISOString(),
        },
      }))

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
