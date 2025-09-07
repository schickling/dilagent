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
  initialReproductionPrompt,
  refineReproductionPrompt,
  reproductionSystemPrompt,
} from '../../prompts/reproduction.ts'
import {
  GenerateHypothesesInputResult,
  type HypothesisInput,
  HypothesisInput as HypothesisInputSchema,
} from '../../schemas/hypothesis.ts'
import { ReproductionResult, ReproductionResultFile } from '../../schemas/reproduction.ts'
import { GitManagerService } from '../../services/git-manager.ts'
import { LLMService } from '../../services/llm.ts'
import { StateStore } from '../../services/state-store.ts'
import { TimelineService } from '../../services/timeline.ts'
import { WorkingDirService } from '../../services/working-dir.ts'
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
const generateRunSlug = (context?: string): string => {
  const date = new Date().toISOString().split('T')[0]! // YYYY-MM-DD, guaranteed to exist
  if (context) {
    const sanitizedContext = context.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    return `${date}-${sanitizedContext}`
  }
  return date
}

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

    // Initialize working directory structure if not exists
    yield* workingDirService.initializeDilagentStructure(resolvedWorkingDirectory)

    // Setup context directory as git repository
    const runId = generateRunSlug('hypothesis-generation')
    yield* gitManager.setupContextRepo(resolvedContextDirectory, resolvedWorkingDirectory, runId)
    const contextDir = workingDirService.getPaths(resolvedWorkingDirectory).contextRepo

    // Record timeline event
    yield* timelineService.recordEvent({
      event: 'Hypothesis generation phase started',
      phase: 'hypothesis-generation',
    })

    // Check for existing reproduction results
    const artifactsDir = workingDirService.getPaths(resolvedWorkingDirectory).artifacts
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
        debugLogPath: path.join(workingDirService.getPaths(resolvedWorkingDirectory).logs, 'generate-hypotheses.log'),
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
    const workingDirService = yield* WorkingDirService

    const hypothesesFile = path.join(workingDirService.getPaths(resolvedWorkingDirectory).artifacts, 'hypotheses.json')

    const hypothesesJson = yield* fs.readFileString(hypothesesFile)
    const hypotheses = yield* Schema.decode(Schema.parseJson(Schema.Array(HypothesisInputSchema)))(hypothesesJson)

    yield* Effect.log(`Loaded ${hypotheses.length} hypotheses from ${hypothesesFile}`)

    return hypotheses
  }).pipe(Effect.withSpan('loadExperiments'))

export const reproduceIssue = ({
  problemPrompt,
  resolvedContextDirectory,
  resolvedWorkingDirectory,
  isFlaky,
  userFeedback,
}: {
  problemPrompt: string
  resolvedContextDirectory: string
  resolvedWorkingDirectory: string
  isFlaky: boolean
  userFeedback?: string[]
}) =>
  Effect.gen(function* () {
    const llm = yield* LLMService
    const fs = yield* FileSystem.FileSystem
    const workingDirService = yield* WorkingDirService
    const _stateStore = yield* StateStore
    const timelineService = yield* TimelineService
    const gitManager = yield* GitManagerService

    // Initialize working directory structure
    yield* workingDirService.initializeDilagentStructure(resolvedWorkingDirectory)

    // Generate run ID and setup context directory as git repository
    const runId = generateRunSlug('reproduction')
    yield* gitManager.setupContextRepo(resolvedContextDirectory, resolvedWorkingDirectory, runId)
    const contextDir = workingDirService.getPaths(resolvedWorkingDirectory).contextRepo

    // Initialize timeline
    yield* timelineService.initializeTimeline(resolvedWorkingDirectory, runId)
    yield* timelineService.enableAutoPersist()
    yield* timelineService.recordEvent({
      event: 'Reproduction phase started',
      phase: 'reproduction',
    })

    // Check for existing reproduction results
    const reproductionJson = yield* fs
      .readFileString(path.join(workingDirService.getPaths(resolvedWorkingDirectory).artifacts, 'reproduction.json'))
      .pipe(
        Effect.andThen(Schema.decode(Schema.parseJson(ReproductionResultFile))),
        Effect.catchAll(() => Effect.succeed(undefined as ReproductionResult | undefined)),
      )

    // Determine which prompt to use
    const prompt =
      reproductionJson?._tag === 'NeedMoreInfo' && userFeedback
        ? refineReproductionPrompt({
            problemPrompt,
            contextDirectory: contextDir,
            isFlaky,
            previousAttempt: reproductionJson,
            userFeedback,
          })
        : initialReproductionPrompt({
            problemPrompt,
            contextDirectory: contextDir,
            isFlaky,
          })

    yield* Effect.log('Starting issue reproduction...')
    yield* timelineService.recordEvent({
      event: 'LLM reproduction request started',
      phase: 'reproduction',
    })

    const reproductionResult = yield* llm
      .prompt(prompt, {
        systemPrompt: reproductionSystemPrompt,
        useBestModel: true,
        skipPermissions: true,
        workingDir: contextDir,
        debugLogPath: path.join(workingDirService.getPaths(resolvedWorkingDirectory).logs, 'reproduction.log'),
      })
      .pipe(
        Effect.timeout('20 minutes'),
        Effect.andThen(Schema.decode(ReproductionResultFile)),
        Effect.withSpan('reproduceIssue'),
      )

    // Save reproduction result as artifact
    const artifactsDir = workingDirService.getPaths(resolvedWorkingDirectory).artifacts
    const reproductionFile = path.join(artifactsDir, 'reproduction.json')
    const reproductionJsonContent = yield* Schema.encode(Schema.parseJson(ReproductionResultFile))(reproductionResult)
    yield* fs.writeFileString(reproductionFile, reproductionJsonContent)

    // Record timeline event
    yield* timelineService.recordEvent({
      event: `Reproduction ${reproductionResult._tag.toLowerCase()}`,
      phase: 'reproduction',
      metadata:
        reproductionResult._tag === 'Success'
          ? { confidence: reproductionResult.confidence, type: reproductionResult.reproductionType }
          : undefined,
    })

    // If successful, also save the repro.ts script
    if (reproductionResult._tag === 'Success') {
      const reproScriptFile = path.join(artifactsDir, 'repro.ts')
      yield* fs.writeFileString(reproScriptFile, reproductionResult.reproScript)

      const typeLabel = {
        immediate: '⚡',
        delayed: '⏳',
        environmental: '🔧',
      }[reproductionResult.reproductionType]

      yield* Effect.log(`✅ Reproduction created (${typeLabel} ${reproductionResult.reproductionType})`)

      if (reproductionResult.executionTimeMs !== undefined) {
        yield* Effect.log(`⏱️  Execution time: ${reproductionResult.executionTimeMs}ms`)
      }

      if (reproductionResult.setupRequirements?.length) {
        yield* Effect.log(`📋 Setup required: ${reproductionResult.setupRequirements.join(', ')}`)
      }

      if (reproductionResult.minimizationNotes) {
        yield* Effect.log(`📝 ${reproductionResult.minimizationNotes}`)
      }

      yield* Effect.log(`📄 Reproduction script saved to ${reproScriptFile}`)
    }

    return reproductionResult
  }).pipe(Effect.withSpan('reproduceIssue'))

export const loadReproduction = (resolvedWorkingDirectory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const workingDirService = yield* WorkingDirService

    const reproductionFile = path.join(
      workingDirService.getPaths(resolvedWorkingDirectory).artifacts,
      'reproduction.json',
    )

    const reproductionJson = yield* fs.readFileString(reproductionFile)
    const reproduction = yield* Schema.decode(Schema.parseJson(ReproductionResultFile))(reproductionJson)

    yield* Effect.log(`Loaded reproduction result from ${reproductionFile}`)

    return reproduction
  }).pipe(Effect.withSpan('loadReproduction'))
