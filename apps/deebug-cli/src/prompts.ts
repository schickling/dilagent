export const generateHypothesisIdeasPrompt = ({ problemPrompt }: { problemPrompt: string }) => `\
Study the following problem and generate a list of potential hypotheses for the root cause.
We will then run experiments to test each hypothesis in depth. Order the hypotheses by likelihood of being the root cause.

For each hypothesis provide a:
- Title
- Description
- Reproduction Steps
`

export const makeExperimentInstructions = `\
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

## Acceptance Criteria

- The root cause is identified
- The root cause is reproducible
- The root cause is documented in the \`report.md\` file
- The root cause has been counter-tested with counter hypothesis
`

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
