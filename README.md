<img src="https://gitbucket.schickling.dev/api/get/32330263261d8466bc8146badc9dabbcdbf3425a046486097f62f47c10b9cf96" alt="" height="200"/>

# dilagent 🔍

**Agentic root cause analysis through hypothesis-driven debugging**

dilagent automates the tedious process of reproducing, diagnosing, and fixing bugs through systematic hypothesis testing and experimentation. It combines LLM agents with structured scientific methodology to identify root causes and validate fixes.

## When to Use dilagent

**Ideal for:**
- Complex, hard-to-reproduce bugs (race conditions, timing issues)
- Performance regressions without obvious cause
- Issues that occur only in specific environments
- Bugs with multiple potential root causes
- Intermittent or flaky test failures

**Not suitable for:**
- Simple syntax errors or compilation issues
- Obvious logic errors that are easily spotted
- Issues with clear error messages pointing to the problem

## How It Works

dilagent follows a structured, multi-stage approach to debugging:

### 1. 🔬 Reproduction Stage
First, dilagent attempts to reproduce the issue:
- Creates minimal reproducible test cases (`repro.ts`)
- Measures timing characteristics (performance, timeouts, race conditions)
- Documents setup requirements
- Asks clarifying questions when needed

### 2. 🧠 Hypothesis Generation  
Based on successful reproduction, dilagent generates targeted hypotheses:
- Analyzes reproduction data and codebase context
- Creates multiple hypotheses (H001, H002, H003...)
- Tailors hypotheses to the type of issue (performance, concurrency, logic)
- Outputs structured `hypotheses.json` for tracking

### 3. 🧪 Hypothesis Testing
Each hypothesis is tested in parallel:
- Independent testing in isolated worktrees
- Each hypothesis can result in:
  - ✅ **Proven**: Root cause identified
  - ❌ **Disproven**: Not the issue, move on
  - ❓ **Inconclusive**: Requires additional data
- Counter-experiments validate findings

### 4. 💬 Interactive Exploration (Optional)
For complex issues requiring human insight:
- REPL-based interactive debugging session
- Agent-assisted exploration with full context
- Direct manipulation and testing

The process continues iteratively until the root cause is found and validated.

## System Architecture

### Overall Manager Flow
![System Overview](./diagrams/manager-flow.svg)

### Hypothesis Testing Loop
![Hypothesis Loop](./diagrams/hypothesis-loop.svg)

## Key Features

- **Automated Reproduction**: Generates minimal test cases from bug reports
- **Parallel Hypothesis Testing**: Tests multiple theories simultaneously in isolated environments
- **Counter-Experiment Validation**: Prevents false positives through negative testing
- **Interactive Fallback**: REPL mode for complex cases requiring human expertise
- **Evidence-Based**: Every conclusion backed by reproducible experiments
- **MCP Integration**: Leverages Model Context Protocol for tool orchestration

## Workflow Stages & Key Files

### Stage 0: Setup
```bash
dilagent manager setup --working-directory ./debug-session --context-directory ./my-project
```
- Creates `.dilagent/` directory structure
- Generates `context.md` with codebase information and issue description

### Stage 1: Reproduce
```bash
dilagent manager repro --working-directory ./debug-session --llm claude
```
- Creates `reproduction.md` with steps to reproduce the issue
- Generates diagnostic information and error details

### Stage 2: Generate Hypotheses
```bash
dilagent manager generate-hypotheses --working-directory ./debug-session --count 3 --llm claude
```
- Creates numbered hypothesis directories: `H001-config-issue/`, `H002-race-condition/`, etc.
- Each contains:
  - `hypothesis.md` - The specific theory about the bug
  - `instructions.md` - Steps to test the hypothesis

### Stage 3: Test Hypotheses
```bash
dilagent manager run-hypotheses --working-directory ./debug-session --llm claude
```
- Creates git worktrees for parallel testing (e.g., `worktree-H001-config-issue/`)
- AI agents test each hypothesis independently
- Updates `report.md` in each hypothesis directory with findings
- Logs stored in `.dilagent/H{NNN}-{slug}/hypothesis.log`

![](https://share.cleanshot.com/Khr4vWlL+)

<details>
<summary><strong>Example report.md output</strong> (click to expand)</summary>

```markdown
# Hypothesis H003: Race Condition in Connection Pool

## Status: ✅ PROVEN

## Initial Analysis
The intermittent timeout errors in production suggested a potential race condition
in the database connection pool management. The error pattern showed:
- Errors occur only under high concurrent load (>100 req/s)  
- Error rate increases exponentially with load
- Database logs show connection pool exhaustion messages
- Issue started appearing after the connection pooling refactor in commit abc123

## Investigation Steps

### Step 1: Reproduce the Issue
Created load test script that successfully reproduced the issue:
```bash
# Load test that triggers the race condition
ab -n 10000 -c 50 http://localhost:3000/api/users/search
# Result: 3.2% failure rate with "connection pool timeout" errors
```

### Step 2: Code Analysis
Identified suspicious code in `src/db/pool.ts:42-58`:
```typescript
// PROBLEMATIC: Race condition between check and increment
if (this.activeConnections < this.maxConnections) {
  // Gap here - another request could increment activeConnections
  this.activeConnections++;
  return this.createConnection();
}
```

### Step 3: Root Cause Identification
The race condition occurs when multiple requests simultaneously:
1. Check `activeConnections < maxConnections` (both see same value)
2. Both increment `activeConnections` 
3. Both attempt to create connections
4. Total connections exceed `maxConnections`
5. Database rejects excess connections
6. Pool state becomes inconsistent

## Fix Applied
Implemented atomic operation using mutex lock:
```typescript
// FIXED: Atomic check-and-increment
async acquireConnection(): Promise<Connection> {
  return this.mutex.acquire(async () => {
    if (this.activeConnections >= this.maxConnections) {
      throw new PoolExhaustedError();
    }
    this.activeConnections++;
    return this.createConnection();
  });
}
```

## Validation Results

### Load Testing
- ✅ 10,000 requests at 50 concurrent: 0% failure rate
- ✅ 50,000 requests at 200 concurrent: 0% failure rate  
- ✅ Connection count never exceeds maxConnections under load

### Code Review
- ✅ All database operations now use atomic operations
- ✅ Added connection pool metrics and monitoring
- ✅ Updated connection pool tests to include concurrency scenarios

### Counter-Experiments
- ✅ Reverting to old code: Issue reproduces immediately
- ✅ Artificially increasing load beyond capacity: Proper error handling
- ✅ Simulating connection failures: Pool recovers correctly

## Performance Impact
- No measurable latency increase (<1ms)
- Memory usage unchanged  
- CPU overhead negligible

## Additional Observations
- This pattern exists in 3 other services using the same pooling library
- Similar race conditions found in Redis connection pool
- Recommended: Audit all resource pooling implementations company-wide

## Files Modified
- `src/db/pool.ts` - Fixed race condition
- `tests/db/pool.test.ts` - Added concurrency tests
- `package.json` - Added async-mutex dependency
```
</details>

### Stage 4: Summary
```bash
dilagent manager summary --working-directory ./debug-session
```
- Aggregates all hypothesis reports
- Generates final summary with likely root causes and fixes

## Quick Start

```bash
# Install
npm install -g dilagent

# Run the complete workflow in one command
dilagent manager all \
  --context-directory ./my-project \
  --working-directory ./debug-session \
  --count 3 \
  --llm claude

# Key options:
# --llm claude|codex - Choose AI model (Claude recommended)
# --working-directory - Where dilagent stores its files
# --context-directory - The codebase to debug
# --count - Number of hypotheses to generate (default: 3)
# --flaky - Use this flag for intermittent/flaky issues
# --repl - Start interactive mode for complex debugging
```

## Troubleshooting

**Issue: Reproduction fails**
- Ensure the bug description is clear and specific
- Check that all required dependencies are installed
- Verify the issue occurs in the provided codebase

**Issue: All hypotheses are inconclusive**
- Try increasing `--count` to generate more hypotheses
- Add more context to `context.md` about recent changes
- Use `--repl` mode for manual exploration

**Issue: Worktree creation fails**
- Ensure you're in a git repository
- Check that git worktree is supported (Git 2.5+)
- Verify sufficient disk space for multiple worktrees

## Configuration

**Environment Variables:**
- `DILAGENT_CLI_PATH` - Automatically set to CLI location for MCP proxy

**LLM Tools:**
- Requires either `claude` or `codex` command in your PATH
- Claude recommended for best results
- Configure your API keys according to your LLM tool's documentation

**Working Directory Best Practices:**
- Use a dedicated directory (e.g., `./debug-sessions/issue-123/`)
- Keep separate from your main codebase
- Clean up old sessions periodically to save disk space

## Requirements

- Bun 1.2+
- Git (for worktree isolation)
- Local LLM tool (`claude` or `codex` command available in PATH)