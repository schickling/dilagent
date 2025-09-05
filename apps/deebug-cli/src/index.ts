#!/usr/bin/env node

import * as Cli from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect } from 'effect'
import { experimentCommand } from './commands/experiment.ts'
import { managerCommand } from './commands/manager.ts'
import { ClaudeService } from './services/claude.ts'

const mainCommand = Cli.Command.make('deebug', {}).pipe(
  Cli.Command.withSubcommands([experimentCommand, managerCommand]),
)

const cli = Cli.Command.run(mainCommand, {
  name: 'deebug',
  version: '0.0.0',
})

const main = Effect.gen(function* () {
  return yield* cli(process.argv)
}).pipe(Effect.provide(NodeContext.layer), Effect.provide(ClaudeService.Default))

NodeRuntime.runMain(main)
