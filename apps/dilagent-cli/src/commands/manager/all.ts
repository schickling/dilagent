import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Layer, Option } from 'effect'
import { createFileLoggerLayer } from '../../services/file-logger.ts'
import { generateHypothesesCommand } from './generate-hypotheses.ts'
import { reproCommand } from './repro.ts'
import { runHypothesisWorkersCommand } from './run-hypotheses.ts'
import { setupCommand } from './setup.ts'
import {
  contextDirectoryOption,
  hypothesisCountOption,
  cwdOption,
  flakyOption,
  LOG_FILES,
  llmOption,
  portOption,
  promptOption,
  replOption,
  workingDirectoryOption,
} from './shared.ts'
import { summaryCommand } from './summary.ts'

/**
 * Main orchestration command that runs the complete dilagent workflow
 *
 * Architecture:
 * - This command is a PURE ORCHESTRATOR - it only calls sub-commands in sequence
 * - Each sub-command is responsible for its own timeline event recording
 * - Each sub-command handles its own business logic and state management
 * - The summary command handles final workflow statistics and completion
 *
 * Flow:
 * 1. setup: Initialize working directory and git repositories
 * 2. repro: Reproduce the issue (records setup phase events)
 * 3. generate-hypotheses: Generate testable hypotheses (records hypothesis-generation events)
 * 4. run-hypotheses: Execute hypothesis tests in parallel (records hypothesis-testing events)
 * 5. summary: Generate final report and statistics (records workflow completion)
 *
 * This approach follows single responsibility principle and avoids code duplication.
 */

export const allCommand = Cli.Command.make(
  'all',
  {
    contextDirectory: contextDirectoryOption,
    workingDirectory: workingDirectoryOption,
    prompt: promptOption,
    hypothesisCount: hypothesisCountOption,
    llm: llmOption,
    port: portOption,
    repl: replOption,
    cwd: cwdOption,
    flaky: flakyOption,
  },
  (options) => {
    const resolvedCwd = Option.getOrElse(options.cwd, () => process.cwd())
    const resolvedWorkingDirectory = path.resolve(resolvedCwd, options.workingDirectory)

    return Effect.gen(function* () {
      yield* Effect.logDebug('[manager all] 🚀 Starting complete dilagent workflow...')

      // Setup working directory
      yield* setupCommand.handler({
        contextDirectory: options.contextDirectory,
        workingDirectory: options.workingDirectory,
        prompt: options.prompt,
        cwd: options.cwd,
      })

      // Reproduction
      yield* reproCommand.handler({
        workingDirectory: options.workingDirectory,
        llm: options.llm,
        flaky: options.flaky,
        cwd: options.cwd,
      })

      // Hypothesis Generation
      yield* generateHypothesesCommand.handler({
        workingDirectory: options.workingDirectory,
        hypothesisCount: options.hypothesisCount,
        llm: options.llm,
        cwd: options.cwd,
      })

      // Hypothesis Testing
      yield* runHypothesisWorkersCommand.handler({
        workingDirectory: options.workingDirectory,
        port: options.port,
        llm: options.llm,
        repl: options.repl,
        cwd: options.cwd,
      })

      // Generate final summary and statistics
      yield* summaryCommand.handler({
        workingDirectory: options.workingDirectory,
        cwd: options.cwd,
      })

      yield* Effect.logDebug('[manager all] ✅ Complete dilagent workflow finished!')
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          createFileLoggerLayer(path.join(resolvedWorkingDirectory, '.dilagent', 'logs', LOG_FILES.ALL), {
            replace: false,
            format: 'logfmt',
          }),
        ),
      ),
    )
  },
)
