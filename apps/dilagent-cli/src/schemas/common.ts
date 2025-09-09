import { Schema } from 'effect'

/**
 * Common schema definitions shared across multiple schema files
 * This file prevents circular dependencies and schema duplication
 */

// Common timestamp type
export const timestamp = Schema.String.annotations({
  description: 'ISO 8601 timestamp',
  examples: ['2025-09-07T12:34:56Z'],
})

// Hypothesis identifier - shared across all schemas
export const HypothesisId = Schema.TemplateLiteral('H', Schema.String)
  .pipe(Schema.pattern(/^H\d{3}$/))
  .annotations({
    title: 'HypothesisId',
    description: 'Hypothesis identifier in format H{NNN}',
    examples: ['H001', 'H002', 'H010'],
  })

export type HypothesisId = typeof HypothesisId.Type

// Hypothesis slug
export const hypothesisSlug = Schema.String.annotations({
  title: 'HypothesisSlug',
  description: 'Auto-generated kebab-case slug from hypothesis description',
  examples: ['race-condition-state-updates', 'memory-leak-event-handler'],
})

// UUID for working directory identification
export const WorkingDirId = Schema.UUID.annotations({
  title: 'WorkingDirId',
  description: 'Unique identifier for this working directory setup',
  examples: ['550e8400-e29b-41d4-a716-446655440000'],
})

// Export types
export type Timestamp = typeof timestamp.Type
export type HypothesisSlug = typeof hypothesisSlug.Type
export type WorkingDirId = typeof WorkingDirId.Type
