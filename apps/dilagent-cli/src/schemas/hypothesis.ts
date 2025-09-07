import { Schema } from 'effect'
import { hypothesisId } from './file-management.ts'

export const HypothesisInput = Schema.TaggedStruct('HypothesisInput', {
  hypothesisId,
  problemTitle: Schema.String.annotations({ description: 'A short title of the problem hypothesis' }),
  problemDescription: Schema.String.annotations({ description: 'A short description of the problem hypothesis' }),
  files: Schema.Array(Schema.String).annotations({ description: 'The files that are relevant to the problem' }),
  problemDetails: Schema.String.annotations({
    description: 'A detailed multi-paragraph description of the problem hypothesis with all relevant information',
  }),
  reproductionSteps: Schema.Array(
    Schema.String.annotations({
      description:
        'A detailed description of the reproduction steps to test the hypothesis. Be very specific (e.g. file paths, command line arguments, function calls, etc.).',
    }),
  ),
  observedBehavior: Schema.String.annotations({
    description: 'A detailed description of the observed behavior of the problem including errors, logs, etc.',
  }),
}).annotations({ title: 'HypothesisInput' })

export type HypothesisInput = typeof HypothesisInput.Type

export const GenerateHypothesesInputResult = Schema.Union(
  Schema.TaggedStruct('Success', {
    hypotheses: Schema.Array(HypothesisInput),
  }),
  Schema.TaggedStruct('Error', {
    error: Schema.String,
  }),
).annotations({ title: 'GenerateHypothesesInputResult' })

export const HypothesisPhase = Schema.Literal('DESIGNING', 'TESTING', 'DIAGNOSING', 'COUNTER_TESTING').annotations({
  title: 'HypothesisPhase',
  description: 'Current phase in the hypothesis testing loop',
})

export type HypothesisPhase = typeof HypothesisPhase.Type

export const HypothesisResult = Schema.Union(
  Schema.TaggedStruct('Proven', {
    hypothesisId,
    findings: Schema.String.annotations({
      description: 'Summary of root causes and findings from the diagnosis',
    }),
    rootCauses: Schema.optional(
      Schema.Array(
        Schema.Struct({
          type: Schema.Literal('tooling', 'algorithmic', 'configuration', 'environmental'),
          description: Schema.String,
        }),
      ),
    ),
    nextSteps: Schema.optional(Schema.Array(Schema.String)),
    evidence: Schema.optional(
      Schema.Struct({
        reproduction: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
        changes: Schema.optional(Schema.Array(Schema.String)),
        testResults: Schema.optional(Schema.String),
      }),
    ),
  }).annotations({ title: 'Proven' }),
  Schema.TaggedStruct('Disproven', {
    hypothesisId,
    reason: Schema.String.annotations({
      description: 'A detailed description of the reason the experiment was disproven',
    }),
    evidence: Schema.String.annotations({
      description: 'Clear evidence backing up why the experiment has disproven the root cause hypothesis',
    }),
    newhypothesisIdeas: Schema.Array(HypothesisInput.omit('hypothesisId')).annotations({
      description: 'Based on learnings from the current experiment, a list of new experiment ideas to try.',
    }),
  }).annotations({ title: 'Disproven' }),
  Schema.TaggedStruct('Inconclusive', {
    hypothesisId,
    attemptedExperiments: Schema.Array(Schema.String).annotations({
      description: 'List of experiments that were attempted',
    }),
    intractableReason: Schema.String.annotations({
      description: 'Explanation of why this hypothesis cannot be definitively proven or disproven',
    }),
  }).annotations({ title: 'Inconclusive' }),
).annotations({
  title: 'HypothesisResult',
  description: 'The final result of a hypothesis (use Inconclusive sparingly as last resort)',
})

export const HypothesisStatusUpdate = Schema.TaggedStruct('HypothesisStatusUpdate', {
  hypothesisId,
  phase: HypothesisPhase,
  experimentId: Schema.optional(
    Schema.String.annotations({
      description: 'Current experiment being worked on (e.g., E01, E02)',
    }),
  ),
  status: Schema.String.annotations({
    description: 'Detailed status message about current progress',
  }),
  evidence: Schema.optional(
    Schema.String.annotations({
      description: 'Any evidence collected so far during this phase',
    }),
  ),
}).annotations({ title: 'HypothesisStatusUpdate' })

export type HypothesisStatusUpdate = typeof HypothesisStatusUpdate.Type
