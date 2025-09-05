import { Command } from '@effect/platform'
import type * as CommandExecutor from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { Effect, Schema, Stream } from 'effect'
import { logDuration } from '../utils/Effect.ts'


/**
 * Custom error for Codex CLI failures
 */
export class CodexError extends Schema.TaggedError<CodexError>()('CodexError', {
  cause: Schema.Defect,
  message: Schema.String,
  exitCode: Schema.optional(Schema.Number),
}) {}

export const CodexModel = Schema.Literal('gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o3')
export type CodexModel = typeof CodexModel.Type

export const CodexSandboxMode = Schema.Literal('read-only', 'workspace-write', 'danger-full-access')
export type CodexSandboxMode = typeof CodexSandboxMode.Type


/**
 * Service for Codex operations using the Codex CLI
 */
export class CodexService extends Effect.Service<CodexService>()('CodexService', {
  effect: Effect.gen(function* () {
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
        extraArgs?: string[]
      } = {},
    ) => {
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

      // Note: Approval policy is not available in exec mode

      // Working directory
      if (options.workingDir) {
        args.push('--cd', options.workingDir)
      }

      // Skip git repo check for flexibility
      args.push('--skip-git-repo-check')

      // Extra arguments
      if (options.extraArgs) {
        args.push(...options.extraArgs)
      }

      // Add the prompt as the last argument
      args.push(prompt)

      return Command.make('codex', ...args)
    }

    /**
     * Execute a prompt using Codex and get the response
     */
    const execute = (
      prompt: string,
      options: {
        model?: CodexModel
        sandboxMode?: CodexSandboxMode
        workingDir?: string
        extraArgs?: string[]
      } = {},
    ): Effect.Effect<string, CodexError | PlatformError, CommandExecutor.CommandExecutor> =>
      Effect.gen(function* () {
        const command = buildCommand(prompt, { ...options, jsonOutput: true })

        const result = yield* Command.string(command).pipe(
          Effect.withSpan('codex.execute'),
          Effect.mapError((error) =>
            new CodexError({
              cause: error,
              message: `Failed to execute Codex command: ${error}`,
            }),
          ),
        )

        // For JSON output, we need to parse the JSONL (JSON Lines) format
        // Each line is a separate JSON object representing an event
        const lines = result.trim().split('\n').filter((line) => line.trim())
        
        if (lines.length === 0) {
          return yield* Effect.fail(
            new CodexError({
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
     * Execute a prompt using Codex in non-JSON mode for streaming output
     */
    const executeStream = (
      prompt: string,
      options: {
        model?: CodexModel
        sandboxMode?: CodexSandboxMode
        workingDir?: string
        extraArgs?: string[]
      } = {},
    ): Stream.Stream<string, CodexError | PlatformError, CommandExecutor.CommandExecutor> =>
      Command.streamLines(buildCommand(prompt, { ...options, jsonOutput: false })).pipe(
        Stream.withSpan('codex.executeStream'),
        Stream.mapError(
          (cause) =>
            new CodexError({
              cause,
              message: 'Failed to stream from Codex CLI',
            }),
        ),
      )

    /**
     * Execute a simple prompt with safe defaults (read-only sandbox)
     */
    const prompt = (
      input: string,
      options: { model?: CodexModel; workingDir?: string } = {},
    ): Effect.Effect<string, CodexError | PlatformError, CommandExecutor.CommandExecutor> =>
      execute(input, {
        ...options,
        sandboxMode: 'read-only',
      })

    /**
     * Execute a prompt with workspace write access
     */
    const executeWithWorkspaceAccess = (
      input: string,
      options: { model?: CodexModel; workingDir?: string } = {},
    ): Effect.Effect<string, CodexError | PlatformError, CommandExecutor.CommandExecutor> =>
      execute(input, {
        ...options,
        sandboxMode: 'workspace-write',
      })

    return { 
      execute, 
      executeStream, 
      prompt, 
      executeWithWorkspaceAccess 
    } as const
  }),
  dependencies: [],
}) {}