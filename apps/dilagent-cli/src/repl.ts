import * as readline from 'node:readline'
import { Console, Effect } from 'effect'
import { StateStore } from './services/state-store.ts'

export const parseCommand = (input: string): string => {
  return input.trim().split(/\s+/)[0] || ''
}

const createReadlinePrompt = (
  completer?: (line: string, callback: (err?: null | Error, result?: [string[], string]) => void) => void,
): Effect.Effect<{
  prompt: (message: string) => Promise<string>
  close: () => void
}> =>
  Effect.sync(() => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      history: [], // Enable command history
      historySize: 1000, // Keep last 1000 commands
      completer, // Add tab completion
    })

    return {
      prompt: (message: string): Promise<string> =>
        new Promise((resolve) => {
          rl.question(message, (answer) => {
            resolve(answer)
          })
        }),
      close: () => rl.close(),
    }
  })

const printHelp = Console.log(`
Available commands:
  list                - Show all hypotheses and their status (default)
  clear               - Reset all hypothesis states to pending
  help                - Show this help message
  exit, quit          - Exit the REPL
`)

// Define a simpler interface for the completer to make testing easier
export interface CompleterStore {
  keys(): Effect.Effect<string[], unknown, never>
}

// Adapter to make StateStore compatible with CompleterStore for hypothesis IDs
const createCompleterAdapter = (store: StateStore): CompleterStore => ({
  keys: () => Effect.gen(function* () {
    const state = yield* store.getDilagentState()
    return state.hypotheses.map(h => h.id)
  })
})

export const createCompleter =
  (_store: CompleterStore) =>
  (line: string, callback: (err?: null | Error, result?: [string[], string]) => void): void => {
    const commands = ['list', 'clear', 'help', 'exit', 'quit']
    const parts = line.trim().split(/\s+/)

    // Command completion (first word) - only when we don't have a space at the end
    if (parts.length === 1 && !line.endsWith(' ')) {
      const partial = parts[0] || ''
      const hits = commands.filter((cmd) => cmd.startsWith(partial))
      callback(null, [hits.length ? hits : commands, partial])
      return
    }

    callback(null, [[], line])
  }

const showHypotheses = (store: StateStore) =>
  Effect.gen(function* () {
    const state = yield* store.getDilagentState()
    if (state.hypotheses.length === 0) {
      yield* Console.log('No hypotheses in state')
    } else {
      yield* Console.log('Current hypotheses:')
      for (const hypothesis of state.hypotheses) {
        const statusIcon = 
          hypothesis.status === 'completed'
            ? hypothesis.result === 'proven' ? '✅' 
              : hypothesis.result === 'disproven' ? '❌'
              : '❔'
            : hypothesis.status === 'running' ? '🔄' : '⏸️'
        
        yield* Console.log(`  ${statusIcon} ${hypothesis.id}: ${hypothesis.slug}`)
        yield* Console.log(`     Status: ${hypothesis.status}${hypothesis.result ? ` (${hypothesis.result})` : ''}`)
        yield* Console.log(`     Branch: ${hypothesis.branch}`)
        yield* Console.log(`     Worktree: ${hypothesis.worktree}`)
        yield* Console.log('')
      }
    }
  })

export const runRepl = Effect.gen(function* () {
  const store = yield* StateStore
  const completerAdapter = createCompleterAdapter(store)
  const completer = createCompleter(completerAdapter)
  const rl = yield* createReadlinePrompt(completer)

  yield* Console.log('Hypothesis Manager REPL. Type "help" for commands, "exit" to quit.')
  yield* Console.log('Use arrow up/down to navigate command history.')
  yield* Console.log('Press Tab for auto-completion of hypothesis IDs.')
  yield* Console.log('Press Enter to list all hypotheses.\n')

  // Show hypotheses on startup
  yield* showHypotheses(store)

  while (true) {
    const input = yield* Effect.promise(() => rl.prompt('> '))

    const command = parseCommand(input)

    switch (command) {
      case 'exit':
      case 'quit':
        yield* Console.log('Goodbye!')
        rl.close()
        return

      case 'help':
        yield* printHelp
        break

      case 'list':
        yield* showHypotheses(store)
        break

      case 'clear':
        // Reset all hypotheses to pending state (similar to dilagent_state_clear MCP tool)
        yield* store.updateDilagentState((state) => ({
          ...state,
          hypotheses: state.hypotheses.map(h => ({
            ...h,
            status: 'pending' as const,
            result: undefined,
            confidence: undefined,
            startedAt: undefined,
            completedAt: undefined,
            executionTimeMs: undefined,
          })),
        }))
        yield* Console.log('All hypotheses reset to pending state')
        break

      case '':
        // Empty input runs list command
        yield* showHypotheses(store)
        break

      default:
        yield* Console.log(`Unknown command: ${command}. Type "help" for available commands.`)
    }
  }
})
