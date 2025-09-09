import { Schema } from 'effect'
import { HypothesisId, hypothesisSlug, timestamp, WorkingDirId } from './common.ts'
import { HypothesisResult } from './hypothesis.ts'

// Workflow phase literals (renamed from Phase for clarity)
export const WorkflowPhase = Schema.Literal(
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

// Hypothesis status literals
export const HypothesisStatus = Schema.Literal('pending', 'running', 'completed', 'failed', 'skipped').annotations({
  title: 'HypothesisStatus',
  description: 'Status of a hypothesis in the testing process',
})

// Event type literals
export const EventType = Schema.Literal(
  // Phase events
  'phase.started',
  'phase.completed',
  'phase.failed',

  // Hypothesis events
  'hypothesis.generated',
  'hypothesis.started',
  'hypothesis.completed',
  'hypothesis.failed',
  'hypothesis.skipped',

  // System events
  'system.initialized',
  'system.error',
  'system.warning',

  // User events
  'user.feedback',
  'user.decision',

  // Git events
  'git.worktree.created',
  'git.commit.created',
  'git.branch.created',
).annotations({
  title: 'EventType',
  description: 'Type of timeline event',
})

// Re-export HypothesisResult from hypothesis.ts (imported above)

// Individual hypothesis state
export const HypothesisState = Schema.Struct({
  id: HypothesisId,
  slug: hypothesisSlug,
  description: Schema.String.annotations({
    description: 'Human-readable description of the hypothesis',
  }),
  status: HypothesisStatus,
  result: Schema.optional(HypothesisResult),

  // Git/filesystem info
  worktreePath: Schema.String.annotations({
    description: 'Path to the hypothesis worktree directory',
    examples: ['/path/to/H001-auth-bug'],
  }),
  branchName: Schema.String.annotations({
    description: 'Git branch name for this hypothesis',
    examples: ['dilagent/H001-auth-bug'],
  }),

  // Timing
  startedAt: Schema.optional(timestamp),
  completedAt: Schema.optional(timestamp),
}).annotations({
  title: 'HypothesisState',
  description: 'Complete state of a single hypothesis',
})

// Progress tracking
export const Progress = Schema.Struct({
  current: Schema.Number,
  total: Schema.Number,
  phase: WorkflowPhase,
  message: Schema.String.annotations({
    description: 'Current status message',
  }),
}).annotations({
  title: 'Progress',
  description: 'Current progress tracking',
})

// Metrics
export const Metrics = Schema.Struct({
  startTime: timestamp,
  endTime: Schema.optional(timestamp),
  hypothesesGenerated: Schema.Number,
  hypothesesCompleted: Schema.Number,
  hypothesesSuccessful: Schema.Number,
  hypothesesFailed: Schema.Number,
  hypothesesSkipped: Schema.Number,
}).annotations({
  title: 'Metrics',
  description: 'Run metrics and statistics',
})

/**
 * Complete state of a Dilagent run
 * @fileLocation .dilagent/state.json
 */
export const DilagentState = Schema.Struct({
  // Working directory identifier
  workingDirId: WorkingDirId,

  // Problem description
  problemPrompt: Schema.String.annotations({
    description: 'User-provided description of the problem being debugged',
  }),

  // Directories
  contextDirectory: Schema.String.annotations({
    description: 'Original context directory path',
  }),
  contextRelativePath: Schema.optional(Schema.String).annotations({
    description: 'Relative path from git root to context directory (e.g., "apps/backend", "." for git root)',
    examples: ['apps/backend', 'packages/core', '.'],
  }),
  workingDirectory: Schema.String.annotations({
    description: 'Working directory containing .dilagent folder',
  }),

  // Hypotheses
  hypotheses: Schema.Record({
    key: HypothesisId,
    value: HypothesisState,
  }).annotations({
    description: 'Map of hypothesis ID to hypothesis state',
  }),

  // Workflow state
  currentPhase: WorkflowPhase,
  completedPhases: Schema.Array(WorkflowPhase),

  // Progress and metrics
  progress: Progress,
  metrics: Metrics,
}).annotations({
  title: 'DilagentState',
  description: 'Complete state of a Dilagent run, auto-persisted',
})

/**
 * A single event in the execution timeline
 */
export const TimelineEvent = Schema.Struct({
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
  title: 'TimelineEvent',
  description: 'A single event in the execution timeline',
})

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

// Summary input for LLM-based summary generation
export const SummaryInput = Schema.Struct({
  state: DilagentState,
  timeline: Timeline,
  executionMetrics: Schema.Struct({
    totalDurationMs: Schema.Number,
    wallClockTimeMs: Schema.Number,
  }),
}).annotations({
  title: 'SummaryInput',
  description: 'Input data for generating summary reports',
})

// Re-export common schemas
export { HypothesisId, hypothesisSlug, timestamp } from './common.ts'

// Export types
export type DilagentState = typeof DilagentState.Type
export type HypothesisState = typeof HypothesisState.Type
export type HypothesisStatus = typeof HypothesisStatus.Type
export type WorkflowPhase = typeof WorkflowPhase.Type
export type SummaryInput = typeof SummaryInput.Type
export type Progress = typeof Progress.Type
export type Metrics = typeof Metrics.Type
export type Timeline = typeof Timeline.Type
export type TimelineEvent = typeof TimelineEvent.Type
export type EventType = typeof EventType.Type

// Common types are automatically available through the schema imports above
// No need to redeclare them since imports from common.ts already provide both value and type
