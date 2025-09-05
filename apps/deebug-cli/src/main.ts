#!/usr/bin/env node

import * as Cli from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer, Logger } from 'effect'
import { experimentCommand } from './commands/experiment.ts'
import { managerCommand } from './commands/manager.ts'
import { StateStore } from './services/state-store.ts'

const mainCommand = Cli.Command.make('deebug', {}).pipe(
  Cli.Command.withSubcommands([experimentCommand, managerCommand]),
)

const cli = Cli.Command.run(mainCommand, {
  name: 'deebug',
  version: '0.0.0',
})

const main = cli(process.argv).pipe(
  Effect.provide(Layer.mergeAll(NodeContext.layer, StateStore.Default, Logger.pretty)),
  Effect.scoped,
)

NodeRuntime.runMain(main, { disablePrettyLogger: true })
