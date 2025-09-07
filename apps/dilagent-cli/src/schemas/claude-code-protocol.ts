import { Schema } from 'effect'

export const ToolName = Schema.Union(
  Schema.Literal('Task'),
  Schema.Literal('Bash'),
  Schema.Literal('Glob'),
  Schema.Literal('Grep'),
  Schema.Literal('LS'),
  Schema.Literal('ExitPlanMode'),
  Schema.Literal('Read'),
  Schema.Literal('Edit'),
  Schema.Literal('MultiEdit'),
  Schema.Literal('Write'),
  Schema.Literal('NotebookEdit'),
  Schema.Literal('WebFetch'),
  Schema.Literal('TodoWrite'),
  Schema.Literal('WebSearch'),
  Schema.Literal('BashOutput'),
  Schema.Literal('KillBash'),
  Schema.TemplateLiteral(Schema.Literal('mcp__playwright__'), Schema.String),
  Schema.TemplateLiteral(Schema.Literal('mcp__ide__'), Schema.String),
)

export type ToolName = typeof ToolName.Type

export const SlashCommand = Schema.String

export type SlashCommand = typeof SlashCommand.Type

export const McpServer = Schema.Struct({
  name: Schema.String,
  status: Schema.Union(Schema.Literal('connected'), Schema.Literal('disconnected'), Schema.Literal('error')),
})

export type McpServer = typeof McpServer.Type

export const CacheCreation = Schema.Struct({
  ephemeral_1h_input_tokens: Schema.Number,
  ephemeral_5m_input_tokens: Schema.Number,
})

export const ServerToolUse = Schema.Struct({
  web_search_requests: Schema.Number,
})

export const Usage = Schema.Struct({
  input_tokens: Schema.Number,
  cache_creation_input_tokens: Schema.optional(Schema.Number),
  cache_read_input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.Number,
  service_tier: Schema.optional(Schema.Union(Schema.Literal('standard'), Schema.Literal('premium'))),
  cache_creation: Schema.optional(CacheCreation),
  server_tool_use: Schema.optional(ServerToolUse),
})

export type Usage = typeof Usage.Type

export const TextContent = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
})

export type TextContent = typeof TextContent.Type

export const ToolUseContent = Schema.Struct({
  type: Schema.Literal('tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

export type ToolUseContent = typeof ToolUseContent.Type

export const ToolResultContent = Schema.Struct({
  type: Schema.Literal('tool_result'),
  tool_use_id: Schema.String,
  content: Schema.String,
  is_error: Schema.optional(Schema.Boolean),
})

export type ToolResultContent = typeof ToolResultContent.Type

export const MessageContentBlock = Schema.Union(TextContent, ToolUseContent, ToolResultContent)

export type MessageContentBlock = typeof MessageContentBlock.Type

export const MessageContent = Schema.Struct({
  role: Schema.Union(Schema.Literal('user'), Schema.Literal('assistant')),
  content: Schema.Array(MessageContentBlock),
})

export type MessageContent = typeof MessageContent.Type

export const ClaudeMessage = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('message'),
  role: Schema.Union(Schema.Literal('user'), Schema.Literal('assistant')),
  model: Schema.optional(Schema.String),
  content: Schema.Array(MessageContentBlock),
  stop_reason: Schema.optional(Schema.NullOr(Schema.String)),
  stop_sequence: Schema.optional(Schema.NullOr(Schema.String)),
  usage: Schema.optional(Usage),
})

export type ClaudeMessage = typeof ClaudeMessage.Type

export const SystemInitMessage = Schema.Struct({
  type: Schema.Literal('system'),
  subtype: Schema.Literal('init'),
  cwd: Schema.String,
  session_id: Schema.String,
  tools: Schema.Array(ToolName),
  mcp_servers: Schema.Array(McpServer),
  model: Schema.String,
  permissionMode: Schema.Union(
    Schema.Literal('default'),
    Schema.Literal('acceptEdits'),
    Schema.Literal('bypassPermissions'),
    Schema.Literal('plan'),
  ),
  slash_commands: Schema.Array(SlashCommand),
  apiKeySource: Schema.Union(
    Schema.Literal('none'),
    Schema.Literal('user'),
    Schema.Literal('project'),
    Schema.Literal('org'),
    Schema.Literal('temporary'),
  ),
  output_style: Schema.String,
  uuid: Schema.String,
})

export type SystemInitMessage = typeof SystemInitMessage.Type

export const AssistantMessage = Schema.Struct({
  type: Schema.Literal('assistant'),
  message: ClaudeMessage,
  parent_tool_use_id: Schema.NullOr(Schema.String),
  session_id: Schema.String,
  uuid: Schema.String,
})

export type AssistantMessage = typeof AssistantMessage.Type

export const UserMessage = Schema.Struct({
  type: Schema.Literal('user'),
  message: MessageContent,
  parent_tool_use_id: Schema.NullOr(Schema.String),
  session_id: Schema.String,
  uuid: Schema.String,
})

export type UserMessage = typeof UserMessage.Type

export const PermissionDenial = Schema.Struct({
  tool_name: Schema.String,
  tool_use_id: Schema.String,
  tool_input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

export type PermissionDenial = typeof PermissionDenial.Type

export const ResultMessage = Schema.Struct({
  type: Schema.Literal('result'),
  subtype: Schema.Union(
    Schema.Literal('success'),
    Schema.Literal('error'),
    Schema.Literal('error_max_turns'),
    Schema.Literal('error_during_execution'),
  ),
  is_error: Schema.Boolean,
  duration_ms: Schema.Number,
  duration_api_ms: Schema.Number,
  num_turns: Schema.Number,
  result: Schema.String,
  session_id: Schema.String,
  total_cost_usd: Schema.Number,
  usage: Usage,
  permission_denials: Schema.Array(PermissionDenial),
  uuid: Schema.String,
})

export type ResultMessage = typeof ResultMessage.Type

export const ClaudeCodeMessage = Schema.Union(SystemInitMessage, AssistantMessage, UserMessage, ResultMessage)

export type ClaudeCodeMessage = typeof ClaudeCodeMessage.Type
