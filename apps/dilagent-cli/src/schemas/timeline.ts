import { Schema } from 'effect'
import { HypothesisId, timestamp, WorkingDirId } from './common.ts'

// Event type literals grouped by category
export const PhaseEventType = Schema.Literal('phase.started', 'phase.completed', 'phase.failed').annotations({
  title: 'PhaseEventType',
  description: 'Phase-related timeline events',
})
export type PhaseEventType = typeof PhaseEventType.Type

export const HypothesisEventType = Schema.Literal(
  'hypothesis.generated',
  'hypothesis.started',
  'hypothesis.completed',
  'hypothesis.failed',
  'hypothesis.skipped',
).annotations({
  title: 'HypothesisEventType',
  description: 'Hypothesis-related timeline events',
})
export type HypothesisEventType = typeof HypothesisEventType.Type

export const SystemEventType = Schema.Literal('system.initialized', 'system.error', 'system.warning').annotations({
  title: 'SystemEventType',
  description: 'System-related timeline events',
})
export type SystemEventType = typeof SystemEventType.Type

export const UserEventType = Schema.Literal('user.feedback', 'user.decision').annotations({
  title: 'UserEventType',
  description: 'User interaction timeline events',
})
export type UserEventType = typeof UserEventType.Type

export const GitEventType = Schema.Literal(
  'git.worktree.created',
  'git.commit.created',
  'git.branch.created',
).annotations({
  title: 'GitEventType',
  description: 'Git-related timeline events',
})
export type GitEventType = typeof GitEventType.Type

// Legacy combined type for backward compatibility during migration
export const EventType = Schema.Union(
  PhaseEventType,
  HypothesisEventType,
  SystemEventType,
  UserEventType,
  GitEventType,
).annotations({
  title: 'EventType',
  description: 'Type of timeline event',
})
export type EventType = typeof EventType.Type

// Workflow phase literals (duplicated here to avoid circular imports)
const WorkflowPhase = Schema.Literal(
  'setup',
  'hypothesis-generation',
  'hypothesis-testing',
  'execution',
  'analysis',
  'reporting',
  'completed',
).annotations({
  title: 'WorkflowPhase',
  description: 'Current phase of the Dilagent run workflow',
})

/**
 * Tagged union variants for different types of timeline events
 */
export const PhaseEvent = Schema.TaggedStruct('PhaseEvent', {
  timestamp,
  event: PhaseEventType,
  phase: WorkflowPhase,
  message: Schema.UndefinedOr(Schema.String),
  details: Schema.UndefinedOr(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }).annotations({
      description: 'Additional phase event metadata',
    }),
  ),
}).annotations({
  title: 'PhaseEvent',
  description: 'Phase-related timeline event',
})
export type PhaseEvent = typeof PhaseEvent.Type

export const HypothesisEvent = Schema.TaggedStruct('HypothesisEvent', {
  timestamp,
  event: HypothesisEventType,
  phase: WorkflowPhase,
  hypothesisId: Schema.UndefinedOr(HypothesisId), // Optional for general hypothesis events like 'hypothesis.generated'
  message: Schema.UndefinedOr(Schema.String),
  details: Schema.UndefinedOr(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }).annotations({
      description: 'Additional hypothesis event metadata',
    }),
  ),
}).annotations({
  title: 'HypothesisEvent',
  description: 'Hypothesis-related timeline event',
})
export type HypothesisEvent = typeof HypothesisEvent.Type

export const SystemEvent = Schema.TaggedStruct('SystemEvent', {
  timestamp,
  event: SystemEventType,
  phase: Schema.UndefinedOr(WorkflowPhase),
  message: Schema.UndefinedOr(Schema.String),
  details: Schema.UndefinedOr(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }).annotations({
      description: 'Additional system event metadata',
    }),
  ),
}).annotations({
  title: 'SystemEvent',
  description: 'System-related timeline event',
})
export type SystemEvent = typeof SystemEvent.Type

export const UserEvent = Schema.TaggedStruct('UserEvent', {
  timestamp,
  event: UserEventType,
  phase: Schema.UndefinedOr(WorkflowPhase),
  message: Schema.UndefinedOr(Schema.String),
  details: Schema.UndefinedOr(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }).annotations({
      description: 'Additional user event metadata',
    }),
  ),
}).annotations({
  title: 'UserEvent',
  description: 'User interaction timeline event',
})
export type UserEvent = typeof UserEvent.Type

export const GitEvent = Schema.TaggedStruct('GitEvent', {
  timestamp,
  event: GitEventType,
  phase: Schema.UndefinedOr(WorkflowPhase),
  message: Schema.UndefinedOr(Schema.String),
  details: Schema.UndefinedOr(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }).annotations({
      description: 'Additional git event metadata',
    }),
  ),
}).annotations({
  title: 'GitEvent',
  description: 'Git-related timeline event',
})
export type GitEvent = typeof GitEvent.Type

/**
 * Tagged union for timeline events with type-safe variants
 */
export const TimelineEvent = Schema.Union(PhaseEvent, HypothesisEvent, SystemEvent, UserEvent, GitEvent).annotations({
  title: 'TimelineEvent',
  description: 'A single event in the execution timeline with type-safe variants',
})
export type TimelineEvent = typeof TimelineEvent.Type

/**
 * Legacy timeline event structure for backward compatibility during migration
 */
export const LegacyTimelineEvent = Schema.Struct({
  timestamp,
  event: EventType,
  phase: Schema.optional(WorkflowPhase),
  hypothesisId: Schema.optional(HypothesisId),
  message: Schema.optional(Schema.String),
  details: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }).annotations({
      description: 'Additional event-specific metadata',
    }),
  ),
}).annotations({
  title: 'LegacyTimelineEvent',
  description: 'Legacy timeline event structure',
})
export type LegacyTimelineEvent = typeof LegacyTimelineEvent.Type

/**
 * Complete execution timeline
 * @fileLocation .dilagent/timeline.json
 */
export const Timeline = Schema.Struct({
  createdAt: timestamp,
  events: Schema.Array(TimelineEvent),
}).annotations({
  title: 'Timeline',
  description: 'Complete execution timeline',
})
export type Timeline = typeof Timeline.Type

// Helper functions for timeline service (which handles timestamp automatically)
export const createPhaseEvent = (params: {
  event: typeof PhaseEventType.Type
  phase: typeof WorkflowPhase.Type
  message?: string
  details?: Record<string, unknown>
}): Omit<PhaseEvent, 'timestamp'> => ({
  _tag: 'PhaseEvent',
  event: params.event,
  phase: params.phase,
  message: params.message,
  details: params.details,
} as Omit<PhaseEvent, 'timestamp'>)

export const createHypothesisEvent = (params: {
  event: typeof HypothesisEventType.Type
  phase: typeof WorkflowPhase.Type
  hypothesisId?: typeof HypothesisId.Type
  message?: string
  details?: Record<string, unknown>
}): Omit<HypothesisEvent, 'timestamp'> => ({
  _tag: 'HypothesisEvent',
  event: params.event,
  phase: params.phase,
  hypothesisId: params.hypothesisId,
  message: params.message,
  details: params.details,
} as Omit<HypothesisEvent, 'timestamp'>)

export const createSystemEvent = (params: {
  event: typeof SystemEventType.Type
  phase?: typeof WorkflowPhase.Type
  message?: string
  details?: Record<string, unknown>
}): Omit<SystemEvent, 'timestamp'> => ({
  _tag: 'SystemEvent',
  event: params.event,
  phase: params.phase,
  message: params.message,
  details: params.details,
} as Omit<SystemEvent, 'timestamp'>)

export const createUserEvent = (params: {
  event: typeof UserEventType.Type
  phase?: typeof WorkflowPhase.Type
  message?: string
  details?: Record<string, unknown>
}): Omit<UserEvent, 'timestamp'> => ({
  _tag: 'UserEvent',
  event: params.event,
  phase: params.phase,
  message: params.message,
  details: params.details,
} as Omit<UserEvent, 'timestamp'>)

export const createGitEvent = (params: {
  event: typeof GitEventType.Type
  phase?: typeof WorkflowPhase.Type
  message?: string
  details?: Record<string, unknown>
}): Omit<GitEvent, 'timestamp'> => ({
  _tag: 'GitEvent',
  event: params.event,
  phase: params.phase,
  message: params.message,
  details: params.details,
} as Omit<GitEvent, 'timestamp'>)