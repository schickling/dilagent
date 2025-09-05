import { Prompt } from '@effect/cli'
import { Console, Effect } from 'effect'
import { StateStore } from './services/state-store.ts'

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

export const runRepl = Effect.gen(function* () {
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
          // yield* store.set(key, value)
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
