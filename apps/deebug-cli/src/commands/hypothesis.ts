import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Effect, Layer, Logger, Option, Stream } from 'effect'
import { ClaudeLLMLive } from '../services/claude.ts'
import { CodexLLMLive } from '../services/codex.ts'
import { createFileLoggerLayer } from '../services/file-logger.ts'
import { LLMService } from '../services/llm.ts'

export const hypothesisCommand = Cli.Command.make(
  'hypothesis',
  {
    worktree: Cli.Options.directory('worktree-dir'),
    managerPort: Cli.Options.integer('manager-port'),
    llm: Cli.Options.choice('llm', ['claude', 'codex']),
    showLogsOption: Cli.Options.boolean('show-logs').pipe(Cli.Options.optional),
    cwdOption: Cli.Options.directory('cwd').pipe(Cli.Options.optional),
  },
  ({ worktree, managerPort, llm, showLogsOption, cwdOption }) =>
    Effect.gen(function* () {
      const cwd = Option.getOrElse(cwdOption, () => process.cwd())
      const resolvedWorktree = path.resolve(cwd, worktree)

      yield* validateWorktree(resolvedWorktree)

      yield* Effect.log(`Worktree: ${resolvedWorktree}`)
      yield* Effect.log(`Manager port: ${managerPort}`)

      // const files = yield* Command.make('ls', '-la').pipe(Command.workingDirectory(resolvedWorktree), Command.string)
      // console.log(`files in ${resolvedWorktree}`, files)

      const llm = yield* LLMService

      const mcpConfig = {
        mcpServers: {
          stateStore: { type: 'http' as const, url: `http://localhost:${managerPort}/mcp` },
        },
      }

      yield* Effect.log('Starting LLM prompt stream')

      yield* llm
        .promptStream(
          `Diagnose the bug in ${resolvedWorktree}. All context is in context.md. Follow the instructions in instructions.md.`,
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
      // Additionally stream the log output to a file
      Effect.provide(
        Layer.mergeAll(
          createFileLoggerLayer(path.resolve(worktree, 'hypothesis.log'), {
            // Given we're configuring the prettyLogger in main.ts, we need to replace it with the file logger
            replace:
              showLogsOption._tag === 'None' || showLogsOption.value === false ? Logger.prettyLoggerDefault : false,
            format: 'logfmt',
          }),
          llm === 'claude' ? ClaudeLLMLive : CodexLLMLive,
        ),
      ),
    ),
)

/**
 * Checks that all necessary files exist in the worktree
 */
const validateWorktree = (worktree: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const expectedFiles = ['instructions.md', 'context.md', 'report.md']
    for (const file of expectedFiles) {
      const filePath = path.resolve(worktree, file)
      const exists = yield* fs.exists(filePath)
      if (!exists) {
        yield* Effect.die(new Error(`File ${path} does not exist`))
      }
    }
    return true
  }).pipe(Effect.withSpan('validateWorktree'))
