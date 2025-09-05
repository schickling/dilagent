import { Command } from '@effect/platform'
import type { CommandExecutor } from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { NodeContext } from '@effect/platform-node'
import { Chunk, Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as ClaudeProvider from './claude.ts'
import * as CodexProvider from './codex.ts'
import { type LLMError, LLMService } from './llm.ts'

const providerLayers = [
  { name: 'Claude', layer: ClaudeProvider.ClaudeLLMLive },
  // { name: 'Codex', layer: CodexProvider.CodexLLMLive },
]

describe.each(providerLayers)('$name LLM provider', { timeout: 60000 }, ({ layer }) => {
  let runtime: ManagedRuntime.ManagedRuntime<LLMService | CommandExecutor, LLMError | PlatformError>

  beforeAll(async () => {
    runtime = ManagedRuntime.make(layer.pipe(Layer.provideMerge(NodeContext.layer), Layer.orDie))
    // Eagerly start the runtime
    await runtime.runPromise(Effect.void)
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
        expect(result.toLowerCase()).toContain('testbot')
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

  it('handles verbose output option', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('Brief response please', {
          verbose: true,
        })
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      }),
    )
  }, 15000)
})

// Provider-specific tests
describe('Codex-specific features', { timeout: 30000 }, () => {
  let runtime: ManagedRuntime.ManagedRuntime<LLMService | CommandExecutor, LLMError | PlatformError>

  beforeAll(async () => {
    runtime = ManagedRuntime.make(CodexProvider.CodexLLMLive.pipe(Layer.provideMerge(NodeContext.layer), Layer.orDie))
    await runtime.runPromise(Effect.void)
  })

  afterAll(async () => await runtime.dispose())

  it('respects sandbox modes', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('What can you do in read-only mode?', {
          skipPermissions: true,
        })
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      }),
    )
  }, 15000)

  it('handles workspace-write sandbox mode', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService
        const result = yield* llm.prompt('List current directory contents', {
          skipPermissions: false,
        })
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      }),
    )
  }, 15000)
})
