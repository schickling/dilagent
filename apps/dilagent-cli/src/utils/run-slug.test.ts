import { describe, expect, it } from 'vitest'
import { generateRunSlug, generateRunSlugForDate, isValidRunSlug, parseRunSlug } from './run-slug.ts'

describe('run slug utilities', () => {
  describe('generateRunSlug', () => {
    it('should generate date-only slug for current date', () => {
      const slug = generateRunSlug()

      // Should match YYYY-MM-DD format
      expect(slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      // Should be today's date
      const today = new Date().toISOString().split('T')[0]
      expect(slug).toBe(today)
    })

    it('should generate slug with context when provided', () => {
      const context = 'auth-bug-fix'
      const slug = generateRunSlug(context)

      // Should match YYYY-MM-DD-context format
      expect(slug).toMatch(/^\d{4}-\d{2}-\d{2}-auth-bug-fix$/)

      // Should start with today's date
      const today = new Date().toISOString().split('T')[0]
      expect(slug).toBe(`${today}-${context}`)
    })

    it('should handle context with hyphens', () => {
      const context = 'multi-word-context'
      const slug = generateRunSlug(context)

      const today = new Date().toISOString().split('T')[0]
      expect(slug).toBe(`${today}-${context}`)
    })

    it('should sanitize context with spaces and special characters', () => {
      const context = 'Auth Bug Fix!'
      const slug = generateRunSlug(context)

      const today = new Date().toISOString().split('T')[0]
      expect(slug).toBe(`${today}-auth-bug-fix`)
    })

    it('should sanitize context with mixed characters', () => {
      const context = 'Memory_Leak@Component#1'
      const slug = generateRunSlug(context)

      const today = new Date().toISOString().split('T')[0]
      expect(slug).toBe(`${today}-memory-leak-component-1`)
    })

    it('should handle empty context', () => {
      const slug = generateRunSlug('')

      const today = new Date().toISOString().split('T')[0]
      expect(slug).toBe(today)
    })

    it('should collapse multiple non-alphanumeric characters into single dashes', () => {
      const context = 'Bug!!!   With   Spaces'
      const slug = generateRunSlug(context)

      const today = new Date().toISOString().split('T')[0]
      expect(slug).toBe(`${today}-bug-with-spaces`)
    })
  })

  describe('generateRunSlugForDate', () => {
    it('should generate slug for specific date', () => {
      const date = new Date('2025-03-15T10:30:00Z')
      const slug = generateRunSlugForDate(date)

      expect(slug).toBe('2025-03-15')
    })

    it('should generate slug for specific date with context', () => {
      const date = new Date('2025-03-15T10:30:00Z')
      const context = 'performance-test'
      const slug = generateRunSlugForDate(date, context)

      expect(slug).toBe('2025-03-15-performance-test')
    })

    it('should handle timezone correctly', () => {
      // Test with a date that could cross timezone boundaries
      const date = new Date('2025-12-31T23:59:59Z')
      const slug = generateRunSlugForDate(date)

      expect(slug).toBe('2025-12-31')
    })
  })

  describe('parseRunSlug', () => {
    it('should parse date-only slug', () => {
      const slug = '2025-09-07'
      const result = parseRunSlug(slug)

      expect(result).toEqual({
        date: '2025-09-07',
        context: undefined,
      })
    })

    it('should parse slug with single word context', () => {
      const slug = '2025-09-07-bugfix'
      const result = parseRunSlug(slug)

      expect(result).toEqual({
        date: '2025-09-07',
        context: 'bugfix',
      })
    })

    it('should parse slug with multi-word context', () => {
      const slug = '2025-09-07-auth-bug-fix'
      const result = parseRunSlug(slug)

      expect(result).toEqual({
        date: '2025-09-07',
        context: 'auth-bug-fix',
      })
    })

    it('should throw on invalid slug format', () => {
      expect(() => parseRunSlug('invalid')).toThrow('Invalid run slug format: invalid')
      expect(() => parseRunSlug('2025-09')).toThrow('Invalid run slug format: 2025-09')
      expect(() => parseRunSlug('2025')).toThrow('Invalid run slug format: 2025')
    })
  })

  describe('isValidRunSlug', () => {
    it('should validate correct date-only slugs', () => {
      expect(isValidRunSlug('2025-09-07')).toBe(true)
      expect(isValidRunSlug('2024-12-31')).toBe(true)
      expect(isValidRunSlug('2023-01-01')).toBe(true)
    })

    it('should validate correct slugs with context', () => {
      expect(isValidRunSlug('2025-09-07-bugfix')).toBe(true)
      expect(isValidRunSlug('2025-09-07-auth-bug-fix')).toBe(true)
      expect(isValidRunSlug('2025-09-07-very-long-context-name')).toBe(true)
    })

    it('should reject invalid date formats', () => {
      expect(isValidRunSlug('25-09-07')).toBe(false)
      expect(isValidRunSlug('2025-9-7')).toBe(false)
      expect(isValidRunSlug('2025/09/07')).toBe(false)
      expect(isValidRunSlug('2025-13-01')).toBe(false) // Invalid month
      expect(isValidRunSlug('2025-02-30')).toBe(false) // Invalid day
    })

    it('should reject malformed slugs', () => {
      expect(isValidRunSlug('invalid')).toBe(false)
      expect(isValidRunSlug('2025-09')).toBe(false)
      expect(isValidRunSlug('2025')).toBe(false)
      expect(isValidRunSlug('')).toBe(false)
    })

    it('should handle edge cases', () => {
      // Leap year
      expect(isValidRunSlug('2024-02-29')).toBe(true)
      expect(isValidRunSlug('2023-02-29')).toBe(false)

      // Valid dates at year boundaries
      expect(isValidRunSlug('2024-01-01')).toBe(true)
      expect(isValidRunSlug('2024-12-31')).toBe(true)
    })
  })

  describe('integration tests', () => {
    it('should round-trip correctly', () => {
      const originalSlug = '2025-09-07-integration-test'
      const parsed = parseRunSlug(originalSlug)
      const reconstructed = `${parsed.date}${parsed.context ? `-${parsed.context}` : ''}`

      expect(reconstructed).toBe(originalSlug)
      expect(isValidRunSlug(reconstructed)).toBe(true)
    })

    it('should generate valid slugs', () => {
      const slug1 = generateRunSlug()
      const slug2 = generateRunSlug('test-context')
      const slug3 = generateRunSlugForDate(new Date('2025-01-01'), 'new-year')

      expect(isValidRunSlug(slug1)).toBe(true)
      expect(isValidRunSlug(slug2)).toBe(true)
      expect(isValidRunSlug(slug3)).toBe(true)
    })
  })
})
