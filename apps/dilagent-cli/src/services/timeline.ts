import { Effect, Ref, Schema } from 'effect'
import type { Timeline, TimelineEvent } from '../schemas/file-management.ts'
import { TimelineEvent as TimelineEventSchema } from '../schemas/file-management.ts'
import { WorkingDirService } from './working-dir.ts'

// Error types for TimelineService
export class TimelineError extends Schema.TaggedError<TimelineError>()('TimelineError', {
  cause: Schema.Defect,
  message: Schema.String,
  operation: Schema.String,
}) {}

export class TimelinePersistenceError extends Schema.TaggedError<TimelinePersistenceError>()(
  'TimelinePersistenceError',
  {
    cause: Schema.Defect,
    message: Schema.String,
    timelineFile: Schema.String,
  },
) {}

/**
 * Service for managing timeline events and persistence
 *
 * Features:
 * - Event recording with automatic timestamp generation
 * - Event filtering by phase and hypothesis ID
 * - Auto-persistence to .dilagent/timeline.json
 * - Thread-safe concurrent event recording
 */
export class TimelineService extends Effect.Service<TimelineService>()('TimelineService', {
  effect: Effect.gen(function* () {
    const workingDirService = yield* WorkingDirService

    // In-memory timeline state
    const timelineStore = yield* Ref.make<Timeline | undefined>(undefined)
    const autoPersistEnabled = yield* Ref.make<boolean>(false)
    const workingDirPath = yield* Ref.make<string | undefined>(undefined)

    /**
     * Initialize timeline from file or create new timeline
     *
     * @param workingDir - Working directory containing .dilagent
     * @param runId - Run ID for the timeline
     * @returns Effect that succeeds when timeline is initialized
     */
    const initializeTimeline = Effect.fn('TimelineService.initializeTimeline')(function* (
      workingDir: string,
      runId: string,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir, runId })

      // Store working directory for auto-persist
      yield* Ref.set(workingDirPath, workingDir)

      // Try to load existing timeline
      const existingTimeline = yield* workingDirService.readTimeline(workingDir).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Effect.log(`No existing timeline found, creating new: ${error.message}`)
            return undefined
          }),
        ),
      )

      const timelineToUse =
        existingTimeline ??
        ({
          runId,
          createdAt: new Date().toISOString(),
          events: [],
        } as Timeline)

      yield* Ref.set(timelineStore, timelineToUse)
      yield* Effect.log(`Initialized timeline ${existingTimeline ? 'from file' : 'as new'}`)
    })

    /**
     * Enable auto-persist - timeline will be written to file on every event
     *
     * @returns Effect that succeeds when auto-persist is enabled
     */
    const enableAutoPersist = Effect.fn('TimelineService.enableAutoPersist')(function* () {
      yield* Ref.set(autoPersistEnabled, true)
      yield* Effect.log('Auto-persist enabled for Timeline')
    })

    /**
     * Disable auto-persist
     *
     * @returns Effect that succeeds when auto-persist is disabled
     */
    const disableAutoPersist = Effect.fn('TimelineService.disableAutoPersist')(function* () {
      yield* Ref.set(autoPersistEnabled, false)
      yield* Effect.log('Auto-persist disabled for Timeline')
    })

    /**
     * Get current timeline
     *
     * @returns Effect that succeeds with current timeline
     */
    const getTimeline = Effect.fn('TimelineService.getTimeline')(function* () {
      const timeline = yield* Ref.get(timelineStore)
      if (!timeline) {
        return yield* new TimelineError({
          cause: new Error('Timeline not initialized'),
          message: 'Timeline has not been initialized. Call initializeTimeline first.',
          operation: 'getTimeline',
        })
      }
      return timeline
    })

    /**
     * Record a new event in the timeline
     *
     * @param event - Event data (timestamp will be added automatically)
     * @returns Effect that succeeds when event is recorded
     */
    const recordEvent = Effect.fn('TimelineService.recordEvent')(function* (event: Omit<TimelineEvent, 'timestamp'>) {
      yield* Effect.annotateCurrentSpan({ event: event.event, hypothesisId: event.hypothesisId })

      const timestamp = new Date().toISOString()
      const fullEvent: TimelineEvent = {
        ...event,
        timestamp,
      }

      // Validate event structure
      const validatedEvent = yield* Schema.decodeUnknown(TimelineEventSchema)(fullEvent).pipe(
        Effect.catchAll(
          (error) =>
            new TimelineError({
              cause: error,
              message: `Invalid event structure: ${event.event}`,
              operation: 'recordEvent',
            }),
        ),
      )

      // Update timeline with new event
      yield* Ref.update(timelineStore, (timeline) => {
        if (!timeline) {
          throw new Error('Timeline not initialized')
        }
        return {
          ...timeline,
          events: [...timeline.events, validatedEvent],
        }
      })

      // Auto-persist if enabled
      const shouldAutoPersist = yield* Ref.get(autoPersistEnabled)
      if (shouldAutoPersist) {
        yield* persistToFile()
      }

      yield* Effect.log(`Recorded event: ${event.event}`)
    })

    /**
     * Get filtered events from the timeline
     *
     * @param filter - Optional filter criteria
     * @returns Effect that succeeds with filtered events
     */
    const getEvents = Effect.fn('TimelineService.getEvents')(function* (filter?: {
      phase?: string
      hypothesisId?: string
    }) {
      const timeline = yield* getTimeline()

      let filteredEvents = timeline.events

      if (filter?.phase) {
        filteredEvents = filteredEvents.filter((event) => event.phase === filter.phase)
      }

      if (filter?.hypothesisId) {
        filteredEvents = filteredEvents.filter((event) => event.hypothesisId === filter.hypothesisId)
      }

      return filteredEvents
    })

    /**
     * Manually persist current timeline to file
     *
     * @returns Effect that succeeds when timeline is persisted
     */
    const persistToFile = Effect.fn('TimelineService.persistToFile')(function* () {
      const timeline = yield* getTimeline()
      const workingDir = yield* Ref.get(workingDirPath)

      if (!workingDir) {
        return yield* new TimelinePersistenceError({
          cause: new Error('Working directory not set'),
          message: 'Cannot persist timeline: working directory not initialized',
          timelineFile: 'unknown',
        })
      }

      const timelineFile = workingDirService.getPaths(workingDir).timelineFile

      yield* workingDirService.writeTimeline(workingDir, timeline).pipe(
        Effect.catchAll(
          (error) =>
            new TimelinePersistenceError({
              cause: error,
              message: `Failed to persist timeline to file`,
              timelineFile,
            }),
        ),
      )

      yield* Effect.log(`Persisted timeline to ${timelineFile}`)
    })

    /**
     * Load timeline from file, replacing current timeline
     *
     * @param workingDir - Working directory containing .dilagent
     * @returns Effect that succeeds when timeline is loaded
     */
    const loadFromFile = Effect.fn('TimelineService.loadFromFile')(function* (workingDir: string) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const timelineFile = workingDirService.getPaths(workingDir).timelineFile

      const timeline = yield* workingDirService.readTimeline(workingDir).pipe(
        Effect.catchAll(
          (error) =>
            new TimelinePersistenceError({
              cause: error,
              message: `Failed to load timeline from file`,
              timelineFile,
            }),
        ),
      )

      yield* Ref.set(timelineStore, timeline)
      yield* Ref.set(workingDirPath, workingDir)
      yield* Effect.log(`Loaded timeline from ${timelineFile}`)
    })

    /**
     * Get timeline statistics
     *
     * @returns Effect that succeeds with timeline statistics
     */
    const getStatistics = Effect.fn('TimelineService.getStatistics')(function* () {
      const timeline = yield* getTimeline()

      const eventsByPhase = timeline.events.reduce(
        (acc, event) => {
          if (event.phase) {
            acc[event.phase] = (acc[event.phase] || 0) + 1
          }
          return acc
        },
        {} as Record<string, number>,
      )

      const eventsByHypothesis = timeline.events.reduce(
        (acc, event) => {
          if (event.hypothesisId) {
            acc[event.hypothesisId] = (acc[event.hypothesisId] || 0) + 1
          }
          return acc
        },
        {} as Record<string, number>,
      )

      return {
        totalEvents: timeline.events.length,
        eventsByPhase,
        eventsByHypothesis,
        firstEvent: timeline.events[0]?.timestamp,
        lastEvent: timeline.events[timeline.events.length - 1]?.timestamp,
      }
    })

    return {
      initializeTimeline,
      enableAutoPersist,
      disableAutoPersist,
      getTimeline,
      recordEvent,
      getEvents,
      persistToFile,
      loadFromFile,
      getStatistics,
    } as const
  }),

  dependencies: [WorkingDirService.Default],
}) {}
