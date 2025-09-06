#!/usr/bin/env node

import * as Cli from '@effect/cli'
import { FetchHttpClient } from '@effect/platform'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer, Logger } from 'effect'
import { experimentCommand } from './commands/experiment.ts'
import { managerCommand } from './commands/manager/mod.ts'
import { utilsCommand } from './commands/utils/mod.ts'
import { StateStore } from './services/state-store.ts'

const mainCommand = Cli.Command.make('deebug', {}).pipe(
  Cli.Command.withSubcommands([experimentCommand, managerCommand, utilsCommand]),
)

const cli = Cli.Command.run(mainCommand, {
  name: 'deebug',
  version: '0.0.0',
})

const main = cli(process.argv).pipe(
  Effect.provide(Layer.mergeAll(NodeContext.layer, StateStore.Default, Logger.pretty, FetchHttpClient.layer)),
  Effect.scoped,
)

NodeRuntime.runMain(main, { disablePrettyLogger: true })
