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
import { createPhaseEvent, createHypothesisEvent } from '../../schemas/file-management.ts'
import { parseJsonLlmResponse } from '../../utils/schema-utils.ts'
import { hypothesisCommand } from '../hypothesis.ts'

// Constants for canonical file structure
export const DILAGENT_DIR = '.dilagent'
export const HYPOTHESES_FILE = 'hypotheses.json'
export const CONTEXT_DIR = 'context'
export const GENERATE_HYPOTHESES_PROMPT_FILE = 'generate-hypotheses.md'
export const REPRODUCTION_FILE = 'reproduction.json'
export const REPRODUCTION_SCRIPT_FILE = 'repro.ts'
export const REPRODUCTION_LOG_FILE = 'reproduction.logDebug'

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
  hypothesisCount,
}: {
  problemPrompt: string
  hypothesisCount?: number
}) =>
  Effect.gen(function* () {
    const llm = yield* LLMService
    const fs = yield* FileSystem.FileSystem
    const workingDirService = yield* WorkingDirService
    const timelineService = yield* TimelineService
    const stateStore = yield* StateStore

    // Context repo is already set up by setup command
    const contextDir = workingDirService.paths.contextRepo

    // Record timeline event
    yield* timelineService.recordEvent(
      createPhaseEvent({
        event: 'phase.started',
        phase: 'hypothesis-generation',
      }),
    )

    // Check for existing reproduction results
    const artifactsDir = workingDirService.paths.artifacts
    const reproduction = yield* fs.readFileString(path.join(artifactsDir, REPRODUCTION_FILE)).pipe(
      Effect.andThen(Schema.decode(Schema.parseJson(ReproductionResult, { space: 2 }))),
      Effect.tapErrorCause(Effect.logError),
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

    yield* fs.writeFileString(path.join(artifactsDir, GENERATE_HYPOTHESES_PROMPT_FILE), prompt)

    if (reproduction?._tag === 'Success') {
      const typeLabel = {
        immediate: '⚡',
        delayed: '⏳',
        environmental: '🔧',
      }[reproduction.reproductionType]

      yield* Effect.logDebug(
        `Found existing reproduction (${typeLabel} ${reproduction.reproductionType}) - generating hypotheses from reproduction data with ${(reproduction.confidence * 100).toFixed(1)}% confidence`,
      )
    } else {
      yield* Effect.logDebug(
        `No reproduction found - generating hypotheses with traditional exploration and reproduction approach`,
      )
      yield* Effect.logDebug(`💡 Hint: Run 'dilagent manager repro' first for more focused hypothesis generation`)
    }

    const HypothesisInputResult = yield* llm
      .prompt(prompt, {
        systemPrompt: toolEnabledSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
        debugLogPath: path.join(workingDirService.paths.logs, 'generate-hypotheses.logDebug'),
      })
      .pipe(
        Effect.timeout('15 minutes'),
        Effect.andThen(Schema.decode(parseJsonLlmResponse(GenerateHypothesesInputResult))),
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

    yield* timelineService.recordEvent(
      createHypothesisEvent({
        event: 'hypothesis.generated',
        phase: 'hypothesis-generation',
        details: { count: hypotheses.length },
        // No hypothesisId since this is about generating multiple hypotheses
      }),
    )

    yield* Effect.logDebug(`Saved ${hypotheses.length} hypotheses to ${hypothesesFile}`)

    // Prepare all hypotheses immediately after generation
    yield* Effect.logDebug(`Preparing hypothesis directories...`)
    yield* Effect.forEach(hypotheses, (hypothesis) => prepareExperiment({ hypothesis }), { concurrency: 4 })

    yield* Effect.logDebug(`All hypotheses prepared and ready to run`)

    // Update StateStore with generated hypotheses
    yield* stateStore.setPhase('hypothesis-testing')

    // Register each hypothesis using the proper method
    yield* Effect.all(
      hypotheses.map((hypothesis) => {
        const hypothesisSlug = hypothesis.problemTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        return stateStore.registerHypothesis({
          id: hypothesis.hypothesisId,
          slug: hypothesisSlug,
          description: hypothesis.problemDescription,
        })
      }),
    )

    yield* Effect.logDebug(`Registered ${hypotheses.length} hypotheses in state`)

    return hypotheses
  }).pipe(Effect.withSpan('generateExperiments'))

export const prepareExperiment = ({ hypothesis }: { hypothesis: HypothesisInput }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const gitManager = yield* GitManagerService
    const stateStore = yield* StateStore

    // Get the hypothesis state which has the correct slug
    const state = yield* stateStore.getState()
    const hypothesisState = state.hypotheses[hypothesis.hypothesisId]

    if (!hypothesisState) {
      return yield* Effect.die(new Error(`Hypothesis ${hypothesis.hypothesisId} not found in state`))
    }

    const hypothesisSlug = hypothesisState.slug

    // Create git worktree for this hypothesis
    yield* gitManager.createHypothesisWorktree({
      hypothesisId: hypothesis.hypothesisId,
      hypothesisSlug,
      workingDirId: state.workingDirId,
    })

    const worktree = hypothesisState.worktreePath

    yield* fs.writeFileString(path.join(worktree, 'instructions.md'), instructionsMd)
    yield* fs.writeFileString(
      path.join(worktree, 'context.md'),
      makeContextMd({ ...hypothesis, workingDirectory: worktree }),
    )

    yield* fs.writeFileString(path.join(worktree, 'report.md'), 'TODO: Create report here')
  }).pipe(Effect.withSpan('prepareExperiment'))

export const runHypothesisWorker = ({
  port,
  hypothesis,
  llm,
  cwd,
}: {
  port: number
  hypothesis: HypothesisInput
  llm: 'claude' | 'codex'
  cwd: string
}) =>
  Effect.gen(function* () {
    const stateStore = yield* StateStore

    // Get the hypothesis state which includes the correct worktree path with slug
    const state = yield* stateStore.getState()
    const hypothesisState = state.hypotheses[hypothesis.hypothesisId]
    if (!hypothesisState) {
      return yield* Effect.die(new Error(`Hypothesis ${hypothesis.hypothesisId} not found in state`))
    }

    // Use the worktree path from state (which includes the slug)
    const hypothesisWorkTree = hypothesisState.worktreePath
    const startTime = Date.now()

    // Mark hypothesis as running
    yield* stateStore.updateHypothesis({
      id: hypothesis.hypothesisId,
      update: {
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    })

    yield* Effect.logDebug(`🔄 Started hypothesis ${hypothesis.hypothesisId}: ${hypothesis.problemTitle}`)

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
      yield* stateStore.updateHypothesis({
        id: hypothesis.hypothesisId,
        update: {
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      })

      yield* Effect.logDebug(`✅ Completed hypothesis ${hypothesis.hypothesisId} (${executionTimeMs}ms)`)
    })

    // Handle errors using Effect's error handling
    yield* runExperiment.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const executionTimeMs = Date.now() - startTime

          // Mark as failed/inconclusive if there's an error
          yield* stateStore.updateHypothesis({
            id: hypothesis.hypothesisId,
            update: {
              status: 'completed',
              result: {
                _tag: 'Inconclusive' as const,
                hypothesisId: hypothesis.hypothesisId,
                attemptedExperiments: ['Hypothesis testing failed due to execution error'],
                intractableReason: `Error: ${error}`,
              },
              completedAt: new Date().toISOString(),
            },
          })

          yield* Effect.logDebug(`❌ Failed hypothesis ${hypothesis.hypothesisId} after ${executionTimeMs}ms: ${error}`)
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

    yield* Effect.logDebug(`Loaded ${hypotheses.length} hypotheses from ${hypothesesFile}`)

    return hypotheses
  }).pipe(Effect.withSpan('loadExperiments'))
