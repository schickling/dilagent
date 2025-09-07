import * as fs from 'node:fs'
import * as os from 'node:os'
import * as Path from 'node:path'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DilagentState } from '../schemas/file-management.ts'
import { StateStore } from './state-store.ts'
import { WorkingDirService } from './working-dir.ts'

describe('StateStore', () => {
  let testDir: string

  // Create test layer with all dependencies
  const PlatformLayer = Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)
  const ServiceLayer = Layer.mergeAll(WorkingDirService.Default, StateStore.Default).pipe(Layer.provide(PlatformLayer))
  const TestLayer = Layer.mergeAll(PlatformLayer, ServiceLayer)

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = await new Promise<string>((resolve, reject) => {
      fs.mkdtemp(Path.join(os.tmpdir(), 'state-store-test-'), (err, dir) => {
        if (err) reject(err)
        else resolve(dir)
      })
    })
  })

  afterEach(async () => {
    // Clean up test directory
    await new Promise<void>((resolve) => {
      fs.rm(testDir, { recursive: true, force: true }, () => resolve())
    })
  })

  // Helper to create a test DilagentState
  const createTestState = (): DilagentState => ({
    runId: '2025-09-07-test',
    runSlug: '2025-09-07-test',
    contextDir: '/test/context',
    contextType: 'directory',
    createdAt: '2025-09-07T12:34:56Z',
    lastUpdated: '2025-09-07T12:34:56Z',
    currentPhase: 'reproduction',
    phaseStartedAt: '2025-09-07T12:34:56Z',
    reproduction: {
      status: 'pending',
      attempts: 0,
      confidence: 0.0,
    },
    hypotheses: [
      {
        id: 'H001',
        slug: 'auth-bug-fix',
        branch: 'dilagent/2025-09-07-test/H001-auth-bug-fix',
        worktree: 'H001-auth-bug-fix',
        status: 'pending',
      },
      {
        id: 'H002',
        slug: 'memory-leak-fix',
        branch: 'dilagent/2025-09-07-test/H002-memory-leak-fix',
        worktree: 'H002-memory-leak-fix',
        status: 'running',
        startedAt: '2025-09-07T12:35:00Z',
        confidence: 0.8,
      },
    ],
    parallelExecution: {
      enabled: false,
      maxConcurrent: 1,
      currentlyRunning: [],
    },
    overallProgress: {
      totalHypotheses: 2,
      completed: 0,
      failed: 0,
      remaining: 2,
    },
  })


  describe('DilagentState management', () => {
    beforeEach(async () => {
      // Initialize .dilagent structure for DilagentState tests
      const program = Effect.gen(function* () {
        const workingDirService = yield* WorkingDirService
        yield* workingDirService.initializeDilagentStructure(testDir)
      })
      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    describe('initializeDilagentState', () => {
      it('should initialize with new state when no existing state file', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)
          const retrievedState = yield* store.getDilagentState()

          expect(retrievedState).toEqual(testState)
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should initialize from existing state file', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const workingDirService = yield* WorkingDirService
          const store = yield* StateStore

          // First, write a state file
          yield* workingDirService.writeState(testDir, testState)

          // Then initialize StateStore - should load from file
          yield* store.initializeDilagentState(testDir)
          const retrievedState = yield* store.getDilagentState()

          expect(retrievedState).toEqual(testState)
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should prefer existing state file over initial state', async () => {
        const existingState = createTestState()
        const initialState = { ...createTestState(), runSlug: '2025-09-07-different' }

        const program = Effect.gen(function* () {
          const workingDirService = yield* WorkingDirService
          const store = yield* StateStore

          // Write existing state to file
          yield* workingDirService.writeState(testDir, existingState)

          // Initialize with different initial state - should use existing
          yield* store.initializeDilagentState(testDir, initialState)
          const retrievedState = yield* store.getDilagentState()

          expect(retrievedState).toEqual(existingState)
          expect(retrievedState.runSlug).toBe('2025-09-07-test') // from existing, not initial
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should fail when no existing state and no initial state provided', async () => {
        const program = Effect.gen(function* () {
          const store = yield* StateStore
          yield* store.initializeDilagentState(testDir) // No initial state
        })

        await expect(Effect.runPromise(program.pipe(Effect.provide(TestLayer)))).rejects.toThrow(
          'no existing state found and no initial state provided',
        )
      })
    })

    describe('auto-flush functionality', () => {
      it('should not auto-flush by default', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const workingDirService = yield* WorkingDirService
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)

          // Update state
          yield* store.updateDilagentState((state) => ({
            ...state,
            currentPhase: 'hypothesis-generation',
          }))

          // File should not exist yet (no auto-flush)
          const fileExists = yield* workingDirService.readState(testDir).pipe(
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false)),
          )

          expect(fileExists).toBe(false)
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should auto-flush when enabled', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const workingDirService = yield* WorkingDirService
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)
          yield* store.enableAutoFlush()

          // Update state - should auto-flush
          yield* store.updateDilagentState((state) => ({
            ...state,
            currentPhase: 'hypothesis-generation',
          }))

          // File should exist and have updated state
          const fileState = yield* workingDirService.readState(testDir)
          expect(fileState.currentPhase).toBe('hypothesis-generation')
          expect(fileState.lastUpdated).not.toBe(testState.lastUpdated) // Should be updated
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should stop auto-flush when disabled', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const workingDirService = yield* WorkingDirService
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)
          yield* store.enableAutoFlush()

          // Update state - should auto-flush
          yield* store.updateDilagentState((state) => ({
            ...state,
            currentPhase: 'hypothesis-generation',
          }))

          // Disable auto-flush
          yield* store.disableAutoFlush()

          // Update state again - should not auto-flush
          yield* store.updateDilagentState((state) => ({
            ...state,
            currentPhase: 'hypothesis-testing',
          }))

          // File should still have the first update, not the second
          const fileState = yield* workingDirService.readState(testDir)
          expect(fileState.currentPhase).toBe('hypothesis-generation') // First update
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })
    })

    describe('manual flush', () => {
      it('should manually flush state to file', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const workingDirService = yield* WorkingDirService
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)

          // Update state (no auto-flush)
          yield* store.updateDilagentState((state) => ({
            ...state,
            currentPhase: 'hypothesis-generation',
          }))

          // Manually flush
          yield* store.flushToFile()

          // File should have updated state
          const fileState = yield* workingDirService.readState(testDir)
          expect(fileState.currentPhase).toBe('hypothesis-generation')
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should fail to flush when state not initialized', async () => {
        const program = Effect.gen(function* () {
          const store = yield* StateStore
          yield* store.flushToFile()
        })

        await expect(Effect.runPromise(program.pipe(Effect.provide(TestLayer)))).rejects.toThrow(
          'DilagentState has not been initialized',
        )
      })
    })

    describe('updateHypothesis', () => {
      it('should update hypothesis status and details', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)

          // Update hypothesis
          yield* store.updateHypothesis('H001', {
            status: 'running',
            startedAt: '2025-09-07T13:00:00Z',
            confidence: 0.9,
          })

          const updatedState = yield* store.getDilagentState()
          const hypothesis = updatedState.hypotheses.find((h) => h.id === 'H001')

          expect(hypothesis?.status).toBe('running')
          expect(hypothesis?.startedAt).toBe('2025-09-07T13:00:00Z')
          expect(hypothesis?.confidence).toBe(0.9)
          expect(updatedState.lastUpdated).not.toBe(testState.lastUpdated)
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should only update specified hypothesis', async () => {
        const testState = createTestState()

        const program = Effect.gen(function* () {
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)

          // Update only H001
          yield* store.updateHypothesis('H001', { status: 'completed', result: 'proven' })

          const updatedState = yield* store.getDilagentState()
          const h001 = updatedState.hypotheses.find((h) => h.id === 'H001')
          const h002 = updatedState.hypotheses.find((h) => h.id === 'H002')

          expect(h001?.status).toBe('completed')
          expect(h001?.result).toBe('proven')
          expect(h002?.status).toBe('running') // Unchanged
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })
    })

    describe('state updates with lastUpdated', () => {
      it('should automatically update lastUpdated timestamp', async () => {
        const testState = createTestState()
        const originalTimestamp = testState.lastUpdated

        const program = Effect.gen(function* () {
          const store = yield* StateStore

          yield* store.initializeDilagentState(testDir, testState)

          // Small delay to ensure timestamp changes - use Effect.sleep instead of await
          yield* Effect.sleep('1 millis')

          yield* store.updateDilagentState((state) => ({
            ...state,
            currentPhase: 'hypothesis-generation',
          }))

          const updatedState = yield* store.getDilagentState()
          expect(updatedState.lastUpdated).not.toBe(originalTimestamp)
          expect(new Date(updatedState.lastUpdated).getTime()).toBeGreaterThan(new Date(originalTimestamp).getTime())
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })
    })

    describe('error handling', () => {
      it('should fail to get state when not initialized', async () => {
        const program = Effect.gen(function* () {
          const store = yield* StateStore
          yield* store.getDilagentState()
        })

        await expect(Effect.runPromise(program.pipe(Effect.provide(TestLayer)))).rejects.toThrow(
          'DilagentState has not been initialized',
        )
      })

      it('should handle corrupt state file gracefully', async () => {
        const _program = Effect.gen(function* () {
          const workingDirService = yield* WorkingDirService

          // Write invalid JSON to state file
          const paths = workingDirService.getPaths(testDir)
          yield* workingDirService.ensureDirectory(Path.dirname(paths.stateFile))
        })

        // Manually write corrupt JSON
        const dilagentDir = Path.join(testDir, '.dilagent')
        fs.mkdirSync(dilagentDir, { recursive: true })
        fs.writeFileSync(Path.join(dilagentDir, 'state.json'), 'invalid json')

        const program2 = Effect.gen(function* () {
          const store = yield* StateStore
          const initialState = createTestState()

          // Should fall back to initial state when file is corrupt
          yield* store.initializeDilagentState(testDir, initialState)
          const state = yield* store.getDilagentState()

          expect(state).toEqual(initialState)
        })

        await Effect.runPromise(program2.pipe(Effect.provide(TestLayer)))
      })
    })
  })

  describe('integration with WorkingDirService', () => {
    it('should work end-to-end with directory initialization and state management', async () => {
      const testState = createTestState()

      const program = Effect.gen(function* () {
        const workingDirService = yield* WorkingDirService
        const store = yield* StateStore

        // Initialize directory structure
        yield* workingDirService.initializeDilagentStructure(testDir)

        // Initialize state store with auto-flush
        yield* store.initializeDilagentState(testDir, testState)
        yield* store.enableAutoFlush()

        // Update hypothesis
        yield* store.updateHypothesis('H001', {
          status: 'running',
          startedAt: '2025-09-07T13:00:00Z',
        })

        // Update overall state
        yield* store.updateDilagentState((state) => ({
          ...state,
          currentPhase: 'hypothesis-testing',
          overallProgress: {
            ...state.overallProgress,
            remaining: 1,
          },
        }))

        // Verify file was written correctly
        const fileState = yield* workingDirService.readState(testDir)

        expect(fileState.currentPhase).toBe('hypothesis-testing')
        expect(fileState.overallProgress.remaining).toBe(1)

        const h001 = fileState.hypotheses.find((h) => h.id === 'H001')
        expect(h001?.status).toBe('running')
        expect(h001?.startedAt).toBe('2025-09-07T13:00:00Z')
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })
})
