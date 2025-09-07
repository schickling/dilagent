import type * as CommandExecutor from '@effect/platform/CommandExecutor'
import type { PlatformError } from '@effect/platform/Error'
import { Context, type Effect, Schema, type Stream } from 'effect'

/**
 * Common error for LLM service failures
 */
export class LLMError extends Schema.TaggedError<LLMError>()('LLMError', {
  cause: Schema.Defect,
  note: Schema.String,
  prompt: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  rawResponse: Schema.optional(Schema.String),
}) {}

/**
 * MCP (Model Context Protocol) configuration
 */
export interface MCPConfig {
  mcpServers?: Record<
    string,
    | {
        type: 'http'
        url: string
      }
    | {
        type: 'stdio'
        command: string
        args: string[]
      }
  >
  [key: string]: unknown
}

/**
 * Options for LLM operations
 */
export interface LLMOptions {
  /** Use the best available model for this LLM provider */
  useBestModel?: boolean
  /** Additional system prompt to append */
  systemPrompt?: string
  /** Working directory for execution */
  workingDir?: string
  /** Skip permissions check  */
  skipPermissions?: boolean
  /** MCP configuration */
  mcpConfig?: MCPConfig
  /** Path to debug log file */
  debugLogPath?: string
}

/**
 * Unified LLM service interface
 *
 * This interface abstracts over different LLM CLI tools (Claude, Codex, etc.)
 * providing a consistent API for prompt execution.
 */
export interface LLMService {
  readonly _tag: 'LLMService'

  /**
   * Send a prompt to the LLM and get the response
   */
  prompt(
    input: string,
    options?: LLMOptions,
  ): Effect.Effect<string, LLMError | PlatformError, CommandExecutor.CommandExecutor>

  /**
   * Send a prompt to the LLM and stream the response
   */
  promptStream(
    input: string,
    options?: LLMOptions,
  ): Stream.Stream<string, LLMError | PlatformError, CommandExecutor.CommandExecutor>
}

/**
 * Context tag for the LLM service
 */
export const LLMService = Context.GenericTag<LLMService>('LLMService')
