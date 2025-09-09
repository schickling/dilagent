# Automatic State & Timeline Management

## Problem Statement

The current state management and timeline service require excessive manual ceremony, making the code imperative and error-prone. Every workflow phase transition requires developers to:

1. **Manually record timeline events** (`phase.started`, `phase.completed`)
2. **Manually update state** (call `setPhase()`, update progress)  
3. **Coordinate both services** across multiple function calls
4. **Remember to do both** in the correct order

This leads to:
- **Code duplication** - Same 3-4 calls repeated everywhere
- **Easy to forget** - Missing timeline events or state updates (bugs we just fixed)
- **No atomicity** - State and timeline can get out of sync
- **Scattered responsibilities** - Business logic mixed with state management
- **Verbose code** - More ceremony than actual business logic

## Current Manual Ceremony Examples

### Phase Transitions (3+ calls each)
```typescript
// Current: Manual ceremony for every phase transition
yield* timelineService.recordEvent({
  event: 'phase.started',
  phase: 'hypothesis-generation'
})

yield* stateStore.setPhase('hypothesis-generation')

// ... business logic ...

yield* timelineService.recordEvent({
  event: 'phase.completed', 
  phase: 'hypothesis-generation'
})

yield* stateStore.setPhase('hypothesis-testing')
```

### Status Updates (2+ calls each)
```typescript
// Current: Manual coordination for hypothesis updates
yield* stateStore.updateHypothesis({
  id: 'H001',
  update: { status: 'running' }
})

yield* timelineService.recordEvent({
  event: 'hypothesis.started',
  hypothesisId: 'H001'
})
```

## Proposed Solutions

### 1. Unified Phase Transition API
Single method handles all phase logic atomically:

```typescript
// Proposed: One call does everything
yield* stateStore.transitionPhase('hypothesis-generation', { 
  details: { count: 5 } 
})
```

### 2. Aspect-Oriented Tracking  
Automatic event recording via Effect aspects:

```typescript
// Proposed: Business logic only, tracking automatic
const generateHypotheses = (...) => 
  Effect.gen(function* () {
    // Pure business logic - no manual event recording
    const hypotheses = yield* llm.prompt(...)
    return hypotheses
  }).pipe(
    withPhaseTracking('hypothesis-generation') // Automatic start/complete events
  )
```

### 3. Event-Driven State Updates
State automatically responds to timeline events:

```typescript
// StateStore auto-subscribes to timeline events
timelineService.onEvent('hypothesis.completed', (event) => {
  // Auto-update hypothesis status based on timeline
  return updateHypothesis(event.hypothesisId, { status: 'completed' })
})
```

### 4. State Machine Pattern
Define valid transitions, prevent invalid ones:

```typescript
const phaseTransitions = {
  setup: ['reproduction'],
  reproduction: ['hypothesis-generation'], 
  // ... etc
}

// Automatically advance to next valid phase
yield* stateStore.advancePhase()
```

## Implementation Priority

1. **✅ Start with Unified Phase Transition** (biggest win, easiest to implement)
2. **📋 Add withPhaseTracking aspect** (clean separation of concerns)  
3. **🔄 Implement Event Bus** (if needed for complex flows)
4. **🛡️ Add State Machine validation** (prevent invalid transitions)

## Success Metrics

- **~60% reduction** in state/timeline management code
- **Zero phase transition bugs** (automatic consistency)
- **Declarative workflow code** (business logic only)
- **Easier testing** (mock one service instead of two)
- **Better error handling** (atomic operations)

## Files That Would Benefit

- `commands/manager/setup.ts` - Phase transitions
- `commands/manager/shared.ts` - Hypothesis generation flow  
- `commands/manager/repro.ts` - Reproduction workflow
- `commands/manager/run-hypotheses.ts` - Testing phase
- `commands/manager/summary.ts` - Completion

All would become much more concise and less error-prone.