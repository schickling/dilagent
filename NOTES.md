# deebug 🦛

Principled, structured debugging and root cause analysis

## CLI

### `experiment`

- arguments:
  - worktree path
  - manager port
- tools:
  - result
    - success
    - error
    - inconclusive
  - status update
- instructions markdown file:
- `settings.json` file
  - permissions

### `manager`

- http server
  - implement status updates
- stages:
  - initial data gathering
    - create feedback loop (fast/minimal)
      - make feedback loop minimal
    - research
  - initial hypothesis generation
  - run experiments
    - spawns `deebug experiment` calls
    - observes experiments
    - spanws new experiments
  - ? patch synthesis
  - final validation
- experiment
  - run experiments in parallel
- experiments tree

- setup for each experiment
  - create worktree
  - seed files
    - create instructions markdown file `hypothesis.md`
      - linege information
    - `instructions.md` standard file
- Web ui

## TODO

- [] Implement git worktree support

## Other notes

- In the future we might want a manager of managers (command `supervisor`)
- Live chart of probability of each hypothesis to track over time

## Concepts

- Problem
  - Reproduction
- Hypothesis (H001, H002, etc.)
  - For each hypothesis we will run a series of experiments to prove or disprove it
  - Initial context:
    - `context.md` file
    - `instructions.md` file
    - `repro.ts` file
  - Each experiment collects more evidence to support or disprove the hypothesis
  - Experiment (H001-E001, H001-E002, etc.)
    - Each experiment needs a `test.ts` file that runs the experiment

    - ? when to switch from E001 to E002?
      - ? when to know when to stop to generate new experiments?
    - Experiment loop
      - Counter experiment loop
  - ? confidence level
  - Counter-experiment (H001-E001-C001, H001-E001-C002, etc.)
  - hypo-report
    - Current understanding of the root cause
    - Evidence
    - Conducted experiments
      - H001-E001: ...
- Root Cause Analysis Report (H001-RCA)
  - A report of the root cause analysis for a hypothesis

- Repro vs test?
  - test has expecations