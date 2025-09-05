export type ToolName =
  | "Task"
  | "Bash"
  | "Glob"
  | "Grep"
  | "LS"
  | "ExitPlanMode"
  | "Read"
  | "Edit"
  | "MultiEdit"
  | "Write"
  | "NotebookEdit"
  | "WebFetch"
  | "TodoWrite"
  | "WebSearch"
  | "BashOutput"
  | "KillBash"
  | `mcp__playwright__${string}`
  | `mcp__ide__${string}`

export type SlashCommand =
  | "fix-ts-issues"
  | "request-research"
  | "add-dir"
  | "agents"
  | "clear"
  | "compact"
  | "config"
  | "context"
  | "cost"
  | "doctor"
  | "exit"
  | "help"
  | "ide"
  | "init"
  | "install-github-app"
  | "mcp"
  | "memory"
  | "migrate-installer"
  | "model"
  | "output-style"
  | "output-style:new"
  | "pr-comments"
  | "release-notes"
  | "resume"
  | "status"
  | "statusline"
  | "todos"
  | "bug"
  | "review"
  | "security-review"
  | "terminal-setup"
  | "upgrade"
  | "vim"
  | "permissions"
  | "privacy-settings"
  | "hooks"
  | "export"
  | "logout"
  | "login"
  | "bashes"

export interface McpServer {
  name: string
  status: "connected" | "disconnected" | "error"
}

export interface Usage {
  input_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens: number
  service_tier?: "standard" | "premium"
  cache_creation?: {
    ephemeral_1h_input_tokens: number
    ephemeral_5m_input_tokens: number
  }
  server_tool_use?: {
    web_search_requests: number
  }
}

// Content block types for Claude messages
export interface TextContent {
  type: "text"
  text: string
}

export interface ToolUseContent {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultContent {
  type: "tool_result"
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type MessageContentBlock = TextContent | ToolUseContent | ToolResultContent

export interface MessageContent {
  role: "user" | "assistant"
  content: MessageContentBlock[]
}

export interface ClaudeMessage {
  id: string
  type: "message"
  role: "user" | "assistant"
  model?: string
  content: MessageContentBlock[]
  stop_reason?: string | null
  stop_sequence?: string | null
  usage?: Usage
}

export interface SystemInitMessage {
  type: "system"
  subtype: "init"
  cwd: string
  session_id: string
  tools: ToolName[]
  mcp_servers: McpServer[]
  model: string
  permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan"
  slash_commands: SlashCommand[]
  apiKeySource: "none" | "user" | "project" | "org" | "temporary"
  output_style: string
  uuid: string
}

export interface AssistantMessage {
  type: "assistant"
  message: ClaudeMessage
  parent_tool_use_id: string | null
  session_id: string
  uuid: string
}

export interface UserMessage {
  type: "user"
  message: MessageContent
  parent_tool_use_id: string | null
  session_id: string
  uuid: string
}

export interface PermissionDenial {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

export interface ResultMessage {
  type: "result"
  subtype: "success" | "error" | "error_max_turns" | "error_during_execution"
  is_error: boolean
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  result?: string
  session_id: string
  total_cost_usd: number
  usage: Usage
  permission_denials: PermissionDenial[]
  uuid: string
}

export type ClaudeCodeMessage =
  | SystemInitMessage
  | AssistantMessage
  | UserMessage
  | ResultMessage