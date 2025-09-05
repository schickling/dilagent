import { PlatformLogger } from '@effect/platform'
import { NodeFileSystem } from '@effect/platform-node'
import { Layer, Logger } from 'effect'

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
export const createFileLoggerLayer = (filePath: string) =>
  Logger.replaceScoped(Logger.defaultLogger, createFileLogger(filePath)).pipe(Layer.provide(NodeFileSystem.layer))

/**
 * Creates a JSON file logger layer that replaces the default logger.
 */
export const createJsonFileLoggerLayer = (filePath: string) =>
  Logger.replaceScoped(Logger.defaultLogger, createJsonFileLogger(filePath)).pipe(Layer.provide(NodeFileSystem.layer))
