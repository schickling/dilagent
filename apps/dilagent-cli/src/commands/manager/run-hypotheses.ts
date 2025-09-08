import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { runRepl } from '../../repl.ts'
import { ClaudeLLMLive } from '../../services/claude.ts'
import { CodexLLMLive } from '../../services/codex.ts'
import { getFreePort } from '../../services/free-port.ts'
import { GitManagerService } from '../../services/git-manager.ts'
import { createMcpServerLayer } from '../../services/mcp-server.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { generateRunSlug } from '../../utils/run-slug.ts'
import {
  cwdOption,
  llmOption,
  loadExperiments,
  portOption,
  replOption,
  runHypothesisWorker,
  workingDirectoryOption,
} from './shared.ts'

export const runHypothesisWorkersCommand = Cli.Command.make(
  'run-hypotheses',
  {
    workingDirectory: workingDirectoryOption,
    port: portOption,
    llm: llmOption,
    repl: replOption,
    cwd: cwdOption,
  },
  ({ workingDirectory, port: portOption, llm, repl: replOption, cwd: cwdOption }) =>
    Effect.gen(function* () {
      const fallbackPort = yield* getFreePort

      const port = Option.getOrElse(portOption, () => fallbackPort)
      const cwd = Option.getOrElse(cwdOption, () => process.cwd())
      const resolvedWorkingDirectory = path.resolve(cwd, workingDirectory)
      const runId = generateRunSlug('hypothesis-testing')

      return yield* Effect.gen(function* () {
        const workingDirService = yield* WorkingDirService
        const timelineService = yield* TimelineService

        const paths = workingDirService.paths
        const resolvedContextDirectory = paths.contextRepo

        yield* Effect.log(`Working directory: ${resolvedWorkingDirectory}`)
        yield* Effect.log(`Dilagent directory: ${paths.dilagent}`)
        yield* Effect.log(`Context directory: ${resolvedContextDirectory}`)

        // Record timeline event
        yield* timelineService.recordEvent({
          event: 'Hypothesis testing phase started',
          phase: 'hypothesis-testing',
        })

        // Load hypotheses from canonical location
        const hypotheses = yield* loadExperiments()

        yield* Effect.log(
          `Running ${hypotheses.length} hypotheses:\n${hypotheses.map((e) => `- ${e.hypothesisId}: ${e.problemTitle}`).join('\n')}`,
        )

        const fiber = yield* Effect.forEach(
          hypotheses,
          (hypothesis) =>
            runHypothesisWorker({
              resolvedWorkingDirectory,
              port,
              hypothesis,
              llm,
              cwd,
            }),
          { concurrency: 4 },
        ).pipe(Effect.tapErrorCause(Effect.logError), Effect.forkScoped)

        yield* Effect.log(`Starting MCP server on port ${port}...`)
        yield* Effect.log(`MCP endpoint: http://localhost:${port}/mcp`)

        if (Option.isSome(replOption) && replOption.value) {
          yield* runRepl
        }

        yield* fiber
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            createMcpServerLayer(port),
            Layer.mergeAll(
              llm === 'claude' ? ClaudeLLMLive : CodexLLMLive,
              Layer.mergeAll(GitManagerService.Default, TimelineService.Default(runId), StateStore.Default).pipe(
                Layer.provideMerge(WorkingDirService.Default(resolvedWorkingDirectory)),
              ),
            ),
          ),
        ),
      )
    }),
)
