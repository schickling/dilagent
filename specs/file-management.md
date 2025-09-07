# Dilagent File Management Specification

## Overview

Dilagent manages a structured file hierarchy for hypothesis-driven debugging using git worktrees for isolation while maintaining exceptional visibility into complex, long-running executions. The system uses a read-only context approach with centralized metadata and comprehensive logging.

## Core Principles

1. **Context Immutability**: Original context-dir is never modified directly (snapshot-based)
2. **Git Worktree Isolation**: Each hypothesis runs in its own git worktree
3. **Enhanced Visibility**: Comprehensive logging, status files, and progress tracking
4. **Clear Hierarchy**: Predictable, semantic directory structure with centralized metadata and cannonical file paths
6. **Parallel Execution**: Support for concurrent hypothesis testing

## Directory Structure

```
working-dir/
├── .dilagent/                          # Centralized metadata and visibility
│   ├── config.json                     # Run configuration
│   ├── state.json                      # Live state (auto-flushed from state store)
│   ├── timeline.json                   # Execution timeline and milestones
│   │
│   ├── context-repo/                   # Git repository (branch: `dilagent/${RUN_SLUG}/root`)
│   │   └── [original context files]    # Immutable snapshot
│   │
│   ├── logs/                           # Centralized logging hierarchy
│   │   ├── manager.log                 # Main orchestration log
│   │   ├── reproduction.log            # Reproduction attempt log
│   │   ├── hypothesis-generation.log   # Hypothesis generation log
│   │   └── parallel-execution.log      # Parallel execution coordination
│   │
│   ├── artifacts/                      # Shared artifacts and results
│   │   ├── reproduction.json           # Successful reproduction data
│   │   ├── hypotheses.json             # Generated hypotheses list
│   │   ├── repro.ts                    # Generated reproduction script
│   │   └── summary.md                  # Overall run summary
│   │
│   └── H{NNN}/                         # Hypothesis metadata
│       ├── hypothesis.log              # Hypothesis-specific execution log
│       ├── context.md                  # Problem context for this hypothesis
│       ├── instructions.md             # Hypothesis-specific instructions
│       ├── report.md                   # Agent-generated findings report
│       └── generated-prompt.md         # Generated prompt for this hypothesis
│
└── worktree-H{NNN}-{hypothesis-slug}/  # Git worktree for hypothesis NNN
    └── ...                             # All files in the worktree (including WIP changes)
```

## File Naming Conventions

### Run Identification
- **Run Slug Format**: `{YYYY-MM-DD}-{optional-context-slug}`
- **Examples**:
  - `2025-09-07-auth-bug`
  - `2025-09-07-memory-issue`
  - `2025-09-07` (no context)

### Hypothesis Identification
- **Hypothesis ID**: `H{NNN}` where NNN is zero-padded (H001, H002, H010)
- **Hypothesis Slug**: Auto-generated from description, kebab-case
- **Examples**:
  - "Race condition in state updates" → `race-condition-state-updates`
  - "Memory leak in event handler" → `memory-leak-event-handler`
  - "Type mismatch in Schema validation" → `type-mismatch-schema-validation`
  - "Undefined variable access" → `undefined-variable-access`

### Directory and Branch Naming
- **Worktree Directories**: `worktree-H{NNN}-{hypothesis-slug}`
- **Branch Names**: `dilagent/{run-slug}/H{NNN}-{hypothesis-slug}`
- **Examples**:
  - Directory: `worktree-H001-race-condition-state-updates`
  - Branch: `dilagent/2025-09-07-auth-bug/H001-race-condition-state-updates`

### Log Files
- **Pattern**: `{component}.log` for main logs

## Git Management

### Context Repository Setup

**IMPORTANT**: The original context-dir must never be modified. All Dilagent operations happen in git worktrees to preserve the original directory state.

**If context-dir is already a git repo:**
```bash
# Create worktree at .dilagent/context-repo with new root branch (original repo untouched)
cd <context-dir>
git worktree add -b dilagent/${RUN_SLUG}/root <working-dir>/.dilagent/context-repo HEAD

# Original context-dir remains on its current branch, completely unchanged
# .dilagent/context-repo is now a valid git worktree on the root branch
```

**If context-dir is a normal directory:**
```bash
# Copy to .dilagent/context-repo (original remains untouched) 
cp -r <context-dir> <working-dir>/.dilagent/context-repo
cd <working-dir>/.dilagent/context-repo

# Initialize as git repo in the copy
git init
git add .
git commit -m "Initial context snapshot for Dilagent run ${RUN_SLUG}"

# Create root branch (this directory is already our working copy)
git checkout -b dilagent/${RUN_SLUG}/root

# .dilagent/context-repo is now a valid git repo on the root branch
```

### Worktree Creation

For each hypothesis:
```bash
# Always use .dilagent/context-repo - it's guaranteed to exist and be on root branch
cd <working-dir>/.dilagent/context-repo

# Create hypothesis worktree branching from the current branch (root)
git worktree add -b dilagent/${RUN_SLUG}/H${NNN}-${HYPOTHESIS_SLUG} \
  ../worktree-H${NNN}-${HYPOTHESIS_SLUG} \
  HEAD
```

**Key Points:**
- `.dilagent/context-repo` is ALWAYS the source for worktrees (consistent approach)
- All hypothesis branches originate from `dilagent/${RUN_SLUG}/root`
- Original context-dir is never switched or modified
- Each hypothesis gets an isolated worktree with its own branch
- No path lookups or conditionals needed

## Schemas & Data Structure

All JSON files are backed by comprehensive TypeScript schemas in `apps/dilagent-cli/src/schemas/file-management.ts`:

### Core Schemas
- **`DilagentState`** → `.dilagent/state.json` - Complete run state with all hypothesis status, results, and progress (single source of truth)
- **`DilagentConfig`** → `.dilagent/config.json` - Run configuration and settings
- **`Timeline`** → `.dilagent/timeline.json` - Centralized execution timeline for all events

### Shared Types
- **`HypothesisInfo`** - Core hypothesis structure used throughout
- **`HypothesisStatus`** - Status enum (`pending`, `running`, `completed`, `failed`, `cancelled`)
- **`HypothesisResultStatus`** - Result enum (`proven`, `disproven`, `inconclusive`)
- **`RunPhase`** - Run phase enum (`reproduction`, `hypothesis-generation`, `hypothesis-testing`, `completed`, `failed`)
- **`TimelineEvent`** - Individual timeline events

The schemas eliminate redundancy through shared types and centralize all hypothesis state in `DilagentState`. **Refer to the schema definitions for the complete data structure** - they serve as the definitive specification for all JSON file formats.


## Enhanced Visibility and Logging

### Log File Hierarchy
```
.dilagent/logs/
├── manager.log                 # Main orchestration and coordination
├── reproduction.log            # Reproduction attempts and results
├── hypothesis-generation.log   # Hypothesis generation process
├── parallel-execution.log      # Parallel execution coordination
└── state-flush.log            # State store auto-flush operations
```

### Status Monitoring
- **Centralized state**: All hypothesis status, results, and progress in `.dilagent/state.json` 
- **State updates**: Auto-flushed on each state store change (real-time)
- **Timeline tracking**: `.dilagent/timeline.json` for all execution events (run-level and hypothesis-level)
- **Progress indicators**: Available through `state.json` hypothesis entries
- **Error aggregation**: Centralized in logs and timeline events

### Single Source of Truth
All hypothesis information is centralized in `.dilagent/state.json` including:
- Current status (`pending`, `running`, `completed`, `failed`, `cancelled`)
- Results (`proven`, `disproven`, `inconclusive`)
- Timing (`startedAt`, `completedAt`, `executionTimeMs`)
- Confidence levels and parallel execution tracking

## TODO Items for Implementation

- [ ] **Create GitManager Effect service** for centralized git operations (context repo setup, worktree creation, branch management) ensuring context-dir immutability (needs to implement the `Git Management` section in this file using `Command` from platform)
- [ ] **Implement state store auto-flush mechanism** to automatically sync in-memory state to `.dilagent/state.json` on each change
- [ ] **Build parallel hypothesis execution coordinator** with proper resource management
- [ ] **Implement run slug generation** with date and optional context slugging (YYYY-MM-DD format)
- [ ] **Create centralized Timeline Effect service** for consistent event tracking across all code (run-level and hypothesis-level events)

