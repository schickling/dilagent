import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Effect, Layer, Option } from 'effect'
import { createPhaseEvent } from '../../schemas/file-management.ts'
import { createFileLoggerLayer } from '../../services/file-logger.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { cwdOption, LOG_FILES, workingDirectoryOption } from './shared.ts'

/**
 * Command to generate comprehensive workflow summary and statistics
 *
 * This command analyzes the complete workflow execution and provides:
 * - Final workflow completion event recording
 * - Comprehensive timing statistics
 * - Detailed summary report file
 * - Console statistics display
 *
 * Used by the 'all' command for final workflow reporting.
 */

export const summaryCommand = Cli.Command.make(
  'summary',
  {
    workingDirectory: workingDirectoryOption,
    cwd: cwdOption,
  },
  ({ workingDirectory, cwd }) => {
    const resolvedCwd = Option.getOrElse(cwd, () => process.cwd())
    const resolvedWorkingDirectory = path.resolve(resolvedCwd, workingDirectory)

    return Effect.gen(function* () {
      yield* Effect.logDebug('[manager summary] 📊 Phase 4: Generating summary...')

      const stateStore = yield* StateStore
      const timelineService = yield* TimelineService
      const workingDirService = yield* WorkingDirService
      const fs = yield* FileSystem.FileSystem

      // Get timeline to calculate total workflow time
      const timeline = yield* timelineService.getTimeline()
      const state = yield* stateStore.getState()

      // Find workflow start and end times from timeline events
      const startEvent = timeline.events.find((e) => e.event === 'phase.started' && e.phase === 'setup')
      const currentTime = Date.now()

      // Calculate total workflow time
      const totalWorkflowTime = startEvent ? currentTime - new Date(startEvent.timestamp).getTime() : undefined

      // Record workflow completion event
      yield* timelineService.recordEvent(
        createPhaseEvent({
          event: 'phase.completed',
          phase: 'completed',
          details: {
            totalExecutionTimeMs: totalWorkflowTime,
            hypothesesGenerated: state.metrics.hypothesesGenerated,
            hypothesesCompleted: state.metrics.hypothesesCompleted,
            hypothesesSuccessful: state.metrics.hypothesesSuccessful,
            hypothesesFailed: state.metrics.hypothesesFailed,
          },
        }),
      )

      // Update state to completed
      yield* stateStore.completeRun()

      // Load updated timeline stats after recording completion event
      const timelineStats = yield* timelineService.getStatistics()

      // Calculate execution metrics
      const hypothesesList = Object.values(state.hypotheses)
      const totalHypotheses = hypothesesList.length
      const completedHypotheses = hypothesesList.filter((h) => h.status === 'completed').length
      const successfulHypotheses = hypothesesList.filter((h) => h.result?._tag === 'Proven').length
      const failedHypotheses = hypothesesList.filter((h) => h.result?._tag === 'Disproven').length
      const pendingHypotheses = hypothesesList.filter((h) => h.status === 'pending').length
      const provenHypotheses = hypothesesList.filter((h) => h.result?._tag === 'Proven').length
      const disprovenHypotheses = hypothesesList.filter((h) => h.result?._tag === 'Disproven').length

      const totalExecutionTime = 0 // TODO: track execution time in new schema

      const startTime = new Date(state.metrics.startTime).getTime()
      const metricsEndTime = state.metrics.endTime ? new Date(state.metrics.endTime).getTime() : Date.now()
      const wallClockTime = metricsEndTime - startTime

      // Generate summary content
      const summaryContent = `# Debugging Session Summary

## Overview
- **Context Directory**: ${state.contextDirectory}
- **Working Directory**: ${state.workingDirectory}
- **Started**: ${new Date(state.metrics.startTime).toLocaleString()}
- **Current Phase**: ${state.currentPhase}
- **Status**: ${state.currentPhase === 'completed' ? 'Completed' : 'In Progress'}

## Results Summary
- **Total Hypotheses**: ${totalHypotheses}
- **Completed**: ${completedHypotheses}/${totalHypotheses} (${Math.round((completedHypotheses / totalHypotheses) * 100)}%)
- **✅ Successful**: ${successfulHypotheses}
- **❌ Failed**: ${failedHypotheses}
- **⏸️ Pending**: ${pendingHypotheses}

## Performance Metrics
- **Wall Clock Time**: ${Math.round(wallClockTime / 1000)}s (${Math.round(wallClockTime / 60000)}m)
- **Total Execution Time**: ${Math.round(totalExecutionTime / 1000)}s (${Math.round(totalExecutionTime / 60000)}m)
- **Timeline Events**: ${timelineStats.totalEvents}

## Hypothesis Details

${hypothesesList
  .map((h) => {
    const statusIcon =
      h.status === 'completed'
        ? h.result?._tag === 'Proven'
          ? '✅'
          : h.result?._tag === 'Disproven'
            ? '❌'
            : '❔'
        : h.status === 'running'
          ? '🔄'
          : '⏸️'

    const summary = h.result
      ? ` - ${h.result._tag === 'Proven' ? h.result.findings : h.result._tag === 'Disproven' ? h.result.reason : h.result.intractableReason}`
      : ''
    const execTime = '' // TODO: track execution time

    return `### ${statusIcon} ${h.id}: ${h.slug}
- **Status**: ${h.status}${summary}
- **Worktree**: ${h.worktreePath}${execTime}
`
  })
  .join('\n')}

## Timeline Summary by Phase
${Object.entries(timelineStats.eventsByPhase)
  .map(([phase, count]) => `- **${phase}**: ${count} events`)
  .join('\n')}

${
  timelineStats.firstEvent
    ? `## Session Duration
- **Started**: ${new Date(timelineStats.firstEvent).toLocaleString()}
- **Latest Activity**: ${new Date(timelineStats.lastEvent!).toLocaleString()}
- **Duration**: ${Math.round((new Date(timelineStats.lastEvent!).getTime() - new Date(timelineStats.firstEvent).getTime()) / 60000)}m`
    : ''
}

## Key Insights
${
  provenHypotheses > 0
    ? `🎯 **Root Cause Found**: ${hypothesesList
        .filter((h) => h.result?._tag === 'Proven')
        .map((h) => h.id)
        .join(', ')}`
    : disprovenHypotheses === totalHypotheses
      ? '🔍 **All hypotheses disproven** - Consider alternative approaches or gather more information'
      : completedHypotheses === 0
        ? '🚀 **Session in progress** - Hypotheses are being tested'
        : '🔄 **Testing in progress** - Some hypotheses ruled out, others still being evaluated'
}

---
*Generated on ${new Date().toLocaleString()}*
`

      // Save summary to artifacts
      const artifactsDir = workingDirService.paths.artifacts
      const summaryFile = path.join(artifactsDir, 'summary.md')

      yield* fs
        .writeFileString(summaryFile, summaryContent)
        .pipe(Effect.catchAll((error) => Effect.die(`Failed to write summary: ${error}`)))

      // Display comprehensive console summary (from all.ts)
      yield* Effect.log('🎯 Complete workflow finished!')
      yield* Effect.log(`📊 Workflow Statistics:`)

      if (totalWorkflowTime) {
        yield* Effect.log(`   • Total time: ${totalWorkflowTime}ms`)
      }

      yield* Effect.log(`   • Hypotheses generated: ${state.metrics.hypothesesGenerated}`)
      yield* Effect.log(`   • Hypotheses completed: ${state.metrics.hypothesesCompleted}`)
      yield* Effect.log(`   • Hypotheses successful: ${state.metrics.hypothesesSuccessful}`)
      yield* Effect.log(`   • Hypotheses failed: ${state.metrics.hypothesesFailed}`)
      yield* Effect.log(`   • Total timeline events: ${timelineStats.totalEvents}`)

      yield* Effect.log(`📄 Generated debugging session summary: ${summaryFile}`)

      return {
        summaryContent,
        totalWorkflowTime,
        metrics: state.metrics,
        timelineStats,
      }
    }).pipe(
      Effect.provide(
        Layer.mergeAll(TimelineService.Default, StateStore.Default).pipe(
          Layer.provideMerge(
            createFileLoggerLayer(path.join(resolvedWorkingDirectory, '.dilagent', 'logs', LOG_FILES.SUMMARY), {
              replace: false,
              format: 'logfmt',
            }),
          ),
          Layer.provideMerge(WorkingDirService.Default({ workingDir: resolvedWorkingDirectory, create: false })),
        ),
      ),
    )
  },
)
