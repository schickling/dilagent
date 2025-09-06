import * as Cli from '@effect/cli'
import { allCommand } from './all.ts'
import { generateExperimentsCommand } from './generate-experiments.ts'
import { replCommand } from './repl.ts'
import { runExperimentsCommand } from './run-experiments.ts'

export const managerCommand = Cli.Command.make('manager', {}).pipe(
  Cli.Command.withSubcommands([generateExperimentsCommand, runExperimentsCommand, allCommand, replCommand]),
  Cli.Command.withDescription('Manage debugging experiments'),
)
