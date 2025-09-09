import { Command, type FileSystem } from '@effect/platform'
import type * as CommandExecutor from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { Effect, Layer, Schema, Stream } from 'effect'
import { ClaudeCodeMessage, ResultMessage } from '../schemas/claude-code-protocol.ts'
import { logDuration } from '../utils/Effect.ts'
import { getWriteToLogFile, LLMError, type LLMOptions, LLMService, type MCPConfig } from './llm.ts'

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
  }

  if (options.outputFormat === 'stream-json') {
    args.push('--verbose')
  }

  if (options.systemPrompt) {
    args.push('--append-system-prompt', JSON.stringify(options.systemPrompt))
  }

  if (options.mcpConfig) {
    args.push('--mcp-config', JSON.stringify(options.mcpConfig))
  }

  if (options.skipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  // console.log('claude command', `echo ${JSON.stringify(input)} | claude ${args.join(' ')}`)

  const inputEcho = Command.make('echo', JSON.stringify(input))

  return inputEcho.pipe(
    Command.pipeTo(Command.make('claude', ...args)),
    Command.workingDirectory(options.workingDir ?? process.cwd()),
  )
}

/**
 * Send a prompt to Claude and get the response
 */
const prompt = (
  input: string,
  options: LLMOptions = {},
): Effect.Effect<string, LLMError | PlatformError, CommandExecutor.CommandExecutor | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    // Map LLM options to Claude-specific options
    const model: ClaudeModel = options.useBestModel ? 'Opus' : 'Sonnet'

    yield* Effect.logDebug(`[ClaudeLLMLive] prompt(model: ${model}): ${input.slice(0, 100).replace(/\n/g, ' ')}...`)

    if (options.debugLogPath !== undefined) {
      const writeToLogFile = yield* getWriteToLogFile(options)

      const last = yield* promptStream(input, options).pipe(
        // TODO map to better log output
        Stream.tap(writeToLogFile),
        Stream.mapEffect((_) =>
          Schema.decode(Schema.parseJson(ClaudeCodeMessage), { errors: 'all' })(_).pipe(
            Effect.tapErrorCause((error) =>
              Effect.logWarning(`Failed to parse Claude CLI JSON response. Continuing regardless...`, error),
            ),
            Effect.orElse(() => Schema.decode(Schema.parseJson(Schema.Any as Schema.Schema<ClaudeCodeMessage>))(_)),
          ),
        ),
        // Stream.mapEffect(Schema.decode(Schema.parseJson(ClaudeCodeMessage), { errors: 'all' })),
        Stream.mapError(
          (cause) =>
            new LLMError({
              cause,
              prompt: input,
              note: 'Failed to parse Claude CLI JSON response',
            }),
        ),
        Stream.runLast,
      )

      if (last._tag !== 'Some' || last.value.type !== 'result') {
        return yield* new LLMError({
          cause: new Error('Claude returned an unexpected response format'),
          prompt: input,
          note: `Claude returned an unexpected response format: ${last._tag}`,
        })
      }

      return yield* getJsonResult({ response: last.value, input, output: last.value.result })
    }

    const command = buildCommand(input, {
      ...options,
      model,
      outputFormat: 'json',
    })

    const output = yield* Command.string(command).pipe(Effect.withSpan('claude.string'))

    const jsonResponse = yield* Effect.try({
      try: () => JSON.parse(output.trim()),
      catch: (cause) =>
        new LLMError({
          cause,
          prompt: input,
          note: `Failed to parse Claude CLI JSON response: ${output}`,
          rawResponse: output,
        }),
    })

    const validatedResponse = yield* Schema.decodeUnknown(ResultMessage)(jsonResponse).pipe(
      Effect.mapError(
        (cause) =>
          new LLMError({
            cause,
            prompt: input,
            note: 'Claude CLI returned unexpected response format',
            rawResponse: output,
          }),
      ),
    )

    return yield* getJsonResult({ response: validatedResponse, input, output })
  }).pipe(Effect.withSpan('claude.prompt'), logDuration('[ClaudeLLMLive] prompt'), Effect.scoped)

/**
 * Send a prompt to Claude and stream the response line by line
 */
const promptStream = (
  input: string,
  options: LLMOptions = {},
): Stream.Stream<string, LLMError | PlatformError, CommandExecutor.CommandExecutor | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    // Map LLM options to Claude-specific options
    const model: ClaudeModel = options.useBestModel ? 'Opus' : 'Sonnet'

    const writeToLogFile = yield* getWriteToLogFile(options)

    return Command.streamLines(
      buildCommand(input, {
        ...options,
        model,
        outputFormat: 'stream-json',
      }),
    ).pipe(
      Stream.tap(writeToLogFile),
      Stream.withSpan('claude.promptStream'),
      Stream.mapError(
        (cause) =>
          new LLMError({
            cause,
            note: 'Failed to stream from Claude CLI',
            prompt: input,
          }),
      ),
    )
  }).pipe(Stream.unwrapScoped)

/**
 * Claude implementation of the LLM service
 */
export const ClaudeLLMLive = Layer.succeed(LLMService, LLMService.of({ _tag: 'LLMService', prompt, promptStream }))

const getJsonResult = ({ response, input, output }: { response: ResultMessage; input: string; output: string }) =>
  Effect.gen(function* () {
    if (response.is_error) {
      return yield* new LLMError({
        cause: new Error('Claude returned an error response'),
        note: `Claude error: ${response.result}`,
        prompt: input,
        rawResponse: output,
      })
    }

    return response.result
  })
