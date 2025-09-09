import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Effect, Layer, Logger, Option, Stream } from 'effect'
import { ClaudeLLMLive } from '../services/claude.ts'
import { CodexLLMLive } from '../services/codex.ts'
import { createFileLoggerLayer } from '../services/file-logger.ts'
import { LLMService } from '../services/llm.ts'
import { WorkingDirService } from '../services/working-dir.ts'
import { workingDirectoryOption } from './manager/shared.ts'

export const hypothesisCommand = Cli.Command.make(
  'hypothesis',
  {
    worktree: Cli.Options.directory('worktree-dir'),
    workingDirOption: workingDirectoryOption,
    managerPort: Cli.Options.integer('manager-port'),
    llm: Cli.Options.choice('llm', ['claude', 'codex']),
    showLogsOption: Cli.Options.boolean('show-logs').pipe(Cli.Options.optional),
    cwdOption: Cli.Options.directory('cwd').pipe(Cli.Options.optional),
  },
  ({ worktree, managerPort, llm, showLogsOption, cwdOption, workingDirOption }) => {
    const cwd = Option.getOrElse(cwdOption, () => process.cwd())
    const workingDir = path.resolve(cwd, workingDirOption)

    return Effect.gen(function* () {
      const resolvedWorktree = path.resolve(cwd, worktree)

      // Extract hypothesis information from worktree directory name
      // Format: worktree-H{NNN}-{hypothesis-slug}
      const worktreeName = path.basename(worktree)
      const match = worktreeName.match(/^worktree-(H\d+)-(.*?)$/)
      if (!match || !match[1] || !match[2]) {
        return yield* Effect.die(
          new Error(
            `Invalid worktree directory name: ${worktreeName}. Expected format: worktree-H{NNN}-{hypothesis-slug}`,
          ),
        )
      }

      const [, hypothesisId, hypothesisSlug] = match

      // Compute hypothesis log path for the layer - we need this outside the Effect.gen
      const hypothesisLogPath = path.resolve(
        workingDir,
        '.dilagent',
        `${hypothesisId}-${hypothesisSlug}`,
        'hypothesis.log',
      )

      return yield* Effect.gen(function* () {
        // Initialize WorkingDirService to get proper paths
        const workingDirService = yield* WorkingDirService

        yield* validateHypothesisFiles({ workingDirService, hypothesisId, hypothesisSlug })

        yield* Effect.log(`Worktree: ${resolvedWorktree}`)
        yield* Effect.log(`Hypothesis ID: ${hypothesisId}`)
        yield* Effect.log(`Hypothesis Slug: ${hypothesisSlug}`)
        yield* Effect.log(`Manager port: ${managerPort}`)

        // const files = yield* Command.make('ls', '-la').pipe(Command.workingDirectory(resolvedWorktree), Command.string)
        // console.log(`files in ${resolvedWorktree}`, files)
        const llmService = yield* LLMService

        const mcpConfig = {
          mcpServers: {
            stateStore: { type: 'http' as const, url: `http://localhost:${managerPort}/mcp` },
          },
        }

        yield* Effect.log('Starting LLM prompt stream')

        // Get hypothesis metadata file paths
        const metadataFiles = workingDirService.paths.hypothesisFiles({ hypothesisId, hypothesisSlug })

        yield* llmService
          .promptStream(
            `Diagnose the bug in ${resolvedWorktree}. All context is in ${metadataFiles.contextMd}. Follow the instructions in ${metadataFiles.instructionsMd}. Update your progress in ${metadataFiles.reportMd}.`,
            {
              useBestModel: true,
              workingDir: resolvedWorktree,
              mcpConfig,
              skipPermissions: true,
            },
          )
          .pipe(Stream.tap(Effect.log), Stream.runDrain)

        yield* Effect.log('Experiment completed')
      }).pipe(
        Effect.withSpan('hypothesis-command'),
        // Additionally stream the log output to the metadata directory hypothesis log file
        Effect.provide(
          Layer.mergeAll(
            createFileLoggerLayer(hypothesisLogPath, {
              // Given we're configuring the prettyLogger in main.ts, we need to replace it with the file logger
              replace:
                showLogsOption._tag === 'None' || showLogsOption.value === false ? Logger.prettyLoggerDefault : false,
              format: 'logfmt',
            }),
            llm === 'claude' ? ClaudeLLMLive : CodexLLMLive,
            WorkingDirService.Default({ workingDirectory: workingDir, create: false }),
          ),
        ),
      )
    })
  },
)

/**
 * Checks that all necessary hypothesis metadata files exist
 */
const validateHypothesisFiles = ({
  workingDirService,
  hypothesisId,
  hypothesisSlug,
}: {
  workingDirService: typeof WorkingDirService.Service
  hypothesisId: string
  hypothesisSlug: string
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const hypothesisFiles = workingDirService.paths.hypothesisFiles({ hypothesisId, hypothesisSlug })

    const expectedFiles = [
      { name: 'instructions.md', path: hypothesisFiles.instructionsMd },
      { name: 'context.md', path: hypothesisFiles.contextMd },
      { name: 'report.md', path: hypothesisFiles.reportMd },
    ]

    for (const { name, path: filePath } of expectedFiles) {
      const exists = yield* fs.exists(filePath)
      if (!exists) {
        return yield* Effect.die(new Error(`Hypothesis file ${name} does not exist at ${filePath}`))
      }
    }

    yield* Effect.logDebug(`All hypothesis metadata files validated for ${hypothesisId}`)
    return true
  }).pipe(Effect.withSpan('validateHypothesisFiles'))
