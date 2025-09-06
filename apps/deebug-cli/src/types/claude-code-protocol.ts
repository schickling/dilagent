import { Schema } from 'effect'

export const ToolNameSchema = Schema.Union(
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

export type ToolName = typeof ToolNameSchema.Type

export const SlashCommandSchema = Schema.Union(
  Schema.Literal('fix-ts-issues'),
  Schema.Literal('request-research'),
  Schema.Literal('add-dir'),
  Schema.Literal('agents'),
  Schema.Literal('clear'),
  Schema.Literal('compact'),
  Schema.Literal('config'),
  Schema.Literal('context'),
  Schema.Literal('cost'),
  Schema.Literal('doctor'),
  Schema.Literal('exit'),
  Schema.Literal('help'),
  Schema.Literal('ide'),
  Schema.Literal('init'),
  Schema.Literal('install-github-app'),
  Schema.Literal('mcp'),
  Schema.Literal('memory'),
  Schema.Literal('migrate-installer'),
  Schema.Literal('model'),
  Schema.Literal('output-style'),
  Schema.Literal('output-style:new'),
  Schema.Literal('pr-comments'),
  Schema.Literal('release-notes'),
  Schema.Literal('resume'),
  Schema.Literal('status'),
  Schema.Literal('statusline'),
  Schema.Literal('todos'),
  Schema.Literal('bug'),
  Schema.Literal('review'),
  Schema.Literal('security-review'),
  Schema.Literal('terminal-setup'),
  Schema.Literal('upgrade'),
  Schema.Literal('vim'),
  Schema.Literal('permissions'),
  Schema.Literal('privacy-settings'),
  Schema.Literal('hooks'),
  Schema.Literal('export'),
  Schema.Literal('logout'),
  Schema.Literal('login'),
  Schema.Literal('bashes'),
)

export type SlashCommand = typeof SlashCommandSchema.Type

export const McpServerSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.Union(Schema.Literal('connected'), Schema.Literal('disconnected'), Schema.Literal('error')),
})

export type McpServer = typeof McpServerSchema.Type

export const CacheCreationSchema = Schema.Struct({
  ephemeral_1h_input_tokens: Schema.Number,
  ephemeral_5m_input_tokens: Schema.Number,
})

export const ServerToolUseSchema = Schema.Struct({
  web_search_requests: Schema.Number,
})

export const UsageSchema = Schema.Struct({
  input_tokens: Schema.Number,
  cache_creation_input_tokens: Schema.optional(Schema.Number),
  cache_read_input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.Number,
  service_tier: Schema.optional(Schema.Union(Schema.Literal('standard'), Schema.Literal('premium'))),
  cache_creation: Schema.optional(CacheCreationSchema),
  server_tool_use: Schema.optional(ServerToolUseSchema),
})

export type Usage = typeof UsageSchema.Type

export const TextContentSchema = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
})

export type TextContent = typeof TextContentSchema.Type

export const ToolUseContentSchema = Schema.Struct({
  type: Schema.Literal('tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

export type ToolUseContent = typeof ToolUseContentSchema.Type

export const ToolResultContentSchema = Schema.Struct({
  type: Schema.Literal('tool_result'),
  tool_use_id: Schema.String,
  content: Schema.String,
  is_error: Schema.optional(Schema.Boolean),
})

export type ToolResultContent = typeof ToolResultContentSchema.Type

export const MessageContentBlockSchema = Schema.Union(TextContentSchema, ToolUseContentSchema, ToolResultContentSchema)

export type MessageContentBlock = typeof MessageContentBlockSchema.Type

export const MessageContentSchema = Schema.Struct({
  role: Schema.Union(Schema.Literal('user'), Schema.Literal('assistant')),
  content: Schema.Array(MessageContentBlockSchema),
})

export type MessageContent = typeof MessageContentSchema.Type

export const ClaudeMessageSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('message'),
  role: Schema.Union(Schema.Literal('user'), Schema.Literal('assistant')),
  model: Schema.optional(Schema.String),
  content: Schema.Array(MessageContentBlockSchema),
  stop_reason: Schema.optional(Schema.NullOr(Schema.String)),
  stop_sequence: Schema.optional(Schema.NullOr(Schema.String)),
  usage: Schema.optional(UsageSchema),
})

export type ClaudeMessage = typeof ClaudeMessageSchema.Type

export const SystemInitMessageSchema = Schema.Struct({
  type: Schema.Literal('system'),
  subtype: Schema.Literal('init'),
  cwd: Schema.String,
  session_id: Schema.String,
  tools: Schema.Array(ToolNameSchema),
  mcp_servers: Schema.Array(McpServerSchema),
  model: Schema.String,
  permissionMode: Schema.Union(
    Schema.Literal('default'),
    Schema.Literal('acceptEdits'),
    Schema.Literal('bypassPermissions'),
    Schema.Literal('plan'),
  ),
  slash_commands: Schema.Array(SlashCommandSchema),
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

export type SystemInitMessage = typeof SystemInitMessageSchema.Type

export const AssistantMessageSchema = Schema.Struct({
  type: Schema.Literal('assistant'),
  message: ClaudeMessageSchema,
  parent_tool_use_id: Schema.NullOr(Schema.String),
  session_id: Schema.String,
  uuid: Schema.String,
})

export type AssistantMessage = typeof AssistantMessageSchema.Type

export const UserMessageSchema = Schema.Struct({
  type: Schema.Literal('user'),
  message: MessageContentSchema,
  parent_tool_use_id: Schema.NullOr(Schema.String),
  session_id: Schema.String,
  uuid: Schema.String,
})

export type UserMessage = typeof UserMessageSchema.Type

export const PermissionDenialSchema = Schema.Struct({
  tool_name: Schema.String,
  tool_use_id: Schema.String,
  tool_input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

export type PermissionDenial = typeof PermissionDenialSchema.Type

export const ResultMessageSchema = Schema.Struct({
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
  usage: UsageSchema,
  permission_denials: Schema.Array(PermissionDenialSchema),
  uuid: Schema.String,
})

export type ResultMessage = typeof ResultMessageSchema.Type

export const ClaudeCodeMessageSchema = Schema.Union(
  SystemInitMessageSchema,
  AssistantMessageSchema,
  UserMessageSchema,
  ResultMessageSchema,
)

export type ClaudeCodeMessage = typeof ClaudeCodeMessageSchema.Type
