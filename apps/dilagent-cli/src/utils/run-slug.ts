/**
 * Utilities for generating run slugs
 *
 * Run slugs follow the format: YYYY-MM-DD[-context-slug]
 * Examples:
 * - 2025-09-07
 * - 2025-09-07-auth-bug-fix
 */

/**
 * Generate a run slug for the current date with optional context
 *
 * @param contextSlug - Optional context to append (e.g., "auth-bug-fix")
 * @returns Run slug in format YYYY-MM-DD[-context-slug] with sanitized context
 */
export const generateRunSlug = (contextSlug?: string): string => {
  const date = new Date().toISOString().split('T')[0]! // YYYY-MM-DD
  if (contextSlug) {
    const sanitizedContext = contextSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
    return sanitizedContext ? `${date}-${sanitizedContext}` : date
  }
  return date
}

/**
 * Parse a run slug into its components
 *
 * @param runSlug - Run slug to parse
 * @returns Object with date and optional context
 */
export const parseRunSlug = (runSlug: string): { date: string; context?: string | undefined } => {
  const parts = runSlug.split('-')

  if (parts.length < 3) {
    throw new Error(`Invalid run slug format: ${runSlug}`)
  }

  // First three parts are YYYY-MM-DD
  const date = parts.slice(0, 3).join('-')!

  // Remaining parts are context (if any)
  const context = parts.length > 3 ? parts.slice(3).join('-') : undefined

  return { date, context }
}

/**
 * Validate a run slug format
 *
 * @param runSlug - Run slug to validate
 * @returns true if valid, false otherwise
 */
export const isValidRunSlug = (runSlug: string): boolean => {
  try {
    const { date } = parseRunSlug(runSlug)

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(date)) {
      return false
    }

    // Validate that it's a valid date
    const parsedDate = new Date(date)
    return parsedDate.toISOString().split('T')[0] === date
  } catch {
    return false
  }
}

/**
 * Generate a run slug for a specific date with optional context
 *
 * @param date - Date to use for the slug
 * @param contextSlug - Optional context to append
 * @returns Run slug in format YYYY-MM-DD[-context-slug]
 */
export const generateRunSlugForDate = (date: Date, contextSlug?: string): string => {
  const dateString = date.toISOString().split('T')[0]! // YYYY-MM-DD
  return contextSlug ? `${dateString}-${contextSlug}` : dateString
}
