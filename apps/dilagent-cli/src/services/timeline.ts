import { FileSystem } from '@effect/platform'
import { Effect, Ref, Schema } from 'effect'
import type { Timeline, TimelineEvent } from '../schemas/file-management.ts'
import { TimelineEvent as TimelineEventSchema, Timeline as TimelineSchema } from '../schemas/file-management.ts'
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
 * Service for managing timeline events
 *
 * Responsibilities:
 * - Owns the complete timeline lifecycle
 * - Reads existing timeline OR creates new on initialization
 * - Auto-persists all new events
 * - Provides filtering and statistics
 */
export class TimelineService extends Effect.Service<TimelineService>()('TimelineService', {
  effect: Effect.gen(function* () {
    const workingDir = yield* WorkingDirService
    const fs = yield* FileSystem.FileSystem

    // Read existing timeline or create new - happens ONCE during init
    const initialTimeline = yield* fs.readFileString(workingDir.paths.timelineFile).pipe(
      Effect.flatMap((content) => Schema.decodeUnknown(Schema.parseJson(TimelineSchema))(content)),
      Effect.catchAll(
        Effect.fn(function* () {
          yield* Effect.logDebug('[TimelineService] No existing timeline found, creating new').pipe(Effect.ignore)
          return {
            createdAt: new Date().toISOString(),
            events: [],
          } as Timeline
        }),
      ),
    )

    // Internal mutable reference
    const timelineRef = yield* Ref.make(initialTimeline)

    // Helper to persist current timeline
    const persist = Effect.gen(function* () {
      const currentTimeline = yield* Ref.get(timelineRef)
      const encoded = yield* Schema.encode(Schema.parseJson(TimelineSchema, { space: 2 }))(currentTimeline)
      yield* fs.writeFileString(workingDir.paths.timelineFile, encoded).pipe(
        Effect.catchAll(
          (error) =>
            new TimelinePersistenceError({
              cause: error,
              message: 'Failed to persist timeline to file',
              timelineFile: workingDir.paths.timelineFile,
            }),
        ),
      )
      // yield* Effect.logDebug('[TimelineService] Timeline persisted')
    })

    // Public API
    const getTimeline = () => Ref.get(timelineRef)

    const recordEvent = (event: Omit<TimelineEvent, 'timestamp'>) =>
      Effect.gen(function* () {
        const fullEvent: TimelineEvent = {
          ...event,
          timestamp: new Date().toISOString(),
        }

        // Validate event
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

        // Update timeline
        yield* Ref.updateAndGet(timelineRef, (timeline) => ({
          ...timeline,
          events: [...timeline.events, validatedEvent],
        }))

        // Auto-persist
        yield* persist

        yield* Effect.logDebug(`[TimelineService] Recorded event: ${event.event}`)
        return validatedEvent
      })

    const getEvents = (filter?: { phase?: string; hypothesisId?: string }) =>
      Effect.gen(function* () {
        const timeline = yield* getTimeline()

        if (!filter) return timeline.events

        return timeline.events.filter((event) => {
          if (filter.phase && event.phase !== filter.phase) return false
          if (filter.hypothesisId && event.hypothesisId !== filter.hypothesisId) return false
          return true
        })
      })

    const getStatistics = () =>
      Effect.gen(function* () {
        const timeline = yield* getTimeline()

        const eventsByPhase = timeline.events.reduce(
          (acc, event) => {
            if (event.phase) acc[event.phase] = (acc[event.phase] || 0) + 1
            return acc
          },
          {} as Record<string, number>,
        )

        const eventsByHypothesis = timeline.events.reduce(
          (acc, event) => {
            if (event.hypothesisId) acc[event.hypothesisId] = (acc[event.hypothesisId] || 0) + 1
            return acc
          },
          {} as Record<string, number>,
        )

        return {
          totalEvents: timeline.events.length,
          eventsByPhase,
          eventsByHypothesis,
          createdAt: timeline.createdAt,
          firstEvent: timeline.events[0]?.timestamp,
          lastEvent: timeline.events[timeline.events.length - 1]?.timestamp,
        }
      })

    const generateSummary = () =>
      Effect.gen(function* () {
        const timeline = yield* getTimeline()
        const stats = yield* getStatistics()

        if (timeline.events.length === 0) {
          return '# Timeline Summary\n\nNo timeline events recorded.'
        }

        const lines = ['# Timeline Summary', '']

        // Overall statistics
        lines.push('## Statistics')
        lines.push(`- **Total Events**: ${stats.totalEvents}`)
        if (stats.firstEvent && stats.lastEvent) {
          const start = new Date(stats.firstEvent)
          const end = new Date(stats.lastEvent)
          const duration = end.getTime() - start.getTime()
          lines.push(`- **Duration**: ${Math.round(duration / 1000)}s (${start.toISOString()} → ${end.toISOString()})`)
        }
        lines.push('')

        // Events by phase
        if (Object.keys(stats.eventsByPhase).length > 0) {
          lines.push('## Events by Phase')
          for (const [phase, count] of Object.entries(stats.eventsByPhase)) {
            lines.push(`- **${phase}**: ${count} events`)
          }
          lines.push('')
        }

        // Events by hypothesis
        if (Object.keys(stats.eventsByHypothesis).length > 0) {
          lines.push('## Events by Hypothesis')
          for (const [hypothesisId, count] of Object.entries(stats.eventsByHypothesis)) {
            lines.push(`- **${hypothesisId}**: ${count} events`)
          }
          lines.push('')
        }

        // Timeline events
        lines.push('## Timeline Events')
        for (const event of timeline.events) {
          const time = new Date(event.timestamp).toISOString().replace('T', ' ').replace('Z', '')
          let eventLine = `- **${time}** - ${event.event}`

          if (event.phase) {
            eventLine += ` (${event.phase})`
          }

          if (event.hypothesisId) {
            eventLine += ` [${event.hypothesisId}]`
          }

          lines.push(eventLine)

          // Add details if present
          if (event.details && Object.keys(event.details).length > 0) {
            const detailEntries = Object.entries(event.details).map(([key, value]) => {
              if (key === 'executionTimeMs') {
                return `${key}: ${value}ms`
              }
              return `${key}: ${JSON.stringify(value)}`
            })
            lines.push(`  - ${detailEntries.join(', ')}`)
          }
        }

        return lines.join('\n')
      })

    return {
      getTimeline,
      recordEvent,
      getEvents,
      getStatistics,
      generateSummary,
    } as const
  }),
}) {}
