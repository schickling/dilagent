import path from 'node:path'
import * as Cli from '@effect/cli'
import { Command, FileSystem } from '@effect/platform'
import { Effect, Option, Schema } from 'effect'
import { experimentInstructions, makeExperimentContext } from '../../prompts/experiment.ts'
import { generateExperimentIdeasPrompt, toolEnabledSystemPrompt } from '../../prompts/manager.ts'
import {
  type ExperimentInput,
  ExperimentInput as ExperimentInputSchema,
  GenerateExperimentsInputResult,
} from '../../schemas/experiment.ts'
import { LLMService } from '../../services/llm.ts'
import { experimentCommand } from '../experiment.ts'

// Constants for canonical file structure
export const DEEBUG_DIR = '.deebug'
export const EXPERIMENTS_FILE = 'experiments.json'
export const CONTEXT_DIR = 'context'
export const HYPOTHESIS_FILE = 'hypothesis-generation.md'

// Reusable CLI option definitions
export const workingDirectoryOption = Cli.Options.directory('working-directory').pipe(
  Cli.Options.withDescription('Directory for experiments and results'),
)

export const contextDirectoryOption = Cli.Options.directory('context-directory').pipe(
  Cli.Options.withDescription('Source directory containing code to debug'),
)

export const llmOption = Cli.Options.choice('llm', ['claude', 'codex']).pipe(
  Cli.Options.withDescription('LLM provider to use'),
)

export const portOption = Cli.Options.integer('port').pipe(
  Cli.Options.optional,
  Cli.Options.withAlias('p'),
  Cli.Options.withDescription('Port to run the MCP server on'),
)

export const promptOption = Cli.Options.text('prompt').pipe(
  Cli.Options.optional,
  Cli.Options.withDescription('Problem description (interactive if not provided)'),
)

export const countOption = Cli.Options.integer('count').pipe(
  Cli.Options.optional,
  Cli.Options.withDescription('Number of experiments to generate'),
)

export const replOption = Cli.Options.boolean('repl').pipe(
  Cli.Options.optional,
  Cli.Options.withDescription('Start REPL after running experiments'),
)

export const cwdOption = Cli.Options.directory('cwd').pipe(
  Cli.Options.optional,
  Cli.Options.withDescription('Current working directory'),
)

// Shared utility functions
export const generateExperiments = ({
  problemPrompt,
  resolvedContextDirectory,
  resolvedWorkingDirectory,
  experimentCount,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
  resolvedWorkingDirectory: string
  experimentCount?: number
}) =>
  Effect.gen(function* () {
    const llm = yield* LLMService
    const fs = yield* FileSystem.FileSystem

    yield* fs.makeDirectory(resolvedWorkingDirectory, { recursive: true })

    // Create .deebug directory for internal files
    const deebugDir = path.join(resolvedWorkingDirectory, DEEBUG_DIR)
    yield* fs.makeDirectory(deebugDir, { recursive: true })

    // Copy context directory to canonical location in .deebug
    const contextDir = path.join(deebugDir, CONTEXT_DIR)
    yield* Command.make('cp', '-r', resolvedContextDirectory, contextDir).pipe(Command.string)

    const prompt = generateExperimentIdeasPrompt({
      problemPrompt,
      resolvedContextDirectory: contextDir,
      ...(experimentCount !== undefined && { experimentCount }),
    })

    yield* fs.writeFileString(path.join(deebugDir, HYPOTHESIS_FILE), prompt)

    yield* Effect.log(`Using tool-enabled hypothesis generation`)

    const experimentInputResult = yield* llm
      .prompt(prompt, {
        systemPrompt: toolEnabledSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
      })
      .pipe(
        Effect.timeout('5 minutes'),
        Effect.andThen(Schema.decode(Schema.parseJson(GenerateExperimentsInputResult))),
      )

    if (experimentInputResult._tag === 'Error') {
      return yield* Effect.die(experimentInputResult.error)
    }

    const experiments = experimentInputResult.experiments

    // Save experiments to canonical location using Schema
    const experimentsFile = path.join(deebugDir, EXPERIMENTS_FILE)
    const experimentsJson = yield* Schema.encode(Schema.parseJson(Schema.Array(ExperimentInputSchema)))(experiments)
    yield* fs.writeFileString(experimentsFile, experimentsJson)

    yield* Effect.log(`Saved ${experiments.length} experiments to ${experimentsFile}`)

    // Prepare all experiments immediately after generation
    yield* Effect.log(`Preparing experiment directories...`)
    yield* Effect.forEach(
      experiments,
      (experiment) =>
        prepareExperiment({
          experiment,
          resolvedWorkingDirectory,
          resolvedContextDirectory: contextDir,
        }),
      { concurrency: 4 },
    )

    yield* Effect.log(`All experiments prepared and ready to run`)

    return experiments
  }).pipe(Effect.withSpan('generateExperiments'))

export const prepareExperiment = ({
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

    // Copy the canonical context directory as the worktree
    yield* Command.make('cp', '-r', resolvedContextDirectory, worktree).pipe(Command.string)

    yield* fs.writeFileString(path.join(worktree, 'instructions.md'), experimentInstructions)
    yield* fs.writeFileString(
      path.join(worktree, 'context.md'),
      makeExperimentContext({ ...experiment, workingDirectory: worktree }),
    )

    yield* fs.writeFileString(path.join(worktree, 'report.md'), 'TODO: Create report here')
  }).pipe(Effect.withSpan('prepareExperiment'))

export const runExperiment = ({
  resolvedWorkingDirectory,
  port,
  experiment,
  llm,
  cwd,
}: {
  resolvedWorkingDirectory: string
  port: number
  experiment: ExperimentInput
  llm: 'claude' | 'codex'
  cwd: string
}) =>
  Effect.gen(function* () {
    const experimentWorkTree = path.join(resolvedWorkingDirectory, experiment.experimentId)

    // Experiment is already prepared during generation, just run it
    yield* experimentCommand.handler({
      managerPort: port,
      worktree: experimentWorkTree,
      llm,
      showLogsOption: Option.none(),
      cwdOption: Option.some(cwd),
    })
  }).pipe(Effect.withSpan('runExperiments'))

export const loadExperiments = (resolvedWorkingDirectory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const deebugDir = path.join(resolvedWorkingDirectory, DEEBUG_DIR)
    const experimentsFile = path.join(deebugDir, EXPERIMENTS_FILE)

    const experimentsJson = yield* fs.readFileString(experimentsFile)
    const experiments = yield* Schema.decode(Schema.parseJson(Schema.Array(ExperimentInputSchema)))(experimentsJson)

    yield* Effect.log(`Loaded ${experiments.length} experiments from ${experimentsFile}`)

    return experiments
  }).pipe(Effect.withSpan('loadExperiments'))
