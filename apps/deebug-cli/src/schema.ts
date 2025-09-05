import { Schema } from 'effect'

export const ExperimentResult = Schema.Union(
  Schema.TaggedStruct('Success', {
    experimentId: Schema.String,
  }),
  Schema.TaggedStruct('Error', {
    experimentId: Schema.String,
    error: Schema.String,
  }),
  Schema.TaggedStruct('Inconclusive', {
    experimentId: Schema.String,
    inconclusive: Schema.String,
  }),
)

export const ExperimentStatusUpdate = Schema.TaggedStruct('ExperimentStatusUpdate', {
  experimentId: Schema.String,
  status: ExperimentResult,
})

export const ExperimentInput = Schema.TaggedStruct('ExperimentInput', {
  experimentId: Schema.String.annotations({ description: 'Format: E001, E002, ...' }),
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
})

export type ExperimentInput = typeof ExperimentInput.Type

export const GenerateExperimentsInputResult = Schema.Union(
  Schema.TaggedStruct('Success', {
    experiments: Schema.Array(ExperimentInput),
  }),
  Schema.TaggedStruct('Error', {
    error: Schema.String,
  }),
)
