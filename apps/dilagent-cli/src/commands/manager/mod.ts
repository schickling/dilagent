import * as Cli from '@effect/cli'
import { allCommand } from './all.ts'
import { generateHypothesesCommand } from './generate-hypotheses.ts'
import { reproCommand } from './repro.ts'
import { runHypothesisWorkersCommand } from './run-hypotheses.ts'
import { setupCommand } from './setup.ts'
import { summaryCommand } from './summary.ts'

export const managerCommand = Cli.Command.make('manager', {}).pipe(
  Cli.Command.withSubcommands([
    setupCommand,
    reproCommand,
    generateHypothesesCommand,
    runHypothesisWorkersCommand,
    allCommand,
    summaryCommand,
  ]),
  Cli.Command.withDescription('Manage debugging hypotheses'),
)
