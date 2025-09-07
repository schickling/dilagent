import * as fs from 'node:fs'
import * as os from 'node:os'
import * as Path from 'node:path'
import { FileSystem } from '@effect/platform'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DilagentConfig, DilagentState, Timeline } from '../schemas/file-management.ts'
import { WorkingDirService } from './working-dir.ts'

describe('WorkingDirService', () => {
  let testDir: string

  // Create test layer with all dependencies
  const TestLayer = WorkingDirService.Default.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)),
  )

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = await new Promise<string>((resolve, reject) => {
      fs.mkdtemp(Path.join(os.tmpdir(), 'dilagent-test-'), (err, dir) => {
        if (err) reject(err)
        else resolve(dir)
      })
    })
  })

  afterEach(async () => {
    // Clean up test directory
    await new Promise<void>((resolve) => {
      fs.rm(testDir, { recursive: true, force: true }, () => resolve())
    })
  })

  describe('initializeDilagentStructure', () => {
    it('should create complete .dilagent directory structure', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.initializeDilagentStructure(testDir)

        // Verify all directories were created
        const fs = yield* FileSystem.FileSystem
        const paths = service.getPaths(testDir)

        const dilagentExists = yield* fs.exists(paths.dilagent)
        const logsExists = yield* fs.exists(paths.logs)
        const artifactsExists = yield* fs.exists(paths.artifacts)
        const contextRepoExists = yield* fs.exists(paths.contextRepo)

        expect(dilagentExists).toBe(true)
        expect(logsExists).toBe(true)
        expect(artifactsExists).toBe(true)
        expect(contextRepoExists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should be idempotent - not fail if directories already exist', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService

        // Initialize twice
        yield* service.initializeDilagentStructure(testDir)
        yield* service.initializeDilagentStructure(testDir)

        // Should succeed both times
        const isValid = yield* service.validateDilagentStructure(testDir)
        expect(isValid).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should handle nested working directories', async () => {
      const nestedDir = Path.join(testDir, 'nested', 'deep', 'structure')

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.initializeDilagentStructure(nestedDir)

        const paths = service.getPaths(nestedDir)
        const fs = yield* FileSystem.FileSystem

        const exists = yield* fs.exists(paths.dilagent)
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe('ensureDirectory', () => {
    it('should create directory if it does not exist', async () => {
      const newDir = Path.join(testDir, 'new-directory')

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.ensureDirectory(newDir)

        const fs = yield* FileSystem.FileSystem
        const exists = yield* fs.exists(newDir)
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should succeed if directory already exists', async () => {
      // Pre-create directory
      fs.mkdirSync(Path.join(testDir, 'existing'), { recursive: true })
      const existingDir = Path.join(testDir, 'existing')

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.ensureDirectory(existingDir)

        // Should not throw
        expect(true).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should fail if path exists but is not a directory', async () => {
      // Create a file at the path
      const filePath = Path.join(testDir, 'not-a-directory')
      fs.writeFileSync(filePath, 'content')

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.ensureDirectory(filePath)
      })

      await expect(Effect.runPromise(program.pipe(Effect.provide(TestLayer)))).rejects.toThrow()
    })

    it('should create nested directories recursively', async () => {
      const nestedPath = Path.join(testDir, 'level1', 'level2', 'level3')

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.ensureDirectory(nestedPath)

        const fs = yield* FileSystem.FileSystem
        const exists = yield* fs.exists(nestedPath)
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe('createHypothesisDirectory', () => {
    beforeEach(async () => {
      // Initialize .dilagent structure for hypothesis tests
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.initializeDilagentStructure(testDir)
      })
      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should create hypothesis directory', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.createHypothesisDirectory(testDir, 'H001')

        const paths = service.getPaths(testDir)
        const fs = yield* FileSystem.FileSystem
        const exists = yield* fs.exists(paths.hypothesisDir('H001'))
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should handle multiple hypothesis directories', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService

        yield* service.createHypothesisDirectory(testDir, 'H001')
        yield* service.createHypothesisDirectory(testDir, 'H002')
        yield* service.createHypothesisDirectory(testDir, 'H010')

        const paths = service.getPaths(testDir)
        const fs = yield* FileSystem.FileSystem

        const h001Exists = yield* fs.exists(paths.hypothesisDir('H001'))
        const h002Exists = yield* fs.exists(paths.hypothesisDir('H002'))
        const h010Exists = yield* fs.exists(paths.hypothesisDir('H010'))

        expect(h001Exists).toBe(true)
        expect(h002Exists).toBe(true)
        expect(h010Exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should be idempotent for same hypothesis ID', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService

        yield* service.createHypothesisDirectory(testDir, 'H001')
        yield* service.createHypothesisDirectory(testDir, 'H001')

        // Should succeed both times
        const paths = service.getPaths(testDir)
        const fs = yield* FileSystem.FileSystem
        const exists = yield* fs.exists(paths.hypothesisDir('H001'))
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe('validateDilagentStructure', () => {
    it('should return false for non-existent structure', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const isValid = yield* service.validateDilagentStructure(testDir)
        expect(isValid).toBe(false)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should return true for complete structure', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService

        yield* service.initializeDilagentStructure(testDir)
        const isValid = yield* service.validateDilagentStructure(testDir)
        expect(isValid).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should return false for incomplete structure', async () => {
      // Create partial structure manually
      const dilagentDir = Path.join(testDir, '.dilagent')
      fs.mkdirSync(dilagentDir)
      fs.mkdirSync(Path.join(dilagentDir, 'logs'))
      // Missing artifacts and context-repo

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const isValid = yield* service.validateDilagentStructure(testDir)
        expect(isValid).toBe(false)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should return false if required path is a file instead of directory', async () => {
      // Create structure but replace logs directory with a file
      const dilagentDir = Path.join(testDir, '.dilagent')
      fs.mkdirSync(dilagentDir)
      fs.writeFileSync(Path.join(dilagentDir, 'logs'), 'not a directory')
      fs.mkdirSync(Path.join(dilagentDir, 'artifacts'))
      fs.mkdirSync(Path.join(dilagentDir, 'context-repo'))

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const isValid = yield* service.validateDilagentStructure(testDir)
        expect(isValid).toBe(false)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe('getPaths', () => {
    it('should return correct paths for all directories', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const paths = service.getPaths(testDir)

        expect(paths.dilagent).toBe(Path.resolve(testDir, '.dilagent'))
        expect(paths.logs).toBe(Path.resolve(testDir, '.dilagent', 'logs'))
        expect(paths.artifacts).toBe(Path.resolve(testDir, '.dilagent', 'artifacts'))
        expect(paths.contextRepo).toBe(Path.resolve(testDir, '.dilagent', 'context-repo'))
        expect(paths.hypothesisDir('H001')).toBe(Path.resolve(testDir, '.dilagent', 'H001'))
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should handle relative working directory paths', async () => {
      const relativePath = Path.relative(process.cwd(), testDir)

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const paths = service.getPaths(relativePath)

        // Should resolve to absolute paths
        expect(Path.isAbsolute(paths.dilagent)).toBe(true)
        expect(paths.dilagent).toBe(Path.resolve(relativePath, '.dilagent'))
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe('getDilagentPath', () => {
    it('should return absolute path to .dilagent directory', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const dilagentPath = service.getDilagentPath(testDir)

        expect(dilagentPath).toBe(Path.resolve(testDir, '.dilagent'))
        expect(Path.isAbsolute(dilagentPath)).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    it('should resolve relative paths', async () => {
      const relativePath = Path.relative(process.cwd(), testDir)

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const dilagentPath = service.getDilagentPath(relativePath)

        expect(Path.isAbsolute(dilagentPath)).toBe(true)
        expect(dilagentPath).toBe(Path.resolve(relativePath, '.dilagent'))
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })
  })

  describe('error handling', () => {
    it('should provide meaningful error when trying to ensure directory on restricted path', async () => {
      // Try to create directory in restricted location
      const restrictedPath = '/root/nonexistent/path'

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.ensureDirectory(restrictedPath)
      })

      await expect(Effect.runPromise(program.pipe(Effect.provide(TestLayer)))).rejects.toThrow(
        'Failed to create directory /root/nonexistent/path',
      )
    })

    it('should handle permission errors during directory creation', async () => {
      // Create a directory, then try to create a file with same name as subdirectory
      const basePath = Path.join(testDir, 'permission-test')
      const conflictPath = Path.join(basePath, 'conflict')

      // Create base directory and a file with conflicting name
      fs.mkdirSync(basePath, { recursive: true })
      fs.writeFileSync(conflictPath, 'blocking file')

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.ensureDirectory(conflictPath)
      })

      await expect(Effect.runPromise(program.pipe(Effect.provide(TestLayer)))).rejects.toThrow(
        'exists but is not a directory',
      )
    })
  })

  describe('config functionality', () => {
    beforeEach(async () => {
      // Initialize .dilagent structure for config tests
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.initializeDilagentStructure(testDir)
      })
      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
    })

    describe('writeConfig and readConfig', () => {
      it('should write and read DilagentConfig successfully', async () => {
        const testConfig: DilagentConfig = {
          runSlug: '2025-09-07-test',
          llm: 'claude',
          maxHypotheses: 5,
          parallelExecution: {
            enabled: true,
            maxConcurrent: 2,
          },
          managerPort: 8080,
          createdAt: '2025-09-07T12:34:56Z',
          problemStatement: 'Test problem statement',
          contextPath: '/test/context',
          workingDir: testDir,
          visibility: {
            logLevel: 'info',
            enableMetrics: true,
            enableTimeline: true,
          },
        }

        const program = Effect.gen(function* () {
          const service = yield* WorkingDirService

          // Write config
          yield* service.writeConfig(testDir, testConfig)

          // Read config back
          const readConfig = yield* service.readConfig(testDir)

          expect(readConfig).toEqual(testConfig)
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })

      it('should fail when reading non-existent config', async () => {
        const program = Effect.gen(function* () {
          const service = yield* WorkingDirService
          yield* service.readConfig(testDir)
        })

        await expect(Effect.runPromise(program.pipe(Effect.provide(TestLayer)))).rejects.toThrow()
      })
    })

    describe('writeState and readState', () => {
      it('should write and read DilagentState successfully', async () => {
        const testState: DilagentState = {
          runId: '2025-09-07-test',
          runSlug: '2025-09-07-test',
          contextDir: '/test/context',
          contextType: 'directory',
          createdAt: '2025-09-07T12:34:56Z',
          lastUpdated: '2025-09-07T12:35:00Z',
          currentPhase: 'reproduction',
          phaseStartedAt: '2025-09-07T12:34:56Z',
          reproduction: {
            status: 'pending',
            attempts: 0,
            confidence: 0.0,
          },
          hypotheses: [],
          parallelExecution: {
            enabled: true,
            maxConcurrent: 2,
            currentlyRunning: [],
          },
          overallProgress: {
            totalHypotheses: 0,
            completed: 0,
            failed: 0,
            remaining: 0,
          },
        }

        const program = Effect.gen(function* () {
          const service = yield* WorkingDirService

          // Write state
          yield* service.writeState(testDir, testState)

          // Read state back
          const readState = yield* service.readState(testDir)

          expect(readState).toEqual(testState)
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })
    })

    describe('writeTimeline and readTimeline', () => {
      it('should write and read Timeline successfully', async () => {
        const testTimeline: Timeline = {
          runId: '2025-09-07-test',
          createdAt: '2025-09-07T12:34:56Z',
          events: [
            {
              timestamp: '2025-09-07T12:34:56Z',
              event: 'Dilagent run started',
              phase: 'reproduction',
            },
            {
              timestamp: '2025-09-07T12:35:00Z',
              event: 'Hypothesis H001 started',
              hypothesisId: 'H001',
              phase: 'hypothesis-testing',
              metadata: {
                confidence: 0.8,
                description: 'Test hypothesis',
              },
            },
          ],
        }

        const program = Effect.gen(function* () {
          const service = yield* WorkingDirService

          // Write timeline
          yield* service.writeTimeline(testDir, testTimeline)

          // Read timeline back
          const readTimeline = yield* service.readTimeline(testDir)

          expect(readTimeline).toEqual(testTimeline)
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })
    })

    describe('getPaths', () => {
      it('should include file paths for config, state, and timeline', async () => {
        const program = Effect.gen(function* () {
          const service = yield* WorkingDirService
          const paths = service.getPaths(testDir)

          expect(paths.configFile).toBe(Path.resolve(testDir, '.dilagent', 'config.json'))
          expect(paths.stateFile).toBe(Path.resolve(testDir, '.dilagent', 'state.json'))
          expect(paths.timelineFile).toBe(Path.resolve(testDir, '.dilagent', 'timeline.json'))
        })

        await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
      })
    })
  })
})
