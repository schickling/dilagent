import * as Cli from '@effect/cli'
import { Command } from '@effect/platform'
import { Effect } from 'effect'
import { ClaudeService } from '../services/claude.ts'

export const experimentCommand = Cli.Command.make(
  'experiment',
  {
    worktree: Cli.Options.directory('worktree-dir'),
    managerPort: Cli.Options.integer('manager-port'),
  },
  Effect.fn(function* ({ worktree }) {
    const files = yield* Command.make('ls', '-la').pipe(Command.workingDirectory(worktree), Command.string)
    console.log('files', files)

    const claude = yield* ClaudeService
    const result = yield* claude.prompt('Hello, Claude!')
    console.log('result', result)
  }),
)
