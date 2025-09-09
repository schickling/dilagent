import path from 'node:path'
import { FileSystem, PlatformLogger } from '@effect/platform'
import { Effect, Layer, Logger } from 'effect'

/**
 * Creates a file logger that writes logs to the specified file path.
 * Uses Effect's built-in PlatformLogger.toFile for efficient file operations.
 */
export const createFileLogger = (filePath: string) => Logger.logfmtLogger.pipe(PlatformLogger.toFile(filePath))

/**
 * Creates a JSON file logger for structured logging.
 */
export const createJsonFileLogger = (filePath: string) => Logger.jsonLogger.pipe(PlatformLogger.toFile(filePath))

/**
 * Creates a file logger layer that replaces the default logger.
 * This layer provides both the file logger and the required NodeFileSystem dependency.
 */
export const createFileLoggerLayer = (
  filePath: string,
  { replace, format }: { replace?: boolean | Logger.Logger<any, any>; format?: 'logfmt' | 'json' } = {},
) => {
  const logger = format === 'logfmt' ? createFileLogger(filePath) : createJsonFileLogger(filePath)

  return Layer.unwrapEffect(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      // Make sure the directory exists
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true })

      return replace
        ? Logger.replaceScoped(Logger.isLogger(replace) ? replace : Logger.defaultLogger, logger)
        : Logger.addEffect(logger)
    }),
  )
}
