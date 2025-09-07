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
      completer = createTestCompleter(store, runtime)
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

  describe('state management integration', () => {
    beforeAll(async () => {
      // Clear state before testing state management
      await runtime.runPromise(store.clear())
    })

    it('can store and retrieve experiment results', async () => {
      const testResult = { _tag: 'Proven' as const, hypothesisId: 'test-exp-001', findings: 'Root cause found' }

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
      await runtime.runPromise(
        store.set('key1', { _tag: 'Proven', hypothesisId: 'exp1', findings: 'Root cause found' }),
      )
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
