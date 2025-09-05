import path from 'node:path'
import * as Cli from '@effect/cli'
import { Command, FileSystem } from '@effect/platform'
import { Effect, Option, Schema } from 'effect'
import {
  experimentInstructions,
  generateHypothesisIdeasPrompt,
  jsonOnlySystemPrompt,
  makeExperimentContext,
} from '../prompts.ts'
import { runRepl } from '../repl.ts'
import { type ExperimentInput, GenerateExperimentsInputResult } from '../schema.ts'
import { ClaudeLLMLive } from '../services/claude.ts'
import { CodexLLMLive } from '../services/codex.ts'
import { getFreePort } from '../services/free-port.ts'
import { LLMService } from '../services/llm.ts'
import { createMcpServerLayer } from '../services/mcp-server.js'
import { experimentCommand } from './experiment.ts'

export const managerCommand = Cli.Command.make(
  'manager',
  {
    portOption: Cli.Options.integer('port').pipe(
      Cli.Options.optional,
      Cli.Options.withAlias('p'),
      Cli.Options.withDescription('Port to run the MCP server on'),
    ),
    contextDirectory: Cli.Options.directory('context-directory'),
    workingDirectory: Cli.Options.directory('working-directory'),
    prompt: Cli.Options.text('prompt'),
    llm: Cli.Options.choice('llm', ['claude', 'codex']),
    cwdOption: Cli.Options.directory('cwd').pipe(Cli.Options.optional),
  },
  ({ portOption, contextDirectory, workingDirectory, prompt, llm, cwdOption }) =>
    Effect.gen(function* () {
      const fallbackPort = yield* getFreePort
      const port = Option.getOrElse(portOption, () => fallbackPort)
      const cwd = Option.getOrElse(cwdOption, () => process.cwd())

      return yield* Effect.gen(function* () {
        const resolvedWorkingDirectory = path.resolve(cwd, workingDirectory)
        const resolvedContextDirectory = path.resolve(cwd, contextDirectory)

        yield* Effect.log(`Context directory: ${resolvedContextDirectory}`)
        yield* Effect.log(`Working directory: ${resolvedWorkingDirectory}`)

        yield* Effect.log(`Generating experiments...`)
        const experiments = yield* generateExperiments({ problemPrompt: prompt, resolvedContextDirectory })

        yield* Effect.log(
          `Running ${experiments.length} experiments: \n${experiments.map((e) => `- ${e.experimentId}: ${e.problemTitle}`).join('\n')}`,
        )

        yield* Effect.forEach(
          experiments,
          Effect.fn(function* (experiment) {
            yield* prepareExperiment({ experiment, resolvedWorkingDirectory, resolvedContextDirectory })
            yield* runExperiment({
              resolvedWorkingDirectory,
              resolvedContextDirectory,
              port: port,
              experiment,
              llm,
              cwd,
            })
          }),
          { concurrency: 4 },
        ).pipe(Effect.tapErrorCause(Effect.logError), Effect.forkScoped)

        yield* Effect.log(`Starting MCP server on port ${port}...`)
        yield* Effect.log(`MCP endpoint: http://localhost:${port}/mcp`)
        yield* Effect.log(`Health check: http://localhost:${port}/health`)
        yield* Effect.log('')

        // Run REPL (StateStore provided from outer scope)
        yield* runRepl
      }).pipe(
        Effect.provide(createMcpServerLayer(port)),
        Effect.provide(llm === 'claude' ? ClaudeLLMLive : CodexLLMLive),
      )
    }),
)

const generateExperiments = ({
  problemPrompt,
  resolvedContextDirectory,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
}) =>
  Effect.gen(function* () {
    const llm = yield* LLMService

    const experimentInputResult = yield* llm
      .prompt(generateHypothesisIdeasPrompt({ problemPrompt, resolvedContextDirectory }), {
        systemPrompt: jsonOnlySystemPrompt,
        useBestModel: true,
        sandboxMode: 'danger-full-access',
        workingDir: resolvedContextDirectory,
      })
      .pipe(Effect.andThen(Schema.decode(Schema.parseJson(GenerateExperimentsInputResult))))

    if (experimentInputResult._tag === 'Error') {
      return yield* Effect.die(experimentInputResult.error)
    }

    return experimentInputResult.experiments
  }).pipe(Effect.withSpan('generateExperiments'))

const prepareExperiment = ({
  experiment,
  resolvedWorkingDirectory,
  resolvedContextDirectory,
}: {
  experiment: ExperimentInput
  resolvedWorkingDirectory: string
  resolvedContextDirectory: string
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const worktree = path.join(resolvedWorkingDirectory, experiment.experimentId)

    yield* fs.makeDirectory(worktree, { recursive: true })

    yield* fs.writeFileString(path.join(worktree, 'instructions.md'), experimentInstructions)
    yield* fs.writeFileString(
      path.join(worktree, 'context.md'),
      makeExperimentContext({ ...experiment, workingDirectory: worktree }),
    )

    yield* fs.writeFileString(path.join(worktree, 'report.md'), 'TODO: Create report here')

    // Copy all contents of resolvedContextDirectory into worktree, not the directory itself
    yield* Command.make('cp', '-r', path.join(resolvedContextDirectory, '.'), worktree).pipe(Command.string)
  }).pipe(Effect.withSpan('prepareExperiment'))

const runExperiment = ({
  resolvedWorkingDirectory,
  resolvedContextDirectory,
  port,
  experiment,
  llm,
  cwd,
}: {
  resolvedWorkingDirectory: string
  resolvedContextDirectory: string
  port: number
  experiment: ExperimentInput
  llm: 'claude' | 'codex'
  cwd: string
}) =>
  Effect.gen(function* () {
    const experimentWorkTree = path.join(resolvedWorkingDirectory, experiment.experimentId)

    yield* prepareExperiment({ experiment, resolvedWorkingDirectory, resolvedContextDirectory })

    yield* experimentCommand.handler({
      managerPort: port,
      worktree: experimentWorkTree,
      llm,
      showLogsOption: Option.none(),
      cwdOption: Option.some(cwd),
    })
  }).pipe(Effect.withSpan('runExperiments'))

// const monitorExperiments = ({ resolvedWorkingDirectory, port }: { resolvedWorkingDirectory: string; port: number }) =>
//   Effect.gen(function* () {
//     // TODO: monitor running experiments and spawn new experiments as needed
//   })

// const synthesizePatch = Effect.gen(function* () {})
// const validatePatch = Effect.gen(function* () {})
