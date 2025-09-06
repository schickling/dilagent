import path from 'node:path'
import * as Cli from '@effect/cli'
import { Command, FileSystem } from '@effect/platform'
import { Effect, Option, Schema } from 'effect'
import { instructionsMd, makeContextMd } from '../../prompts/hypothesis-worker.ts'
import { generateHypothesisIdeasPrompt, toolEnabledSystemPrompt } from '../../prompts/manager.ts'
import {
  GenerateHypothesesInputResult,
  type HypothesisInput,
  HypothesisInput as HypothesisInputSchema,
} from '../../schemas/hypothesis.ts'
import { LLMService } from '../../services/llm.ts'
import { hypothesisCommand } from '../hypothesis.ts'

// Constants for canonical file structure
export const DEEBUG_DIR = '.deebug'
export const HYPOTHESES_FILE = 'hypotheses.json'
export const CONTEXT_DIR = 'context'
export const GENERATE_HYPOTHESES_PROMPT_FILE = 'generate-hypotheses.md'

// Reusable CLI option definitions
export const workingDirectoryOption = Cli.Options.directory('working-directory').pipe(
  Cli.Options.withDescription('Directory for hypotheses and results'),
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
  Cli.Options.withDescription('Number of hypotheses to generate'),
)

export const replOption = Cli.Options.boolean('repl').pipe(
  Cli.Options.optional,
  Cli.Options.withDescription('Start REPL after running hypotheses'),
)

export const cwdOption = Cli.Options.directory('cwd').pipe(
  Cli.Options.optional,
  Cli.Options.withDescription('Current working directory'),
)

// Shared utility functions
export const generateHypotheses = ({
  problemPrompt,
  resolvedContextDirectory,
  resolvedWorkingDirectory,
  hypothesisCount,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
  resolvedWorkingDirectory: string
  hypothesisCount?: number
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

    const prompt = generateHypothesisIdeasPrompt({
      problemPrompt,
      resolvedContextDirectory: contextDir,
      ...(hypothesisCount !== undefined && { hypothesisCount }),
    })

    yield* fs.writeFileString(path.join(deebugDir, GENERATE_HYPOTHESES_PROMPT_FILE), prompt)

    yield* Effect.log(`Generating hypotheses from problem prompt. Trying to reproduce the problem...`)

    // TODO do problem reproduction in separate step first (via separate prompt)
    // refine/standartize reproduction by creating a `repro.ts` file that reproduces the problem

    const HypothesisInputResult = yield* llm
      .prompt(prompt, {
        systemPrompt: toolEnabledSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
      })
      .pipe(
        Effect.timeout('5 minutes'),
        Effect.andThen(Schema.decode(Schema.parseJson(GenerateHypothesesInputResult))),
        Effect.withSpan('generateHypotheses'),
      )

    if (HypothesisInputResult._tag === 'Error') {
      return yield* Effect.die(HypothesisInputResult.error)
    }

    const hypotheses = HypothesisInputResult.hypotheses

    // Save hypotheses to canonical location using Schema
    const hypothesissFile = path.join(deebugDir, HYPOTHESES_FILE)
    const hypothesissJson = yield* Schema.encode(Schema.parseJson(Schema.Array(HypothesisInputSchema)))(hypotheses)
    yield* fs.writeFileString(hypothesissFile, hypothesissJson)

    yield* Effect.log(`Saved ${hypotheses.length} hypotheses to ${hypothesissFile}`)

    // Prepare all hypotheses immediately after generation
    yield* Effect.log(`Preparing hypothesis directories...`)
    yield* Effect.forEach(
      hypotheses,
      (hypothesis) =>
        prepareExperiment({
          hypothesis,
          resolvedWorkingDirectory,
          resolvedContextDirectory: contextDir,
        }),
      { concurrency: 4 },
    )

    yield* Effect.log(`All hypotheses prepared and ready to run`)

    return hypotheses
  }).pipe(Effect.withSpan('generateExperiments'))

export const prepareExperiment = ({
  hypothesis,
  resolvedWorkingDirectory,
  resolvedContextDirectory,
}: {
  hypothesis: HypothesisInput
  resolvedWorkingDirectory: string
  resolvedContextDirectory: string
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const worktree = path.join(resolvedWorkingDirectory, hypothesis.hypothesisId)

    // Copy the canonical context directory as the worktree
    yield* Command.make('cp', '-r', resolvedContextDirectory, worktree).pipe(Command.string)

    yield* fs.writeFileString(path.join(worktree, 'instructions.md'), instructionsMd)
    yield* fs.writeFileString(
      path.join(worktree, 'context.md'),
      makeContextMd({ ...hypothesis, workingDirectory: worktree }),
    )

    yield* fs.writeFileString(path.join(worktree, 'report.md'), 'TODO: Create report here')
  }).pipe(Effect.withSpan('prepareExperiment'))

export const runHypothesisWorker = ({
  resolvedWorkingDirectory,
  port,
  hypothesis,
  llm,
  cwd,
}: {
  resolvedWorkingDirectory: string
  port: number
  hypothesis: HypothesisInput
  llm: 'claude' | 'codex'
  cwd: string
}) =>
  Effect.gen(function* () {
    const hypothesisWorkTree = path.join(resolvedWorkingDirectory, hypothesis.hypothesisId)

    // Experiment is already prepared during generation, just run it
    yield* hypothesisCommand.handler({
      managerPort: port,
      worktree: hypothesisWorkTree,
      llm,
      showLogsOption: Option.none(),
      cwdOption: Option.some(cwd),
    })
  }).pipe(Effect.withSpan('runHypothesisWorkers'))

export const loadExperiments = (resolvedWorkingDirectory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const deebugDir = path.join(resolvedWorkingDirectory, DEEBUG_DIR)
    const hypothesissFile = path.join(deebugDir, HYPOTHESES_FILE)

    const hypothesissJson = yield* fs.readFileString(hypothesissFile)
    const hypotheses = yield* Schema.decode(Schema.parseJson(Schema.Array(HypothesisInputSchema)))(hypothesissJson)

    yield* Effect.log(`Loaded ${hypotheses.length} hypotheses from ${hypothesissFile}`)

    return hypotheses
  }).pipe(Effect.withSpan('loadExperiments'))
