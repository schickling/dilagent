import { AiTool, AiToolkit, McpServer } from '@effect/ai'
import { Effect, Layer, Record, Schema } from 'effect'
import { HypothesisId } from '../schemas/file-management.ts'
import { HypothesisPhase, HypothesisResult, HypothesisStatusUpdate } from '../schemas/hypothesis.ts'
import { StateStore } from './state-store.js'

const UpdateStatusToolParameters = Schema.Struct({
  hypothesisId: HypothesisId,
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
})

const UpdateStatusTool = AiTool.make('dilagent_hypothesis_update_status', {
  description: `\
Update the current status of your hypothesis testing progress. Use this throughout the hypothesis loop to report progress.

Example parameters:
${JSON.stringify(UpdateStatusToolParameters.make({ hypothesisId: 'H001', phase: 'DESIGNING', status: 'Designing experiments', experimentId: 'E01' }))}

Call this when:
- Starting a new phase (DESIGNING, TESTING, DIAGNOSING, COUNTER_TESTING)
- Making progress within a phase
- Collecting evidence or completing experiments`,
  parameters: UpdateStatusToolParameters.fields,
  success: Schema.String,
})

const SetResultToolParameters = Schema.Struct({
  hypothesisId: HypothesisId,
  result: HypothesisResult,
})

const SetResultTool = AiTool.make('dilagent_hypothesis_set_result', {
  description: `\
Set the final result of your hypothesis testing. Only use this when you have reached a definitive conclusion.

Example parameters:
${JSON.stringify(SetResultToolParameters.make({ hypothesisId: 'H001', result: { _tag: 'Proven', hypothesisId: 'H001', findings: 'Found the root cause', rootCauses: [{ type: 'tooling', description: 'The tooling used was the root cause' }], nextSteps: ['Fix the tooling'], evidence: { reproduction: { minimalReproduction: 'Simple reproduction steps', environment: 'Node.js 20', consistency: 'Always reproducible' }, measurementData: { performanceMetrics: 'CPU usage reduced by 50%', resourceUsage: 'Memory usage stable', timingData: 'Response time improved from 2s to 500ms' } } } }))}

Call this only at terminal states:
- Root cause found and confirmed (Proven)
- Hypothesis definitively ruled out (Disproven) 
- Truly intractable situation (Inconclusive - use as absolutely last resort)`,
  parameters: SetResultToolParameters.fields,
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

const StateClearTool = AiTool.make('dilagent_state_clear', {
  description: 'Clear all entries from the state store',
  parameters: {},
  success: Schema.String,
})

export const toolkit = AiToolkit.make(UpdateStatusTool, SetResultTool, GetStatusAllTool, StateClearTool)

const makeHandlers = Effect.gen(function* () {
  const store = yield* StateStore

  return toolkit.of({
    dilagent_hypothesis_update_status: ({ hypothesisId, phase, status }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_update_status called for ${hypothesisId} in ${phase} phase`)

        // Update hypothesis status in DilagentState
        yield* store.updateHypothesis({
          id: hypothesisId,
          update: {
            status: 'running',
          },
        })

        const message = `Updated status for ${hypothesisId}: ${phase} - ${status}`
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_update_status: ${message}`)
        return message
      }).pipe(Effect.orDie),

    dilagent_hypothesis_set_result: ({ hypothesisId, result }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_set_result called for ${hypothesisId}: ${result._tag}`)

        // Use the new HypothesisResult directly
        const stateResult = result

        yield* store.updateHypothesis({
          id: hypothesisId,
          update: {
            status: 'completed',
            result: stateResult,
            completedAt: new Date().toISOString(),
          },
        })

        const message = `Set final result for ${hypothesisId}: ${result._tag}`
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_set_result: ${message}`)
        return message
      }).pipe(Effect.orDie),

    dilagent_hypothesis_get_status_all: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_get_status_all called`)

        const state = yield* store.getState()
        const hypotheses = Object.values(state.hypotheses).map((h) => {
          // Create a compatible status update format
          const currentStatus: HypothesisStatusUpdate = {
            _tag: 'HypothesisStatusUpdate',
            hypothesisId: h.id,
            phase: h.status === 'running' ? 'TESTING' : 'DESIGNING',
            status: `Status: ${h.status}${h.result ? ` (${h.result._tag === 'Proven' ? h.result.findings : h.result._tag === 'Disproven' ? h.result.reason : h.result.intractableReason})` : ''}`,
            evidence: `Worktree: ${h.worktreePath}`,
          }

          return {
            hypothesisId: h.id,
            currentStatus,
          }
        })

        yield* Effect.logDebug(`[MCP] dilagent_hypothesis_get_status_all returning ${hypotheses.length} hypotheses`)
        return { hypotheses }
      }).pipe(Effect.orDie),

    dilagent_state_clear: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`[MCP] dilagent_state_clear called`)

        // Reset all hypotheses to pending state
        yield* store.updateState((state) => ({
          ...state,
          hypotheses: Record.map(state.hypotheses, (h) => ({
            ...h,
            status: 'pending' as const,
            result: undefined,
            startedAt: undefined,
            completedAt: undefined,
          })),
        }))

        const message = 'State store cleared - all hypotheses reset to pending'
        yield* Effect.logDebug(`[MCP] dilagent_state_clear: ${message}`)
        return message
      }).pipe(Effect.orDie),
  })
})

export const McpToolkit = McpServer.toolkit(toolkit)

export const McpToolsLayer = McpServer.toolkit(toolkit).pipe(
  Layer.provide(Layer.unwrapEffect(makeHandlers.pipe(Effect.map((handlers) => toolkit.toLayer(handlers))))),
)
