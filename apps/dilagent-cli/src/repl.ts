import * as readline from 'node:readline'
import { Console, Effect } from 'effect'
import { StateStore } from './services/state-store.ts'

export const parseCommand = (input: string): { command: string; args: Array<string> } => {
  const parts = input.trim().split(/\s+/)
  return {
    command: parts[0] || '',
    args: parts.slice(1),
  }
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
  get <key>           - Get value for key
  set <key> <value>   - Set key to value
  delete <key>        - Delete a key
  list                - List all key-value pairs
  keys                - List all keys
  clear               - Clear all entries
  help                - Show this help message
  exit, quit          - Exit the REPL
`)

// Define a simpler interface for the completer to make testing easier
export interface CompleterStore {
  keys(): Effect.Effect<string[], unknown, never>
}

export const createCompleter =
  (store: CompleterStore) =>
  (line: string, callback: (err?: null | Error, result?: [string[], string]) => void): void => {
    const commands = ['get', 'set', 'delete', 'list', 'keys', 'clear', 'help', 'exit', 'quit']
    const parts = line.trim().split(/\s+/)

    // Command completion (first word) - only when we don't have a space at the end
    if (parts.length === 1 && !line.endsWith(' ')) {
      const partial = parts[0] || ''
      const hits = commands.filter((cmd) => cmd.startsWith(partial))
      callback(null, [hits.length ? hits : commands, partial])
      return
    }

    // Key completion for get/delete commands - when we have command + space or command + partial key
    if ((parts[0] === 'get' || parts[0] === 'delete') && (line.endsWith(' ') || parts.length >= 2)) {
      const partial = parts[1] || ''

      // Use Effect to get keys asynchronously
      const keysEffect = store.keys()

      Effect.runPromise(keysEffect)
        .then((allKeys) => {
          const hits = allKeys.filter((key) => key.startsWith(partial))
          // Show all keys if no partial specified (empty string), otherwise show just hits
          callback(null, [partial === '' ? allKeys : hits, partial])
        })
        .catch((_error) => {
          // If we can't get keys, just return empty completion
          callback(null, [[], partial])
        })
      return
    }

    callback(null, [[], line])
  }

export const runRepl = Effect.gen(function* () {
  const store = yield* StateStore
  const completer = createCompleter(store)
  const rl = yield* createReadlinePrompt(completer)

  yield* Console.log('State Manager REPL. Type "help" for commands, "exit" to quit.')
  yield* Console.log('Use arrow up/down to navigate command history.')
  yield* Console.log('Press Tab for auto-completion of commands and keys.')

  while (true) {
    const input = yield* Effect.promise(() => rl.prompt('> '))

    const { command, args } = parseCommand(input)

    switch (command) {
      case 'exit':
      case 'quit':
        yield* Console.log('Goodbye!')
        rl.close()
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
          // For the REPL, we'll create a simple string value
          // In a real scenario, this would need proper type handling
          const HypothesisStatus = {
            _tag: 'Proven' as const,
            hypothesisId: value,
            nextSteps: [],
          }
          yield* store.set(key, HypothesisStatus)
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
            yield* Console.log(`  ${key} = ${JSON.stringify(value)}`)
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
