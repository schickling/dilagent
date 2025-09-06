import * as Cli from '@effect/cli'
import { allCommand } from './all.ts'
import { generateHypothesesCommand } from './generate-hypotheses.ts'
import { replCommand } from './repl.ts'
import { runHypothesisWorkersCommand } from './run-hypotheses.ts'

export const managerCommand = Cli.Command.make('manager', {}).pipe(
  Cli.Command.withSubcommands([generateHypothesesCommand, runHypothesisWorkersCommand, allCommand, replCommand]),
  Cli.Command.withDescription('Manage debugging hypotheses'),
)
