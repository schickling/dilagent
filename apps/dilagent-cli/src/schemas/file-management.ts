import { Schema } from 'effect'

// Common types (reused across file management schemas)
export const timestamp = Schema.String.annotations({
  description: 'ISO 8601 timestamp',
  examples: ['2025-09-07T12:34:56Z'],
})

export const runSlug = Schema.String.annotations({
  title: 'RunSlug',
  description: 'Run identifier slug in format YYYY-MM-DD-context',
  examples: ['2025-09-07-auth-bug', '2025-09-07-memory-issue', '2025-09-07'],
})

const DigitStr = Schema.Literal('0', '1', '2', '3', '4', '5', '6', '7', '8', '9')

export const hypothesisId = Schema.TemplateLiteral('H', DigitStr, DigitStr, DigitStr).annotations({
  title: 'HypothesisId',
  description: 'Hypothesis identifier in format H{NNN}',
  examples: ['H001', 'H002', 'H010'],
})

export const hypothesisSlug = Schema.String.annotations({
  title: 'HypothesisSlug',
  description: 'Auto-generated kebab-case slug from hypothesis description',
  examples: ['race-condition-state-updates', 'memory-leak-event-handler'],
})

// Reusable status enums
export const HypothesisStatus = Schema.Literal('pending', 'running', 'completed', 'failed', 'cancelled').annotations({
  title: 'HypothesisStatus',
  description: 'Status of a hypothesis in the testing process',
})

// Reuse existing HypothesisResult but extract the result values for simple status tracking
export const HypothesisResultStatus = Schema.Literal('proven', 'disproven', 'inconclusive').annotations({
  title: 'HypothesisResultStatus',
  description: 'Simple result status extracted from full HypothesisResult',
})

export const RunPhase = Schema.Literal(
  'reproduction',
  'hypothesis-generation',
  'hypothesis-testing',
  'completed',
  'failed',
).annotations({
  title: 'RunPhase',
  description: 'Current phase of the Dilagent run',
})

export const ReproductionStatus = Schema.Literal('pending', 'in-progress', 'success', 'failed').annotations({
  title: 'ReproductionStatus',
  description: 'Status of reproduction attempt',
})

// Reusable hypothesis info structure
export const HypothesisInfo = Schema.Struct({
  id: hypothesisId,
  slug: hypothesisSlug,
  branch: Schema.String.annotations({
    description: 'Git branch name for this hypothesis',
    examples: ['dilagent/2025-09-07-auth-bug/H001-race-condition-state-updates'],
  }),
  worktree: Schema.String.annotations({
    description: 'Worktree directory name',
    examples: ['H001-race-condition-state-updates'],
  }),
  status: HypothesisStatus,
  result: Schema.optional(HypothesisResultStatus),
  startedAt: Schema.optional(timestamp),
  completedAt: Schema.optional(timestamp),
  confidence: Schema.optional(
    Schema.Number.annotations({
      description: 'Confidence level between 0 and 1',
    }),
  ),
  executionTimeMs: Schema.optional(Schema.Number),
}).annotations({
  title: 'HypothesisInfo',
  description: 'Core hypothesis information used across multiple schemas',
})

/**
 * Complete state of a Dilagent run, auto-flushed from state store
 * @fileLocation .dilagent/state.json
 */
export const DilagentState = Schema.Struct({
  runId: runSlug,
  runSlug,
  contextDir: Schema.String.annotations({
    description: 'Path to original context directory',
  }),
  contextType: Schema.Literal('git', 'directory'),
  createdAt: timestamp,
  lastUpdated: timestamp,
  currentPhase: RunPhase,
  phaseStartedAt: timestamp,
  reproduction: Schema.Struct({
    status: ReproductionStatus,
    attempts: Schema.Number,
    confidence: Schema.Number.annotations({
      description: 'Reproduction confidence between 0 and 1',
    }),
  }),
  hypotheses: Schema.Array(HypothesisInfo),
  parallelExecution: Schema.Struct({
    enabled: Schema.Boolean,
    maxConcurrent: Schema.Number,
    currentlyRunning: Schema.Array(hypothesisId),
  }),
  overallProgress: Schema.Struct({
    totalHypotheses: Schema.Number,
    completed: Schema.Number,
    failed: Schema.Number,
    remaining: Schema.Number,
  }),
}).annotations({
  title: 'DilagentState',
  description: 'Complete state of a Dilagent run, auto-flushed from state store',
})

export type DilagentState = typeof DilagentState.Type

/**
 * Configuration for a Dilagent run
 * @fileLocation .dilagent/config.json
 */
export const DilagentConfig = Schema.Struct({
  runSlug,
  llm: Schema.Literal('claude', 'codex'),
  maxHypotheses: Schema.Number,
  parallelExecution: Schema.Struct({
    enabled: Schema.Boolean,
    maxConcurrent: Schema.Number,
  }),
  managerPort: Schema.Number,
  createdAt: timestamp,
  problemStatement: Schema.String,
  contextPath: Schema.String.annotations({
    description: 'Original context directory path',
  }),
  workingDir: Schema.String.annotations({
    description: 'Working directory path where .dilagent is created',
  }),
  visibility: Schema.Struct({
    logLevel: Schema.Literal('error', 'warn', 'info', 'debug'),
    enableMetrics: Schema.Boolean,
    enableTimeline: Schema.Boolean,
  }),
}).annotations({
  title: 'DilagentConfig',
  description: 'Configuration for a Dilagent run',
})

export type DilagentConfig = typeof DilagentConfig.Type

/**
 * A single event in the execution timeline
 */
export const TimelineEvent = Schema.Struct({
  timestamp,
  event: Schema.String.annotations({
    description: 'Event description',
    examples: ['Hypothesis H001 started', 'Reproduction completed', 'All hypotheses finished'],
  }),
  hypothesisId: Schema.optional(hypothesisId),
  phase: Schema.optional(
    Schema.String.annotations({
      description: 'Current phase when event occurred',
      examples: ['reproduction', 'hypothesis-generation', 'hypothesis-testing'],
    }),
  ),
  metadata: Schema.optional(
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

export type TimelineEvent = typeof TimelineEvent.Type

/**
 * Complete execution timeline for a Dilagent run
 * @fileLocation .dilagent/timeline.json
 */
export const Timeline = Schema.Struct({
  runId: runSlug,
  createdAt: timestamp,
  events: Schema.Array(TimelineEvent),
}).annotations({
  title: 'Timeline',
  description: 'Complete execution timeline for a Dilagent run',
})

export type Timeline = typeof Timeline.Type

// Artifact schemas (files in .dilagent/artifacts/)

/**
 * Successful reproduction data
 * @fileLocation .dilagent/artifacts/reproduction.json
 */
export const ReproductionArtifact = Schema.parseJson(Schema.Any, { space: 2 }).annotations({
  title: 'ReproductionArtifact',
  description: 'Successful reproduction data stored as JSON artifact',
})

/**
 * Generated hypotheses list
 * @fileLocation .dilagent/artifacts/hypotheses.json
 */
export const HypothesesArtifact = Schema.parseJson(Schema.Array(Schema.Any), { space: 2 }).annotations({
  title: 'HypothesesArtifact',
  description: 'List of generated hypotheses stored as JSON artifact',
})

/**
 * Generated reproduction script
 * @fileLocation .dilagent/artifacts/repro.ts
 */
export const ReproScript = Schema.String.annotations({
  title: 'ReproScript',
  description: 'Generated TypeScript reproduction script content',
})

/**
 * Overall run summary report
 * @fileLocation .dilagent/artifacts/summary.md
 */
export const SummaryReport = Schema.String.annotations({
  title: 'SummaryReport',
  description: 'Markdown summary of the complete Dilagent run results',
})

/**
 * Input data for generating summary.md report
 */
export const SummaryInput = Schema.Struct({
  runState: DilagentState,
  runConfig: DilagentConfig,
  timeline: Timeline,
  reproductionResult: Schema.optional(
    Schema.Any.annotations({
      description: 'Reproduction result data if reproduction succeeded',
    }),
  ),
  executionMetrics: Schema.Struct({
    totalDurationMs: Schema.Number,
    reproductionDurationMs: Schema.optional(Schema.Number),
    hypothesisGenerationDurationMs: Schema.optional(Schema.Number),
    hypothesesTestingDurationMs: Schema.optional(Schema.Number),
  }),
  artifactsPaths: Schema.Struct({
    reproScript: Schema.optional(
      Schema.String.annotations({
        description: 'Path to repro.ts if generated',
      }),
    ),
    hypothesesJson: Schema.optional(
      Schema.String.annotations({
        description: 'Path to hypotheses.json if generated',
      }),
    ),
    reproductionJson: Schema.optional(
      Schema.String.annotations({
        description: 'Path to reproduction.json if generated',
      }),
    ),
  }),
}).annotations({
  title: 'SummaryInput',
  description: 'Complete input data needed to generate comprehensive summary.md report',
})

export type SummaryInput = typeof SummaryInput.Type
