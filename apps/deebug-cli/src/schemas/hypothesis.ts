import { Schema } from 'effect'

const hypothesisId = Schema.String.annotations({
  title: 'hypothesisId',
  description: 'Format: H001, H002, ...',
})

export const HypothesisInput = Schema.TaggedStruct('HypothesisInput', {
  hypothesisId,
  problemTitle: Schema.String.annotations({ description: 'A short title of the problem' }),
  problemDescription: Schema.String.annotations({ description: 'A short description of the problem' }),
  files: Schema.Array(Schema.String).annotations({ description: 'The files that are relevant to the problem' }),
  problemDetails: Schema.String.annotations({
    description: 'A detailed multi-paragraph description of the problem with all relevant information',
  }),
  experimentApproach: Schema.String.annotations({
    description: 'A detailed description of the experiment approach to test the hypothesis.',
  }),
  reproductionSteps: Schema.Array(
    Schema.String.annotations({
      description: 'A detailed description of the reproduction steps to test the hypothesis.',
    }),
  ),
  observedBehavior: Schema.String.annotations({
    description: 'A detailed description of the observed behavior of the problem including errors, logs, etc.',
  }),
}).annotations({ title: 'HypothesisInput' })

export type HypothesisInput = typeof HypothesisInput.Type

export const GenerateExperimentsInputResult = Schema.Union(
  Schema.TaggedStruct('Success', {
    hypotheses: Schema.Array(HypothesisInput),
  }),
  Schema.TaggedStruct('Error', {
    error: Schema.String,
  }),
).annotations({ title: 'GenerateExperimentsInputResult' })

export const HypothesisResult = Schema.Union(
  Schema.TaggedStruct('Proven', {
    hypothesisId,
    nextSteps: Schema.Array(Schema.String).annotations({
      description: 'A detailed description of the next steps to test the hypothesis.',
    }),
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
    currentStatus: Schema.String,
  }).annotations({ title: 'Inconclusive' }),
  Schema.TaggedStruct('Diagnosed', {
    hypothesisId,
    findings: Schema.String.annotations({
      description: 'Summary of root causes and findings from the diagnosis',
    }),
    rootCauses: Schema.optional(
      Schema.Array(
        Schema.Struct({
          type: Schema.Union(
            Schema.Literal('tooling'),
            Schema.Literal('algorithmic'),
            Schema.Literal('configuration'),
            Schema.Literal('environmental'),
          ),
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
  }).annotations({ title: 'Diagnosed' }),
).annotations({
  title: 'HypothesisResult',
  description: 'The final result of an experiment',
})

export const HypothesisStatusUpdate = Schema.TaggedStruct('HypothesisStatusUpdate', {
  hypothesisId,
  status: HypothesisResult,
}).annotations({ title: 'HypothesisStatusUpdate' })
