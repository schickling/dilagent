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
  problemTitle: Schema.String,
  problemDescription: Schema.String,
  experimentApproach: Schema.String,
  reproductionSteps: Schema.Array(Schema.String),
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
