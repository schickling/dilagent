# Dilagent Services Architecture

## Service Dependencies & Data Flow

```
Commands (setup, all, repro, etc.) ───────────────────────────────────────────────────┐
                                                                                      │
Core Services                          LLM Services              Infrastructure       │
┌──────────────┐  ┌─────────────────┐  ┌─────────────────┐      ┌──────────────────┐  │
│ WorkingDir   │  │ StateStore      │  │ LLMService      │      │ FileLogger       │  │
│ - dirs/paths │◄─┤ - state.json    │  │ (interface)     │      │ - logs/*.log     │◄─┤
│ - .dilagent/ │  │ - hypotheses    │  └─┬─────────────┬─┘      └──────────────────┘  │
└──────────────┘  └─────────────────┘    │             │                              │
       │                    │            ▼             ▼                              │
       │          ┌─────────▼───────┐  ┌─────────┐  ┌─────────┐      ┌──────────────┐ │
       │          │ Timeline        │  │ Claude  │  │ Codex   │      │ MCPServer    │ │
       │          │ - timeline.json │  │ Service │  │ Service │      │ - hypothesis │◄┤
       │          │ - events/phases │  │         │  │         │      │   workers    │ │
       │          └─────────────────┘  └─────────┘  └─────────┘      └──────────────┘ │
       │                                                                              │
       ▼                                                                              │
┌──────────────┐                                            ┌─────────────────────┐   │
│ GitManager   │                                            │ FreePort Utility    │◄──┘
│ - worktrees  │                                            │ - port allocation   │
│ - context    │                                            └─────────────────────┘
└──────────────┘

Data Flow:  Core Services ◄─► LLM Services ◄─► Infrastructure
File Ops:   WorkingDir/GitManager ──► FileSystem ──► Artifacts/Logs
```

## Service Specifications

### Core Services

#### WorkingDirService
- **Purpose**: Manages directory structure and paths
- **Key Methods**: `ensureDirectory()`, `paths.*`
- **Creates**: `.dilagent/`, `logs/`, `artifacts/`, `context-repo/`
- **Used by**: All commands

#### StateStore
- **Purpose**: Manages application state and hypothesis tracking
- **Key Methods**: `registerHypothesis()`, `updateHypothesis()`, `setPhase()`
- **Persists**: `state.json` with workflow progress and hypothesis states
- **Used by**: All phases of workflow

#### TimelineService  
- **Purpose**: Records timeline events for debugging and analytics
- **Key Methods**: `recordEvent()`, `getTimeline()`
- **Persists**: `timeline.json` with phase and system events
- **Used by**: Command lifecycle tracking

#### GitManagerService
- **Purpose**: Manages git repositories and worktrees
- **Key Methods**: `setupContextRepo()`, `createHypothesisWorktree()`
- **Creates**: Context repo, hypothesis-specific branches/worktrees
- **Used by**: Setup and hypothesis preparation

### LLM Services

#### LLMService (Interface)
- **Purpose**: Abstraction for different LLM providers
- **Key Methods**: `prompt()`, `parseResponse()`
- **Used by**: All AI-powered operations

#### ClaudeService & CodexService
- **Purpose**: Provider-specific LLM implementations
- **Features**: Rate limiting, model selection, error handling
- **Models**: Claude (Haiku/Sonnet), OpenAI (GPT-4/3.5)

### Infrastructure Services

#### FileLoggerService
- **Purpose**: File-based logging with automatic directory creation
- **Creates**: Log files in `.dilagent/logs/`
- **Formats**: logfmt, JSON

#### MCPServerService
- **Purpose**: Model Context Protocol server for hypothesis workers
- **Features**: Tool exposure, concurrent hypothesis execution
- **Used by**: Hypothesis testing phase

#### FreePortService
- **Purpose**: Allocates free network ports
- **Used by**: MCP server startup

## Key Interactions

1. **Initialization**: WorkingDir → StateStore → Timeline
2. **Setup Phase**: GitManager sets up context repo
3. **Hypothesis Generation**: LLM → StateStore (register) → GitManager (worktrees)
4. **Hypothesis Testing**: MCPServer → LLM → StateStore (results)
5. **Throughout**: Timeline records events, FileLogger captures logs