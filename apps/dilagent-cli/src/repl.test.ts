/**
 * REPL Service Tests
 *
 * These tests verify the REPL functionality including command parsing,
 * auto-completion, and state management integration.
 */
import { Effect, ManagedRuntime } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CompleterStore, createCompleter, parseCommand } from './repl.ts'
import { StateStore } from './services/state-store.ts'

// We can use the exported createCompleter directly
const createTestCompleter = (store: StateStore, _runtime?: ManagedRuntime.ManagedRuntime<StateStore, never>) => {
  return createCompleter(store)
}

describe('REPL', () => {
  let runtime: ManagedRuntime.ManagedRuntime<StateStore, never>
  let store: StateStore

  beforeAll(async () => {
    // Create StateStore instance for testing using ManagedRuntime
    runtime = ManagedRuntime.make(StateStore.Default)
    store = await runtime.runPromise(StateStore)
  })

  afterAll(async () => {
    await runtime.dispose()
  })

  describe('parseCommand', () => {
    it('parses command with no arguments', () => {
      const result = parseCommand('help')
      expect(result).toEqual({
        command: 'help',
        args: [],
      })
    })

    it('parses command with single argument', () => {
      const result = parseCommand('get mykey')
      expect(result).toEqual({
        command: 'get',
        args: ['mykey'],
      })
    })

    it('parses command with multiple arguments', () => {
      const result = parseCommand('set mykey some value here')
      expect(result).toEqual({
        command: 'set',
        args: ['mykey', 'some', 'value', 'here'],
      })
    })

    it('handles empty input', () => {
      const result = parseCommand('')
      expect(result).toEqual({
        command: '',
        args: [],
      })
    })

    it('handles whitespace-only input', () => {
      const result = parseCommand('   ')
      expect(result).toEqual({
        command: '',
        args: [],
      })
    })

    it('handles extra whitespace', () => {
      const result = parseCommand('  get   mykey  ')
      expect(result).toEqual({
        command: 'get',
        args: ['mykey'],
      })
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
      completer = createTestCompleter(store, runtime)
    })

    it('completes commands from partial input', async () => {
      const [completions, partial] = await complete('he')
      expect(completions).toContain('help')
      expect(partial).toBe('he')
    })

    it('shows all commands for empty input', async () => {
      const [completions, partial] = await complete('')
      expect(completions).toEqual(['get', 'set', 'delete', 'list', 'keys', 'clear', 'help', 'exit', 'quit'])
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

    it('completes keys for get command with empty state', async () => {
      const [completions, partial] = await complete('get ')
      expect(completions).toEqual([]) // Empty state should return empty completions
      expect(partial).toBe('')
    })

    it('completes keys for delete command with empty state', async () => {
      const [completions, partial] = await complete('delete ')
      expect(completions).toEqual([]) // Empty state should return empty completions
      expect(partial).toBe('')
    })

    it('does not complete for other commands', async () => {
      const [completions, partial] = await complete('list ')
      expect(completions).toEqual([])
      expect(partial).toBe('list ')
    })
  })

  describe('auto-completion with populated state', () => {
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

    beforeAll(async () => {
      // Populate the state store with test data
      await runtime.runPromise(store.set('experiment-1', { _tag: 'Proven', hypothesisId: 'exp-1', nextSteps: [] }))
      await runtime.runPromise(
        store.set('experiment-2', {
          _tag: 'Disproven',
          hypothesisId: 'exp-2',
          reason: 'Test reason',
          evidence: 'Test evidence',
          newhypothesisIdeas: [],
        }),
      )
      await runtime.runPromise(store.set('test-key', { _tag: 'Proven', hypothesisId: 'test-exp', nextSteps: [] }))

      completer = createTestCompleter(store, runtime)
    })

    it('completes existing keys for get command', async () => {
      const [completions, partial] = await complete('get exp')
      expect(completions).toEqual(['experiment-1', 'experiment-2'])
      expect(partial).toBe('exp')
    })

    it('shows all keys when no partial match', async () => {
      const [completions, partial] = await complete('get ')
      expect(completions.sort()).toEqual(['experiment-1', 'experiment-2', 'test-key'])
      expect(partial).toBe('')
    })

    it('completes keys for delete command', async () => {
      const [completions, partial] = await complete('delete test')
      expect(completions).toEqual(['test-key'])
      expect(partial).toBe('test')
    })

    it('returns no matches for non-existent prefix', async () => {
      const [completions, partial] = await complete('get nonexistent')
      expect(completions).toEqual([])
      expect(partial).toBe('nonexistent')
    })
  })

  describe('state management integration', () => {
    beforeAll(async () => {
      // Clear state before testing state management
      await runtime.runPromise(store.clear())
    })

    it('can store and retrieve experiment results', async () => {
      const testResult = { _tag: 'Proven' as const, hypothesisId: 'test-exp-001', nextSteps: [] }

      await runtime.runPromise(store.set('my-test-key', testResult))
      const retrieved = await runtime.runPromise(store.get('my-test-key'))

      expect(retrieved).toEqual(testResult)
    })

    it('returns undefined for non-existent keys', async () => {
      const retrieved = await runtime.runPromise(store.get('non-existent-key'))
      expect(retrieved).toBeUndefined()
    })

    it('can list all entries', async () => {
      await runtime.runPromise(store.clear())
      await runtime.runPromise(store.set('key1', { _tag: 'Proven', hypothesisId: 'exp1', nextSteps: [] }))
      await runtime.runPromise(
        store.set('key2', {
          _tag: 'Disproven',
          hypothesisId: 'exp2',
          reason: 'Test reason',
          evidence: 'Test evidence',
          newhypothesisIdeas: [],
        }),
      )

      const entries = await runtime.runPromise(store.list())
      expect(entries).toHaveLength(2)
      expect(entries.map((e) => e.key).sort()).toEqual(['key1', 'key2'])
    })

    it('can get all keys', async () => {
      const keys = await runtime.runPromise(store.keys())
      expect(keys.sort()).toEqual(['key1', 'key2'])
    })

    it('can delete keys', async () => {
      const deleted = await runtime.runPromise(store.delete('key1'))
      expect(deleted).toBe(true)

      const keys = await runtime.runPromise(store.keys())
      expect(keys).toEqual(['key2'])

      // Deleting non-existent key returns false
      const notDeleted = await runtime.runPromise(store.delete('non-existent'))
      expect(notDeleted).toBe(false)
    })

    it('can clear all data', async () => {
      await runtime.runPromise(store.clear())
      const keys = await runtime.runPromise(store.keys())
      expect(keys).toEqual([])
    })
  })

  describe('error handling', () => {
    it('handles completer errors gracefully', async () => {
      // Create a completer store that will fail
      const failingStore: CompleterStore = {
        keys: () => Effect.fail(new Error('Store access failed')),
      }

      const failingCompleter = createCompleter(failingStore)

      const result = await new Promise<[string[], string]>((resolve, reject) => {
        failingCompleter('get test', (err, result) => {
          if (err) reject(err)
          else if (result) resolve(result)
          else reject(new Error('No result'))
        })
      })

      const [completions, partial] = result
      expect(completions).toEqual([]) // Should return empty completions on error
      expect(partial).toBe('test')
    })
  })
})
