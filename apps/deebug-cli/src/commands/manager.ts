import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Console, Effect, Option, Schema } from 'effect'
import {
  experimentInstructions,
  generateHypothesisIdeasPrompt,
  jsonOnlySystemPrompt,
  makeExperimentContext,
} from '../prompts.ts'
import { runRepl } from '../repl.ts'
import { type ExperimentInput, GenerateExperimentsInputResult } from '../schema.ts'
import { ClaudeService } from '../services/claude.ts'
import { createMcpServerLayer } from '../services/mcp-server.js'
import { experimentCommand } from './experiment.ts'

export const managerCommand = Cli.Command.make(
  'manager',
  {
    port: Cli.Options.integer('port').pipe(
      Cli.Options.optional,
      Cli.Options.withAlias('p'),
      Cli.Options.withDescription('Port to run the MCP server on'),
    ),
    workingDirectory: Cli.Options.directory('working-directory'),
    prompt: Cli.Options.text('prompt'),
  },
  ({ port: portOption, workingDirectory, prompt }) => {
    const actualPort = Option.getOrElse(portOption, () => 3000)
    return Effect.gen(function* () {
      const resolvedWorkingDirectory = path.resolve(workingDirectory)

      const experiments = yield* generateExperiments({ problemPrompt: prompt, resolvedWorkingDirectory })

      for (const experiment of experiments) {
        yield* prepareExperiment({ ...experiment, resolvedWorkingDirectory })
        yield* runExperiment({ resolvedWorkingDirectory, port: actualPort, experiment })
      }

      console.log('experiments', experiments)

      // yield* runExperiments({ resolvedWorkingDirectory, port: actualPort }).pipe(
      //   Effect.tapErrorCause(Effect.logError),
      //   Effect.forkScoped,
      // )

      // yield* Console.log(`Starting MCP server on port ${actualPort}...`)
      // yield* Console.log(`MCP endpoint: http://localhost:${actualPort}/mcp`)
      // yield* Console.log(`Health check: http://localhost:${actualPort}/health`)
      // yield* Console.log('')

      // // Run REPL (StateStore provided from outer scope)
      // yield* runRepl
    }).pipe(
      // Provide StateStore.Live once at the top level so it's shared by both server and REPL
      Effect.provide(createMcpServerLayer(actualPort)),
    )
  },
)

const generateExperiments = ({
  problemPrompt,
  resolvedWorkingDirectory,
}: {
  problemPrompt: string
  resolvedWorkingDirectory: string
}) =>
  Effect.gen(function* () {
    const claude = yield* ClaudeService

    const experimentInputResult = yield* claude
      .prompt(generateHypothesisIdeasPrompt({ problemPrompt, resolvedWorkingDirectory }), {
        // TODO re-fine permissions
        extraArgs: ['--dangerously-skip-permissions'],
        systemPrompt: jsonOnlySystemPrompt,
      })
      .pipe(Effect.tap(Effect.log), Effect.andThen(Schema.decode(Schema.parseJson(GenerateExperimentsInputResult))))

    if (experimentInputResult._tag === 'Error') {
      return yield* Effect.die(experimentInputResult.error)
    }

    return experimentInputResult.experiments
  }).pipe(Effect.withSpan('generateExperiments'))

const prepareExperiment = ({
  problemTitle,
  problemDescription,
  experimentId,
  resolvedWorkingDirectory,
}: ExperimentInput & { resolvedWorkingDirectory: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const worktree = path.resolve(resolvedWorkingDirectory, experimentId)

    fs.writeFileString(path.resolve(worktree, 'instructions.md'), experimentInstructions)
    fs.writeFileString(
      path.resolve(worktree, 'context.md'),
      makeExperimentContext({ problemTitle, problemDescription, experimentInstructions, experimentId }),
    )
    fs.writeFileString(path.resolve(worktree, 'report.md'), 'TODO: Create report here')
  }).pipe(Effect.withSpan('prepareExperiment'))

const runExperiment = ({
  resolvedWorkingDirectory,
  port,
  experiment,
}: {
  resolvedWorkingDirectory: string
  port: number
  experiment: ExperimentInput
}) =>
  Effect.gen(function* () {
    const experimentWorkTree = path.resolve(resolvedWorkingDirectory, experiment.experimentId)

    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(experimentWorkTree, { recursive: true })

    yield* prepareExperiment({ ...experiment, resolvedWorkingDirectory })

    console.log('running experiment', experimentWorkTree)

    yield* experimentCommand.handler({ managerPort: port, worktree: experimentWorkTree })
  }).pipe(Effect.withSpan('runExperiments'))

// const monitorExperiments = ({ resolvedWorkingDirectory, port }: { resolvedWorkingDirectory: string; port: number }) =>
//   Effect.gen(function* () {
//     // TODO: monitor running experiments and spawn new experiments as needed
//   })

// const synthesizePatch = Effect.gen(function* () {})
// const validatePatch = Effect.gen(function* () {})
