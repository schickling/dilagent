import path from 'node:path'
import * as Cli from '@effect/cli'
import { Prompt } from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Console, Effect, Fiber, Layer, Option } from 'effect'
import { ClaudeService } from '../services/claude.ts'
import { createMcpServerLayer } from '../services/mcp-server.js'
import { StateStore } from '../services/state-store.js'
import { experimentCommand } from './experiment.ts'

const parseCommand = (input: string): { command: string; args: Array<string> } => {
  const parts = input.trim().split(/\s+/)
  return {
    command: parts[0] || '',
    args: parts.slice(1),
  }
}

const printHelp = Console.log(`
Available commands:
  get <key>           - Get value for key
  set <key> <value>   - Set key to value
  delete <key>        - Delete a key
  list                - List all key-value pairs
  keys                - List all keys
  clear               - Clear all entries
  help                - Show this help message
  exit, quit          - Exit the REPL
`)

const runRepl = Effect.gen(function* () {
  const store = yield* StateStore

  yield* Console.log('State Manager REPL. Type "help" for commands, "exit" to quit.')

  while (true) {
    const input = yield* Prompt.text({
      message: '> ',
      default: '',
    })

    const { command, args } = parseCommand(input)

    switch (command) {
      case 'exit':
      case 'quit':
        yield* Console.log('Goodbye!')
        return

      case 'help':
        yield* printHelp
        break

      case 'get':
        if (args.length !== 1) {
          yield* Console.log('Usage: get <key>')
        } else {
          const key = args[0]!
          const value = yield* store.get(key)
          if (value === undefined) {
            yield* Console.log(`Key "${key}" not found`)
          } else {
            yield* Console.log(`${key} = ${value}`)
          }
        }
        break

      case 'set':
        if (args.length < 2) {
          yield* Console.log('Usage: set <key> <value>')
        } else {
          const key = args[0]!
          const value = args.slice(1).join(' ')
          yield* store.set(key, value)
          yield* Console.log(`Set ${key} = ${value}`)
        }
        break

      case 'delete':
        if (args.length !== 1) {
          yield* Console.log('Usage: delete <key>')
        } else {
          const key = args[0]!
          const deleted = yield* store.delete(key)
          if (deleted) {
            yield* Console.log(`Deleted key "${key}"`)
          } else {
            yield* Console.log(`Key "${key}" not found`)
          }
        }
        break

      case 'list': {
        const entries = yield* store.list()
        if (entries.length === 0) {
          yield* Console.log('No entries in state store')
        } else {
          yield* Console.log('State store entries:')
          for (const { key, value } of entries) {
            yield* Console.log(`  ${key} = ${value}`)
          }
        }
        break
      }

      case 'keys': {
        const keys = yield* store.keys()
        if (keys.length === 0) {
          yield* Console.log('No keys in state store')
        } else {
          yield* Console.log(`Keys: ${keys.join(', ')}`)
        }
        break
      }

      case 'clear':
        yield* store.clear()
        yield* Console.log('State store cleared')
        break

      case '':
        // Empty input, just show prompt again
        break

      default:
        yield* Console.log(`Unknown command: ${command}. Type "help" for available commands.`)
    }
  }
})

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
  ({ port: portOption, workingDirectory, prompt }) =>
    Effect.gen(function* () {
      const actualPort = Option.getOrElse(portOption, () => 3000)
      console.log('manager', actualPort, workingDirectory, prompt)

      const resolvedWorkingDirectory = path.resolve(workingDirectory)

      yield* gatherInitialData

      yield* runExperiments({ resolvedWorkingDirectory, port: actualPort })

      yield* Console.log(`Starting MCP server on port ${actualPort}...`)
      yield* Console.log(`MCP endpoint: http://localhost:${actualPort}/mcp`)
      yield* Console.log(`Health check: http://localhost:${actualPort}/health`)
      yield* Console.log('')

      // Create server layer (without StateStore, which will be provided below)
      const serverLayer = createMcpServerLayer(actualPort)

      // Launch server in background (StateStore provided from outer scope)
      const serverFiber = yield* Layer.launch(serverLayer).pipe(Effect.fork)

      // Run REPL (StateStore provided from outer scope)
      yield* runRepl.pipe(Effect.ensuring(Fiber.interrupt(serverFiber)))
    }).pipe(
      // Provide StateStore.Live once at the top level so it's shared by both server and REPL
      Effect.provide(StateStore.Live),
    ),
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

const generateHypothesisIdeasPrompt = ({ problemPrompt }: { problemPrompt: string }) => `\
Study the following problem and generate a list of potential hypotheses for the root cause.
We will then run experiments to test each hypothesis in depth. Order the hypotheses by likelihood of being the root cause.

For each hypothesis provide a:
- Title
- Description
- Reproduction Steps
`

const makeExperimentInstructions = `\
You are an expert debugging assistant. Your job is to analyze and diagnose the root cause for the given problem.

## Goal

1. Identify the root cause of the problem
2. 

## Strategies

- Test loop: Create a targeted test loop that's fast to run and focused on the hypothesis
- Isolate: create a minimal reproduction of the problem
  - if your minimal reproduction attempt doesn't work, bisect and compare with the non-minimal reproduction until your minimal setup reproduces the problem
- Logging: add log statements
- Research: do some web research (e.g. existing issues on GitHub) to build a deeper understanding of the problem

## Acceptance Criteria

- The root cause is identified
- The root cause is reproducible
- The root cause is documented in the \`report.md\` file
- The root cause has been counter-tested with counter hypothesis
`

const makeExperimentContext = ({
  problemTitle,
  problemDescription,
  experimentInstructions,
}: {
  problemTitle: string
  problemDescription: string
  experimentInstructions: string
}) => `\
## Instructions

Follow the instructions provided in the \`instructions.md\` file.

## Problem: ${problemTitle}

${problemDescription}

## Experiment

${experimentInstructions}
`
