import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { generateRunSlug } from '../../utils/run-slug.ts'
import { generateHypothesesCommand } from './generate-hypotheses.ts'
import { reproCommand } from './repro.ts'
import { runHypothesisWorkersCommand } from './run-hypotheses.ts'
import {
  contextDirectoryOption,
  countOption,
  cwdOption,
  flakyOption,
  llmOption,
  portOption,
  promptOption,
  replOption,
  workingDirectoryOption,
} from './shared.ts'

export const allCommand = Cli.Command.make(
  'all',
  {
    contextDirectory: contextDirectoryOption,
    workingDirectory: workingDirectoryOption,
    prompt: promptOption,
    count: countOption,
    llm: llmOption,
    port: portOption,
    repl: replOption,
    cwd: cwdOption,
    flaky: flakyOption,
  },
  (options) => {
    const resolvedCwd = Option.getOrElse(options.cwd, () => process.cwd())
    const resolvedWorkingDirectory = path.resolve(resolvedCwd, options.workingDirectory)
    const runId = generateRunSlug('all')

    return Effect.gen(function* () {
      const timelineService = yield* TimelineService

      const workflowStartTime = Date.now()

      // Record workflow start
      yield* timelineService.recordEvent({
        event: 'Complete workflow started',
        phase: 'workflow',
        metadata: {
          phases: ['reproduction', 'hypothesis-generation', 'hypothesis-testing'],
          options: {
            llm: options.llm,
            count: options.count?._tag === 'Some' ? options.count.value : undefined,
            flaky: options.flaky?._tag === 'Some' ? options.flaky.value : false,
          },
        },
      })

      // Phase 1: Reproduction
      const reproStartTime = Date.now()
      yield* timelineService.recordEvent({
        event: 'Phase 1: Reproduction started',
        phase: 'reproduction',
      })

      yield* reproCommand.handler({
        contextDirectory: options.contextDirectory,
        workingDirectory: options.workingDirectory,
        prompt: options.prompt,
        llm: options.llm,
        flaky: options.flaky,
        cwd: options.cwd,
      })

      const reproEndTime = Date.now()
      yield* timelineService.recordEvent({
        event: 'Phase 1: Reproduction completed',
        phase: 'reproduction',
        metadata: {
          executionTimeMs: reproEndTime - reproStartTime,
        },
      })

      // Phase 2: Hypothesis Generation
      const hypothesisGenStartTime = Date.now()
      yield* timelineService.recordEvent({
        event: 'Phase 2: Hypothesis generation started',
        phase: 'hypothesis-generation',
      })

      yield* generateHypothesesCommand.handler({
        contextDirectory: options.contextDirectory,
        workingDirectory: options.workingDirectory,
        prompt: options.prompt,
        count: options.count,
        llm: options.llm,
        cwd: options.cwd,
      })

      const hypothesisGenEndTime = Date.now()
      yield* timelineService.recordEvent({
        event: 'Phase 2: Hypothesis generation completed',
        phase: 'hypothesis-generation',
        metadata: {
          executionTimeMs: hypothesisGenEndTime - hypothesisGenStartTime,
        },
      })

      // Phase 3: Hypothesis Testing
      const testingStartTime = Date.now()
      yield* timelineService.recordEvent({
        event: 'Phase 3: Hypothesis testing started',
        phase: 'hypothesis-testing',
      })

      yield* runHypothesisWorkersCommand.handler({
        workingDirectory: options.workingDirectory,
        port: options.port,
        llm: options.llm,
        repl: options.repl,
        cwd: options.cwd,
      })

      const testingEndTime = Date.now()
      const workflowEndTime = Date.now()

      yield* timelineService.recordEvent({
        event: 'Phase 3: Hypothesis testing completed',
        phase: 'hypothesis-testing',
        metadata: {
          executionTimeMs: testingEndTime - testingStartTime,
        },
      })

      // Record workflow completion with comprehensive timing
      yield* timelineService.recordEvent({
        event: 'Complete workflow finished',
        phase: 'workflow',
        metadata: {
          totalExecutionTimeMs: workflowEndTime - workflowStartTime,
          reproductionTimeMs: reproEndTime - reproStartTime,
          hypothesisGenerationTimeMs: hypothesisGenEndTime - hypothesisGenStartTime,
          hypothesisTestingTimeMs: testingEndTime - testingStartTime,
        },
      })

      // Log comprehensive summary with timeline statistics
      const stats = yield* timelineService.getStatistics()

      yield* Effect.log('🎯 Complete workflow finished!')
      yield* Effect.log(`📊 Workflow Statistics:`)
      yield* Effect.log(`   • Total time: ${workflowEndTime - workflowStartTime}ms`)
      yield* Effect.log(`   • Reproduction: ${reproEndTime - reproStartTime}ms`)
      yield* Effect.log(`   • Hypothesis generation: ${hypothesisGenEndTime - hypothesisGenStartTime}ms`)
      yield* Effect.log(`   • Hypothesis testing: ${testingEndTime - testingStartTime}ms`)
      yield* Effect.log(`   • Total events recorded: ${stats.totalEvents}`)
    }).pipe(
      Effect.provide(
        Layer.mergeAll(TimelineService.Default(runId), StateStore.Default).pipe(
          Layer.provideMerge(WorkingDirService.Default(resolvedWorkingDirectory)),
        ),
      ),
    )
  },
)
