import * as Path from 'node:path'
import { FileSystem } from '@effect/platform'
import { Effect, Schema } from 'effect'

// Error types for WorkingDirService
export class FileSystemError extends Schema.TaggedError<FileSystemError>()('FileSystemError', {
  cause: Schema.Defect,
  message: Schema.String,
  path: Schema.optional(Schema.String),
}) {}

export class WorkingDirNotInitializedError extends Schema.TaggedError<WorkingDirNotInitializedError>()(
  'WorkingDirNotInitializedError',
  {
    workingDir: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Service for managing directory structure and paths
 *
 * Responsibilities:
 * - Provides all paths as a single source of truth
 * - Ensures directory structure exists on initialization
 * - NO file I/O operations (just directory creation)
 */
export class WorkingDirService extends Effect.Service<WorkingDirService>()('WorkingDirService', {
  effect: ({ workingDir, create = false }: { workingDir: string; create?: boolean }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem

      // Define all paths immutably
      const paths = {
        dilagent: Path.resolve(workingDir, '.dilagent'),
        logs: Path.resolve(workingDir, '.dilagent', 'logs'),
        artifacts: Path.resolve(workingDir, '.dilagent', 'artifacts'),
        contextRepo: Path.resolve(workingDir, '.dilagent', 'context-repo'),
        stateFile: Path.resolve(workingDir, '.dilagent', 'state.json'),
        timelineFile: Path.resolve(workingDir, '.dilagent', 'timeline.json'),

        // Hypothesis directory includes both ID and slug
        hypothesisDir: ({ hypothesisId, hypothesisSlug }: { hypothesisId: string; hypothesisSlug: string }): string => {
          return Path.resolve(workingDir, '.dilagent', `${hypothesisId}-${hypothesisSlug}`)
        },
      } as const

      // Ensure a directory exists, creating it if necessary
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

          yield* Effect.logDebug(`[WorkingDirService] Directory already exists: ${dirPath}`)
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

        yield* Effect.logDebug(`[WorkingDirService] Created directory: ${dirPath}`)
      })

      // Helper to create hypothesis-specific directory
      const ensureHypothesisDir = ({
        hypothesisId,
        hypothesisSlug,
      }: {
        hypothesisId: string
        hypothesisSlug: string
      }) =>
        Effect.gen(function* () {
          const dir = paths.hypothesisDir({ hypothesisId, hypothesisSlug })
          yield* ensureDirectory(dir)
          yield* Effect.logDebug(`[WorkingDirService] Created hypothesis directory: ${dir}`)
          return dir
        })

      // Helper for validation (for tests)
      const validateDilagentStructure = () =>
        Effect.gen(function* () {
          const requiredDirs = [paths.dilagent, paths.logs, paths.artifacts, paths.contextRepo]

          for (const dir of requiredDirs) {
            const exists = yield* fs.exists(dir)
            if (!exists) {
              return false
            }

            const stat = yield* fs.stat(dir).pipe(Effect.catchAll(() => Effect.succeed({ type: 'File' as const })))
            if (stat.type !== 'Directory') {
              return false
            }
          }

          return true
        })

      // Initialize directories based on create flag
      if (create) {
        // Create all base directories during initialization
        yield* Effect.all([
          ensureDirectory(paths.dilagent),
          ensureDirectory(paths.logs),
          ensureDirectory(paths.artifacts),
          ensureDirectory(paths.contextRepo),
        ])
        yield* Effect.logDebug(`[WorkingDirService] Created working directory structure at ${workingDir}`)
      } else {
        // Validate that the required directories exist
        const isInitialized = yield* validateDilagentStructure()
        if (!isInitialized) {
          return yield* new WorkingDirNotInitializedError({
            workingDir,
            message: `Dilagent working directory not initialized at ${workingDir}. Run 'dilagent manager setup' first.`,
          })
        }
        yield* Effect.logDebug(`[WorkingDirService] Validated existing working directory structure at ${workingDir}`)
      }

      return {
        paths,
        workingDir,
        ensureHypothesisDir,
      } as const
    }),
}) {}
