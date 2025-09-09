import { Duration, JSONSchema } from 'effect'
import { GenerateHypothesesInputResult } from '../schemas/hypothesis.ts'
import type { ReproductionResult } from '../schemas/reproduction.ts'

const jSchema = JSON.stringify(JSONSchema.make(GenerateHypothesesInputResult))

export const toolEnabledSystemPrompt = `You have access to tools for file operations, bash execution, and other tasks. Use these tools as needed to investigate the problem thoroughly.

CRITICAL: Use tools to investigate, but your final response must be ONLY valid JSON matching the required schema. Do not include any explanatory text, tool usage descriptions, or other content - respond with pure JSON only.`

export const generateHypothesesFromReproductionPrompt = ({
  problemPrompt,
  resolvedContextDirectory,
  reproduction,
  hypothesisCount,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
  reproduction: Extract<ReproductionResult, { _tag: 'Success' }>
  hypothesisCount?: number
}) => `\
## Context

<problem>
${problemPrompt}
</problem>

<context-directory>
${resolvedContextDirectory}
</context-directory>

<reproduction-results>
Observed Behavior: ${reproduction.observedBehavior}
Expected Behavior: ${reproduction.expectedBehavior}
Confidence: ${(reproduction.confidence * 100).toFixed(1)}%
Is Flaky: ${reproduction.isFlaky}

Reproduction Characteristics:
- Type: ${reproduction.reproductionType}
${reproduction.executionTimeMs ? `- Execution Time: ${reproduction.executionTimeMs}ms` : ''}
${reproduction.setupRequirements?.length ? `- Setup Required: ${reproduction.setupRequirements.join(', ')}` : ''}
${reproduction.minimizationNotes ? `- Minimization: ${reproduction.minimizationNotes}` : ''}

Diagnostics:
- Logs: ${JSON.stringify(reproduction.diagnostics.logs, null, 2)}
- Errors: ${JSON.stringify(reproduction.diagnostics.errors, null, 2)}
- Environment: ${JSON.stringify(reproduction.diagnostics.environment, null, 2)}

Reproduction Steps:
${reproduction.reproductionSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}
</reproduction-results>

<response-schema>
${jSchema}
</response-schema>

## Instructions

Based on the successful reproduction of the issue, generate a list of potential hypotheses for the root cause.

**Key Information:**
- The issue has been successfully reproduced with ${(reproduction.confidence * 100).toFixed(1)}% confidence
- Clear contrast available: Expected "${reproduction.expectedBehavior}" vs Observed "${reproduction.observedBehavior}"
- Reproduction Type: ${reproduction.reproductionType}
- ${reproduction.isFlaky ? 'This is a flaky/intermittent issue - consider timing, race conditions, and non-deterministic factors' : 'This is a deterministic issue - focus on consistent root causes'}

**Reproduction Context Guidance:**
${
  reproduction.reproductionType === 'delayed'
    ? '- Consider: Accumulation effects, resource leaks, state buildup, timing dependencies'
    : ''
}
${
  reproduction.reproductionType === 'environmental'
    ? '- Consider: Configuration differences, external dependencies, system resources'
    : ''
}
${
  reproduction.reproductionType === 'immediate' && reproduction.executionTimeMs
    ? `- Fast reproduction (${Duration.format(reproduction.executionTimeMs)}) suggests immediate, direct cause`
    : ''
}

${hypothesisCount ? `Generate exactly ${hypothesisCount} hypotheses ordered by likelihood of being the root cause.` : 'Generate up to 5 hypotheses ordered by likelihood of being the root cause.'}
Don't include very low-confidence hypotheses. Don't include hypotheses that are not related to the problem.

**Process:**
1. **Analyze the reproduction data** - Study the observed vs expected behavior contrast
2. **Review diagnostic information** - Look for patterns in logs, errors, and environment data
3. **Consider the reproduction context** - Use the reproduction steps and success rate to inform hypotheses
4. **Generate focused hypotheses** - Create hypotheses that directly explain the observed behavior

You can use tools to:
- Read relevant files in the context directory
- Examine the generated repro.ts script for additional insights
- Run additional analysis if needed

Focus on hypotheses that specifically explain why the expected behavior differs from the observed behavior.

Make sure referenced file paths are relative to the context directory.

CRITICAL: You must respond with ONLY JSON. No explanations. No text before JSON. No text after JSON. Follow the response schema exactly.

Begin your response with {
`
