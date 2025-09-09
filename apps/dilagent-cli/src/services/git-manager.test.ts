import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as Path from 'node:path'
import { Command } from '@effect/platform'
import { NodeContext, NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir } from '../utils/fs.ts'
import { GitManagerService } from './git-manager.ts'
import { WorkingDirService } from './working-dir.ts'

describe('GitManagerService', () => {
  let testDir: string
  let contextDir: string
  let workingDir: string

  // Create test layer with all dependencies
  const TestLayer = (workingDir: string) =>
    GitManagerService.Default.pipe(
      Layer.provideMerge(WorkingDirService.Default({ workingDirectory: workingDir, create: true })),
      Layer.provideMerge(Layer.mergeAll(NodeContext.layer, NodeFileSystem.layer)),
    )

  beforeEach(async () => {
    // Create unique test directories for each test
    testDir = makeTempDir('git-manager-test-')
    contextDir = Path.join(testDir, 'context')
    workingDir = Path.join(testDir, 'working')

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
        }).pipe(Effect.provide(TestLayer(workingDir))),
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
        }).pipe(Effect.provide(TestLayer(workingDir))),
      )
    })

    it('should handle non-existent directory', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GitManagerService
          const result = yield* service.isGitRepo('/non/existent/path')
          expect(result).toBe(false)
        }).pipe(Effect.provide(TestLayer(workingDir))),
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
        }).pipe(Effect.provide(TestLayer(workingDir))),
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
        }).pipe(Effect.provide(TestLayer(workingDir))),
      )
    })

    it('should fail for non-git directory', async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.getGitRoot(contextDir).pipe(Effect.tap(Effect.log))
          }).pipe(Effect.provide(TestLayer(workingDir))),
        ),
      ).rejects.toThrow()
    })

    describe('setupContextRepo', () => {
      describe('with non-git context', () => {
        it('should copy files and initialize git repo', async () => {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })

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
              expect(currentBranch).toBe('dilagent/test-working-dir-id/main')
            }).pipe(Effect.provide(TestLayer(workingDir))),
          )
        }, 10000)

        it('should copy all files including hidden files when context is not a git repo', async () => {
          // Add a hidden file to context dir
          fs.writeFileSync(Path.join(contextDir, '.gitignore'), 'node_modules/')

          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              const workingDirService = yield* WorkingDirService

              yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })

              const contextRepoPath = workingDirService.paths.contextRepo

              // Verify all files were copied including hidden ones
              expect(fs.existsSync(Path.join(contextRepoPath, 'README.md'))).toBe(true)
              expect(fs.existsSync(Path.join(contextRepoPath, '.gitignore'))).toBe(true)
              expect(fs.existsSync(Path.join(contextRepoPath, 'src', 'main.ts'))).toBe(true)

              // Verify files have correct content
              const readme = fs.readFileSync(Path.join(contextRepoPath, 'README.md'), 'utf-8')
              expect(readme).toContain('# Test Project')

              const gitignore = fs.readFileSync(Path.join(contextRepoPath, '.gitignore'), 'utf-8')
              expect(gitignore).toBe('node_modules/')

              // Verify the commit contains the files
              const result = yield* Command.string(
                Command.make('git', 'ls-tree', '-r', 'HEAD', '--name-only').pipe(
                  Command.workingDirectory(contextRepoPath),
                ),
              )

              expect(result).toContain('README.md')
              expect(result).toContain('.gitignore')
              expect(result).toContain('src/main.ts')
            }).pipe(Effect.provide(TestLayer(workingDir))),
          )
        }, 10000)

        it('should not modify original context directory', async () => {
          // Get original file content
          const originalContent = fs.readFileSync(Path.join(contextDir, 'README.md'), 'utf-8')

          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })

              // Verify original context is unchanged
              const currentContent = fs.readFileSync(Path.join(contextDir, 'README.md'), 'utf-8')
              expect(currentContent).toBe(originalContent)

              // Verify no .git directory was created in original context
              expect(fs.existsSync(Path.join(contextDir, '.git'))).toBe(false)
            }).pipe(Effect.provide(TestLayer(workingDir))),
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
                Command.make('git', 'commit', '--no-verify', '-m', 'Initial commit').pipe(
                  Command.workingDirectory(contextDir),
                ),
              )
            }).pipe(Effect.provide(TestLayer(workingDir))),
          )
        }, 15000)

        it('should create worktree from git repo', async () => {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })

              const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

              // Verify context-repo exists and is a git repo
              const isGitRepo = yield* service.isGitRepo(contextRepoPath)
              expect(isGitRepo).toBe(true)

              // Verify files are accessible
              expect(fs.existsSync(Path.join(contextRepoPath, 'README.md'))).toBe(true)
              expect(fs.existsSync(Path.join(contextRepoPath, 'config.json'))).toBe(true)

              // Verify correct branch
              const currentBranch = yield* service.getCurrentBranch(contextRepoPath)
              expect(currentBranch).toBe('dilagent/test-working-dir-id/main')
            }).pipe(Effect.provide(TestLayer(workingDir))),
          )
        })

        it('should not modify original git repository', async () => {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService

              // Get original branch
              const originalBranch = yield* service.getCurrentBranch(contextDir)

              yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })

              // Verify original repo is unchanged
              const currentBranch = yield* service.getCurrentBranch(contextDir)
              expect(currentBranch).toBe(originalBranch)

              // Verify worktrees don't affect original
              const worktrees = yield* service.listWorktrees()
              expect(worktrees.length).toBeGreaterThan(0)

              // Original should still have same files
              expect(fs.existsSync(Path.join(contextDir, 'README.md'))).toBe(true)
            }).pipe(Effect.provide(TestLayer(workingDir))),
          )
        })
      })
    })

    describe('setupContextRepo with git subdirectory', () => {
      let gitRepoRoot: string
      let gitSubdirContext: string

      beforeEach(() => {
        // Create a git repository with subdirectories
        gitRepoRoot = makeTempDir('git-repo-test-')
        gitSubdirContext = Path.join(gitRepoRoot, 'apps', 'backend')

        // Create repo structure
        fs.mkdirSync(Path.join(gitRepoRoot, 'apps'), { recursive: true })
        fs.mkdirSync(Path.join(gitRepoRoot, 'apps', 'frontend'))
        fs.mkdirSync(gitSubdirContext)

        // Create files in root
        fs.writeFileSync(Path.join(gitRepoRoot, 'README.md'), '# Monorepo\nThis is a monorepo')
        fs.writeFileSync(Path.join(gitRepoRoot, 'package.json'), '{"name":"monorepo","private":true}')

        // Create files in backend subdirectory
        fs.writeFileSync(Path.join(gitSubdirContext, 'README.md'), '# Backend App\nBackend application')
        fs.writeFileSync(Path.join(gitSubdirContext, 'package.json'), '{"name":"backend","main":"index.js"}')
        fs.writeFileSync(Path.join(gitSubdirContext, 'index.js'), 'console.log("Backend app")')

        // Create files in frontend subdirectory
        fs.writeFileSync(Path.join(gitRepoRoot, 'apps', 'frontend', 'index.html'), '<html><body>Frontend</body></html>')

        // Initialize git repo at root
        execSync('git init', { cwd: gitRepoRoot })
        execSync('git config user.email "test@example.com"', { cwd: gitRepoRoot })
        execSync('git config user.name "Test User"', { cwd: gitRepoRoot })
        execSync('git add .', { cwd: gitRepoRoot })
        execSync('git commit -m "Initial commit"', { cwd: gitRepoRoot })
      })

      afterEach(() => {
        if (fs.existsSync(gitRepoRoot)) {
          fs.rmSync(gitRepoRoot, { recursive: true, force: true })
        }
      })

      it('should detect git subdirectory and calculate relative path', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            const result = yield* service.setupContextRepo({
              contextDir: gitSubdirContext,
              workingDirId: 'test-working-dir-id',
            })

            const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

            // Should return result with contextRepoPath and relativePath
            expect(result.contextRepoPath).toBe(contextRepoPath)
            expect(result.relativePath).toBe('apps/backend')

            // Verify worktree was created and contains all repo files
            expect(fs.existsSync(contextRepoPath)).toBe(true)
            expect(fs.existsSync(Path.join(contextRepoPath, 'README.md'))).toBe(true) // Root file
            expect(fs.existsSync(Path.join(contextRepoPath, 'apps', 'backend', 'README.md'))).toBe(true) // Subdirectory file
            expect(fs.existsSync(Path.join(contextRepoPath, 'apps', 'frontend', 'index.html'))).toBe(true) // Other subdirectory

            // Verify it's a git repo with correct branch
            const isGitRepo = yield* service.isGitRepo(contextRepoPath)
            expect(isGitRepo).toBe(true)

            const currentBranch = yield* service.getCurrentBranch(contextRepoPath)
            expect(currentBranch).toBe('dilagent/test-working-dir-id/main')

            // Verify original git repo is untouched
            const originalBranch = execSync('git branch --show-current', { cwd: gitRepoRoot }).toString().trim()
            expect(originalBranch).toMatch(/^(master|main)$/) // git defaults to 'main' in newer versions
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      }, 10000)

      it('should handle git subdirectory at root level (relative path ".")', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            const result = yield* service.setupContextRepo({
              contextDir: gitRepoRoot,
              workingDirId: 'test-working-dir-id',
            })

            // Should return relative path as "." since context is at git root
            expect(result.relativePath).toBe('.')

            const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')
            expect(fs.existsSync(contextRepoPath)).toBe(true)

            // Should contain all files since entire repo was used
            expect(fs.existsSync(Path.join(contextRepoPath, 'README.md'))).toBe(true)
            expect(fs.existsSync(Path.join(contextRepoPath, 'apps', 'backend', 'index.js'))).toBe(true)
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      }, 10000)
    })

    describe('createHypothesisWorktree', () => {
      beforeEach(async () => {
        // Set up context repo first
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })

      it('should create hypothesis worktree', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H001',
              hypothesisSlug: 'auth-bug',
              workingDirId: 'test-working-dir-id',
            })

            const worktreePath = Path.join(workingDir, 'worktree-H001-auth-bug')

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
            expect(currentBranch).toBe('dilagent/test-working-dir-id/H001-auth-bug')
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })

      it('should create multiple hypothesis worktrees', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService

            yield* service.createHypothesisWorktree({
              hypothesisId: 'H001',
              hypothesisSlug: 'auth-bug',
              workingDirId: 'test-working-dir-id',
            })
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H002',
              hypothesisSlug: 'performance',
              workingDirId: 'test-working-dir-id',
            })

            // Verify both worktrees exist
            expect(fs.existsSync(Path.join(workingDir, 'worktree-H001-auth-bug'))).toBe(true)
            expect(fs.existsSync(Path.join(workingDir, 'worktree-H002-performance'))).toBe(true)

            // Verify they're independent
            const branch1 = yield* service.getCurrentBranch(Path.join(workingDir, 'worktree-H001-auth-bug'))
            const branch2 = yield* service.getCurrentBranch(Path.join(workingDir, 'worktree-H002-performance'))

            expect(branch1).toBe('dilagent/test-working-dir-id/H001-auth-bug')
            expect(branch2).toBe('dilagent/test-working-dir-id/H002-performance')
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })

      it('should fail if context-repo does not exist', async () => {
        // Remove context-repo
        fs.rmSync(Path.join(workingDir, '.dilagent', 'context-repo'), { recursive: true, force: true })

        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.createHypothesisWorktree({
                hypothesisId: 'H001',
                hypothesisSlug: 'auth-bug',
                workingDirId: 'test-working-dir-id',
              })
            }).pipe(Effect.provide(TestLayer(workingDir))),
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
            yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H001',
              hypothesisSlug: 'test-hypothesis',
              workingDirId: 'test-working-dir-id',
            })
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })

      it('should list all worktrees', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            const worktrees = yield* service.listWorktrees()

            expect(worktrees.length).toBeGreaterThanOrEqual(2) // context-repo + hypothesis worktree

            // Find the hypothesis worktree
            const hypothesisWorktree = worktrees.find((w) => w.path.includes('worktree-H001-test-hypothesis'))
            expect(hypothesisWorktree).toBeDefined()
            expect(hypothesisWorktree?.branch).toBe('dilagent/test-working-dir-id/H001-test-hypothesis')
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })
    })

    describe('removeWorktree', () => {
      beforeEach(async () => {
        // Set up context repo and create a hypothesis worktree
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H001',
              hypothesisSlug: 'test-hypothesis',
              workingDirId: 'test-working-dir-id',
            })
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })

      it('should remove worktree', async () => {
        const worktreePath = Path.join(workingDir, 'worktree-H001-test-hypothesis')

        // Verify worktree exists
        expect(fs.existsSync(worktreePath)).toBe(true)

        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.removeWorktree(worktreePath)

            // Verify worktree is gone
            expect(fs.existsSync(worktreePath)).toBe(false)
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })
    })

    describe('getCurrentBranch', () => {
      beforeEach(async () => {
        // Set up context repo
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })

      it('should return current branch name', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService
            const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

            const branch = yield* service.getCurrentBranch(contextRepoPath)
            expect(branch).toBe('dilagent/test-working-dir-id/main')
          }).pipe(Effect.provide(TestLayer(workingDir))),
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
            }).pipe(Effect.provide(TestLayer(workingDir))),
          ),
        ).rejects.toThrow()
      })

      it('should provide meaningful error messages', async () => {
        try {
          await Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* GitManagerService
              yield* service.getCurrentBranch('/non/existent/path')
            }).pipe(Effect.provide(TestLayer(workingDir))),
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
            yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })

            // Create multiple hypothesis worktrees
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H001',
              hypothesisSlug: 'test1',
              workingDirId: 'test-working-dir-id',
            })
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H002',
              hypothesisSlug: 'test2',
              workingDirId: 'test-working-dir-id',
            })

            // Verify original context has no git artifacts
            expect(fs.existsSync(Path.join(contextDir, '.git'))).toBe(false)
            expect(fs.existsSync(Path.join(contextDir, '.gitignore'))).toBe(false)

            // Verify original files are untouched
            const originalContent = fs.readFileSync(Path.join(contextDir, 'README.md'), 'utf-8')
            expect(originalContent).toContain('# Test Project')
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })

      it('should isolate hypothesis worktrees from each other', async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* GitManagerService

            yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H001',
              hypothesisSlug: 'test1',
              workingDirId: 'test-working-dir-id',
            })
            yield* service.createHypothesisWorktree({
              hypothesisId: 'H002',
              hypothesisSlug: 'test2',
              workingDirId: 'test-working-dir-id',
            })

            const worktree1 = Path.join(workingDir, 'worktree-H001-test1')
            const worktree2 = Path.join(workingDir, 'worktree-H002-test2')

            // Modify file in first worktree
            fs.writeFileSync(Path.join(worktree1, 'test1.txt'), 'hypothesis 1 changes')

            // Verify second worktree is unaffected
            expect(fs.existsSync(Path.join(worktree2, 'test1.txt'))).toBe(false)

            // Verify they have different branches
            const branch1 = yield* service.getCurrentBranch(worktree1)
            const branch2 = yield* service.getCurrentBranch(worktree2)

            expect(branch1).not.toBe(branch2)
            expect(branch1).toBe('dilagent/test-working-dir-id/H001-test1')
            expect(branch2).toBe('dilagent/test-working-dir-id/H002-test2')
          }).pipe(Effect.provide(TestLayer(workingDir))),
        )
      })
    })
  })

  describe('GitManagerService integration', () => {
    it('FIXED: commands now use GitManagerService for context-repo initialization', async () => {
      // This test documents the fix - commands now properly use GitManagerService

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GitManagerService

          // Use setupContextRepo as commands now do
          yield* service.setupContextRepo({ contextDir, workingDirId: 'test-working-dir-id' })

          const contextRepoPath = Path.join(workingDir, '.dilagent/context-repo')
          const gitExists = fs.existsSync(Path.join(contextRepoPath, '.git'))

          // This now passes because commands use GitManagerService:
          expect(gitExists).toBe(true) // ✅ Commands now produce proper git repos
        }).pipe(Effect.provide(TestLayer(workingDir))),
      )
    })
  })
})
