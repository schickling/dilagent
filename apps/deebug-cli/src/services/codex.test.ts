import { NodeContext } from '@effect/platform-node'
import { Chunk, Effect, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { CodexService } from './codex.ts'

describe('CodexService', () => {
  const runPromise = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    // @ts-expect-error - Effect.provide handles dependencies correctly at runtime
    Effect.runPromise(effect.pipe(Effect.provide(CodexService.Default), Effect.provide(NodeContext.layer)))

  it('should successfully execute a simple prompt and return response', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.prompt('What is 2+2?')
      return result
    })

    // Since we're testing against the actual Codex CLI, this is an integration test
    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  }, 15000) // Increased timeout for API call

  it('should handle model selection option', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.prompt('What is 3+3?', { model: 'gpt-4' })
      return result
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result).toContain('6')
  }, 15000)

  it('should execute with workspace access', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.executeWithWorkspaceAccess('List the files in the current directory using ls command')
      return result
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  }, 15000)

  it('should handle working directory option', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.prompt('What directory am I in?', { 
        workingDir: '/tmp'
      })
      return result
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  }, 15000)

  it('should execute custom command with specific options', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.execute('Tell me a short joke', {
        model: 'gpt-4',
        sandboxMode: 'read-only',
      })
      return result
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  }, 15000)

  it('should validate response for simple math questions', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.prompt('Calculate 5*5')
      return result
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result).toContain('25')
  }, 15000)

  it('should handle minimal prompts', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.prompt('Hi')
      return result
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  }, 15000)

  describe('executeStream', () => {

    it('should stream response lines', async () => {
      const program = Effect.gen(function* () {
        const codex = yield* CodexService
        const stream = codex.executeStream('Count from 1 to 3, each number on a new line')
        const chunks = yield* Stream.runCollect(stream)
        return chunks
      })

      const result = await runPromise(program)
      expect(Chunk.size(result)).toBeGreaterThan(0)
      const lines = Chunk.toReadonlyArray(result)
      lines.forEach((line) => {
        expect(typeof line).toBe('string')
      })
    }, 20000)

    it('should handle model selection in streaming', async () => {
      const program = Effect.gen(function* () {
        const codex = yield* CodexService
        const stream = codex.executeStream('What is 7+7?', { model: 'gpt-4' })
        const chunks = yield* Stream.runCollect(stream)
        return chunks
      })

      const result = await runPromise(program)
      expect(Chunk.size(result)).toBeGreaterThan(0)
      const lines = Chunk.toReadonlyArray(result)
      const fullResponse = lines.join('')
      expect(fullResponse).toContain('14')
    }, 20000)

    it('should handle minimal stream input', async () => {
      const program = Effect.gen(function* () {
        const codex = yield* CodexService
        const stream = codex.executeStream('Hello')
        const chunks = yield* Stream.runCollect(stream)
        return chunks
      })

      const result = await runPromise(program)
      expect(Chunk.isChunk(result)).toBe(true)
      expect(Chunk.size(result)).toBeGreaterThan(0)
    }, 20000)

    it('should stream multiple lines from longer responses', async () => {
      const program = Effect.gen(function* () {
        const codex = yield* CodexService
        const stream = codex.executeStream('Write a short haiku about programming')
        const chunks = yield* Stream.runCollect(stream)
        return chunks
      })

      const result = await runPromise(program)
      expect(Chunk.size(result)).toBeGreaterThan(0)
      const lines = Chunk.toReadonlyArray(result)
      lines.forEach((line) => {
        expect(typeof line).toBe('string')
      })
    }, 20000)
  })

  it('should handle different sandbox modes', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      const result = yield* codex.execute('What can I do in read-only mode?', {
        sandboxMode: 'read-only',
      })
      return result
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  }, 15000)

  // Error handling test
  it('should handle Codex CLI errors gracefully', async () => {
    const program = Effect.gen(function* () {
      const codex = yield* CodexService
      // This might fail depending on Codex CLI behavior with invalid models
      try {
        const result = yield* codex.execute('Hello', { 
          model: 'invalid-model' as any,
          sandboxMode: 'read-only',
        })
        return result
      } catch {
        // If it throws an error, that's expected behavior
        return 'error handled'
      }
    })

    const result = await runPromise(program)
    expect(typeof result).toBe('string')
  }, 15000)
})