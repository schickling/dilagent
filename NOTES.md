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