import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Effect, Layer } from 'effect'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { generateRunSlug } from '../../utils/run-slug.ts'
import { workingDirectoryOption } from './shared.ts'

export const summaryCommand = Cli.Command.make(
  'summary',
  {
    workingDirectory: workingDirectoryOption,
  },
  ({ workingDirectory }) => {
    const runId = generateRunSlug('summary')
    const resolvedWorkingDirectory = path.resolve(process.cwd(), workingDirectory)

    return Effect.gen(function* () {
      const stateStore = yield* StateStore
      const timelineService = yield* TimelineService
      const workingDirService = yield* WorkingDirService
      const fs = yield* FileSystem.FileSystem

      // Load state and timeline
      const state = yield* stateStore.getDilagentState()
      const timelineStats = yield* timelineService.getStatistics()

      // Calculate execution metrics
      const totalHypotheses = state.hypotheses.length
      const completedHypotheses = state.hypotheses.filter((h) => h.status === 'completed').length
      const provenHypotheses = state.hypotheses.filter((h) => h.result === 'proven').length
      const disprovenHypotheses = state.hypotheses.filter((h) => h.result === 'disproven').length
      const inconclusiveHypotheses = state.hypotheses.filter((h) => h.result === 'inconclusive').length

      const totalExecutionTime = state.hypotheses.reduce((acc, h) => acc + (h.executionTimeMs ?? 0), 0)

      const startTime = new Date(state.createdAt).getTime()
      const endTime = Date.now() // DilagentState doesn't have completedAt field
      const wallClockTime = endTime - startTime

      // Generate summary content
      const summaryContent = `# Debugging Session Summary

## Overview
- **Run ID**: ${state.runId}
- **Context**: ${state.contextDir}
- **Started**: ${new Date(state.createdAt).toLocaleString()}
- **Current Phase**: ${state.currentPhase}
- **Status**: ${state.currentPhase === 'completed' ? 'Completed' : 'In Progress'}

## Results Summary
- **Total Hypotheses**: ${totalHypotheses}
- **Completed**: ${completedHypotheses}/${totalHypotheses} (${Math.round((completedHypotheses / totalHypotheses) * 100)}%)
- **✅ Proven**: ${provenHypotheses}
- **❌ Disproven**: ${disprovenHypotheses}
- **❔ Inconclusive**: ${inconclusiveHypotheses}

## Performance Metrics
- **Wall Clock Time**: ${Math.round(wallClockTime / 1000)}s (${Math.round(wallClockTime / 60000)}m)
- **Total Execution Time**: ${Math.round(totalExecutionTime / 1000)}s (${Math.round(totalExecutionTime / 60000)}m)
- **Timeline Events**: ${timelineStats.totalEvents}

## Reproduction Status
${
  state.reproduction.status === 'success'
    ? `✅ **Successful** (${Math.round(state.reproduction.confidence * 100)}% confidence)`
    : state.reproduction.status === 'failed'
      ? `❌ **Failed** after ${state.reproduction.attempts} attempts`
      : `⏳ **Pending**`
}

## Hypothesis Details

${state.hypotheses
  .map((h) => {
    const statusIcon =
      h.status === 'completed'
        ? h.result === 'proven'
          ? '✅'
          : h.result === 'disproven'
            ? '❌'
            : '❔'
        : h.status === 'running'
          ? '🔄'
          : '⏸️'

    const confidence = h.confidence !== undefined ? ` (${Math.round(h.confidence * 100)}% confidence)` : ''
    const execTime = h.executionTimeMs ? ` | ${Math.round(h.executionTimeMs / 1000)}s` : ''

    return `### ${statusIcon} ${h.id}: ${h.slug}
- **Status**: ${h.status}${confidence}
- **Branch**: ${h.branch}${execTime}
- **Worktree**: ${h.worktree}
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
    ? `🎯 **Root Cause Found**: ${state.hypotheses
        .filter((h) => h.result === 'proven')
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

      yield* Effect.log(`📄 Generated debugging session summary: ${summaryFile}`)
      yield* Effect.log(
        `📊 Session Stats: ${completedHypotheses}/${totalHypotheses} hypotheses completed, ${provenHypotheses} proven`,
      )

      return summaryContent
    }).pipe(
      Effect.provide(
        Layer.mergeAll(TimelineService.Default(runId), StateStore.Default).pipe(
          Layer.provideMerge(WorkingDirService.Default(resolvedWorkingDirectory)),
        ),
      ),
    )
  },
)
