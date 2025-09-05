import { JSONSchema } from 'effect'
import { type ExperimentInput, GenerateExperimentsInputResult } from './schema.ts'

const jSchema = JSON.stringify(JSONSchema.make(GenerateExperimentsInputResult))

export const jsonOnlySystemPrompt = `CRITICAL SYSTEM CONSTRAINT: You are operating in JSON-only mode. Your output must be pure JSON with zero additional text. Any text before or after JSON will cause parsing errors and system failure. Do not explain, do not comment, do not add context. Output must start with { and end with }.`

export const toolEnabledSystemPrompt = `You have access to tools for file operations, bash execution, and other tasks. Use these tools as needed to investigate the problem thoroughly.

CRITICAL: Use tools to investigate, but your final response must be ONLY valid JSON matching the required schema. Do not include any explanatory text, tool usage descriptions, or other content - respond with pure JSON only.`


export const generateHypothesisIdeasPrompt = ({
  problemPrompt,
  resolvedContextDirectory,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
}) => `\
## Context

<problem>
${problemPrompt}
</problem>

<context-directory>
${resolvedContextDirectory}
</context-directory>

<response-schema>
${jSchema}
</response-schema>

## Instructions

Study the problem in the context directory and generate a list of potential hypotheses for the root cause.
We will then run experiments to test each hypothesis in depth. Order the hypotheses by likelihood of being the root cause.

You have access to tools including:
- Read files in the context directory
- Execute bash commands to run code and scripts  
- List directory contents

**IMPORTANT STEPS:**
1. **Explore the directory** - Use tools to list and read all files to understand the codebase structure
2. **Reproduce the problem** - Look for any scripts, tests, or runnable code that can demonstrate the issue
3. **Observe actual behavior** - Run the code/scripts and capture the real output 
4. **Analyze the results** - Based on the observed behavior, generate hypotheses about root causes

Start by exploring the files and finding ways to reproduce the problem. Only generate hypotheses after you've observed the actual behavior.

Collect all relevant information to return the required data following the response schema.

## Output

Make sure referenced file paths are relative to the context directory.

IMPORTANT: Return an error if any of the following conditions are met:
- You cannot reproduce the problem (e.g. file not found, etc.)
- You're running into any problems following the instructions (e.g. missing tools, etc.)
- You could not collect all relevant information to return the required data following the response schema.
- You cannot generate a list of high-confidence hypotheses

CRITICAL: You must respond with ONLY JSON. No explanations. No text before JSON. No text after JSON. Follow the response schema.

Begin your response with {
`

/** instructions.md */
export const experimentInstructions = `\
You are an expert debugging assistant. Your job is to analyze and diagnose the root cause for the given problem.

## Goal

1. Identify the root cause of the problem
2. Document the root cause and your progress in the \`report.md\` file

// TODO ascii art diagram for feedback loop of testing hypotheses

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

## \`report.md\`

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
  problemDetails,
  reproductionSteps,
  experimentId,
  experimentApproach,
  files,
  observedBehavior,
  workingDirectory,
}: ExperimentInput & { workingDirectory: string }) => `\
## Experiment: \`${experimentId}\`

## Instructions

Follow the instructions provided in the \`instructions.md\` file.

## Working Directory: \`${workingDirectory}\`

## Problem: ${problemTitle}

${problemDescription}

## Details

${problemDetails}

## Reproduction Steps

${reproductionSteps.join('\n')}

## Observed Behavior

${observedBehavior}

## Files

${files.join('\n')}

## Experiment Approach

Here is an initial approach to the experiment. Refine it as you go.

<experiment-approach>
${experimentApproach}
</experiment-approach>

`
