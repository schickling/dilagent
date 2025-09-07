import { AiTool, AiToolkit, McpServer } from '@effect/ai'
import { Effect, Layer, Schema } from 'effect'
import { HypothesisPhase, HypothesisResult, HypothesisStatusUpdate } from '../schemas/hypothesis.ts'
import { StateStore } from './state-store.js'

const UpdateStatusTool = AiTool.make('dilagent_hypothesis_update_status', {
  description: `\
Update the current status of your hypothesis testing progress. Use this throughout the hypothesis loop to report progress.

Call this when:
- Starting a new phase (DESIGNING, TESTING, DIAGNOSING, COUNTER_TESTING)
- Making progress within a phase
- Collecting evidence or completing experiments`,
  parameters: {
    hypothesisId: Schema.String.annotations({
      description: 'The hypothesis ID you are working on',
    }),
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
  },
  success: Schema.String,
})

const SetResultTool = AiTool.make('dilagent_hypothesis_set_result', {
  description: `\
Set the final result of your hypothesis testing. Only use this when you have reached a definitive conclusion.

Call this only at terminal states:
- Root cause found and confirmed (Proven)
- Hypothesis definitively ruled out (Disproven) 
- Truly intractable situation (Inconclusive - use as absolutely last resort)`,
  parameters: {
    hypothesisId: Schema.String.annotations({
      description: 'The hypothesis ID you completed testing',
    }),
    result: HypothesisResult,
  },
  success: Schema.String,
})

const GetStatusAllTool = AiTool.make('dilagent_hypothesis_get_status_all', {
  description: `\
Query the status of all hypotheses being worked on. 

IMPORTANT: Only use this during the DESIGNING phase to:
- Avoid duplicate experiments
- Learn from other workers' findings
- Coordinate testing approaches

Do NOT call this during other phases.`,
  parameters: {},
  success: Schema.Struct({
    hypotheses: Schema.Array(
      Schema.Struct({
        hypothesisId: Schema.String,
        currentStatus: Schema.Union(HypothesisStatusUpdate, HypothesisResult),
      }),
    ),
  }),
})

export const toolkit = AiToolkit.make(UpdateStatusTool, SetResultTool, GetStatusAllTool)

const makeHandlers = Effect.gen(function* () {
  const store = yield* StateStore

  return toolkit.of({
    dilagent_hypothesis_update_status: ({ hypothesisId, phase, experimentId, status, evidence }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_update_status called for ${hypothesisId} in ${phase} phase`)

        const statusUpdate: HypothesisStatusUpdate = {
          _tag: 'HypothesisStatusUpdate',
          hypothesisId,
          phase,
          experimentId,
          status,
          evidence,
        }

        const key = `${hypothesisId}:status`
        yield* store.set(key, statusUpdate)

        const message = `Updated status for ${hypothesisId}: ${phase} - ${status}`
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_update_status: ${message}`)
        return message
      }),

    dilagent_hypothesis_set_result: ({ hypothesisId, result }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_set_result called for ${hypothesisId}: ${result._tag}`)

        const key = `${hypothesisId}:result`
        yield* store.set(key, result)

        const message = `Set final result for ${hypothesisId}: ${result._tag}`
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_set_result: ${message}`)
        return message
      }),

    dilagent_hypothesis_get_status_all: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_get_status_all called`)

        const entries = yield* store.list()
        const hypotheses = entries.map((entry) => ({
          hypothesisId: entry.key.split(':')[0] ?? 'unknown',
          currentStatus: entry.value,
        }))

        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_get_status_all returning ${hypotheses.length} hypotheses`)
        return { hypotheses }
      }),
  })
})

export const McpToolkit = McpServer.toolkit(toolkit)

export const McpToolsLayer = McpServer.toolkit(toolkit).pipe(
  Layer.provide(Layer.unwrapEffect(makeHandlers.pipe(Effect.map((handlers) => toolkit.toLayer(handlers))))),
)
