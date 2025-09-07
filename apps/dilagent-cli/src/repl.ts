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
  list                - List all state store entries (default)
  clear               - Clear all entries
  help                - Show this help message
  exit, quit          - Exit the REPL
`)

// Define a simpler interface for the completer to make testing easier
export interface CompleterStore {
  keys(): Effect.Effect<string[], unknown, never>
}

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

const showList = (store: StateStore) =>
  Effect.gen(function* () {
    const entries = yield* store.list()
    if (entries.length === 0) {
      yield* Console.log('No entries in state store')
    } else {
      yield* Console.log('State store entries:')
      for (const { key, value } of entries) {
        yield* Console.log(`  ${key} = ${JSON.stringify(value, null, 2)}`)
      }
    }
  })

export const runRepl = Effect.gen(function* () {
  const store = yield* StateStore
  const completer = createCompleter(store)
  const rl = yield* createReadlinePrompt(completer)

  yield* Console.log('State Manager REPL. Type "help" for commands, "exit" to quit.')
  yield* Console.log('Use arrow up/down to navigate command history.')
  yield* Console.log('Press Tab for auto-completion of commands.')
  yield* Console.log('Press Enter to list all entries.\n')

  // Show list on startup
  yield* showList(store)

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
        yield* showList(store)
        break

      case 'clear':
        yield* store.clear()
        yield* Console.log('State store cleared')
        break

      case '':
        // Empty input runs list command
        yield* showList(store)
        break

      default:
        yield* Console.log(`Unknown command: ${command}. Type "help" for available commands.`)
    }
  }
})
