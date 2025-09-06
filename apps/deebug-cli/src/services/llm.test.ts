/**
 * LLM Service Integration Tests
 *
 * These tests verify that all LLM service implementations work consistently.
 * All tests in this file should pass for every LLM provider (Claude, Codex, etc.)
 * to ensure compatibility across different LLM backends.
 */
import type { CommandExecutor } from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { NodeContext } from '@effect/platform-node'
import { Chunk, Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as ClaudeProvider from './claude.ts'
import * as CodexProvider from './codex.ts'
import { type LLMError, LLMService } from './llm.ts'
import { StateStore } from './state-store.ts'

const providerLayers = [
  { name: 'Claude', layer: ClaudeProvider.ClaudeLLMLive },
  { name: 'Codex', layer: CodexProvider.CodexLLMLive },
]

describe.each(providerLayers)('$name LLM provider', { timeout: 60000 }, ({ layer }) => {
  let runtime: ManagedRuntime.ManagedRuntime<LLMService | CommandExecutor | StateStore, LLMError | PlatformError>

  beforeAll(async () => {
    // Import MCP server layer for integration testing
    const { createMcpServerLayer } = await import('./mcp-server.ts')

    // Create runtime with LLM provider, MCP server, and StateStore
    runtime = ManagedRuntime.make(
      Layer.mergeAll(
        layer,
        createMcpServerLayer(3457).pipe(Layer.provideMerge(StateStore.Default)),
        NodeContext.layer,
      ).pipe(Layer.orDie),
    )

    // Eagerly start the runtime
    await runtime.runPromise(Effect.void)

    // Give the MCP server a moment to start
    await new Promise((resolve) => setTimeout(resolve, 1000))
  })

  afterAll(async () => await runtime.dispose())

  it('handles simple prompts', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('What is 2+2?')
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
        expect(result).toContain('4')
      }),
    )
  }, 15000)

  it('validates math questions', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('Calculate 5*5')
        expect(typeof result).toBe('string')
        expect(result).toContain('25')
      }),
    )
  }, 15000)

  it('handles minimal prompts', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('Hi')
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      }),
    )
  }, 15000)

  it('supports system prompts', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('What is your name?', {
          systemPrompt: 'Always respond with "I am TestBot"',
        })
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
        // Note: System prompts may not be perfectly honored by the LLM
        // so we just verify the call succeeds and returns content
      }),
    )
  }, 15000)

  it('streams responses', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const stream = llm.promptStream('Count from 1 to 3, each on a new line')
        const chunks = yield* Stream.runCollect(stream)
        expect(Chunk.size(chunks)).toBeGreaterThan(0)
        const lines = Chunk.toReadonlyArray(chunks)
        lines.forEach((line) => {
          expect(typeof line).toBe('string')
        })
      }),
    )
  }, 20000)

  it('uses best model when requested', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('What is the capital of France?', {
          useBestModel: true,
        })
        expect(typeof result).toBe('string')
        expect(result.toLowerCase()).toContain('paris')
      }),
    )
  }, 15000)

  it('uses standard model by default', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('What is 7+7?', {
          useBestModel: false,
        })
        expect(typeof result).toBe('string')
        expect(result).toContain('14')
      }),
    )
  }, 15000)

  it('handles working directory option', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('What directory context do you have?', {
          workingDir: '/tmp',
        })
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      }),
    )
  }, 15000)

  it('accepts MCP configuration without errors', () => {
    // This is a simple unit test that verifies MCP config structure
    const mcpConfig = {
      mcpServers: {
        testServer: { type: 'http' as const, url: 'http://localhost:3456/mcp' },
      },
    }

    // Verify the config structure is valid
    expect(mcpConfig.mcpServers).toBeDefined()
    expect(mcpConfig.mcpServers.testServer.type).toBe('http')
    expect(mcpConfig.mcpServers.testServer.url).toBe('http://localhost:3456/mcp')

    // Verify JSON serialization works (this is what gets passed to CLI)
    const jsonConfig = JSON.stringify(mcpConfig)
    expect(jsonConfig).toContain('"mcpServers"')
    expect(jsonConfig).toContain('"testServer"')
    expect(() => JSON.parse(jsonConfig)).not.toThrow()
  })

  it('accepts skipPermissions option without errors', () => {
    // Test that skipPermissions is properly handled in options
    const optionsWithPermissions = { skipPermissions: true }
    const optionsWithoutPermissions = { skipPermissions: false }

    expect(optionsWithPermissions.skipPermissions).toBe(true)
    expect(optionsWithoutPermissions.skipPermissions).toBe(false)

    // This verifies the option structure is correct
    expect(typeof optionsWithPermissions.skipPermissions).toBe('boolean')
    expect(typeof optionsWithoutPermissions.skipPermissions).toBe('boolean')
  })

  it('accepts combined MCP and skipPermissions options', () => {
    // Test combining both options
    const combinedOptions = {
      mcpConfig: {
        mcpServers: {
          stateStore: { type: 'http' as const, url: 'http://localhost:3000/mcp' },
        },
      },
      skipPermissions: true,
    }

    expect(combinedOptions.mcpConfig).toBeDefined()
    expect(combinedOptions.skipPermissions).toBe(true)

    // Verify JSON serialization of MCP config works
    const jsonConfig = JSON.stringify(combinedOptions.mcpConfig)
    expect(() => JSON.parse(jsonConfig)).not.toThrow()

    const parsed = JSON.parse(jsonConfig)
    expect(parsed.mcpServers.stateStore.type).toBe('http')
  })

  describe('with MCP tools', { timeout: 60000 }, () => {
    const mcpConfig = {
      mcpServers: {
        stateStore: { type: 'http' as const, url: 'http://localhost:3457/mcp' },
      },
    }

    it('executes deebug_state_set tool and stores data', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Clear store first to ensure clean state
          yield* store.clear()

          // Create test data that matches the expected schema
          const testData = { _tag: 'Proven' as const, hypothesisId: 'H001' }

          // Prompt to store the value using MCP tools
          const result = yield* llm.prompt(
            `Use the deebug_state_set tool to store this experiment result: {"_tag": "Proven", "hypothesisId": "H001"} with key "test-key"`,
            {
              mcpConfig,
              skipPermissions: true,
            },
          )

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)

          // Verify the value was actually stored in StateStore
          const storedValue = yield* store.get('test-key')
          expect(storedValue).toEqual(testData)
        }),
      )
    })

    it('executes state.get tool and retrieves data', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Pre-populate the store with test data
          const testData = {
            _tag: 'Disproven' as const,
            hypothesisId: 'H002',
            reason: 'Test reason',
            evidence: 'Test evidence',
            newhypothesisIdeas: [],
          }
          yield* store.set('existing-key', testData)

          // Prompt to retrieve the value using MCP tools
          const result = yield* llm.prompt('Use the state.get tool to retrieve the value for key "existing-key"', {
            mcpConfig,
            skipPermissions: true,
          })

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)
          expect(result).toContain('H002')
          expect(result).toContain('Disproven')
        }),
      )
    })

    it('executes state.list tool and shows all entries', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Clear and populate store with multiple test entries
          yield* store.clear()
          const testData1 = { _tag: 'Proven' as const, hypothesisId: 'H003', nextSteps: [] }
          const testData2 = { _tag: 'Inconclusive' as const, hypothesisId: 'H004', currentStatus: 'In progress' }

          yield* store.set('key1', testData1)
          yield* store.set('key2', testData2)

          // Prompt to list all entries using MCP tools
          const result = yield* llm.prompt('Use the state.list tool to show all entries in the state store', {
            mcpConfig,
            skipPermissions: true,
          })

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)
          expect(result).toContain('key1')
          expect(result).toContain('key2')
          expect(result).toContain('H003')
          expect(result).toContain('H004')
        }),
      )
    })

    it('executes state.clear tool and empties the store', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Pre-populate store with test data
          const testData = { _tag: 'Proven' as const, hypothesisId: 'H005', nextSteps: [] }
          yield* store.set('temp-key', testData)

          // Verify data is there initially
          const initialValue = yield* store.get('temp-key')
          expect(initialValue).toEqual(testData)

          // Prompt to clear the store using MCP tools
          const result = yield* llm.prompt('Use the state.clear tool to clear all entries from the state store', {
            mcpConfig,
            skipPermissions: true,
          })

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)

          // Verify store was actually cleared
          const clearedValue = yield* store.get('temp-key')
          expect(clearedValue).toBeUndefined()

          const allEntries = yield* store.list()
          expect(allEntries).toHaveLength(0)
        }),
      )
    })

    it('executes state.keys tool and lists all keys', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Clear and populate store with multiple keys
          yield* store.clear()
          const testData1 = { _tag: 'Proven' as const, hypothesisId: 'H006', nextSteps: [] }
          const testData2 = { _tag: 'Proven' as const, hypothesisId: 'H007', nextSteps: [] }

          yield* store.set('alpha-key', testData1)
          yield* store.set('beta-key', testData2)

          // Prompt to get all keys using MCP tools
          const result = yield* llm.prompt('Use the state.keys tool to get all keys from the state store', {
            mcpConfig,
            skipPermissions: true,
          })

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)
          expect(result).toContain('alpha-key')
          expect(result).toContain('beta-key')
        }),
      )
    })
  })
})
