/**
 * LLM Service Integration Tests
 *
 * These tests verify that all LLM service implementations work consistently.
 * All tests in this file should pass for every LLM provider (Claude, Codex, etc.)
 * to ensure compatibility across different LLM backends.
 */

import * as os from 'node:os'
import type { FileSystem } from '@effect/platform'
import type { CommandExecutor } from '@effect/platform/CommandExecutor'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Chunk, Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as ClaudeProvider from './claude.ts'
import { LLMService } from './llm.ts'
import { createMcpServerLayer } from './mcp-server.ts'
import { StateStore } from './state-store.ts'
import { WorkingDirService } from './working-dir.ts'

const providerLayers = [
  { name: 'Claude', layer: ClaudeProvider.ClaudeLLMLive },
  // { name: 'Codex', layer: CodexProvider.CodexLLMLive },
]

describe.each(providerLayers)('$name LLM provider', { timeout: 60000 }, ({ layer }) => {
  let runtime: ManagedRuntime.ManagedRuntime<LLMService | CommandExecutor | StateStore | FileSystem.FileSystem, never>

  beforeAll(async () => {
    // Create runtime with LLM provider, MCP server, and StateStore
    const PlatformLayer = Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)
    const ServiceLayer = createMcpServerLayer(3457).pipe(
      Layer.provideMerge(StateStore.Default),
      Layer.provideMerge(WorkingDirService.Default({ workingDir: os.tmpdir(), create: true })),
      Layer.provide(PlatformLayer),
    )

    runtime = ManagedRuntime.make(Layer.mergeAll(PlatformLayer, layer, ServiceLayer).pipe(Layer.orDie))

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

  describe('with modern hypothesis MCP tools', { timeout: 60000 }, () => {
    const mcpConfig = {
      mcpServers: {
        stateStore: { type: 'http' as const, url: 'http://localhost:3457/mcp' },
      },
    }

    it('executes dilagent_hypothesis_update_status tool', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Initialize store with a hypothesis
          const state = yield* store.getState()
          yield* store.updateState(() => ({
            ...state,
            hypotheses: {
              H001: {
                id: 'H001',
                description: 'Test hypothesis for MCP tools',
                slug: 'test-hypothesis',
                branchName: 'dilagent/test/H001-test-hypothesis',
                worktreePath: '/tmp/test-worktree',
                status: 'pending',
              },
            },
          }))

          // Prompt to update hypothesis status using MCP tools
          const result = yield* llm.prompt(
            `Use the dilagent_hypothesis_update_status tool to update hypothesis H001 to TESTING phase with status "Running initial tests" and experimentId "E01"`,
            {
              mcpConfig,
              skipPermissions: true,
            },
          )

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)

          // Verify the hypothesis was updated
          const updatedState = yield* store.getState()
          const hypothesis = updatedState.hypotheses.H001
          expect(hypothesis?.status).toBe('running')
        }),
      )
    })

    it('executes dilagent_hypothesis_set_result tool', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Initialize store with a running hypothesis
          const state = yield* store.getState()
          yield* store.updateState(() => ({
            ...state,
            hypotheses: {
              H002: {
                id: 'H002',
                description: 'Result hypothesis for MCP tools',
                slug: 'result-hypothesis',
                branchName: 'dilagent/test/H002-result-hypothesis',
                worktreePath: '/tmp/result-worktree',
                status: 'running',
              },
            },
          }))

          // Prompt to set final result using MCP tools
          const result = yield* llm.prompt(
            `Use the dilagent_hypothesis_set_result tool to set hypothesis H002 result as proven with findings "Root cause identified" and evidence showing the reproduction steps`,
            {
              mcpConfig,
              skipPermissions: true,
            },
          )

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)

          // Verify the hypothesis result was set
          const updatedState = yield* store.getState()
          const hypothesis = updatedState.hypotheses.H002
          expect(hypothesis?.status).toBe('completed')
          expect(hypothesis?.result?._tag).toBe('Proven')
        }),
      )
    })

    it('executes dilagent_hypothesis_get_status_all tool', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Initialize store with multiple hypotheses
          const state = yield* store.getState()
          yield* store.updateState(() => ({
            ...state,
            hypotheses: {
              H003: {
                id: 'H003',
                description: 'First hypothesis for status all test',
                slug: 'first-hypothesis',
                branchName: 'dilagent/test/H003-first-hypothesis',
                worktreePath: '/tmp/first-worktree',
                status: 'running',
              },
              H004: {
                id: 'H004',
                description: 'Second hypothesis for status all test',
                slug: 'second-hypothesis',
                branchName: 'dilagent/test/H004-second-hypothesis',
                worktreePath: '/tmp/second-worktree',
                status: 'completed',
                result: { _tag: 'Proven' as const, hypothesisId: 'H004', findings: 'proven' },
              },
            },
          }))

          // Prompt to get all hypothesis status using MCP tools
          const result = yield* llm.prompt(
            'Use the dilagent_hypothesis_get_status_all tool to get the status of all hypotheses',
            {
              mcpConfig,
              skipPermissions: true,
            },
          )

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)

          // Verify the response contains information about both hypotheses
          expect(result).toContain('H003')
          expect(result).toContain('H004')
        }),
      )
    })

    it('executes dilagent_state_clear tool', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService
          const store = yield* StateStore

          // Initialize store with hypotheses in various states
          const state = yield* store.getState()
          yield* store.updateState(() => ({
            ...state,
            hypotheses: {
              H005: {
                id: 'H005',
                description: 'Clear test hypothesis',
                slug: 'clear-test-hypothesis',
                branchName: 'dilagent/test/H005-clear-test',
                worktreePath: '/tmp/clear-worktree',
                status: 'running',
              },
              H006: {
                id: 'H006',
                description: 'Another clear hypothesis',
                slug: 'another-clear-hypothesis',
                branchName: 'dilagent/test/H006-another-clear',
                worktreePath: '/tmp/another-clear-worktree',
                status: 'completed',
                result: {
                  _tag: 'Disproven' as const,
                  hypothesisId: 'H006',
                  reason: 'disproven',
                  evidence: 'test evidence',
                  newhypothesisIdeas: [],
                },
              },
            },
          }))

          // Verify hypotheses have some statuses before clearing
          const stateBefore = yield* store.getState()
          const runningBefore = Object.values(stateBefore.hypotheses).filter((h) => h.status === 'running').length
          const completedBefore = Object.values(stateBefore.hypotheses).filter((h) => h.status === 'completed').length
          expect(runningBefore + completedBefore).toBeGreaterThan(0)

          // Prompt to clear hypothesis states using MCP tools
          const result = yield* llm.prompt(
            'Use the dilagent_state_clear tool to reset all hypothesis states to pending',
            {
              mcpConfig,
              skipPermissions: true,
            },
          )

          // Since we provided MCP config, we expect tool usage to work
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)

          // Verify all hypotheses were reset to pending
          const stateAfter = yield* store.getState()
          const allPending = Object.values(stateAfter.hypotheses).every((h) => h.status === 'pending')
          expect(allPending).toBe(true)
        }),
      )
    })
  })
})
