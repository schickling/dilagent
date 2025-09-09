import * as Path from 'node:path'
import { Command } from '@effect/platform'
import { Effect, Schema } from 'effect'
import { WorkingDirService } from './working-dir.ts'

// Error types for GitManagerService
export class GitError extends Schema.TaggedError<GitError>()('GitError', {
  cause: Schema.Defect,
  message: Schema.String,
  command: Schema.optional(Schema.String),
  workingDir: Schema.optional(Schema.String),
}) {}

export class GitRepoNotFoundError extends Schema.TaggedError<GitRepoNotFoundError>()('GitRepoNotFoundError', {
  path: Schema.String,
  message: Schema.String,
}) {}

export class GitWorktreeError extends Schema.TaggedError<GitWorktreeError>()('GitWorktreeError', {
  cause: Schema.Defect,
  message: Schema.String,
  worktreePath: Schema.String,
}) {}

/**
 * Service for managing git operations with context immutability
 *
 * Key principles:
 * - Original context directory is NEVER modified
 * - Each hypothesis runs in its own git worktree
 * - .dilagent/context-repo is always a valid git repository
 * - Branch naming: dilagent/main and dilagent/H{NNN}-{hypothesis-slug}
 */
export class GitManagerService extends Effect.Service<GitManagerService>()('GitManagerService', {
  effect: Effect.gen(function* () {
    const workingDir = yield* WorkingDirService

    /**
     * Check if a directory is a git repository
     */
    const isGitRepo = Effect.fn('GitManagerService.isGitRepo')(function* (path: string) {
      yield* Effect.annotateCurrentSpan({ path })

      const result = yield* Command.exitCode(
        Command.make('git', 'rev-parse', '--git-dir').pipe(Command.workingDirectory(path)),
      ).pipe(
        Effect.catchAll(() => Effect.succeed(1)), // Return non-zero exit code if command fails
      )

      return result === 0
    })

    /**
     * Get the root directory of a git repository
     */
    const getGitRoot = Effect.fn('GitManagerService.getGitRoot')(function* (path: string) {
      yield* Effect.annotateCurrentSpan({ path })

      const result = yield* Command.string(
        Command.make('git', 'rev-parse', '--show-toplevel').pipe(Command.workingDirectory(path)),
      ).pipe(
        Effect.catchAll(
          (error) =>
            new GitError({
              cause: error,
              message: `Failed to get git root for ${path}`,
              command: 'git rev-parse --show-toplevel',
              workingDir: path,
            }),
        ),
      )

      // Check if result is empty (happens when not a git repo)
      if (!result || result.trim() === '') {
        return yield* new GitError({
          cause: new Error('Not a git repository'),
          message: `Failed to get git root for ${path}`,
          command: 'git rev-parse --show-toplevel',
          workingDir: path,
        })
      }

      return result.trim()
    })

    /**
     * Initialize context repository in .dilagent/context-repo
     *
     * If context-dir is a git repo: creates worktree
     * If context-dir is not a git repo: copies files and initializes git
     */
    const setupContextRepo = Effect.fn('GitManagerService.setupContextRepo')(function* (
      contextDir: string,
      workingDirId: string,
    ) {
      yield* Effect.annotateCurrentSpan({ contextDir, workingDirId })

      const contextRepoPath = workingDir.paths.contextRepo
      const isContextGitRepo = yield* isGitRepo(contextDir)

      if (isContextGitRepo) {
        yield* Effect.logDebug(`[GitManagerService] Context directory is a git repo, creating worktree`)

        // Get the git root to ensure we're working with the correct repository
        const gitRoot = yield* getGitRoot(contextDir)
        // Canonicalize both paths to handle symlinks (e.g., /var -> /private/var on macOS)
        const canonicalGitRoot = yield* Effect.try(() => require('node:fs').realpathSync(gitRoot))
        const canonicalContextDir = yield* Effect.try(() => require('node:fs').realpathSync(contextDir))
        const relativePath = Path.relative(canonicalGitRoot, canonicalContextDir) || '.'
        const branchName = `dilagent/${workingDirId}/main`

        yield* Effect.logDebug(`[GitManagerService] Creating worktree with branch: ${branchName}`)

        // First, try to remove any existing worktree at this path (cleanup from failed runs)
        yield* Command.exitCode(
          Command.make('git', 'worktree', 'remove', '--force', contextRepoPath).pipe(Command.workingDirectory(gitRoot)),
        ).pipe(
          Effect.catchAll(() => Effect.succeed(0)), // Ignore if doesn't exist
          Effect.tap(() =>
            Effect.logDebug(`[GitManagerService] Cleaned up any existing worktree at ${contextRepoPath}`),
          ),
        )

        // Create worktree from the git root
        yield* Command.exitCode(
          Command.make('git', 'worktree', 'add', '-b', branchName, contextRepoPath, 'HEAD').pipe(
            Command.workingDirectory(gitRoot),
          ),
        ).pipe(
          Effect.catchAll((error) =>
            Effect.flatMap(
              Effect.logError(`[GitManagerService] Worktree creation failed with error: ${String(error)}`),
              () =>
                new GitWorktreeError({
                  cause: error,
                  message: `Failed to create worktree at ${contextRepoPath} with branch ${branchName}. This may be due to a branch name conflict or permission issue.`,
                  worktreePath: contextRepoPath,
                }),
            ),
          ),
          Effect.tap(() => Effect.logDebug(`[GitManagerService] Successfully created worktree`)),
        )

        yield* Effect.logDebug(`[GitManagerService] Created git worktree: ${contextRepoPath} (branch: ${branchName})`)

        return {
          contextRepoPath,
          relativePath,
        }
      } else {
        yield* Effect.logDebug(`[GitManagerService] Context directory is not a git repo, copying and initializing git`)

        // Copy context directory contents to context-repo (which already exists)
        // Copy regular files and directories
        yield* Command.exitCode(
          Command.make('sh', '-c', `cp -r "${contextDir}"/* "${contextRepoPath}"/ 2>/dev/null || true`),
        ).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to copy regular files from context directory to ${contextRepoPath}`,
                command: `cp -r "${contextDir}"/* "${contextRepoPath}"/`,
              }),
          ),
        )

        // Copy hidden files and directories (dotfiles)
        yield* Command.exitCode(
          Command.make('sh', '-c', `cp -r "${contextDir}"/.[^.]* "${contextRepoPath}"/ 2>/dev/null || true`),
        ).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to copy hidden files from context directory to ${contextRepoPath}`,
                command: `cp -r "${contextDir}"/.[^.]* "${contextRepoPath}"/`,
              }),
          ),
        )

        // Initialize git repository
        yield* Command.exitCode(Command.make('git', 'init').pipe(Command.workingDirectory(contextRepoPath))).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to initialize git in ${contextRepoPath}`,
                command: 'git init',
                workingDir: contextRepoPath,
              }),
          ),
        )

        // Configure git user identity
        yield* Command.exitCode(
          Command.make('git', 'config', 'user.email', 'dilagent@example.com').pipe(
            Command.workingDirectory(contextRepoPath),
          ),
        ).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to configure git user.email in ${contextRepoPath}`,
                command: 'git config user.email dilagent@example.com',
                workingDir: contextRepoPath,
              }),
          ),
        )

        yield* Command.exitCode(
          Command.make('git', 'config', 'user.name', 'Dilagent').pipe(Command.workingDirectory(contextRepoPath)),
        ).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to configure git user.name in ${contextRepoPath}`,
                command: 'git config user.name Dilagent',
                workingDir: contextRepoPath,
              }),
          ),
        )

        // Add all files
        yield* Command.exitCode(Command.make('git', 'add', '.').pipe(Command.workingDirectory(contextRepoPath))).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to add files in ${contextRepoPath}`,
                command: 'git add .',
                workingDir: contextRepoPath,
              }),
          ),
        )

        // Initial commit
        yield* Command.exitCode(
          Command.make('git', 'commit', '-m', 'Initial context snapshot').pipe(
            Command.workingDirectory(contextRepoPath),
          ),
        ).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to create initial commit in ${contextRepoPath}`,
                command: 'git commit -m "Initial context snapshot"',
                workingDir: contextRepoPath,
              }),
          ),
        )

        // Create and checkout the main branch with unique workingDirId
        const branchName = `dilagent/${workingDirId}/main`
        yield* Command.exitCode(
          Command.make('git', 'checkout', '-b', branchName).pipe(Command.workingDirectory(contextRepoPath)),
        ).pipe(
          Effect.catchAll((error) =>
            Effect.flatMap(
              Effect.logError(`[GitManagerService] Branch creation failed with error: ${String(error)}`),
              () =>
                new GitError({
                  cause: error,
                  message: `Failed to create branch ${branchName} in ${contextRepoPath}. This may be due to an existing branch with the same name.`,
                  command: `git checkout -b ${branchName}`,
                  workingDir: contextRepoPath,
                }),
            ),
          ),
          Effect.tap(() => Effect.logDebug(`[GitManagerService] Successfully created branch ${branchName}`)),
        )

        yield* Effect.log(`Initialized git repo: ${contextRepoPath} (branch: ${branchName})`)

        return {
          contextRepoPath,
          relativePath: '.', // Context directory is the root of the new git repo
        }
      }
    })

    /**
     * Create a hypothesis-specific worktree
     */
    const createHypothesisWorktree = Effect.fn('GitManagerService.createHypothesisWorktree')(function* ({
      hypothesisId,
      hypothesisSlug,
      workingDirId,
    }: {
      hypothesisId: string
      hypothesisSlug: string
      workingDirId: string
    }) {
      yield* Effect.annotateCurrentSpan({ hypothesisId, hypothesisSlug, workingDirId })

      const contextRepoPath = workingDir.paths.contextRepo
      const worktreePath = Path.join(workingDir.workingDir, `${hypothesisId}-${hypothesisSlug}`)
      const branchName = `dilagent/${workingDirId}/${hypothesisId}-${hypothesisSlug}`

      // Verify context-repo exists and is a git repo
      const isContextRepo = yield* isGitRepo(contextRepoPath)
      if (!isContextRepo) {
        return yield* new GitRepoNotFoundError({
          path: contextRepoPath,
          message: `Context repo not found or not a git repository: ${contextRepoPath}`,
        })
      }

      // Create the .dilagent hypothesis directory
      yield* workingDir.ensureHypothesisDir({ hypothesisId, hypothesisSlug })

      yield* Effect.logDebug(`[GitManagerService] Creating hypothesis worktree: ${branchName} at ${worktreePath}`)

      // First, try to remove any existing worktree at this path (cleanup from failed runs)
      yield* Command.exitCode(
        Command.make('git', 'worktree', 'remove', '--force', worktreePath).pipe(
          Command.workingDirectory(contextRepoPath),
        ),
      ).pipe(
        Effect.catchAll(() => Effect.succeed(0)), // Ignore if doesn't exist
        Effect.tap(() =>
          Effect.logDebug(`[GitManagerService] Cleaned up any existing hypothesis worktree at ${worktreePath}`),
        ),
      )

      // Create worktree for hypothesis
      yield* Command.exitCode(
        Command.make('git', 'worktree', 'add', '-b', branchName, worktreePath, 'HEAD').pipe(
          Command.workingDirectory(contextRepoPath),
        ),
      ).pipe(
        Effect.catchAll((error) =>
          Effect.flatMap(
            Effect.logError(`[GitManagerService] Hypothesis worktree creation failed with error: ${String(error)}`),
            () =>
              new GitWorktreeError({
                cause: error,
                message: `Failed to create hypothesis worktree at ${worktreePath} with branch ${branchName}. This may be due to a branch name conflict or disk space issue.`,
                worktreePath,
              }),
          ),
        ),
        Effect.tap(() => Effect.logDebug(`[GitManagerService] Successfully created hypothesis worktree`)),
      )

      yield* Effect.logDebug(`[GitManagerService] Created hypothesis worktree: ${worktreePath} (branch: ${branchName})`)
      return worktreePath
    })

    /**
     * List all git worktrees in context-repo
     */
    const listWorktrees = Effect.fn('GitManagerService.listWorktrees')(function* () {
      const contextRepoPath = workingDir.paths.contextRepo

      const result = yield* Command.string(
        Command.make('git', 'worktree', 'list', '--porcelain').pipe(Command.workingDirectory(contextRepoPath)),
      ).pipe(
        Effect.catchAll(
          (error) =>
            new GitError({
              cause: error,
              message: `Failed to list worktrees in ${contextRepoPath}`,
              command: 'git worktree list --porcelain',
              workingDir: contextRepoPath,
            }),
        ),
      )

      // Parse the porcelain output
      const lines = result.trim().split('\n')
      const worktrees: Array<{ path: string; branch?: string; bare?: boolean }> = []

      let currentWorktree: { path: string; branch?: string; bare?: boolean } | null = null

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          if (currentWorktree) {
            worktrees.push(currentWorktree)
          }
          currentWorktree = { path: line.substring(9) }
        } else if (line.startsWith('branch ') && currentWorktree) {
          const branchName = line.substring(7)
          // Remove refs/heads/ prefix if present
          currentWorktree.branch = branchName.startsWith('refs/heads/') ? branchName.substring(11) : branchName
        } else if (line === 'bare' && currentWorktree) {
          currentWorktree.bare = true
        } else if (line === '' && currentWorktree) {
          worktrees.push(currentWorktree)
          currentWorktree = null
        }
      }

      if (currentWorktree) {
        worktrees.push(currentWorktree)
      }

      return worktrees
    })

    /**
     * Remove a git worktree
     */
    const removeWorktree = Effect.fn('GitManagerService.removeWorktree')(function* (worktreePath: string) {
      yield* Effect.annotateCurrentSpan({ worktreePath })

      const contextRepoPath = workingDir.paths.contextRepo

      yield* Command.exitCode(
        Command.make('git', 'worktree', 'remove', worktreePath).pipe(Command.workingDirectory(contextRepoPath)),
      ).pipe(
        Effect.catchAll(
          (error) =>
            new GitError({
              cause: error,
              message: `Failed to remove worktree ${worktreePath}`,
              command: `git worktree remove ${worktreePath}`,
              workingDir: contextRepoPath,
            }),
        ),
      )

      yield* Effect.logDebug(`[GitManagerService] Removed worktree: ${worktreePath}`)
    })

    /**
     * Get the current branch name in a git repository
     */
    const getCurrentBranch = Effect.fn('GitManagerService.getCurrentBranch')(function* (repoPath: string) {
      yield* Effect.annotateCurrentSpan({ repoPath })

      const result = yield* Command.string(
        Command.make('git', 'branch', '--show-current').pipe(Command.workingDirectory(repoPath)),
      ).pipe(
        Effect.catchAll(
          (error) =>
            new GitError({
              cause: error,
              message: `Failed to get current branch in ${repoPath}`,
              command: 'git branch --show-current',
              workingDir: repoPath,
            }),
        ),
      )

      return result.trim()
    })

    return {
      isGitRepo,
      getGitRoot,
      setupContextRepo,
      createHypothesisWorktree,
      listWorktrees,
      removeWorktree,
      getCurrentBranch,
    } as const
  }),
}) {}
