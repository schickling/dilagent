import { PlatformLogger } from '@effect/platform'
import { Logger } from 'effect'

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
  { replace, format }: { replace?: boolean; format?: 'logfmt' | 'json' } = {},
) => {
  const logger = format === 'logfmt' ? createFileLogger(filePath) : createJsonFileLogger(filePath)
  return replace ? Logger.replaceScoped(Logger.defaultLogger, logger) : Logger.addEffect(logger)
}
