import * as Cli from '@effect/cli'
import { Command } from '@effect/platform'
import { Effect, Stream } from 'effect'
import path from 'path'
import { ClaudeService } from '../services/claude.ts'
import type { ClaudeCodeMessage } from '../types/claude-code-protocol.ts'

export const experimentCommand = Cli.Command.make(
  'experiment',
  {
    worktree: Cli.Options.directory('worktree-dir'),
    managerPort: Cli.Options.integer('manager-port'),
  },
  Effect.fn(function* ({ worktree }) {
    const resolvedWorktree = path.resolve(worktree)

    const files = yield* Command.make('ls', '-la').pipe(Command.workingDirectory(resolvedWorktree), Command.string)
    console.log(`files in ${resolvedWorktree}`, files)

    const claude = yield* ClaudeService

    yield* claude
      .promptStream(`Diagnose the bug in ${resolvedWorktree}`, { extraArgs: ['--dangerously-skip-permissions'] })
      .pipe(Stream.tap(logClaudeMessage), Stream.runDrain)
  }),
)

const logClaudeMessage = Effect.fn(function* (message: ClaudeCodeMessage) {
  if (message.type === 'assistant') {
    console.log('[assistant]', ...message.message.content.map((c) => (c.type === 'tool_result' ? c.content : c)))
  }
  if (message.type === 'user') {
    console.log('[user]', ...message.message.content.map((c) => (c.type === 'tool_result' ? c.content : c)))
  }
  if (message.type === 'result') {
    console.log('[result]', message.result)
  }
  if (message.type === 'system') {
    console.log('[system]', message)
  }
})
