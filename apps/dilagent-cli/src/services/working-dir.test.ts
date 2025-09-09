import * as fs from 'node:fs'
import * as os from 'node:os'
import * as Path from 'node:path'
import { FileSystem } from '@effect/platform'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkingDirService } from './working-dir.ts'

describe('WorkingDirService', () => {
  let testDir: string

  const TestLayer = (testDir: string) =>
    WorkingDirService.Default({ workingDir: testDir, create: true }).pipe(
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

        // Verify all directories were created
        const fs = yield* FileSystem.FileSystem
        const paths = service.paths

        const dilagentExists = yield* fs.exists(paths.dilagent)
        const logsExists = yield* fs.exists(paths.logs)
        const artifactsExists = yield* fs.exists(paths.artifacts)
        const contextRepoExists = yield* fs.exists(paths.contextRepo)

        expect(dilagentExists).toBe(true)
        expect(logsExists).toBe(true)
        expect(artifactsExists).toBe(true)
        expect(contextRepoExists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })

    it('should handle nested working directories', async () => {
      const nestedDir = Path.join(testDir, 'nested', 'deep', 'structure')

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        // yield* service.initializeDilagentStructure(nestedDir)

        const paths = service.paths
        const fs = yield* FileSystem.FileSystem

        const exists = yield* fs.exists(paths.dilagent)
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(nestedDir))))
    })
  })

  describe('createHypothesisDirectory', () => {
    it('should create hypothesis directory', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        yield* service.ensureHypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' })

        const paths = service.paths
        const fs = yield* FileSystem.FileSystem
        const exists = yield* fs.exists(
          paths.hypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' }),
        )
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })

    it('should handle multiple hypothesis directories', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService

        yield* service.ensureHypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' })
        yield* service.ensureHypothesisDir({ hypothesisId: 'H002', hypothesisSlug: 'test-hypothesis-2' })
        yield* service.ensureHypothesisDir({ hypothesisId: 'H010', hypothesisSlug: 'test-hypothesis-10' })

        const paths = service.paths
        const fs = yield* FileSystem.FileSystem

        const h001Exists = yield* fs.exists(
          paths.hypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' }),
        )
        const h002Exists = yield* fs.exists(
          paths.hypothesisDir({ hypothesisId: 'H002', hypothesisSlug: 'test-hypothesis-2' }),
        )
        const h010Exists = yield* fs.exists(
          paths.hypothesisDir({ hypothesisId: 'H010', hypothesisSlug: 'test-hypothesis-10' }),
        )

        expect(h001Exists).toBe(true)
        expect(h002Exists).toBe(true)
        expect(h010Exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })

    it('should be idempotent for same hypothesis ID', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService

        yield* service.ensureHypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' })
        yield* service.ensureHypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' })

        // Should succeed both times
        const paths = service.paths
        const fs = yield* FileSystem.FileSystem
        const exists = yield* fs.exists(
          paths.hypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' }),
        )
        expect(exists).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })
  })

  describe('getPaths', () => {
    it('should return correct paths for all directories', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const paths = service.paths

        expect(paths.dilagent).toBe(Path.resolve(testDir, '.dilagent'))
        expect(paths.logs).toBe(Path.resolve(testDir, '.dilagent', 'logs'))
        expect(paths.artifacts).toBe(Path.resolve(testDir, '.dilagent', 'artifacts'))
        expect(paths.contextRepo).toBe(Path.resolve(testDir, '.dilagent', 'context-repo'))
        expect(paths.hypothesisDir({ hypothesisId: 'H001', hypothesisSlug: 'test-hypothesis' })).toBe(
          Path.resolve(testDir, '.dilagent', 'H001-test-hypothesis'),
        )
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })

    it('should handle relative working directory paths', async () => {
      const relativePath = Path.relative(process.cwd(), testDir)

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const paths = service.paths

        // Should resolve to absolute paths
        expect(Path.isAbsolute(paths.dilagent)).toBe(true)
        expect(paths.dilagent).toBe(Path.resolve(relativePath, '.dilagent'))
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })
  })

  describe('getDilagentPath', () => {
    it('should return absolute path to .dilagent directory', async () => {
      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const dilagentPath = service.paths.dilagent

        expect(dilagentPath).toBe(Path.resolve(testDir, '.dilagent'))
        expect(Path.isAbsolute(dilagentPath)).toBe(true)
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })

    it('should resolve relative paths', async () => {
      const relativePath = Path.relative(process.cwd(), testDir)

      const program = Effect.gen(function* () {
        const service = yield* WorkingDirService
        const dilagentPath = service.paths.dilagent

        expect(Path.isAbsolute(dilagentPath)).toBe(true)
        expect(dilagentPath).toBe(Path.resolve(relativePath, '.dilagent'))
      })

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer(testDir))))
    })
  })
})
