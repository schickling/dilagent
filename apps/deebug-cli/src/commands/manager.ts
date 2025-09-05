import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Console, Effect, Option } from 'effect'
import { makeExperimentInstructions } from '../prompts.ts'
import { runRepl } from '../repl.ts'
import { ClaudeService } from '../services/claude.ts'
import { createMcpServerLayer } from '../services/mcp-server.js'
import { experimentCommand } from './experiment.ts'

export const managerCommand = Cli.Command.make(
  'manager',
  {
    port: Cli.Options.integer('port').pipe(
      Cli.Options.optional,
      Cli.Options.withAlias('p'),
      Cli.Options.withDescription('Port to run the MCP server on'),
    ),
    workingDirectory: Cli.Options.directory('working-directory'),
    prompt: Cli.Options.text('prompt'),
  },
  ({ port: portOption, workingDirectory, prompt }) => {
    const actualPort = Option.getOrElse(portOption, () => 3000)
    return Effect.gen(function* () {
      console.log('manager', actualPort, workingDirectory, prompt)

      const resolvedWorkingDirectory = path.resolve(workingDirectory)

      yield* gatherInitialData

      // yield* runExperiments({ resolvedWorkingDirectory, port: actualPort })

      yield* Console.log(`Starting MCP server on port ${actualPort}...`)
      yield* Console.log(`MCP endpoint: http://localhost:${actualPort}/mcp`)
      yield* Console.log(`Health check: http://localhost:${actualPort}/health`)
      yield* Console.log('')

      // Run REPL (StateStore provided from outer scope)
      yield* runRepl
    }).pipe(
      // Provide StateStore.Live once at the top level so it's shared by both server and REPL
      Effect.provide(createMcpServerLayer(actualPort)),
    )
  },
)

const gatherInitialData = Effect.gen(function* () {})

const generateExperiments = Effect.gen(function* () {
  const claude = yield* ClaudeService
  const results = yield* claude.prompt(makeExperimentInstructions)
})

const runExperiments = ({ resolvedWorkingDirectory, port }: { resolvedWorkingDirectory: string; port: number }) =>
  Effect.gen(function* () {
    const experimentAWorkTree = path.resolve(resolvedWorkingDirectory, 'experiment-a')
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(experimentAWorkTree)

    yield* experimentCommand.handler({ managerPort: port, worktree: experimentAWorkTree })
  })

const synthesizePatch = Effect.gen(function* () {})
const validatePatch = Effect.gen(function* () {})
