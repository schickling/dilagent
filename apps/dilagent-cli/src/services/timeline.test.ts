import * as fs from 'node:fs'
import * as Path from 'node:path'
import { FileSystem } from '@effect/platform'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Timeline } from '../schemas/file-management.ts'
import {
  createHypothesisEvent,
  createPhaseEvent,
  createSystemEvent,
  Timeline as TimelineSchema,
} from '../schemas/file-management.ts'
import { makeTempDir } from '../utils/fs.ts'
import { TimelineService } from './timeline.ts'
import { WorkingDirService } from './working-dir.ts'

describe('TimelineService', () => {
  let testDir: string

  // Create test layer with all dependencies
  let runtime: ManagedRuntime.ManagedRuntime<TimelineService | WorkingDirService | FileSystem.FileSystem, never>

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = makeTempDir('timeline-service-test-')

    const PlatformLayer = Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)
    const WorkingDirLayer = WorkingDirService.Default({ workingDirectory: testDir, create: true }).pipe(
      Layer.provideMerge(PlatformLayer),
    )
    const ServiceLayer = TimelineService.Default.pipe(Layer.provideMerge(WorkingDirLayer))
    const TestLayer = Layer.mergeAll(PlatformLayer, WorkingDirLayer, ServiceLayer).pipe(Layer.orDie)

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
    createdAt: '2025-09-07T12:34:56Z',
    events: [
      {
        ...createPhaseEvent({ event: 'phase.started', phase: 'setup' }),
        timestamp: '2025-09-07T12:35:00Z',
      },
      {
        ...createHypothesisEvent({
          event: 'hypothesis.started',
          hypothesisId: 'H001',
          phase: 'hypothesis-testing',
        }),
        timestamp: '2025-09-07T12:36:00Z',
      },
    ],
  })

  describe('Timeline initialization', () => {
    it('should initialize new timeline when no existing file', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Initialize timeline
        const timeline = yield* timelineService.getTimeline()

        // Timeline no longer has runId
        expect(timeline.events).toEqual([])
        expect(timeline.events).toEqual([])
        expect(timeline.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/) // ISO timestamp
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should initialize from existing timeline file', async () => {
      const existingTimeline = createTestTimeline()

      // Pre-create the timeline file before initializing services
      const dilagentDir = Path.join(testDir, '.dilagent')
      fs.mkdirSync(dilagentDir, { recursive: true })
      const timelineFilePath = Path.join(dilagentDir, 'timeline.json')
      fs.writeFileSync(timelineFilePath, JSON.stringify(existingTimeline))

      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Get timeline - TimelineService should have loaded from file during initialization
        const timeline = yield* timelineService.getTimeline()

        // Timeline loaded from file should match existing timeline events and creation time
        expect(timeline.createdAt).toBe(existingTimeline.createdAt)
        expect(timeline.events).toEqual(existingTimeline.events)
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })

  describe('Event recording', () => {
    it('should record events with automatic timestamps', async () => {
      const beforeRecord = new Date().toISOString()

      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record an event
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            phase: 'hypothesis-testing',
            hypothesisId: 'H001',
          }),
        )

        const timeline = yield* timelineService.getTimeline()
        expect(timeline.events).toHaveLength(1)

        const event = timeline.events[0]!
        expect(event._tag).toBe('HypothesisEvent')
        expect(event.event).toBe('hypothesis.started')
        expect(event.phase).toBe('hypothesis-testing')
        if (event._tag === 'HypothesisEvent') {
          expect(event.hypothesisId).toBe('H001')
        }
        expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
        expect(new Date(event.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(beforeRecord).getTime())
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should record multiple events in sequence', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record multiple events
        yield* timelineService.recordEvent(createPhaseEvent({ event: 'phase.started', phase: 'setup' }))
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            phase: 'hypothesis-testing',
            hypothesisId: 'H001',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.completed',
            phase: 'hypothesis-testing',
          }),
        )

        // Record event with details instead of metadata
        yield* timelineService.recordEvent(
          createSystemEvent({
            event: 'system.initialized',
            phase: 'setup',
            details: { key1: 'value1', key2: 42 },
          }),
        )

        const timeline = yield* timelineService.getTimeline()
        expect(timeline.events).toHaveLength(4)

        expect(timeline.events[0]!._tag).toBe('PhaseEvent')
        expect(timeline.events[0]!.event).toBe('phase.started')
        const hypothesisEvent = timeline.events[1]!
        expect(hypothesisEvent._tag).toBe('HypothesisEvent')
        expect(hypothesisEvent.event).toBe('hypothesis.started')
        expect(hypothesisEvent.phase).toBe('hypothesis-testing')
        if (hypothesisEvent._tag === 'HypothesisEvent') {
          expect(hypothesisEvent.hypothesisId).toBe('H001')
        }
        expect(timeline.events[2]!._tag).toBe('HypothesisEvent')
        expect(timeline.events[2]!.event).toBe('hypothesis.completed')
        expect(timeline.events[3]!._tag).toBe('SystemEvent')
        expect(timeline.events[3]!.event).toBe('system.initialized')
        expect(timeline.events[3]!.details).toEqual({ key1: 'value1', key2: 42 })
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should validate event structure', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Try to record an invalid event (event field as number instead of string)
        yield* timelineService.recordEvent({ event: 123 as any, phase: 'setup' } as any)
      })

      await expect(Effect.runPromise(program.pipe(Effect.provide(runtime)))).rejects.toThrow()
    })
  })

  describe('Event filtering', () => {
    it('should filter events by phase', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events in different phases
        yield* timelineService.recordEvent(
          createPhaseEvent({
            event: 'phase.started',
            phase: 'setup',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            phase: 'hypothesis-generation',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            phase: 'hypothesis-testing',
          }),
        )
        yield* timelineService.recordEvent(
          createPhaseEvent({
            event: 'phase.started',
            phase: 'setup',
          }),
        )

        // Filter by phase
        const setupEvents = yield* timelineService.getEvents({ phase: 'setup' })
        const hypothesisEvents = yield* timelineService.getEvents({ phase: 'hypothesis-generation' })

        expect(setupEvents).toHaveLength(2)
        expect(setupEvents[0]!.event).toBe('phase.started')
        expect(setupEvents[1]!.event).toBe('phase.started')

        expect(hypothesisEvents).toHaveLength(1)
        expect(hypothesisEvents[0]!.event).toBe('hypothesis.started')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should filter events by hypothesis ID', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events for different hypotheses
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H001',
            phase: 'hypothesis-testing',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H002',
            phase: 'hypothesis-testing',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.completed',
            hypothesisId: 'H001',
            phase: 'hypothesis-testing',
          }),
        )
        yield* timelineService.recordEvent(
          createSystemEvent({
            event: 'system.initialized',
            phase: 'setup',
          }),
        )

        // Filter by hypothesis ID
        const h001Events = yield* timelineService.getEvents({ hypothesisId: 'H001' })
        const h002Events = yield* timelineService.getEvents({ hypothesisId: 'H002' })

        expect(h001Events).toHaveLength(2)
        expect(h001Events[0]!.event).toBe('hypothesis.started')
        expect(h001Events[1]!.event).toBe('hypothesis.completed')

        expect(h002Events).toHaveLength(1)
        expect(h002Events[0]!.event).toBe('hypothesis.started')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should filter events by both phase and hypothesis ID', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H001',
            phase: 'hypothesis-testing',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H001',
            phase: 'hypothesis-generation',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H002',
            phase: 'hypothesis-testing',
          }),
        )

        // Filter by both criteria
        const filteredEvents = yield* timelineService.getEvents({
          phase: 'hypothesis-testing',
          hypothesisId: 'H001',
        })

        expect(filteredEvents).toHaveLength(1)
        expect(filteredEvents[0]!.event).toBe('hypothesis.started')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })

  describe('Auto-persistence', () => {
    it('should auto-persist by default', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        const workingDirService = yield* WorkingDirService
        const fs = yield* FileSystem.FileSystem

        // Record an event
        yield* timelineService.recordEvent(createSystemEvent({ event: 'system.initialized', phase: 'setup' }))

        // File should exist due to auto-persistence in TimelineService
        const fileExists = yield* fs.exists(workingDirService.paths.timelineFile)
        expect(fileExists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should auto-persist all events', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        const fs = yield* FileSystem.FileSystem
        const workingDir = yield* WorkingDirService

        // Record an event - should auto-persist
        yield* timelineService.recordEvent(createSystemEvent({ event: 'system.initialized', phase: 'setup' }))

        // File should exist and have the event
        const timelineContent = yield* fs.readFileString(workingDir.paths.timelineFile)
        const parsedContent = JSON.parse(timelineContent)
        const fileTimeline = yield* Schema.decodeUnknown(TimelineSchema)(parsedContent)
        expect(fileTimeline.events).toHaveLength(1)
        expect(fileTimeline.events[0]!.event).toBe('system.initialized')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should persist multiple events sequentially', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        const fs = yield* FileSystem.FileSystem
        const workingDir = yield* WorkingDirService

        // All events auto-persist in the new architecture
        yield* timelineService.recordEvent(createSystemEvent({ event: 'system.initialized', phase: 'setup' }))
        yield* timelineService.recordEvent(
          createHypothesisEvent({ event: 'hypothesis.started', phase: 'hypothesis-testing' }),
        )

        // File should have both events
        const timelineContent = yield* fs.readFileString(workingDir.paths.timelineFile)
        const parsedContent = JSON.parse(timelineContent)
        const fileTimeline = yield* Schema.decodeUnknown(TimelineSchema)(parsedContent)
        expect(fileTimeline.events).toHaveLength(2)
        expect(fileTimeline.events[0]!.event).toBe('system.initialized')
        expect(fileTimeline.events[1]!.event).toBe('hypothesis.started')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })

  describe('Persistence behavior', () => {
    it('should automatically persist timeline to file', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        const fs = yield* FileSystem.FileSystem
        const workingDir = yield* WorkingDirService

        // All events auto-persist in the new architecture
        yield* timelineService.recordEvent(createSystemEvent({ event: 'system.initialized', phase: 'setup' }))
        yield* timelineService.recordEvent(
          createHypothesisEvent({ event: 'hypothesis.started', phase: 'hypothesis-testing' }),
        )

        // File should already have both events
        const timelineContent = yield* fs.readFileString(workingDir.paths.timelineFile)
        const parsedContent = JSON.parse(timelineContent)
        const fileTimeline = yield* Schema.decodeUnknown(TimelineSchema)(parsedContent)
        expect(fileTimeline.events).toHaveLength(2)
        expect(fileTimeline.events[0]!.event).toBe('system.initialized')
        expect(fileTimeline.events[1]!.event).toBe('hypothesis.started')
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })

    it('should always have timeline available after initialization', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService
        const timeline = yield* timelineService.getTimeline()
        expect(timeline.events).toEqual([])
        expect(timeline.createdAt).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })

  describe('Statistics', () => {
    it('should provide timeline statistics', async () => {
      const program = Effect.gen(function* () {
        const timelineService = yield* TimelineService

        // Record events with different phases and hypotheses
        yield* timelineService.recordEvent(
          createPhaseEvent({
            event: 'phase.started',
            phase: 'setup',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H001',
            phase: 'hypothesis-testing',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.completed',
            hypothesisId: 'H001',
            phase: 'hypothesis-testing',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H002',
            phase: 'hypothesis-testing',
          }),
        )

        const stats = yield* timelineService.getStatistics()

        expect(stats.totalEvents).toBe(4)
        expect(stats.eventsByPhase).toEqual({
          setup: 1,
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
        const fs = yield* FileSystem.FileSystem

        // Record various events (all auto-persist)
        yield* timelineService.recordEvent(
          createSystemEvent({
            event: 'system.initialized',
            phase: 'setup',
          }),
        )
        yield* timelineService.recordEvent(
          createPhaseEvent({
            event: 'phase.started',
            phase: 'setup',
          }),
        )
        yield* timelineService.recordEvent(
          createHypothesisEvent({
            event: 'hypothesis.started',
            hypothesisId: 'H001',
            phase: 'hypothesis-testing',
            details: { confidence: 0.8 },
          }),
        )

        // Verify file was written correctly via auto-persist
        const timelineContent = yield* fs.readFileString(workingDirService.paths.timelineFile)
        const parsedContent = JSON.parse(timelineContent)
        const fileTimeline = yield* Schema.decodeUnknown(TimelineSchema)(parsedContent)

        expect(fileTimeline.events).toHaveLength(3)
        expect(fileTimeline.events[0]!.event).toBe('system.initialized')
        expect(fileTimeline.events[1]!.event).toBe('phase.started')
        expect(fileTimeline.events[2]!.event).toBe('hypothesis.started')
        expect(fileTimeline.events[2]!.details).toEqual({ confidence: 0.8 })
      })

      await Effect.runPromise(program.pipe(Effect.provide(runtime)))
    })
  })
})
