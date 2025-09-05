import { JSONSchema } from 'effect'
import { GenerateExperimentsInputResult } from './schema.ts'

const jSchema = JSON.stringify(JSONSchema.make(GenerateExperimentsInputResult))

export const jsonOnlySystemPrompt = `CRITICAL SYSTEM CONSTRAINT: You are operating in JSON-only mode. Your output must be pure JSON with zero additional text. Any text before or after JSON will cause parsing errors and system failure. Do not explain, do not comment, do not add context. Output must start with { and end with }.`

export const generateHypothesisIdeasPrompt = ({
  problemPrompt,
  resolvedWorkingDirectory,
}: {
  problemPrompt: string
  resolvedWorkingDirectory: string
}) => `\
Study the following problem and generate a list of potential hypotheses for the root cause.
We will then run experiments to test each hypothesis in depth. Order the hypotheses by likelihood of being the root cause.

<problem>
${problemPrompt}
</problem>

<working-directory>
${resolvedWorkingDirectory}
</working-directory>

CRITICAL: You must respond with ONLY JSON. No explanations. No text before JSON. No text after JSON.

JSON Schema: ${jSchema}

Begin your response with {
`

/** instructions.md */
export const experimentInstructions = `\
You are an expert debugging assistant. Your job is to analyze and diagnose the root cause for the given problem.

## Goal

1. Identify the root cause of the problem
2. 

## Strategies

- Test loop: Create a targeted test loop that's fast to run and focused on the hypothesis
- Isolate: create a minimal reproduction of the problem
  - if your minimal reproduction attempt doesn't work, bisect and compare with the non-minimal reproduction until your minimal setup reproduces the problem
- Logging: add log statements
- Research: do some web research (e.g. existing issues on GitHub) to build a deeper understanding of the problem

## MCP Server

- Use the MCP server \`kvStore\` to update the experiment manager about your progress and results.

// TODO
// 

## Acceptance Criteria

- The root cause is identified
- The root cause is reproducible
- The root cause is documented in the \`report.md\` file
- The root cause has been counter-tested with counter hypothesis

`

/** context.md */
export const makeExperimentContext = ({
  problemTitle,
  problemDescription,
  experimentInstructions,
  experimentId,
}: {
  problemTitle: string
  problemDescription: string
  experimentInstructions: string
  experimentId: string
}) => `\
## Experiment: \`${experimentId}\`

## Instructions

Follow the instructions provided in the \`instructions.md\` file.

## Problem: ${problemTitle}

${problemDescription}

## Experiment

${experimentInstructions}
`
