import { Schema } from 'effect'

const experimentId = Schema.String.annotations({ description: 'Format: E001, E002, ...' })

export const ExperimentInput = Schema.TaggedStruct('ExperimentInput', {
  experimentId,
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

export const ExperimentResult = Schema.Union(
  Schema.TaggedStruct('Proven', {
    experimentId,
  }),
  Schema.TaggedStruct('Disproven', {
    experimentId,
    reason: Schema.String.annotations({
      description: 'A detailed description of the reason the experiment was disproven',
    }),
    evidence: Schema.String.annotations({
      description: 'Clear evidence backing up why the experiment has disproven the root cause hypothesis',
    }),
    newExperimentIdeas: Schema.Array(ExperimentInput.omit('experimentId')).annotations({
      description: 'Based on learnings from the current experiment, a list of new experiment ideas to try.',
    }),
  }),
  Schema.TaggedStruct('Inconclusive', {
    experimentId,
    currentStatus: Schema.String,
  }),
).annotations({
  description: 'The final result of an experiment',
})

export const ExperimentStatusUpdate = Schema.TaggedStruct('ExperimentStatusUpdate', {
  experimentId,
  status: ExperimentResult,
})
