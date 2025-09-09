import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { llmJsonStringResponse, parseJsonLlmResponse } from './schema-utils.ts'

describe('schema-utils', () => {
  describe('llmJsonStringResponse', () => {
    const MyStruct = Schema.Struct({
      key: Schema.String,
    })
    const schema = parseJsonLlmResponse(MyStruct)

    it('should extract JSON from markdown code block', () => {
      const input = '```json\n{"key": "value"}\n```'
      const result = Schema.decodeUnknownSync(schema)(input)
      expect(result).toStrictEqual({ key: 'value' })
    })

    it('should handle JSON with whitespace inside code block', () => {
      const input = '```json\n  {"key": "value"}  \n```'
      const result = Schema.decodeUnknownSync(schema)(input)
      expect(result).toStrictEqual({ key: 'value' })
    })

    it('should return original string when not wrapped in code block', () => {
      const input = '{"key": "value"}'
      const result = Schema.decodeUnknownSync(schema)(input)
      expect(result).toStrictEqual({ key: 'value' })
    })

    it('should handle multiline JSON in code block', () => {
      const MultiStruct = Schema.Struct({
        key1: Schema.String,
        key2: Schema.String,
      })
      const multiSchema = parseJsonLlmResponse(MultiStruct)
      const input = '```json\n{\n  "key1": "value1",\n  "key2": "value2"\n}\n```'
      const result = Schema.decodeUnknownSync(multiSchema)(input)
      expect(result).toStrictEqual({ key1: 'value1', key2: 'value2' })
    })

    it('should return original string when code block is not json type', () => {
      const input = '```javascript\n{"key": "value"}\n```'
      const result = Schema.decodeUnknownSync(llmJsonStringResponse)(input)
      expect(result).toBe('```javascript\n{"key": "value"}\n```')
    })

    it('should handle empty string', () => {
      const input = ''
      const result = Schema.decodeUnknownSync(llmJsonStringResponse)(input)
      expect(result).toBe('')
    })

    it('should encode passthrough without modification', () => {
      const input = '{"key": "value"}'
      const result = Schema.encodeSync(llmJsonStringResponse)(input)
      expect(result).toBe('{"key": "value"}')
    })
  })
})
