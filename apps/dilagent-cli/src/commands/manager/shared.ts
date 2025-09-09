import path from 'node:path'
import * as Cli from '@effect/cli'
import { FileSystem } from '@effect/platform'
import { Duration, Effect, Option, Schema } from 'effect'
import { instructionsMd, makeContextMd } from '../../prompts/hypothesis-worker.ts'
import { generateHypothesesFromReproductionPrompt, toolEnabledSystemPrompt } from '../../prompts/manager.ts'
import { createHypothesisEvent, createPhaseEvent } from '../../schemas/file-management.ts'
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
import { parseJsonLlmResponse } from '../../utils/schema-utils.ts'
import { hypothesisCommand } from '../hypothesis.ts'

// Constants for canonical file structure
export const DILAGENT_DIR = '.dilagent'
export const HYPOTHESES_FILE = 'hypotheses.json'
export const CONTEXT_DIR = 'context'
export const GENERATE_HYPOTHESES_PROMPT_FILE = 'generate-hypotheses.md'
export const REPRODUCTION_FILE = 'reproduction.json'
export const REPRODUCTION_SCRIPT_FILE = 'repro.ts'

// Log file constants for each manager stage with phase numbers
export const LOG_FILES = {
  SETUP: '0-setup.log',
  REPRODUCTION: '1-reproduction.log',
  REPRODUCTION_PROMPT: '1-reproduction-prompt.log',
  GENERATE_HYPOTHESES: '2-generate-hypotheses.log',
  GENERATE_HYPOTHESES_PROMPT: '2-generate-hypotheses-prompt.log',
  RUN_HYPOTHESES: '3-run-hypotheses.log',
  SUMMARY: '4-summary.log',
  ALL: 'all.log',
} as const

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

export const hypothesisCountOption = Cli.Options.integer('hypothesis-count').pipe(
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

    // Record timeline event and set state phase
    yield* timelineService.recordEvent(
      createPhaseEvent({
        event: 'phase.started',
        phase: 'hypothesis-generation',
      }),
    )

    // Set the current phase to hypothesis-generation
    yield* stateStore.setPhase('hypothesis-generation')

    // Check for existing reproduction results
    const artifactsDir = workingDirService.paths.artifacts
    const reproduction = yield* fs.readFileString(path.join(artifactsDir, REPRODUCTION_FILE)).pipe(
      Effect.andThen(Schema.decode(Schema.parseJson(ReproductionResult, { space: 2 }))),
      Effect.tapErrorCause(Effect.logError),
      Effect.catchAll(() => Effect.succeed(undefined as ReproductionResult | undefined)),
    )

    // Require successful reproduction before generating hypotheses
    if (!reproduction || reproduction._tag !== 'Success') {
      return yield* Effect.die(
        reproduction?._tag === 'NeedMoreInfo'
          ? `Reproduction failed and needs more information. Please run 'dilagent manager repro' to fix reproduction issues before generating hypotheses.`
          : `No successful reproduction found. Please run 'dilagent manager repro' first to reproduce the issue before generating hypotheses.`,
      )
    }

    const typeLabel = {
      immediate: '⚡',
      delayed: '⏳',
      environmental: '🔧',
    }[reproduction.reproductionType]

    yield* Effect.logDebug(
      `Found existing reproduction (${typeLabel} ${reproduction.reproductionType}) - generating hypotheses from reproduction data with ${(reproduction.confidence * 100).toFixed(1)}% confidence`,
    )

    const state = yield* stateStore.getState()
    const prompt = generateHypothesesFromReproductionPrompt({
      problemPrompt,
      resolvedContextDirectory: contextDir,
      contextRelativePath: state.contextRelativePath,
      reproduction,
      hypothesisCount,
    })

    yield* fs.writeFileString(path.join(artifactsDir, GENERATE_HYPOTHESES_PROMPT_FILE), prompt)

    const HypothesisInputResult = yield* llm
      .prompt(prompt, {
        systemPrompt: toolEnabledSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
        debugLogPath: path.join(workingDirService.paths.logs, LOG_FILES.GENERATE_HYPOTHESES_PROMPT),
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
    const hypothesesFile = path.join(artifactsDir, HYPOTHESES_FILE)
    const hypothesesJson = yield* Schema.encode(Schema.parseJson(Schema.Array(HypothesisInputSchema), { space: 2 }))(
      hypotheses,
    )
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

    // Prepare all hypotheses after registration
    yield* Effect.logDebug(`Preparing hypothesis directories...`)
    yield* Effect.forEach(hypotheses, (hypothesis) => prepareExperiment({ hypothesis }), { concurrency: 4 })

    yield* Effect.logDebug(`All hypotheses prepared and ready to run`)

    // Record hypothesis-generation phase completion
    yield* timelineService.recordEvent(
      createPhaseEvent({
        event: 'phase.completed',
        phase: 'hypothesis-generation',
        details: { count: hypotheses.length },
      }),
    )

    return hypotheses
  }).pipe(Effect.withSpan('generateExperiments'))

export const prepareExperiment = ({ hypothesis }: { hypothesis: HypothesisInput }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const gitManager = yield* GitManagerService
    const stateStore = yield* StateStore
    const workingDirService = yield* WorkingDirService

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

    const worktreeDirectory = hypothesisState.worktreePath

    // Ensure hypothesis metadata directory exists and get file paths
    const metadataDir = yield* workingDirService.ensureHypothesisDir({
      hypothesisId: hypothesis.hypothesisId,
      hypothesisSlug,
    })
    const hypothesisFiles = workingDirService.paths.hypothesisFiles({
      hypothesisId: hypothesis.hypothesisId,
      hypothesisSlug,
    })

    // Write metadata files to the hypothesis metadata directory (not the worktree)
    yield* fs.writeFileString(hypothesisFiles.instructionsMd, instructionsMd)
    yield* fs.writeFileString(
      hypothesisFiles.contextMd,
      makeContextMd({ ...hypothesis, worktreeDirectory, contextRelativePath: state.contextRelativePath }),
    )
    yield* fs.writeFileString(hypothesisFiles.reportMd, 'TODO: Create report here')

    // Create empty hypothesis log file
    yield* fs.writeFileString(hypothesisFiles.hypothesisLog, '')
    yield* fs.writeFileString(hypothesisFiles.hypothesisPromptLog, '')

    yield* Effect.logDebug(
      `[prepareExperiment] Created hypothesis metadata files in ${metadataDir} for ${hypothesis.hypothesisId}`,
    )
  }).pipe(Effect.withSpan('prepareExperiment'))

export const runHypothesisWorker = ({
  port,
  hypothesis,
  llm,
  cwd,
  workingDir,
}: {
  port: number
  hypothesis: HypothesisInput
  llm: 'claude' | 'codex'
  cwd: string
  workingDir: string
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
        workingDirOption: workingDir,
        llm,
        showLogsOption: Option.none(),
        cwdOption: Option.some(cwd),
      })

      // Hypothesis completion is handled by MCP tools (dilagent_hypothesis_set_result)
      // No need to update status here - MCP tools already set status='completed' with result
      const executionTimeMs = Date.now() - startTime
      yield* Effect.logDebug(`✅ Completed hypothesis ${hypothesis.hypothesisId} (${Duration.format(executionTimeMs)})`)
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
