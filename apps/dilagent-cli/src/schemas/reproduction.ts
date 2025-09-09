import { Schema } from 'effect'

export const ReproductionDiagnostics = Schema.Struct({
  logs: Schema.Array(Schema.String).annotations({
    description: 'Detailed logs captured during reproduction attempts',
  }),
  errors: Schema.Array(Schema.String).annotations({
    description: 'Error messages and stack traces captured',
  }),
  environment: Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
    description: 'Relevant environment variables, versions, and system info',
  }),
}).annotations({ title: 'ReproductionDiagnostics' })

export const ReproductionResult = Schema.Union(
  Schema.TaggedStruct('Success', {
    reproScript: Schema.String.annotations({
      description: 'Generated repro.ts file content with clear logging',
    }),
    observedBehavior: Schema.String.annotations({
      description: 'Detailed description of the actual behavior observed',
    }),
    expectedBehavior: Schema.String.annotations({
      description: 'Clear description of what the expected behavior should be',
    }),
    diagnostics: ReproductionDiagnostics,
    isFlaky: Schema.Boolean.annotations({
      description: 'Whether the bug shows flaky/non-deterministic behavior',
    }),
    confidence: Schema.Number.annotations({
      description: 'Confidence level in reproduction success (0.0-1.0)',
    }),
    reproductionSteps: Schema.Array(Schema.String).annotations({
      description: 'Step-by-step instructions to reproduce the issue',
    }),
    executionTimeMs: Schema.optional(Schema.Number).annotations({
      description: 'Time to execute reproduction locally (when measurable)',
    }),
    reproductionType: Schema.Literal('immediate', 'delayed', 'environmental').annotations({
      description: 'Basic characteristic of how the bug manifests',
    }),
    minimizationNotes: Schema.optional(Schema.String).annotations({
      description: 'Notes on what was removed and what else could be minimized',
    }),
    setupRequirements: Schema.optional(Schema.Array(Schema.String)).annotations({
      description: 'Any special setup needed to run the reproduction',
    }),
  }).annotations({ title: 'ReproductionSuccess' }),

  Schema.TaggedStruct('NeedMoreInfo', {
    questions: Schema.Array(Schema.String).annotations({
      description: 'Questions that need user answers to proceed with reproduction',
    }),
    context: Schema.String.annotations({
      description: 'Context explaining why more information is needed',
    }),
    attemptedApproaches: Schema.Array(Schema.String).annotations({
      description: 'Approaches already tried that need more clarification',
    }),
    blockers: Schema.optional(Schema.Array(Schema.String)).annotations({
      description: 'Specific blockers preventing reproduction',
    }),
    suggestions: Schema.optional(Schema.Array(Schema.String)).annotations({
      description: 'Suggestions for the user to help unblock reproduction',
    }),
  }).annotations({ title: 'ReproductionNeedMoreInfo' }),
).annotations({
  title: 'ReproductionResult',
  description: 'Result of attempting to reproduce an issue',
})

export type ReproductionResult = typeof ReproductionResult.Type

export const ReproductionResultFile = Schema.parseJson(ReproductionResult, { space: 2 })

export const ReproductionInput = Schema.Struct({
  problemPrompt: Schema.String.annotations({
    description: 'User description of the problem to reproduce',
  }),
  isFlaky: Schema.Boolean.annotations({
    description: 'Whether user indicated this is a flaky/intermittent bug',
  }),
  contextDirectory: Schema.String.annotations({
    description: 'Path to the context directory containing code to debug',
  }),
  workingDirectory: Schema.String.annotations({
    description: 'Working directory where reproduction artifacts will be stored',
  }),
  previousAttempt: Schema.optional(ReproductionResult).annotations({
    description: 'Previous reproduction attempt result if this is a retry',
  }),
  userFeedback: Schema.optional(Schema.Array(Schema.String)).annotations({
    description: 'User answers to questions from previous NeedMoreInfo result',
  }),
}).annotations({ title: 'ReproductionInput' })

export type ReproductionInput = typeof ReproductionInput.Type
