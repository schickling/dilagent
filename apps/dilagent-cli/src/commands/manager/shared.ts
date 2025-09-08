import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Effect, Option, Schema } from 'effect'
import { instructionsMd, makeContextMd } from '../../prompts/hypothesis-worker.ts'
import {
  generateHypothesesFromReproductionPrompt,
  generateHypothesisIdeasPrompt,
  toolEnabledSystemPrompt,
} from '../../prompts/manager.ts'
import {
  GenerateHypothesesInputResult,
  type HypothesisInput,
  HypothesisInput as HypothesisInputSchema,
} from '../../schemas/hypothesis.ts'
import { ReproductionResult } from '../../schemas/reproduction.ts'
import { GitManagerService } from '../../services/git-manager.ts'
import { LLMService } from '../../services/llm.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
import { generateRunSlug } from '../../utils/run-slug.ts'
import { hypothesisCommand } from '../hypothesis.ts'

// Constants for canonical file structure
export const DILAGENT_DIR = '.dilagent'
export const HYPOTHESES_FILE = 'hypotheses.json'
export const CONTEXT_DIR = 'context'
export const GENERATE_HYPOTHESES_PROMPT_FILE = 'generate-hypotheses.md'
export const REPRODUCTION_FILE = 'reproduction.json'
export const REPRODUCTION_SCRIPT_FILE = 'repro.ts'
export const REPRODUCTION_LOG_FILE = 'reproduction.log'

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

export const flakyOption = Cli.Options.boolean('flaky').pipe(
  Cli.Options.optional,
  Cli.Options.withDescription('Indicate that this is a flaky/intermittent bug'),
)

// Helper functions

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
    const workingDirService = yield* WorkingDirService
    const timelineService = yield* TimelineService
    const gitManager = yield* GitManagerService
    const stateStore = yield* StateStore

    // Setup context directory as git repository
    const runId = generateRunSlug('hypothesis-generation')
    yield* gitManager.setupContextRepo(resolvedContextDirectory, runId)
    const contextDir = workingDirService.paths.contextRepo

    // Record timeline event
    yield* timelineService.recordEvent({
      event: 'Hypothesis generation phase started',
      phase: 'hypothesis-generation',
    })

    // Check for existing reproduction results
    const artifactsDir = workingDirService.paths.artifacts
    const reproduction = yield* fs.readFileString(path.join(artifactsDir, 'reproduction.json')).pipe(
      Effect.andThen(Schema.decode(Schema.parseJson(ReproductionResult, { space: 2 }))),
      Effect.catchAll(() => Effect.succeed(undefined as ReproductionResult | undefined)),
    )

    // Choose prompt based on whether reproduction exists
    const prompt =
      reproduction?._tag === 'Success'
        ? generateHypothesesFromReproductionPrompt({
            problemPrompt,
            resolvedContextDirectory: contextDir,
            reproduction,
            ...(hypothesisCount !== undefined && { hypothesisCount }),
          })
        : generateHypothesisIdeasPrompt({
            problemPrompt,
            resolvedContextDirectory: contextDir,
            ...(hypothesisCount !== undefined && { hypothesisCount }),
          })

    yield* fs.writeFileString(path.join(artifactsDir, 'generate-hypotheses.md'), prompt)

    if (reproduction?._tag === 'Success') {
      const typeLabel = {
        immediate: '⚡',
        delayed: '⏳',
        environmental: '🔧',
      }[reproduction.reproductionType]

      yield* Effect.log(
        `Found existing reproduction (${typeLabel} ${reproduction.reproductionType}) - generating hypotheses from reproduction data with ${(reproduction.confidence * 100).toFixed(1)}% confidence`,
      )
    } else {
      yield* Effect.log(
        `No reproduction found - generating hypotheses with traditional exploration and reproduction approach`,
      )
      yield* Effect.log(`💡 Hint: Run 'dilagent manager repro' first for more focused hypothesis generation`)
    }

    const HypothesisInputResult = yield* llm
      .prompt(prompt, {
        systemPrompt: toolEnabledSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
        debugLogPath: path.join(workingDirService.paths.logs, 'generate-hypotheses.log'),
      })
      .pipe(
        Effect.timeout('15 minutes'),
        Effect.andThen(Schema.decode(Schema.parseJson(GenerateHypothesesInputResult))),
        Effect.withSpan('generateHypotheses'),
      )

    if (HypothesisInputResult._tag === 'Error') {
      return yield* Effect.die(HypothesisInputResult.error)
    }

    const hypotheses = HypothesisInputResult.hypotheses

    // Save hypotheses to artifacts directory
    const hypothesesFile = path.join(artifactsDir, 'hypotheses.json')
    const hypothesesJson = yield* Schema.encode(Schema.parseJson(Schema.Array(HypothesisInputSchema)))(hypotheses)
    yield* fs.writeFileString(hypothesesFile, hypothesesJson)

    yield* timelineService.recordEvent({
      event: `Generated ${hypotheses.length} hypotheses`,
      phase: 'hypothesis-generation',
      metadata: { count: hypotheses.length },
    })

    yield* Effect.log(`Saved ${hypotheses.length} hypotheses to ${hypothesesFile}`)

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

    // Update StateStore with generated hypotheses
    yield* stateStore.updateDilagentState((state) => ({
      ...state,
      currentPhase: 'hypothesis-testing' as const,
      phaseStartedAt: new Date().toISOString(),
      hypotheses: hypotheses.map((hypothesis) => {
        const hypothesisSlug = hypothesis.problemTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        const runId = generateRunSlug('hypothesis-testing')
        return {
          id: hypothesis.hypothesisId,
          slug: hypothesisSlug,
          branch: `dilagent/${runId}/${hypothesis.hypothesisId}-${hypothesisSlug}`,
          worktree: `${hypothesis.hypothesisId}-${hypothesisSlug}`,
          status: 'pending' as const,
        }
      }),
      overallProgress: {
        ...state.overallProgress,
        totalHypotheses: hypotheses.length,
      },
    }))

    yield* Effect.log(`Updated state with ${hypotheses.length} hypotheses`)

    return hypotheses
  }).pipe(Effect.withSpan('generateExperiments'))

export const prepareExperiment = ({
  hypothesis,
  resolvedWorkingDirectory,
}: {
  hypothesis: HypothesisInput
  resolvedWorkingDirectory: string
  resolvedContextDirectory: string
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const gitManager = yield* GitManagerService

    // Generate runSlug and hypothesis slug for git branching
    const runId = generateRunSlug('hypothesis-testing')
    const hypothesisSlug = hypothesis.problemTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    // Create git worktree for this hypothesis
    yield* gitManager.createHypothesisWorktree(resolvedWorkingDirectory, runId, hypothesis.hypothesisId, hypothesisSlug)

    const worktree = path.join(resolvedWorkingDirectory, `${hypothesis.hypothesisId}-${hypothesisSlug}`)

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
    const stateStore = yield* StateStore
    const hypothesisWorkTree = path.join(resolvedWorkingDirectory, hypothesis.hypothesisId)
    const startTime = Date.now()

    // Mark hypothesis as running
    yield* stateStore.updateHypothesis(hypothesis.hypothesisId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })

    yield* Effect.log(`🔄 Started hypothesis ${hypothesis.hypothesisId}: ${hypothesis.problemTitle}`)

    // Run the experiment with proper Effect error handling
    const runExperiment = Effect.gen(function* () {
      yield* hypothesisCommand.handler({
        managerPort: port,
        worktree: hypothesisWorkTree,
        llm,
        showLogsOption: Option.none(),
        cwdOption: Option.some(cwd),
      })

      // Mark as completed with execution time tracking
      const executionTimeMs = Date.now() - startTime
      yield* stateStore.updateHypothesis(hypothesis.hypothesisId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        executionTimeMs,
      })

      yield* Effect.log(`✅ Completed hypothesis ${hypothesis.hypothesisId} (${executionTimeMs}ms)`)
    })

    // Handle errors using Effect's error handling
    yield* runExperiment.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const executionTimeMs = Date.now() - startTime

          // Mark as failed/inconclusive if there's an error
          yield* stateStore.updateHypothesis(hypothesis.hypothesisId, {
            status: 'completed',
            result: 'inconclusive',
            completedAt: new Date().toISOString(),
            executionTimeMs,
          })

          yield* Effect.log(`❌ Failed hypothesis ${hypothesis.hypothesisId} after ${executionTimeMs}ms: ${error}`)
          return yield* Effect.fail(error)
        }),
      ),
    )
  }).pipe(Effect.withSpan('runHypothesisWorker'))

export const loadExperiments = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const workingDirService = yield* WorkingDirService

    const hypothesesFile = path.join(workingDirService.paths.artifacts, 'hypotheses.json')

    const hypothesesJson = yield* fs.readFileString(hypothesesFile)
    const hypotheses = yield* Schema.decode(Schema.parseJson(Schema.Array(HypothesisInputSchema)))(hypothesesJson)

    yield* Effect.log(`Loaded ${hypotheses.length} hypotheses from ${hypothesesFile}`)

    return hypotheses
  }).pipe(Effect.withSpan('loadExperiments'))
