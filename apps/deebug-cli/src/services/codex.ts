import { Command, type CommandExecutor } from '@effect/platform'
import type { PlatformError } from '@effect/platform/Error'
import { Effect, Layer, Schema, Stream } from 'effect'
import { logDuration } from '../utils/Effect.ts'
import { LLMError, type LLMOptions, LLMService } from './llm.ts'

export const CodexModel = Schema.Literal('gpt-5-high', 'gpt-5-medium', 'gpt-5-low', 'gpt-5-minimal')
export type CodexModel = typeof CodexModel.Type

export const CodexSandboxMode = Schema.Literal('read-only', 'workspace-write', 'danger-full-access')
export type CodexSandboxMode = typeof CodexSandboxMode.Type

/**
 * Check if a directory is within a git repository
 */
const isInGitRepo = (dir: string): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const result = yield* Command.make('git', 'rev-parse', '--git-dir').pipe(
      Command.workingDirectory(dir),
      Command.exitCode,
      Effect.catchAll(() => Effect.succeed(1)),
    )
    return result === 0
  })

/**
 * Build Codex CLI command with common options
 */
const buildCommand = (
  prompt: string,
  options: {
    model?: CodexModel
    sandboxMode?: CodexSandboxMode
    workingDir?: string
    jsonOutput?: boolean
    systemPrompt?: string
    mcpConfig?: import('./llm.ts').MCPConfig
  } = {},
): Effect.Effect<Command.Command, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const args = ['exec']

    // Add JSON output format for programmatic usage
    if (options.jsonOutput) {
      args.push('--json')
    }

    // Model selection
    if (options.model) {
      args.push('--model', options.model)
    }

    // Sandbox mode
    if (options.sandboxMode) {
      args.push('--sandbox', options.sandboxMode)
    }

    // Working directory
    if (options.workingDir) {
      args.push('--cd', options.workingDir)
    }

    // System prompt support via config override
    if (options.systemPrompt) {
      args.push('-c', `system_prompt=${JSON.stringify(options.systemPrompt)}`)
    }

    // MCP configuration support via --config flag
    if (options.mcpConfig) {
      args.push('--config', JSON.stringify(options.mcpConfig))
    }

    // Auto-detect git repo and add skip flag if needed
    const workingDir = options.workingDir ?? process.cwd()
    const inGitRepo = yield* isInGitRepo(workingDir)
    if (!inGitRepo) {
      args.push('--skip-git-repo-check')
    }

    // Add the prompt as the last argument
    args.push(prompt)

    return Command.make('codex', ...args)
  })

/**
 * Send a prompt to Codex and get the response
 */
const prompt = (
  input: string,
  options: LLMOptions = {},
): Effect.Effect<string, LLMError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    // Map LLM options to Codex-specific options
    const model: CodexModel = options.useBestModel ? 'gpt-5-high' : 'gpt-5-medium'
    const sandboxMode: CodexSandboxMode = options.sandboxMode ?? 'read-only'

    const command = yield* buildCommand(input, {
      model,
      sandboxMode,
      ...(options.workingDir && { workingDir: options.workingDir }),
      jsonOutput: true,
      ...(options.systemPrompt && { systemPrompt: options.systemPrompt }),
      ...(options.mcpConfig && { mcpConfig: options.mcpConfig }),
    })

    const result = yield* Command.string(command).pipe(
      Effect.withSpan('codex.execute'),
      Effect.mapError(
        (error) =>
          new LLMError({
            cause: error,
            message: `Failed to execute Codex command: ${error}`,
          }),
      ),
    )

    // For JSON output, we need to parse the JSONL (JSON Lines) format
    // Each line is a separate JSON object representing an event
    const lines = result
      .trim()
      .split('\n')
      .filter((line) => line.trim())

    if (lines.length === 0) {
      return yield* Effect.fail(
        new LLMError({
          cause: new Error('Empty response from Codex CLI'),
          message: 'Codex CLI returned empty response',
        }),
      )
    }

    // Find the last message or result from the JSON events
    let finalResult = ''
    for (const line of lines) {
      try {
        const event = JSON.parse(line)

        // Look for agent_message type with message field
        if (event.msg?.type === 'agent_message' && event.msg.message) {
          finalResult = event.msg.message
        }
        // Fallback to other possible message formats
        else if (event.content) {
          finalResult = event.content
        } else if (event.message) {
          finalResult = event.message
        } else if (event.result) {
          finalResult = event.result
        }
      } catch {
        // If JSON parsing fails, treat the line as plain text
        finalResult = line
      }
    }

    return finalResult || result
  }).pipe(Effect.withSpan('codex.execute'), logDuration('codex.execute'))

/**
 * Send a prompt to Codex and stream the response
 */
const promptStream = (
  input: string,
  options: LLMOptions = {},
): Stream.Stream<string, LLMError | PlatformError, CommandExecutor.CommandExecutor> =>
  Stream.fromEffect(
    Effect.gen(function* () {
      // Map LLM options to Codex-specific options
      const model: CodexModel = options.useBestModel ? 'gpt-5-high' : 'gpt-5-medium'
      const sandboxMode: CodexSandboxMode = options.sandboxMode ?? 'read-only'

      return yield* buildCommand(input, {
        model,
        sandboxMode,
        ...(options.workingDir && { workingDir: options.workingDir }),
        jsonOutput: false, // Non-JSON for streaming
        ...(options.systemPrompt && { systemPrompt: options.systemPrompt }),
        ...(options.mcpConfig && { mcpConfig: options.mcpConfig }),
      })
    }),
  ).pipe(
    Stream.flatMap((command) =>
      Command.streamLines(command).pipe(
        Stream.withSpan('codex.executeStream'),
        Stream.mapError(
          (cause) =>
            new LLMError({
              cause,
              message: 'Failed to stream from Codex CLI',
            }),
        ),
      ),
    ),
  )

/**
 * Codex implementation of the LLM service
 */
export const CodexLLMLive = Layer.succeed(LLMService, LLMService.of({ _tag: 'LLMService', prompt, promptStream }))
