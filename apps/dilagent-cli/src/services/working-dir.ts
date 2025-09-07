import * as Path from 'node:path'
import { FileSystem } from '@effect/platform'
import { Effect, Schema } from 'effect'
import type { DilagentConfig, DilagentState, Timeline } from '../schemas/file-management.ts'
import {
  DilagentConfig as DilagentConfigSchema,
  DilagentState as DilagentStateSchema,
  Timeline as TimelineSchema,
} from '../schemas/file-management.ts'

// Error types for FileSystemService
export class FileSystemError extends Schema.TaggedError<FileSystemError>()('FileSystemError', {
  cause: Schema.Defect,
  message: Schema.String,
  path: Schema.optional(Schema.String),
}) {}

export class DirectoryExistsError extends Schema.TaggedError<DirectoryExistsError>()('DirectoryExistsError', {
  path: Schema.String,
  message: Schema.String,
}) {}

/**
 * Service for managing the .dilagent working directory structure
 *
 * Responsible for:
 * - Creating the complete .dilagent working directory structure
 * - Creating hypothesis-specific directories
 * - Handling directory existence gracefully
 */
export class WorkingDirService extends Effect.Service<WorkingDirService>()('WorkingDirService', {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    /**
     * Initialize the complete .dilagent directory structure
     *
     * Creates:
     * - .dilagent/
     * - .dilagent/logs/
     * - .dilagent/artifacts/
     * - .dilagent/context-repo/ (empty, will be populated by GitManager)
     *
     * @param workingDir - The working directory where .dilagent should be created
     * @returns Effect that succeeds when structure is created
     */
    const initializeDilagentStructure = Effect.fn('WorkingDirService.initializeDilagentStructure')(function* (
      workingDir: string,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const dilagentDir = Path.join(workingDir, '.dilagent')

      // Create main .dilagent directory
      yield* ensureDirectory(dilagentDir)

      // Create subdirectories
      yield* ensureDirectory(Path.join(dilagentDir, 'logs'))
      yield* ensureDirectory(Path.join(dilagentDir, 'artifacts'))
      yield* ensureDirectory(Path.join(dilagentDir, 'context-repo'))

      yield* Effect.log(`Initialized .dilagent structure in ${dilagentDir}`)
    })

    /**
     * Ensure a directory exists, creating it if necessary
     *
     * @param dirPath - Absolute path to directory
     * @returns Effect that succeeds when directory exists
     */
    const ensureDirectory = Effect.fn('WorkingDirService.ensureDirectory')(function* (dirPath: string) {
      yield* Effect.annotateCurrentSpan({ dirPath })

      // Check if directory already exists
      const exists = yield* fs.exists(dirPath)

      if (exists) {
        // Verify it's actually a directory
        const stat = yield* fs.stat(dirPath).pipe(
          Effect.catchAll(
            (error) =>
              new FileSystemError({
                cause: error,
                message: `Failed to stat ${dirPath}`,
                path: dirPath,
              }),
          ),
        )

        if (stat.type !== 'Directory') {
          return yield* new FileSystemError({
            cause: new Error('Path exists but is not a directory'),
            message: `Path ${dirPath} exists but is not a directory`,
            path: dirPath,
          })
        }

        yield* Effect.log(`Directory already exists: ${dirPath}`)
        return
      }

      // Create directory with recursive flag
      yield* fs.makeDirectory(dirPath, { recursive: true }).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to create directory ${dirPath}`,
              path: dirPath,
            }),
        ),
      )

      yield* Effect.log(`Created directory: ${dirPath}`)
    })

    /**
     * Create a hypothesis-specific directory
     *
     * Creates: .dilagent/H{NNN}/
     *
     * @param workingDir - The working directory containing .dilagent
     * @param hypothesisId - The hypothesis ID (e.g., "H001")
     * @returns Effect that succeeds when directory is created
     */
    const createHypothesisDirectory = Effect.fn('WorkingDirService.createHypothesisDirectory')(function* (
      workingDir: string,
      hypothesisId: string,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir, hypothesisId })

      const hypothesisDir = Path.join(workingDir, '.dilagent', hypothesisId)
      yield* ensureDirectory(hypothesisDir)
      yield* Effect.log(`Created hypothesis directory: ${hypothesisDir}`)
    })

    /**
     * Check if .dilagent structure exists and is valid
     *
     * @param workingDir - The working directory to check
     * @returns Effect that succeeds with boolean indicating if structure exists
     */
    const validateDilagentStructure = Effect.fn('WorkingDirService.validateDilagentStructure')(function* (
      workingDir: string,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const dilagentDir = Path.join(workingDir, '.dilagent')
      const requiredDirs = [
        dilagentDir,
        Path.join(dilagentDir, 'logs'),
        Path.join(dilagentDir, 'artifacts'),
        Path.join(dilagentDir, 'context-repo'),
      ]

      for (const dir of requiredDirs) {
        const exists = yield* fs.exists(dir)
        if (!exists) {
          yield* Effect.log(`Missing required directory: ${dir}`)
          return false
        }

        const stat = yield* fs.stat(dir).pipe(Effect.catchAll(() => Effect.succeed({ type: 'File' as const })))

        if (stat.type !== 'Directory') {
          yield* Effect.log(`Path is not a directory: ${dir}`)
          return false
        }
      }

      return true
    })

    /**
     * Get the .dilagent directory path for a working directory
     *
     * @param workingDir - The working directory
     * @returns The absolute path to .dilagent directory
     */
    const getDilagentPath = (workingDir: string): string => {
      return Path.resolve(workingDir, '.dilagent')
    }

    /**
     * Get paths for various .dilagent subdirectories
     *
     * @param workingDir - The working directory
     * @returns Object with paths to all subdirectories
     */
    const getPaths = (workingDir: string) => {
      const dilagent = getDilagentPath(workingDir)
      return {
        dilagent,
        logs: Path.join(dilagent, 'logs'),
        artifacts: Path.join(dilagent, 'artifacts'),
        contextRepo: Path.join(dilagent, 'context-repo'),
        hypothesisDir: (hypothesisId: string) => Path.join(dilagent, hypothesisId),
        configFile: Path.join(dilagent, 'config.json'),
        stateFile: Path.join(dilagent, 'state.json'),
        timelineFile: Path.join(dilagent, 'timeline.json'),
      }
    }

    /**
     * Write DilagentConfig to config.json
     *
     * @param workingDir - Working directory containing .dilagent
     * @param config - DilagentConfig to write
     * @returns Effect that succeeds when config is written
     */
    const writeConfig = Effect.fn('WorkingDirService.writeConfig')(function* (
      workingDir: string,
      config: DilagentConfig,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const paths = getPaths(workingDir)
      const configJson = yield* Schema.encode(Schema.parseJson(DilagentConfigSchema))(config).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to encode config for ${paths.configFile}`,
              path: paths.configFile,
            }),
        ),
      )

      yield* fs.writeFileString(paths.configFile, configJson).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to write config to ${paths.configFile}`,
              path: paths.configFile,
            }),
        ),
      )

      yield* Effect.log(`Written config to ${paths.configFile}`)
    })

    /**
     * Read DilagentConfig from config.json
     *
     * @param workingDir - Working directory containing .dilagent
     * @returns Effect that succeeds with DilagentConfig
     */
    const readConfig = Effect.fn('WorkingDirService.readConfig')(function* (workingDir: string) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const paths = getPaths(workingDir)

      const configContent = yield* fs.readFileString(paths.configFile).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to read config from ${paths.configFile}`,
              path: paths.configFile,
            }),
        ),
      )

      return yield* Schema.decodeUnknown(Schema.parseJson(DilagentConfigSchema))(configContent).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to parse config from ${paths.configFile}`,
              path: paths.configFile,
            }),
        ),
      )
    })

    /**
     * Write DilagentState to state.json
     *
     * @param workingDir - Working directory containing .dilagent
     * @param state - DilagentState to write
     * @returns Effect that succeeds when state is written
     */
    const writeState = Effect.fn('WorkingDirService.writeState')(function* (workingDir: string, state: DilagentState) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const paths = getPaths(workingDir)
      const stateJson = yield* Schema.encode(Schema.parseJson(DilagentStateSchema))(state).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to encode state for ${paths.stateFile}`,
              path: paths.stateFile,
            }),
        ),
      )

      yield* fs.writeFileString(paths.stateFile, stateJson).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to write state to ${paths.stateFile}`,
              path: paths.stateFile,
            }),
        ),
      )

      yield* Effect.log(`Written state to ${paths.stateFile}`)
    })

    /**
     * Read DilagentState from state.json
     *
     * @param workingDir - Working directory containing .dilagent
     * @returns Effect that succeeds with DilagentState
     */
    const readState = Effect.fn('WorkingDirService.readState')(function* (workingDir: string) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const paths = getPaths(workingDir)

      const stateContent = yield* fs.readFileString(paths.stateFile).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to read state from ${paths.stateFile}`,
              path: paths.stateFile,
            }),
        ),
      )

      return yield* Schema.decodeUnknown(Schema.parseJson(DilagentStateSchema))(stateContent).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to parse state from ${paths.stateFile}`,
              path: paths.stateFile,
            }),
        ),
      )
    })

    /**
     * Write Timeline to timeline.json
     *
     * @param workingDir - Working directory containing .dilagent
     * @param timeline - Timeline to write
     * @returns Effect that succeeds when timeline is written
     */
    const writeTimeline = Effect.fn('WorkingDirService.writeTimeline')(function* (
      workingDir: string,
      timeline: Timeline,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const paths = getPaths(workingDir)
      const timelineJson = yield* Schema.encode(Schema.parseJson(TimelineSchema))(timeline).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to encode timeline for ${paths.timelineFile}`,
              path: paths.timelineFile,
            }),
        ),
      )

      yield* fs.writeFileString(paths.timelineFile, timelineJson).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to write timeline to ${paths.timelineFile}`,
              path: paths.timelineFile,
            }),
        ),
      )

      yield* Effect.log(`Written timeline to ${paths.timelineFile}`)
    })

    /**
     * Read Timeline from timeline.json
     *
     * @param workingDir - Working directory containing .dilagent
     * @returns Effect that succeeds with Timeline
     */
    const readTimeline = Effect.fn('WorkingDirService.readTimeline')(function* (workingDir: string) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const paths = getPaths(workingDir)

      const timelineContent = yield* fs.readFileString(paths.timelineFile).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to read timeline from ${paths.timelineFile}`,
              path: paths.timelineFile,
            }),
        ),
      )

      return yield* Schema.decodeUnknown(Schema.parseJson(TimelineSchema))(timelineContent).pipe(
        Effect.catchAll(
          (error) =>
            new FileSystemError({
              cause: error,
              message: `Failed to parse timeline from ${paths.timelineFile}`,
              path: paths.timelineFile,
            }),
        ),
      )
    })

    return {
      initializeDilagentStructure,
      ensureDirectory,
      createHypothesisDirectory,
      validateDilagentStructure,
      getDilagentPath,
      getPaths,
      writeConfig,
      readConfig,
      writeState,
      readState,
      writeTimeline,
      readTimeline,
    } as const
  }),

  dependencies: [],
}) {}
