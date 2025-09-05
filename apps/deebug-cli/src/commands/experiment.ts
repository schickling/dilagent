import path from 'node:path'
import * as Cli from '@effect/cli'
import { Effect, Stream } from 'effect'
import { ClaudeService } from '../services/claude.ts'
import { createFileLoggerLayer } from '../services/file-logger.ts'
import type { ClaudeCodeMessage } from '../types/claude-code-protocol.ts'

export const experimentCommand = Cli.Command.make(
  'experiment',
  {
    worktree: Cli.Options.directory('worktree-dir'),
    managerPort: Cli.Options.integer('manager-port'),
  },
  ({ worktree, managerPort }) =>
    Effect.gen(function* () {
      const resolvedWorktree = path.resolve(worktree)

      yield* Effect.log(`Worktree: ${resolvedWorktree}`)
      yield* Effect.log(`Manager port: ${managerPort}`)

      // const files = yield* Command.make('ls', '-la').pipe(Command.workingDirectory(resolvedWorktree), Command.string)
      // console.log(`files in ${resolvedWorktree}`, files)

      const claude = yield* ClaudeService

      const mcpConfig = {
        mcpServers: {
          kvStore: { type: 'http', url: `http://localhost:${managerPort}/mcp` },
        },
      }

      yield* Effect.log('Starting Claude prompt stream')

      yield* claude
        .promptStream(`Create some example data in the kvStore mcp thing`, {
          // .promptStream(`Diagnose the bug in ${resolvedWorktree}`, {
          // TODO re-fine permissions
          extraArgs: ['--dangerously-skip-permissions', '--mcp-config', `'${JSON.stringify(mcpConfig)}'`],
        })
        .pipe(Stream.tap(logClaudeMessage), Stream.runDrain)

      yield* Effect.log('Experiment completed')
    }).pipe(
      Effect.withSpan('experiment-command'),
      // Additionally stream the log output to a file
      Effect.provide(createFileLoggerLayer(path.resolve(worktree, 'experiment.log'))),
    ),
)

const logClaudeMessage = Effect.fn(function* (message: ClaudeCodeMessage) {
  if (message.type === 'assistant') {
    const content = message.message.content.map((c) => (c.type === 'tool_result' ? c.content : c)).join(' ')
    yield* Effect.log(`[assistant] ${content}`)
  }
  if (message.type === 'user') {
    const content = message.message.content.map((c) => (c.type === 'tool_result' ? c.content : c)).join(' ')
    yield* Effect.log(`[user] ${content}`)
  }
  if (message.type === 'result') {
    yield* Effect.log(`[result] ${JSON.stringify(message.result)}`)
  }
  if (message.type === 'system') {
    yield* Effect.log(`[system] ${JSON.stringify(message)}`)
  }
})
