import * as Path from 'node:path'
import { Command } from '@effect/platform'
import { Effect, Schema } from 'effect'

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
 * - Branch naming: dilagent/{run-slug}/root and dilagent/{run-slug}/H{NNN}-{hypothesis-slug}
 */
export class GitManagerService extends Effect.Service<GitManagerService>()('GitManagerService', {
  effect: Effect.gen(function* () {
    /**
     * Check if a directory is a git repository
     *
     * @param path - Directory path to check
     * @returns Effect that succeeds with boolean indicating if it's a git repo
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
     *
     * @param path - Path within the git repository
     * @returns Effect that succeeds with the root directory path
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
     *
     * @param contextDir - Original context directory (never modified)
     * @param workingDir - Working directory containing .dilagent
     * @param runSlug - Run slug for branch naming
     * @returns Effect that succeeds when context repo is set up
     */
    const setupContextRepo = Effect.fn('GitManagerService.setupContextRepo')(function* (
      contextDir: string,
      workingDir: string,
      runSlug: string,
    ) {
      yield* Effect.annotateCurrentSpan({ contextDir, workingDir, runSlug })

      const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')
      const isContextGitRepo = yield* isGitRepo(contextDir)

      if (isContextGitRepo) {
        yield* Effect.log(`Context directory is a git repo, creating worktree`)

        // Get the git root to ensure we're working with the correct repository
        const gitRoot = yield* getGitRoot(contextDir)
        const branchName = `dilagent/${runSlug}/root`

        // Create worktree from the git root
        yield* Command.exitCode(
          Command.make('git', 'worktree', 'add', '-b', branchName, contextRepoPath, 'HEAD').pipe(
            Command.workingDirectory(gitRoot),
          ),
        ).pipe(
          Effect.catchAll(
            (error) =>
              new GitWorktreeError({
                cause: error,
                message: `Failed to create worktree at ${contextRepoPath}`,
                worktreePath: contextRepoPath,
              }),
          ),
        )

        yield* Effect.log(`Created git worktree: ${contextRepoPath} (branch: ${branchName})`)
      } else {
        yield* Effect.log(`Context directory is not a git repo, copying and initializing git`)

        // Copy context directory to context-repo
        yield* Command.exitCode(Command.make('cp', '-r', `${contextDir}/.`, contextRepoPath)).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to copy context directory to ${contextRepoPath}`,
                command: `cp -r ${contextDir}/. ${contextRepoPath}`,
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

        // Create and checkout the root branch
        const branchName = `dilagent/${runSlug}/root`
        yield* Command.exitCode(
          Command.make('git', 'checkout', '-b', branchName).pipe(Command.workingDirectory(contextRepoPath)),
        ).pipe(
          Effect.catchAll(
            (error) =>
              new GitError({
                cause: error,
                message: `Failed to create branch ${branchName} in ${contextRepoPath}`,
                command: `git checkout -b ${branchName}`,
                workingDir: contextRepoPath,
              }),
          ),
        )

        yield* Effect.log(`Initialized git repo: ${contextRepoPath} (branch: ${branchName})`)
      }
    })

    /**
     * Create a hypothesis-specific worktree
     *
     * @param workingDir - Working directory containing .dilagent
     * @param runSlug - Run slug for branch naming
     * @param hypothesisId - Hypothesis ID (e.g., "H001")
     * @param hypothesisSlug - Hypothesis slug (e.g., "auth-bug-fix")
     * @returns Effect that succeeds when worktree is created
     */
    const createHypothesisWorktree = Effect.fn('GitManagerService.createHypothesisWorktree')(function* (
      workingDir: string,
      runSlug: string,
      hypothesisId: string,
      hypothesisSlug: string,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir, runSlug, hypothesisId, hypothesisSlug })

      const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')
      const worktreePath = Path.join(workingDir, `${hypothesisId}-${hypothesisSlug}`)
      const branchName = `dilagent/${runSlug}/${hypothesisId}-${hypothesisSlug}`

      // Verify context-repo exists and is a git repo
      const isContextRepo = yield* isGitRepo(contextRepoPath)
      if (!isContextRepo) {
        return yield* new GitRepoNotFoundError({
          path: contextRepoPath,
          message: `Context repo not found or not a git repository: ${contextRepoPath}`,
        })
      }

      // Create worktree for hypothesis
      yield* Command.exitCode(
        Command.make('git', 'worktree', 'add', '-b', branchName, worktreePath, 'HEAD').pipe(
          Command.workingDirectory(contextRepoPath),
        ),
      ).pipe(
        Effect.catchAll(
          (error) =>
            new GitWorktreeError({
              cause: error,
              message: `Failed to create hypothesis worktree at ${worktreePath}`,
              worktreePath,
            }),
        ),
      )

      yield* Effect.log(`Created hypothesis worktree: ${worktreePath} (branch: ${branchName})`)
    })

    /**
     * List all git worktrees in context-repo
     *
     * @param workingDir - Working directory containing .dilagent
     * @returns Effect that succeeds with array of worktree info
     */
    const listWorktrees = Effect.fn('GitManagerService.listWorktrees')(function* (workingDir: string) {
      yield* Effect.annotateCurrentSpan({ workingDir })

      const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

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
     *
     * @param workingDir - Working directory containing .dilagent
     * @param worktreePath - Path to the worktree to remove
     * @returns Effect that succeeds when worktree is removed
     */
    const removeWorktree = Effect.fn('GitManagerService.removeWorktree')(function* (
      workingDir: string,
      worktreePath: string,
    ) {
      yield* Effect.annotateCurrentSpan({ workingDir, worktreePath })

      const contextRepoPath = Path.join(workingDir, '.dilagent', 'context-repo')

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

      yield* Effect.log(`Removed worktree: ${worktreePath}`)
    })

    /**
     * Get the current branch name in a git repository
     *
     * @param repoPath - Path to the git repository
     * @returns Effect that succeeds with the current branch name
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

  dependencies: [],
}) {}
