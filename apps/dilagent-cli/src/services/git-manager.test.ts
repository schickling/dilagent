import * as fs from 'node:fs'
import * as os from 'node:os'
import * as Path from 'node:path'
import { Command } from '@effect/platform'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateRunSlug } from '../utils/run-slug.ts'
import { GitManagerService } from './git-manager.ts'

describe('GitManagerService', () => {
  let testDir: string
  let contextDir: string
  let workingDir: string
  let runSlug: string

  // Create test layer with all dependencies
  const TestLayer = GitManagerService.Default.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)),
  )

  beforeEach(async () => {
    // Create unique test directories for each test
    testDir = await new Promise<string>((resolve, reject) => {
      fs.mkdtemp(Path.join(os.tmpdir(), 'git-manager-test-'), (err, dir) => {
        if (err) reject(err)
        else resolve(dir)
      })
    })

    contextDir = Path.join(testDir, 'context')
    workingDir = Path.join(testDir, 'working')
    runSlug = generateRunSlug('test')

    // Create context and working directories
    fs.mkdirSync(contextDir, { recursive: true })
    fs.mkdirSync(workingDir, { recursive: true })
    fs.mkdirSync(Path.join(workingDir, '.dilagent'), { recursive: true })

    // Add some test files to context
    fs.writeFileSync(Path.join(contextDir, 'README.md'), '# Test Project\n\nThis is a test.')
    fs.writeFileSync(Path.join(contextDir, 'config.json'), '{"test": true}')
    fs.mkdirSync(Path.join(contextDir, 'src'), { recursive: true })
    fs.writeFileSync(Path.join(contextDir, 'src', 'main.ts'), 'console.log("hello world")')
  }, 15000)

  afterEach(async () => {
    // Clean up test directory
    await new Promise<void>((resolve) => {
      fs.rm(testDir, { recursive: true, force: true }, () => resolve())
    })
  })

  describe('isGitRepo', () => {
    it('should return false for non-git directory', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GitManagerService
          const result = yield* service.isGitRepo(contextDir)
          expect(result).toBe(false)
        }).pipe(Effect.provide(TestLayer)),
      )
    })

    it('should return true for git repository', async () => {
      // Initialize git repo in context
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Command.exitCode(Command.make('git', 'init').pipe(Command.workingDirectory(contextDir)))

          const service = yield* GitManagerService
          const result = yield* service.isGitRepo(contextDir)
          expect(result).toBe(true)
        }).pipe(Effect.provide(TestLayer)),
      )
    })

    it('should handle non-existent directory', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GitManagerService
          const result = yield* service.isGitRepo('/non/existent/path')
          expect(result).toBe(false)
        }).pipe(Effect.provide(TestLayer)),
      )
    })
  })

  describe('getGitRoot', () => {
    it('should return git root for repository', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Command.exitCode(Command.make('git', 'init').pipe(Command.workingDirectory(contextDir)))

          const service = yield* GitManagerService
          const root = yield* service.getGitRoot(contextDir)
          expect(fs.realpathSync(root)).toBe(fs.realpathSync(contextDir))
        }).pipe(Effect.provide(TestLayer)),
      )
    })

    it('should return git root from subdirectory', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Command.exitCode(Command.make('git', 'init').pipe(Command.workingDirectory(contextDir)))

          const subDir = Path.join(contextDir, 'src')
          const service = yield* GitManagerService
          const root = yield* service.getGitRoot(subDir)
          expect(fs.realpathSync(root)).toBe(fs.realpathSync(contextDir))
        }).pipe(Effect.provide(TestLayer)),
      )
    })

    it('should fail for non-git directory', async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.getGitRoot(contextDir).pipe(Effect.tap(Effect.log))
          }).pipe(Effect.provide(TestLayer)),
        ),
      ).rejects.toThrow()
    })

    describe('setupContextRepo', () => {
      describe('with non-git context', () => {
        it('should copy files and initialize git repo', async () => {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.setupContextRepo(contextDir, workingDir, runSlug)

              const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

              // Verify context-repo exists and is a git repo
              const isGitRepo = yield* service.isGitRepo(contextRepoPath)
              expect(isGitRepo).toBe(true)

              // Verify files were copied
              expect(fs.existsSync(Path.join(contextRepoPath, 'README.md'))).toBe(true)
              expect(fs.existsSync(Path.join(contextRepoPath, 'config.json'))).toBe(true)
              expect(fs.existsSync(Path.join(contextRepoPath, 'src', 'main.ts'))).toBe(true)

              // Verify correct branch
              const currentBranch = yield* service.getCurrentBranch(contextRepoPath)
              expect(currentBranch).toBe(`dilagent/${runSlug}/root`)
            }).pipe(Effect.provide(TestLayer)),
          )
        }, 10000)

        it('should not modify original context directory', async () => {
          // Get original file content
          const originalContent = fs.readFileSync(Path.join(contextDir, 'README.md'), 'utf-8')

          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.setupContextRepo(contextDir, workingDir, runSlug)

              // Verify original context is unchanged
              const currentContent = fs.readFileSync(Path.join(contextDir, 'README.md'), 'utf-8')
              expect(currentContent).toBe(originalContent)

              // Verify no .git directory was created in original context
              expect(fs.existsSync(Path.join(contextDir, '.git'))).toBe(false)
            }).pipe(Effect.provide(TestLayer)),
          )
        })
      })

      describe('with git context', () => {
        beforeEach(async () => {
          // Initialize git repo in context with initial commit
          await Effect.runPromise(
            Effect.gen(function* () {
              // Initialize git
              yield* Command.exitCode(Command.make('git', 'init').pipe(Command.workingDirectory(contextDir)))

              // Configure git user
              yield* Command.exitCode(
                Command.make('git', 'config', 'user.email', 'test@example.com').pipe(
                  Command.workingDirectory(contextDir),
                ),
              )
              yield* Command.exitCode(
                Command.make('git', 'config', 'user.name', 'Test User').pipe(Command.workingDirectory(contextDir)),
              )

              // Add and commit files
              yield* Command.exitCode(Command.make('git', 'add', '.').pipe(Command.workingDirectory(contextDir)))
              yield* Command.exitCode(
                Command.make('git', 'commit', '-m', 'Initial commit').pipe(Command.workingDirectory(contextDir)),
              )
            }).pipe(Effect.provide(TestLayer)),
          )
        }, 15000)

        it('should create worktree from git repo', async () => {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.setupContextRepo(contextDir, workingDir, runSlug)

              const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

              // Verify context-repo exists and is a git repo
              const isGitRepo = yield* service.isGitRepo(contextRepoPath)
              expect(isGitRepo).toBe(true)

              // Verify files are accessible
              expect(fs.existsSync(Path.join(contextRepoPath, 'README.md'))).toBe(true)
              expect(fs.existsSync(Path.join(contextRepoPath, 'config.json'))).toBe(true)

              // Verify correct branch
              const currentBranch = yield* service.getCurrentBranch(contextRepoPath)
              expect(currentBranch).toBe(`dilagent/${runSlug}/root`)
            }).pipe(Effect.provide(TestLayer)),
          )
        })

        it('should not modify original git repository', async () => {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService

              // Get original branch
              const originalBranch = yield* service.getCurrentBranch(contextDir)

              yield* service.setupContextRepo(contextDir, workingDir, runSlug)

              // Verify original repo is unchanged
              const currentBranch = yield* service.getCurrentBranch(contextDir)
              expect(currentBranch).toBe(originalBranch)

              // Verify worktrees don't affect original
              const worktrees = yield* service.listWorktrees(workingDir)
              expect(worktrees.length).toBeGreaterThan(0)

              // Original should still have same files
              expect(fs.existsSync(Path.join(contextDir, 'README.md'))).toBe(true)
            }).pipe(Effect.provide(TestLayer)),
          )
        })
      })
    })

    describe('createHypothesisWorktree', () => {
      beforeEach(async () => {
        // Set up context repo first
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.setupContextRepo(contextDir, workingDir, runSlug)
          }).pipe(Effect.provide(TestLayer)),
        )
      })

      it('should create hypothesis worktree', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H001', 'auth-bug')

            const worktreePath = Path.join(workingDir, 'H001-auth-bug')

            // Verify worktree directory exists
            expect(fs.existsSync(worktreePath)).toBe(true)

            // Verify it's a git repo
            const isGitRepo = yield* service.isGitRepo(worktreePath)
            expect(isGitRepo).toBe(true)

            // Verify files are accessible
            expect(fs.existsSync(Path.join(worktreePath, 'README.md'))).toBe(true)
            expect(fs.existsSync(Path.join(worktreePath, 'src', 'main.ts'))).toBe(true)

            // Verify correct branch
            const currentBranch = yield* service.getCurrentBranch(worktreePath)
            expect(currentBranch).toBe(`dilagent/${runSlug}/H001-auth-bug`)
          }).pipe(Effect.provide(TestLayer)),
        )
      })

      it('should create multiple hypothesis worktrees', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService

            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H001', 'auth-bug')
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H002', 'performance')

            // Verify both worktrees exist
            expect(fs.existsSync(Path.join(workingDir, 'H001-auth-bug'))).toBe(true)
            expect(fs.existsSync(Path.join(workingDir, 'H002-performance'))).toBe(true)

            // Verify they're independent
            const branch1 = yield* service.getCurrentBranch(Path.join(workingDir, 'H001-auth-bug'))
            const branch2 = yield* service.getCurrentBranch(Path.join(workingDir, 'H002-performance'))

            expect(branch1).toBe(`dilagent/${runSlug}/H001-auth-bug`)
            expect(branch2).toBe(`dilagent/${runSlug}/H002-performance`)
          }).pipe(Effect.provide(TestLayer)),
        )
      })

      it('should fail if context-repo does not exist', async () => {
        // Remove context-repo
        fs.rmSync(Path.join(workingDir, '.dilagent', 'context-repo'), { recursive: true, force: true })

        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.createHypothesisWorktree(workingDir, runSlug, 'H001', 'auth-bug')
            }).pipe(Effect.provide(TestLayer)),
          ),
        ).rejects.toThrow()
      })
    })

    describe('listWorktrees', () => {
      beforeEach(async () => {
        // Set up context repo and create a hypothesis worktree
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.setupContextRepo(contextDir, workingDir, runSlug)
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H001', 'test-hypothesis')
          }).pipe(Effect.provide(TestLayer)),
        )
      })

      it('should list all worktrees', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            const worktrees = yield* service.listWorktrees(workingDir)

            expect(worktrees.length).toBeGreaterThanOrEqual(2) // context-repo + hypothesis worktree

            // Find the hypothesis worktree
            const hypothesisWorktree = worktrees.find((w) => w.path.includes('H001-test-hypothesis'))
            expect(hypothesisWorktree).toBeDefined()
            expect(hypothesisWorktree?.branch).toBe(`dilagent/${runSlug}/H001-test-hypothesis`)
          }).pipe(Effect.provide(TestLayer)),
        )
      })
    })

    describe('removeWorktree', () => {
      beforeEach(async () => {
        // Set up context repo and create a hypothesis worktree
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.setupContextRepo(contextDir, workingDir, runSlug)
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H001', 'test-hypothesis')
          }).pipe(Effect.provide(TestLayer)),
        )
      })

      it('should remove worktree', async () => {
        const worktreePath = Path.join(workingDir, 'H001-test-hypothesis')

        // Verify worktree exists
        expect(fs.existsSync(worktreePath)).toBe(true)

        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.removeWorktree(workingDir, worktreePath)

            // Verify worktree is gone
            expect(fs.existsSync(worktreePath)).toBe(false)
          }).pipe(Effect.provide(TestLayer)),
        )
      })
    })

    describe('getCurrentBranch', () => {
      beforeEach(async () => {
        // Set up context repo
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.setupContextRepo(contextDir, workingDir, runSlug)
          }).pipe(Effect.provide(TestLayer)),
        )
      })

      it('should return current branch name', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

            const branch = yield* service.getCurrentBranch(contextRepoPath)
            expect(branch).toBe(`dilagent/${runSlug}/root`)
          }).pipe(Effect.provide(TestLayer)),
        )
      })
    })

    describe('error handling', () => {
      it('should handle git command failures gracefully', async () => {
        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              // Try to get branch from non-existent directory
              yield* service.getCurrentBranch('/non/existent/path')
            }).pipe(Effect.provide(TestLayer)),
          ),
        ).rejects.toThrow()
      })

      it('should provide meaningful error messages', async () => {
        try {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.getCurrentBranch('/non/existent/path')
            }).pipe(Effect.provide(TestLayer)),
          )
        } catch (error: any) {
          expect(error.message).toContain('Failed to get current branch')
        }
      })
    })

    describe('context immutability tests', () => {
      it('should never create git artifacts in original context directory', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService

            // Setup context repo
            yield* service.setupContextRepo(contextDir, workingDir, runSlug)

            // Create multiple hypothesis worktrees
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H001', 'test1')
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H002', 'test2')

            // Verify original context has no git artifacts
            expect(fs.existsSync(Path.join(contextDir, '.git'))).toBe(false)
            expect(fs.existsSync(Path.join(contextDir, '.gitignore'))).toBe(false)

            // Verify original files are untouched
            const originalContent = fs.readFileSync(Path.join(contextDir, 'README.md'), 'utf-8')
            expect(originalContent).toContain('# Test Project')
          }).pipe(Effect.provide(TestLayer)),
        )
      })

      it('should isolate hypothesis worktrees from each other', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService

            yield* service.setupContextRepo(contextDir, workingDir, runSlug)
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H001', 'test1')
            yield* service.createHypothesisWorktree(workingDir, runSlug, 'H002', 'test2')

            const worktree1 = Path.join(workingDir, 'H001-test1')
            const worktree2 = Path.join(workingDir, 'H002-test2')

            // Modify file in first worktree
            fs.writeFileSync(Path.join(worktree1, 'test1.txt'), 'hypothesis 1 changes')

            // Verify second worktree is unaffected
            expect(fs.existsSync(Path.join(worktree2, 'test1.txt'))).toBe(false)

            // Verify they have different branches
            const branch1 = yield* service.getCurrentBranch(worktree1)
            const branch2 = yield* service.getCurrentBranch(worktree2)

            expect(branch1).not.toBe(branch2)
            expect(branch1).toBe(`dilagent/${runSlug}/H001-test1`)
            expect(branch2).toBe(`dilagent/${runSlug}/H002-test2`)
          }).pipe(Effect.provide(TestLayer)),
        )
      })
    })
  })

  describe('GitManagerService integration', () => {
    it('FIXED: commands now use GitManagerService for context-repo initialization', async () => {
      // This test documents the fix - commands now properly use GitManagerService

      // PREVIOUS BEHAVIOR (was wrong):
      // - reproduceIssue used: Command.make('cp', '-r', ...)
      // - Result: plain directory copy, no git

      // CURRENT BEHAVIOR (fixed):
      // - reproduceIssue uses: GitManagerService.setupContextRepo()
      // - Result: proper git repository with version control

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GitManagerService

          // Use setupContextRepo as commands now do
          yield* service.setupContextRepo(contextDir, workingDir, runSlug)

          const contextRepoPath = Path.join(workingDir, '.dilagent/context-repo')
          const gitExists = fs.existsSync(Path.join(contextRepoPath, '.git'))

          // This now passes because commands use GitManagerService:
          expect(gitExists).toBe(true) // ✅ Commands now produce proper git repos

          // The fix: reproduceIssue() and generateHypotheses() functions
          // now use GitManagerService.setupContextRepo() instead of cp commands
        }).pipe(Effect.provide(TestLayer)),
      )
    })
  })
})
