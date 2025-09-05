import { Command } from '@effect/platform'
import type * as CommandExecutor from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { Effect, Layer, Schema, Stream } from 'effect'
import { logDuration } from '../utils/Effect.ts'
import { LLMError, type LLMOptions, LLMService, type MCPConfig } from './llm.ts'

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

export const ClaudeModel = Schema.Literal('Opus', 'Sonnet')
export type ClaudeModel = typeof ClaudeModel.Type

/**
 * Build Claude CLI command with common options
 */
const buildCommand = (
  input: string,
  options: {
    model?: ClaudeModel
    outputFormat?: 'json' | 'stream-json'
    systemPrompt?: string
    verbose?: boolean
    mcpConfig?: MCPConfig
    workingDir?: string
    skipPermissions?: boolean
  } = {},
) => {
  const args = ['--print']

  if (options.model) {
    args.push('--model', options.model)
  }

  if (options.outputFormat) {
    args.push('--output-format', options.outputFormat)
    if (options.outputFormat === 'stream-json' || options.verbose) {
      args.push('--verbose')
    }
  }

  if (options.systemPrompt) {
    args.push('--append-system-prompt', JSON.stringify(options.systemPrompt))
  }

  if (options.mcpConfig) {
    args.push('--mcp-config', `'${JSON.stringify(options.mcpConfig)}'`)
  }

  if (options.skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  console.log('claude command', `echo ${JSON.stringify(input)} | claude ${args.join(' ')}`)

  const inputEcho = Command.make('echo', JSON.stringify(input))

  return inputEcho.pipe(
    Command.pipeTo(Command.make('claude', ...args)),
    Command.runInShell(true),
    Command.workingDirectory(options.workingDir ?? process.cwd()),
  )
}

/**
 * Send a prompt to Claude and get the response
 */
const prompt = (
  input: string,
  options: LLMOptions = {},
): Effect.Effect<string, LLMError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    // Map LLM options to Claude-specific options
    const model: ClaudeModel = options.useBestModel ? 'Opus' : 'Sonnet'

    const command = buildCommand(input, {
      ...options,
      model,
      outputFormat: 'json',
    })

    const output = yield* Command.string(command).pipe(Effect.withSpan('claude.string'))

    const parsedResponse = yield* Effect.try({
      try: () => JSON.parse(output.trim()),
      catch: (cause) =>
        new LLMError({
          cause,
          message: `Failed to parse Claude CLI JSON response: ${output}`,
        }),
    })

    const validatedResponse = yield* Schema.decodeUnknown(ClaudeResponseSchema)(parsedResponse).pipe(
      Effect.mapError(
        (cause) =>
          new LLMError({
            cause,
            message: 'Claude CLI returned unexpected response format',
          }),
      ),
    )

    if (validatedResponse.is_error) {
      return yield* new LLMError({
        cause: new Error('Claude returned an error response'),
        message: `Claude error: ${validatedResponse.result}`,
      })
    }

    // Claude CLI may wrap JSON in markdown code blocks even with tool usage
    // Extract JSON if it's wrapped in ```json...``` 
    const result = validatedResponse.result.trim()
    const jsonMatch = result.match(/^```json\s*\n([\s\S]*?)\n```$/)
    return jsonMatch?.[1]?.trim() ?? result
  }).pipe(Effect.withSpan('claude.prompt'), logDuration('claude.prompt'))

/**
 * Send a prompt to Claude and stream the response line by line
 */
const promptStream = (
  input: string,
  options: LLMOptions = {},
): Stream.Stream<string, LLMError | PlatformError, CommandExecutor.CommandExecutor> => {
  // Map LLM options to Claude-specific options
  const model: ClaudeModel = options.useBestModel ? 'Opus' : 'Sonnet'

  return Command.streamLines(
    buildCommand(input, {
      ...options,
      model,
      outputFormat: 'stream-json',
    }),
  ).pipe(
    Stream.withSpan('claude.promptStream'),
    Stream.mapError(
      (cause) =>
        new LLMError({
          cause,
          message: 'Failed to stream from Claude CLI',
        }),
    ),
  )
}

/**
 * Claude implementation of the LLM service
 */
export const ClaudeLLMLive = Layer.succeed(LLMService, LLMService.of({ _tag: 'LLMService', prompt, promptStream }))
