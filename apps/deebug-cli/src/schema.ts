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
