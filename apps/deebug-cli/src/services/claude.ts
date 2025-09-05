import { Command } from '@effect/platform'
import type * as CommandExecutor from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { Effect, Schema } from 'effect'
import { logDuration } from '../utils/Effect.js'

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

/**
 * Service for Claude operations using the Claude CLI
 */
export class ClaudeService extends Effect.Service<ClaudeService>()('ClaudeService', {
  effect: Effect.gen(function* () {
    /**
     * Send a prompt to Claude and get the response
     */
    const prompt = (
      input: string,
      options: { model?: string } = {},
    ): Effect.Effect<string, ClaudeError | PlatformError, CommandExecutor.CommandExecutor> =>
      Effect.gen(function* () {
        const args = ['--print', '--output-format', 'json']

        if (options.model) {
          args.push('--model', options.model)
        }

        // Use bash to pipe input to Claude CLI
        const bashCommand = `echo ${JSON.stringify(input)} | claude ${args.join(' ')}`
        const command = Command.make('bash', '-c', bashCommand)

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

    return { prompt } as const
  }),
  dependencies: [],
}) {}
