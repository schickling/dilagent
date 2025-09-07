/**
 * REPL Service Tests
 *
 * These tests verify the REPL functionality including command parsing,
 * auto-completion, and state management integration.
 */
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CompleterStore, createCompleter, parseCommand } from './repl.ts'
import { StateStore } from './services/state-store.ts'
import { WorkingDirService } from './services/working-dir.ts'

// Create a test completer adapter that works with StateStore
const createTestCompleter = (store: StateStore) => {
  const completerAdapter: CompleterStore = {
    keys: () => Effect.gen(function* () {
      const state = yield* store.getDilagentState()
      return state.hypotheses.map(h => h.id)
    })
  }
  return createCompleter(completerAdapter)
}

describe('REPL', () => {
  let runtime: ManagedRuntime.ManagedRuntime<StateStore, never>
  let store: StateStore

  beforeAll(async () => {
    // Create StateStore instance for testing using ManagedRuntime with FileSystem dependency
    const PlatformLayer = Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)
    const ServiceLayer = Layer.mergeAll(WorkingDirService.Default, StateStore.Default).pipe(
      Layer.provide(PlatformLayer),
    )
    const TestLayer = Layer.mergeAll(PlatformLayer, ServiceLayer)

    runtime = ManagedRuntime.make(TestLayer)
    store = await runtime.runPromise(StateStore)
  })

  afterAll(async () => {
    await runtime.dispose()
  })

  describe('parseCommand', () => {
    it('extracts command from input', () => {
      expect(parseCommand('help')).toBe('help')
      expect(parseCommand('list')).toBe('list')
      expect(parseCommand('clear')).toBe('clear')
    })

    it('ignores arguments and only returns command', () => {
      expect(parseCommand('list some args')).toBe('list')
    })

    it('handles empty input', () => {
      expect(parseCommand('')).toBe('')
      expect(parseCommand('   ')).toBe('')
    })

    it('handles extra whitespace', () => {
      expect(parseCommand('  list  ')).toBe('list')
    })
  })

  describe('auto-completion', () => {
    let completer: (line: string, callback: (err?: null | Error, result?: [string[], string]) => void) => void

    // Helper function to promisify the completer
    const complete = (line: string): Promise<[string[], string]> => {
      return new Promise((resolve, reject) => {
        completer(line, (err, result) => {
          if (err) reject(err)
          else if (result) resolve(result)
          else reject(new Error('No result'))
        })
      })
    }

    beforeAll(() => {
      completer = createTestCompleter(store)
    })

    it('shows all commands for empty input', async () => {
      const [completions, partial] = await complete('')
      expect(completions).toEqual(['list', 'clear', 'help', 'exit', 'quit'])
      expect(partial).toBe('')
    })

    it('filters commands by prefix', async () => {
      const [completions, partial] = await complete('c')
      expect(completions).toEqual(['clear'])
      expect(partial).toBe('c')
    })

    it('returns exact match for complete command', async () => {
      const [completions, partial] = await complete('help')
      expect(completions).toContain('help')
      expect(partial).toBe('help')
    })

    it('does not complete for commands with arguments', async () => {
      const [completions, partial] = await complete('list ')
      expect(completions).toEqual([])
      expect(partial).toBe('list ')
    })
  })

  // Legacy state management tests removed - REPL now focuses on hypothesis management

  describe('error handling', () => {
    it('handles completer errors gracefully', async () => {
      // Create a completer store that will fail (not used in simplified version but kept for interface)
      const failingStore: CompleterStore = {
        keys: () => Effect.fail(new Error('Store access failed')),
      }

      const failingCompleter = createCompleter(failingStore)

      // Test command completion (which doesn't depend on store)
      const result = await new Promise<[string[], string]>((resolve, reject) => {
        failingCompleter('lis', (err, result) => {
          if (err) reject(err)
          else if (result) resolve(result)
          else reject(new Error('No result'))
        })
      })

      const [completions, partial] = result
      expect(completions).toEqual(['list']) // Command completion should still work
      expect(partial).toBe('lis')
    })
  })
})
