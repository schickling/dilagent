import * as fs from 'node:fs'
import * as os from 'node:os'
import * as Path from 'node:path'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Timeline } from '../schemas/file-management.ts'
import { TimelineService } from './timeline.ts'
import { WorkingDirService } from './working-dir.ts'

describe('TimelineService', () => {
  let testDir: string
  const runId = '2025-09-07-test'

  // Create test layer with all dependencies
  let runtime: ManagedRuntime.ManagedRuntime<TimelineService | WorkingDirService, never>

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = await new Promise<string>((resolve, reject) => {
      fs.mkdtemp(Path.join(os.tmpdir(), 'timeline-service-test-'), (err, dir) => {
        if (err) reject(err)
        else resolve(dir)
      })
    })

    const PlatformLayer = Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)
    const ServiceLayer = Layer.mergeAll(
      TimelineService.Default(runId).pipe(Layer.provideMerge(WorkingDirService.Default(testDir))),
    ).pipe(Layer.provide(PlatformLayer))
    const TestLayer = Layer.mergeAll(PlatformLayer, ServiceLayer).pipe(Layer.orDie)

    runtime = ManagedRuntime.make(TestLayer)
  })

  afterEach(async () => {
    // Clean up test directory
    await new Promise<void>((resolve) => {
      fs.rm(testDir, { recursive: true, force: true }, () => resolve())
    })
  })

  // Helper to create test timeline
  const createTestTimeline = (): Timeline => ({
    runId,
    createdAt: '2025-09-07T12:34:56Z',
    events: [
      {
        timestamp: '2025-09-07T12:35:00Z',
        event: 'Reproduction started',
        phase: 'reproduction',
      },
      {
        timestamp: '2025-09-07T12:36:00Z',
        event: 'Hypothesis H001 started',
        hypothesisId: 'H001',
        phase: 'hypothesis-testing',
      },
    ],
  })

  describe('Timeline initialization', () => {
    it('should initialize new timeline when no existing file', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Initialize timeline
        const timeline = yield* timelineService.getTimeline()

        expect(timeline.runId).toBe(runId)
        expect(timeline.events).toEqual([])
        expect(timeline.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/) // ISO timestamp
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should initialize from existing timeline file', async () => {
      const existingTimeline = createTestTimeline()

      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        const workingDirService = yield* WorkingDirService

        // Initialize .dilagent structure

        // Write existing timeline
        yield* workingDirService.writeTimeline(existingTimeline)

        // Initialize timeline - should load from file
        const timeline = yield* timelineService.getTimeline()

        expect(timeline).toEqual(existingTimeline)
        expect(timeline.runId).toBe('2025-09-07-test') // From existing file, not parameter
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should fail to get timeline when not initialized', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        yield* timelineService.getTimeline()
      })

      await expect(Effect.runPromise(program.pipe(Effect.provide(runtime)))).rejects.toThrow(
        'Timeline has not been initialized',
      )
    })
  })

  describe('Event recording', () => {
    it('should record events with automatic timestamps', async () => {
      const beforeRecord = new Date().toISOString()

      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record an event
        yield* timelineService.recordEvent({
          event: 'Test event occurred',
          phase: 'testing',
          hypothesisId: 'H001',
        })

        const timeline = yield* timelineService.getTimeline()
        expect(timeline.events).toHaveLength(1)

        const event = timeline.events[0]!
        expect(event.event).toBe('Test event occurred')
        expect(event.phase).toBe('testing')
        expect(event.hypothesisId).toBe('H001')
        expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
        expect(new Date(event.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(beforeRecord).getTime())
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should record multiple events in sequence', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record multiple events
        yield* timelineService.recordEvent({ event: 'First event' })
        yield* timelineService.recordEvent({
          event: 'Second event',
          phase: 'testing',
          hypothesisId: 'H001',
        })
        yield* timelineService.recordEvent({
          event: 'Third event',
          metadata: { key1: 'value1', key2: 42 },
        })

        const timeline = yield* timelineService.getTimeline()
        expect(timeline.events).toHaveLength(3)

        expect(timeline.events[0]!.event).toBe('First event')
        expect(timeline.events[1]!.event).toBe('Second event')
        expect(timeline.events[1]!.phase).toBe('testing')
        expect(timeline.events[1]!.hypothesisId).toBe('H001')
        expect(timeline.events[2]!.event).toBe('Third event')
        expect(timeline.events[2]!.metadata).toEqual({ key1: 'value1', key2: 42 })
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should validate event structure', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Try to record an invalid event (event field as number instead of string)
        yield* timelineService.recordEvent({ event: 123 as any })
      })

      await expect(Effect.runPromise(program.pipe(Effect.provide(runtime)))).rejects.toThrow('Invalid event structure')
    })
  })

  describe('Event filtering', () => {
    it('should filter events by phase', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events in different phases
        yield* timelineService.recordEvent({
          event: 'Reproduction started',
          phase: 'reproduction',
        })
        yield* timelineService.recordEvent({
          event: 'Hypothesis generated',
          phase: 'hypothesis-generation',
        })
        yield* timelineService.recordEvent({
          event: 'Hypothesis tested',
          phase: 'hypothesis-testing',
        })
        yield* timelineService.recordEvent({
          event: 'Another reproduction event',
          phase: 'reproduction',
        })

        // Filter by phase
        const reproductionEvents = yield* timelineService.getEvents({ phase: 'reproduction' })
        const hypothesisEvents = yield* timelineService.getEvents({ phase: 'hypothesis-generation' })

        expect(reproductionEvents).toHaveLength(2)
        expect(reproductionEvents[0]!.event).toBe('Reproduction started')
        expect(reproductionEvents[1]!.event).toBe('Another reproduction event')

        expect(hypothesisEvents).toHaveLength(1)
        expect(hypothesisEvents[0]!.event).toBe('Hypothesis generated')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should filter events by hypothesis ID', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events for different hypotheses
        yield* timelineService.recordEvent({
          event: 'H001 started',
          hypothesisId: 'H001',
          phase: 'hypothesis-testing',
        })
        yield* timelineService.recordEvent({
          event: 'H002 started',
          hypothesisId: 'H002',
          phase: 'hypothesis-testing',
        })
        yield* timelineService.recordEvent({
          event: 'H001 completed',
          hypothesisId: 'H001',
          phase: 'hypothesis-testing',
        })
        yield* timelineService.recordEvent({
          event: 'General event',
        })

        // Filter by hypothesis ID
        const h001Events = yield* timelineService.getEvents({ hypothesisId: 'H001' })
        const h002Events = yield* timelineService.getEvents({ hypothesisId: 'H002' })

        expect(h001Events).toHaveLength(2)
        expect(h001Events[0]!.event).toBe('H001 started')
        expect(h001Events[1]!.event).toBe('H001 completed')

        expect(h002Events).toHaveLength(1)
        expect(h002Events[0]!.event).toBe('H002 started')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should filter events by both phase and hypothesis ID', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events
        yield* timelineService.recordEvent({
          event: 'H001 testing started',
          hypothesisId: 'H001',
          phase: 'hypothesis-testing',
        })
        yield* timelineService.recordEvent({
          event: 'H001 generation event',
          hypothesisId: 'H001',
          phase: 'hypothesis-generation',
        })
        yield* timelineService.recordEvent({
          event: 'H002 testing started',
          hypothesisId: 'H002',
          phase: 'hypothesis-testing',
        })

        // Filter by both criteria
        const filteredEvents = yield* timelineService.getEvents({
          phase: 'hypothesis-testing',
          hypothesisId: 'H001',
        })

        expect(filteredEvents).toHaveLength(1)
        expect(filteredEvents[0]!.event).toBe('H001 testing started')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })

  describe('Auto-persistence', () => {
    it('should not auto-persist by default', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        const workingDirService = yield* WorkingDirService

        // Record an event
        yield* timelineService.recordEvent({ event: 'Test event' })

        // File should not exist yet (no auto-persist)
        const fileExists = yield* workingDirService.readTimeline().pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        )

        expect(fileExists).toBe(false)
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should auto-persist when enabled', async () => {
      const program = Effect.gen(function* () {
        const workingDirService = yield* WorkingDirService
        const timelineService = yield* TimelineService

        yield* timelineService.enableAutoPersist()

        // Record an event - should auto-persist
        yield* timelineService.recordEvent({ event: 'Test event' })

        // File should exist and have the event
        const fileTimeline = yield* workingDirService.readTimeline()
        expect(fileTimeline.events).toHaveLength(1)
        expect(fileTimeline.events[0]!.event).toBe('Test event')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should stop auto-persist when disabled', async () => {
      const program = Effect.gen(function* () {
        const workingDirService = yield* WorkingDirService
        const timelineService = yield* TimelineService

        yield* timelineService.enableAutoPersist()

        // Record first event - should auto-persist
        yield* timelineService.recordEvent({ event: 'First event' })

        // Disable auto-persist
        yield* timelineService.disableAutoPersist()

        // Record second event - should not auto-persist
        yield* timelineService.recordEvent({ event: 'Second event' })

        // File should still have only the first event
        const fileTimeline = yield* workingDirService.readTimeline()
        expect(fileTimeline.events).toHaveLength(1)
        expect(fileTimeline.events[0]!.event).toBe('First event')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })

  describe('Manual persistence', () => {
    it('should manually persist timeline to file', async () => {
      const program = Effect.gen(function* () {
        const workingDirService = yield* WorkingDirService
        const timelineService = yield* TimelineService

        // Record events (no auto-persist)
        yield* timelineService.recordEvent({ event: 'First event' })
        yield* timelineService.recordEvent({ event: 'Second event' })

        // Manually persist
        yield* timelineService.persistToFile()

        // File should have both events
        const fileTimeline = yield* workingDirService.readTimeline()
        expect(fileTimeline.events).toHaveLength(2)
        expect(fileTimeline.events[0]!.event).toBe('First event')
        expect(fileTimeline.events[1]!.event).toBe('Second event')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should fail to persist when timeline not initialized', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        yield* timelineService.persistToFile()
      })

      await expect(Effect.runPromise(program.pipe(Effect.provide(runtime)))).rejects.toThrow(
        'Timeline has not been initialized',
      )
    })
  })

  describe('Statistics', () => {
    it('should provide timeline statistics', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events with different phases and hypotheses
        yield* timelineService.recordEvent({
          event: 'Reproduction started',
          phase: 'reproduction',
        })
        yield* timelineService.recordEvent({
          event: 'H001 started',
          hypothesisId: 'H001',
          phase: 'hypothesis-testing',
        })
        yield* timelineService.recordEvent({
          event: 'H001 completed',
          hypothesisId: 'H001',
          phase: 'hypothesis-testing',
        })
        yield* timelineService.recordEvent({
          event: 'H002 started',
          hypothesisId: 'H002',
          phase: 'hypothesis-testing',
        })

        const stats = yield* timelineService.getStatistics()

        expect(stats.totalEvents).toBe(4)
        expect(stats.eventsByPhase).toEqual({
          reproduction: 1,
          'hypothesis-testing': 3,
        })
        expect(stats.eventsByHypothesis).toEqual({
          H001: 2,
          H002: 1,
        })
        expect(stats.firstEvent).toBeDefined()
        expect(stats.lastEvent).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should handle empty timeline statistics', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        const stats = yield* timelineService.getStatistics()

        expect(stats.totalEvents).toBe(0)
        expect(stats.eventsByPhase).toEqual({})
        expect(stats.eventsByHypothesis).toEqual({})
        expect(stats.firstEvent).toBeUndefined()
        expect(stats.lastEvent).toBeUndefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })

  describe('Integration with WorkingDirService', () => {
    it('should work end-to-end with directory initialization and timeline management', async () => {
      const program = Effect.gen(function* () {
        const workingDirService = yield* WorkingDirService
        const timelineService = yield* TimelineService

        // Initialize directory structure

        // Initialize timeline with auto-persist
        yield* timelineService.enableAutoPersist()

        // Record various events
        yield* timelineService.recordEvent({
          event: 'Run started',
          phase: 'initialization',
        })
        yield* timelineService.recordEvent({
          event: 'Reproduction began',
          phase: 'reproduction',
        })
        yield* timelineService.recordEvent({
          event: 'H001 hypothesis started',
          hypothesisId: 'H001',
          phase: 'hypothesis-testing',
          metadata: { confidence: 0.8 },
        })

        // Verify file was written correctly via auto-persist
        const fileTimeline = yield* workingDirService.readTimeline()

        expect(fileTimeline.runId).toBe(runId)
        expect(fileTimeline.events).toHaveLength(3)
        expect(fileTimeline.events[0]!.event).toBe('Run started')
        expect(fileTimeline.events[1]!.event).toBe('Reproduction began')
        expect(fileTimeline.events[2]!.event).toBe('H001 hypothesis started')
        expect(fileTimeline.events[2]!.metadata).toEqual({ confidence: 0.8 })
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })
})
