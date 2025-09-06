import { JSONSchema } from 'effect'
import { GenerateHypothesesInputResult } from '../schemas/hypothesis.ts'

const jSchema = JSON.stringify(JSONSchema.make(GenerateHypothesesInputResult))

export const toolEnabledSystemPrompt = `You have access to tools for file operations, bash execution, and other tasks. Use these tools as needed to investigate the problem thoroughly.

CRITICAL: Use tools to investigate, but your final response must be ONLY valid JSON matching the required schema. Do not include any explanatory text, tool usage descriptions, or other content - respond with pure JSON only.`

// TODO: maybe do the reproduction run in a separate directory that's a copy of the context directory?
export const generateHypothesisIdeasPrompt = ({
  problemPrompt,
  resolvedContextDirectory,
  hypothesisCount,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
  hypothesisCount?: number
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
We will then run hypothesiss to test each hypothesis in depth. Order the hypotheses by likelihood of being the root cause.

${hypothesisCount ? `Generate exactly ${hypothesisCount} hypotheses ordered by likelihood of being the root cause.` : 'Generate hypotheses ordered by likelihood of being the root cause.'}

You have access to all tools you need including:
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
