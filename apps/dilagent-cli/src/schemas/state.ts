import { Schema } from 'effect'
import packageJson from '../../package.json' with { type: 'json' }
import { HypothesisId, hypothesisSlug, timestamp, WorkingDirId } from './common.ts'
import { HypothesisResult, HypothesisStatusUpdate } from './hypothesis.ts'

// Workflow phase literals (renamed from Phase for clarity)
export const WorkflowPhase = Schema.Literal(
  'setup',
  'reproduction',
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
export type WorkflowPhase = typeof WorkflowPhase.Type

// Hypothesis status literals
export const HypothesisStatus = Schema.Literal('pending', 'running', 'completed', 'failed', 'skipped').annotations({
  title: 'HypothesisStatus',
  description: 'Status of a hypothesis in the testing process',
})
export type HypothesisStatus = typeof HypothesisStatus.Type

/**
 * Individual hypothesis state with progress tracking
 */
export const HypothesisState = Schema.Struct({
  dilagentVersion: Schema.Literal(packageJson.version).annotations({
    description: "Version of Dilagent that created this hypothesis. There's currently no cross-version compatibility.",
  }),
  id: HypothesisId,
  slug: hypothesisSlug,
  description: Schema.String.annotations({
    description: 'Human-readable description of the hypothesis',
  }),
  status: HypothesisStatus,
  result: Schema.optional(HypothesisResult),

  // Progress tracking
  currentStatusUpdate: Schema.optional(HypothesisStatusUpdate).annotations({
    description: 'Latest status update from hypothesis worker including phase, experiments, and evidence',
  }),

  // Git/filesystem info
  worktreePath: Schema.String.annotations({
    description: 'Path to the hypothesis worktree directory',
    examples: ['/path/to/worktree-H001-auth-bug'],
  }),
  metadataPath: Schema.String.annotations({
    description:
      'Path to hypothesis metadata directory in the working directory containing instructions.md, context.md, etc.',
    examples: ['/path/to/.dilagent/H001-auth-bug'],
  }),
  branchName: Schema.String.annotations({
    description: 'Git branch name for this hypothesis',
    examples: ['dilagent/<WORKING_DIR_ID>/H001-auth-bug'],
  }),

  // Timing
  startedAt: Schema.optional(timestamp),
  completedAt: Schema.optional(timestamp),
}).annotations({
  title: 'HypothesisState',
  description: 'Complete state of a single hypothesis',
})
export type HypothesisState = typeof HypothesisState.Type

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
export type Progress = typeof Progress.Type

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
export type Metrics = typeof Metrics.Type

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
export type DilagentState = typeof DilagentState.Type
