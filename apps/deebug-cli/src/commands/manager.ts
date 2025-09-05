import * as Cli from '@effect/cli'
import { Effect } from 'effect'

export const managerCommand = Cli.Command.make(
  'manager',
  {
    port: Cli.Options.integer('port').pipe(Cli.Options.optional),
  },
  Effect.fn(function* ({ port }) {
    console.log('manager', port)
  }),
)
