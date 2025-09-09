import * as fs from 'node:fs'
import * as os from 'node:os'
import * as Path from 'node:path'
import { FileSystem } from '@effect/platform'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DilagentState } from '../schemas/file-management.ts'
import { StateStore } from './state-store.ts'
import { WorkingDirService } from './working-dir.ts'

// Helper function to create expected default state
const createExpectedDefaultState = (workingDir: string): DilagentState => ({
  workingDirId: expect.any(String),
  problemPrompt: '',
  contextDirectory: workingDir,
  contextRelativePath: undefined,
  workingDirectory: workingDir,
  hypotheses: {},
  currentPhase: 'setup',
  completedPhases: [],
  metrics: {
    startTime: expect.any(String),
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

describe('StateStore', () => {
  let testDir: string
  let runtime: ManagedRuntime.ManagedRuntime<StateStore | WorkingDirService | FileSystem.FileSystem, never>

  // Create test layer with all dependencies
  const PlatformLayer = Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)
  const WorkingDirLayer = (testDir: string) =>
    WorkingDirService.Default({ workingDir: testDir, create: true }).pipe(Layer.provideMerge(PlatformLayer))
  const ServiceLayer = (testDir: string) => StateStore.Default.pipe(Layer.provideMerge(WorkingDirLayer(testDir)))
  const TestLayer = (testDir: string) =>
    Layer.mergeAll(PlatformLayer, WorkingDirLayer(testDir), ServiceLayer(testDir)).pipe(Layer.orDie)

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = await new Promise<string>((resolve, reject) => {
      fs.mkdtemp(Path.join(os.tmpdir(), 'state-store-test-'), (err, dir) => {
        if (err) reject(err)
        else resolve(dir)
      })
    })

    runtime = ManagedRuntime.make(TestLayer(testDir))
  })

  afterEach(async () => {
    // Clean up test directory
    await new Promise<void>((resolve) => {
      fs.rm(testDir, { recursive: true, force: true }, () => resolve())
    })
  })

  describe('StateStore service', () => {
    it('should auto-initialize with default state when no existing state file', async () => {
      const expectedState = createExpectedDefaultState(testDir)

      const program = Effect.gen(function* () {
        const store = yield* StateStore

        const retrievedState = yield* store.getState()

        expect(retrievedState).toEqual(expectedState)
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should auto-persist state changes', async () => {
      const program = Effect.gen(function* () {
        const store = yield* StateStore
        const workingDir = yield* WorkingDirService
        const fs = yield* FileSystem.FileSystem

        // Update the state
        yield* store.setPhase('hypothesis-generation')

        // Verify the state was updated in memory
        const updatedState = yield* store.getState()
        expect(updatedState.currentPhase).toBe('hypothesis-generation')
        expect(updatedState.completedPhases).toContain('hypothesis-generation')

        // Verify the state was persisted to disk
        const fileContent = yield* fs.readFileString(workingDir.paths.stateFile)
        const parsedState = JSON.parse(fileContent) as DilagentState
        expect(parsedState.currentPhase).toBe('hypothesis-generation')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should register and update hypotheses', async () => {
      const program = Effect.gen(function* () {
        const store = yield* StateStore

        // Register a hypothesis
        yield* store.registerHypothesis({ id: 'H001', slug: 'auth-bug-fix', description: 'Fix authentication bug' })

        // Update hypothesis status
        yield* store.updateHypothesis({
          id: 'H001',
          update: {
            status: 'running',
            startedAt: '2025-09-08T12:00:00Z',
          },
        })

        const state = yield* store.getState()

        // Check hypothesis was registered
        expect(state.hypotheses.H001).toBeDefined()
        expect(state.hypotheses.H001!.slug).toBe('auth-bug-fix')
        expect(state.hypotheses.H001!.description).toBe('Fix authentication bug')
        expect(state.hypotheses.H001!.status).toBe('running')
        expect(state.hypotheses.H001!.startedAt).toBe('2025-09-08T12:00:00Z')

        // Check metrics were updated
        expect(state.metrics.hypothesesGenerated).toBe(1)
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should handle multiple hypotheses independently', async () => {
      const program = Effect.gen(function* () {
        const store = yield* StateStore

        // Register multiple hypotheses
        yield* store.registerHypothesis({ id: 'H001', slug: 'auth-bug', description: 'Fix auth bug' })
        yield* store.registerHypothesis({ id: 'H002', slug: 'perf-fix', description: 'Fix performance issue' })

        // Update only H001
        yield* store.updateHypothesis({
          id: 'H001',
          update: {
            status: 'completed',
            result: {
              _tag: 'Proven' as const,
              hypothesisId: 'H001',
              findings: 'Auth bug fixed successfully',
            },
          },
        })

        const state = yield* store.getState()

        // H001 should be updated
        expect(state.hypotheses.H001!.status).toBe('completed')
        expect(state.hypotheses.H001!.result?._tag).toBe('Proven')

        // H002 should remain unchanged
        expect(state.hypotheses.H002!.status).toBe('pending')
        expect(state.hypotheses.H002!.result).toBeUndefined()

        // Metrics should reflect the updates
        expect(state.metrics.hypothesesGenerated).toBe(2)
        expect(state.metrics.hypothesesCompleted).toBe(1)
        expect(state.metrics.hypothesesSuccessful).toBe(1)
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should load existing state from file on initialization', async () => {
      // Pre-create a state file
      const existingState: DilagentState = {
        workingDirId: '550e8400-e29b-41d4-a716-446655440000',
        problemPrompt: 'Existing problem description',
        contextDirectory: testDir,
        contextRelativePath: undefined,
        workingDirectory: testDir,
        hypotheses: {
          H001: {
            id: 'H001',
            slug: 'existing-hyp',
            description: 'Existing hypothesis',
            status: 'running',
            worktreePath: Path.join(testDir, 'H001-existing-hyp'),
            branchName: 'dilagent/550e8400-e29b-41d4-a716-446655440000/H001-existing-hyp',
            startedAt: '2025-09-08T10:00:00Z',
            completedAt: undefined,
            result: undefined,
          },
        },
        currentPhase: 'hypothesis-testing',
        completedPhases: ['setup', 'hypothesis-generation'],
        metrics: {
          startTime: '2025-09-08T09:00:00Z',
          endTime: undefined,
          hypothesesGenerated: 1,
          hypothesesCompleted: 0,
          hypothesesSuccessful: 0,
          hypothesesFailed: 0,
          hypothesesSkipped: 0,
        },
        progress: {
          current: 1,
          total: 2,
          phase: 'hypothesis-testing',
          message: 'Testing hypothesis H001',
        },
      }

      // Write the state file before service initialization
      const dilagentDir = Path.join(testDir, '.dilagent')
      fs.mkdirSync(dilagentDir, { recursive: true })
      fs.writeFileSync(Path.join(dilagentDir, 'state.json'), JSON.stringify(existingState))

      const program = Effect.gen(function* () {
        const store = yield* StateStore
        const loadedState = yield* store.getState()

        expect(loadedState.currentPhase).toBe('hypothesis-testing')
        expect(loadedState.hypotheses.H001!.slug).toBe('existing-hyp')
        expect(loadedState.metrics.hypothesesGenerated).toBe(1)
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should handle state updates with progress tracking', async () => {
      const program = Effect.gen(function* () {
        const store = yield* StateStore

        // Update progress
        yield* store.updateProgress({
          current: 3,
          total: 10,
          message: 'Processing hypothesis tests',
        })

        const state = yield* store.getState()
        expect(state.progress.current).toBe(3)
        expect(state.progress.total).toBe(10)
        expect(state.progress.message).toBe('Processing hypothesis tests')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should complete the run and update metrics', async () => {
      const program = Effect.gen(function* () {
        const store = yield* StateStore

        // Complete the run
        yield* store.completeRun()

        const state = yield* store.getState()
        expect(state.currentPhase).toBe('completed')
        expect(state.metrics.endTime).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })
})
