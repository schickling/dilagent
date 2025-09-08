#!/usr/bin/env node

import * as Cli from '@effect/cli'
import { FetchHttpClient } from '@effect/platform'
import { NodeContext, NodeFileSystem, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer, Logger, LogLevel } from 'effect'
import { hypothesisCommand } from './commands/hypothesis.ts'
import { managerCommand } from './commands/manager/mod.ts'
import { utilsCommand } from './commands/utils/mod.ts'
import { StateStore } from './services/state-store.ts'

// Needed for Codex to find the CLI in the MCP proxy
process.env.DILAGENT_CLI_PATH = process.env.DILAGENT_CLI_PATH ?? process.argv[1]!

const mainCommand = Cli.Command.make('dilagent', {}).pipe(
  Cli.Command.withSubcommands([hypothesisCommand, managerCommand, utilsCommand]),
)

const cli = Cli.Command.run(mainCommand, {
  name: 'dilagent',
  version: '0.0.0',
})

const PlatformLayer = Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)

const MainLayer = Layer.mergeAll(
  PlatformLayer,
  Logger.pretty,
  Logger.minimumLogLevel(LogLevel.Debug),
  FetchHttpClient.layer,
)

const main = cli(process.argv).pipe(Effect.provide(MainLayer), Effect.scoped)

NodeRuntime.runMain(main, { disablePrettyLogger: true })
