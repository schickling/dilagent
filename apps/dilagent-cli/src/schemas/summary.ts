import { Schema } from 'effect'
import { DilagentState } from './state.ts'
import { Timeline } from './timeline.ts'

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

// Export types
export type SummaryInput = typeof SummaryInput.Type
