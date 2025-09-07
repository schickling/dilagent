#!/usr/bin/env node

import * as Cli from '@effect/cli'
import { FetchHttpClient } from '@effect/platform'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer, Logger, LogLevel } from 'effect'
import { hypothesisCommand } from './commands/hypothesis.ts'
import { managerCommand } from './commands/manager/mod.ts'
import { utilsCommand } from './commands/utils/mod.ts'
import { StateStore } from './services/state-store.ts'

// Needed for Codex to find the CLI in the MCP proxy
process.env.DEEBUG_CLI_PATH = process.env.DEEBUG_CLI_PATH ?? process.argv[1]!

const mainCommand = Cli.Command.make('deebug', {}).pipe(
  Cli.Command.withSubcommands([hypothesisCommand, managerCommand, utilsCommand]),
)

const cli = Cli.Command.run(mainCommand, {
  name: 'deebug',
  version: '0.0.0',
})

const main = cli(process.argv).pipe(
  Effect.provide(
    Layer.mergeAll(
      NodeContext.layer,
      StateStore.Default,
      Logger.pretty,
      Logger.minimumLogLevel(LogLevel.Debug),
      FetchHttpClient.layer,
    ),
  ),
  Effect.scoped,
)

NodeRuntime.runMain(main, { disablePrettyLogger: true })
