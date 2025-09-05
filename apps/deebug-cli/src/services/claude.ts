import { Command } from '@effect/platform'
import type * as CommandExecutor from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { Effect, Schema, Stream } from 'effect'
import type { ClaudeCodeMessage } from '../types/claude-code-protocol.ts'
import { logDuration } from '../utils/Effect.ts'

/**
 * Claude CLI response schema
 */
const ClaudeResponseSchema = Schema.Struct({
  type: Schema.Literal('result'),
  subtype: Schema.Literal('success'),
  is_error: Schema.Boolean,
  result: Schema.String,
  session_id: Schema.String,
  total_cost_usd: Schema.Number,
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
  }),
})

/**
 * Custom error for Claude CLI failures
 */
export class ClaudeError extends Schema.TaggedError<ClaudeError>()('ClaudeError', {
  cause: Schema.Defect,
  message: Schema.String,
  exitCode: Schema.optional(Schema.Number),
}) {}

export const ClaudeModel = Schema.Literal('Opus', 'Sonnet')
export type ClaudeModel = typeof ClaudeModel.Type

/**
 * Service for Claude operations using the Claude CLI
 */
export class ClaudeService extends Effect.Service<ClaudeService>()('ClaudeService', {
  effect: Effect.gen(function* () {
    /**
     * Build Claude CLI command with common options
     */
    const buildCommand = (
      input: string,
      options: { model?: ClaudeModel; extraArgs?: string[]; outputFormat?: 'json' | 'stream-json' } = {},
    ) => {
      const args = ['--print']

      if (options.model) {
        args.push('--model', options.model)
      }

      if (options.outputFormat) {
        args.push('--output-format', options.outputFormat)
        if (options.outputFormat === 'stream-json') {
          args.push('--verbose')
        }
      }

      if (options.extraArgs) {
        args.push(...options.extraArgs)
      }

      // Use bash to pipe input to Claude CLI
      const bashCommand = `echo ${JSON.stringify(input)} | claude ${args.join(' ')}`
      console.log('bashCommand', bashCommand)
      return Command.make('bash', '-c', bashCommand)
    }

    /**
     * Send a prompt to Claude and get the response
     */
    const prompt = (
      input: string,
      options: { model?: ClaudeModel; extraArgs?: string[] } = {},
    ): Effect.Effect<string, ClaudeError | PlatformError, CommandExecutor.CommandExecutor> =>
      Effect.gen(function* () {
        const command = buildCommand(input, { ...options, outputFormat: 'json' })

        const output = yield* Command.string(command).pipe(Effect.withSpan('claude.string'))

        const parsedResponse = yield* Effect.try({
          try: () => JSON.parse(output.trim()),
          catch: (cause) =>
            new ClaudeError({
              cause,
              message: `Failed to parse Claude CLI JSON response: ${output}`,
            }),
        })

        const validatedResponse = yield* Schema.decodeUnknown(ClaudeResponseSchema)(parsedResponse).pipe(
          Effect.mapError(
            (cause) =>
              new ClaudeError({
                cause,
                message: 'Claude CLI returned unexpected response format',
              }),
          ),
        )

        if (validatedResponse.is_error) {
          return yield* Effect.fail(
            new ClaudeError({
              cause: new Error('Claude returned an error response'),
              message: `Claude error: ${validatedResponse.result}`,
            }),
          )
        }

        return validatedResponse.result
      }).pipe(Effect.withSpan('claude.prompt'), logDuration('claude.prompt'))

    /**
     * Send a prompt to Claude and stream the response line by line
     */
    const promptStream = (
      input: string,
      options: { model?: ClaudeModel; extraArgs?: string[] } = {},
    ): Stream.Stream<ClaudeCodeMessage, ClaudeError | PlatformError, CommandExecutor.CommandExecutor> =>
      Command.streamLines(buildCommand(input, { ...options, outputFormat: 'stream-json' })).pipe(
        Stream.map((_) => JSON.parse(_) as ClaudeCodeMessage),
        Stream.withSpan('claude.promptStream'),
        Stream.mapError(
          (cause) =>
            new ClaudeError({
              cause,
              message: 'Failed to stream from Claude CLI',
            }),
        ),
      )

    return { prompt, promptStream } as const
  }),
  dependencies: [],
}) {}
