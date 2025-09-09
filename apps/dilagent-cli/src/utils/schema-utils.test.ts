import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { llmJsonStringResponse, parseJsonLlmResponse } from './schema-utils.ts'

describe('schema-utils', () => {
  describe('llmJsonStringResponse', () => {
    const MyStruct = Schema.Struct({
      key: Schema.String,
    })
    const schema = parseJsonLlmResponse(MyStruct)

    describe('markdown code block extraction', () => {
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

      it('should extract from code block even if syntax is invalid (validation happens later)', () => {
        const input = '```json\ninvalid json\n```\nBut here is valid: {"key": "value"}'
        const extracted = Schema.decodeUnknownSync(llmJsonStringResponse)(input)
        expect(extracted).toBe('invalid json')
      })

      it('should ignore non-json code blocks', () => {
        const input = '```javascript\n{"invalid": "js"}\n```\nActual result: {"key": "value"}'
        const result = Schema.decodeUnknownSync(schema)(input)
        expect(result).toStrictEqual({ key: 'value' })
      })
    })

    describe('embedded JSON extraction', () => {
      it('should extract JSON embedded in explanatory text', () => {
        const input = 'Here is the result: {"key": "value"}'
        const result = Schema.decodeUnknownSync(schema)(input)
        expect(result).toStrictEqual({ key: 'value' })
      })

      it('should extract JSON from complex LLM response like the example', () => {
        const ComplexStruct = Schema.Struct({
          _tag: Schema.String,
          reproScript: Schema.String,
          observedBehavior: Schema.String,
          expectedBehavior: Schema.String,
          isFlaky: Schema.Boolean,
          confidence: Schema.Number,
        })
        const complexSchema = parseJsonLlmResponse(ComplexStruct)

        const input = `Perfect! Now I have all the information needed to create a comprehensive reproduction result. Based on my analysis:

1. **The Bug**: The code has an HLC (Hybrid Logical Clock) implementation bug
2. **Root Cause**: Instead of merging the local clock with the sender's clock once per sync message

{
  "_tag": "Success",
  "reproScript": "#!/usr/bin/env node\\nconsole.log('test')",
  "observedBehavior": "The HLC implementation has a clock skew bug",
  "expectedBehavior": "The HLC should merge properly",
  "isFlaky": false,
  "confidence": 1.0
}`

        const result = Schema.decodeUnknownSync(complexSchema)(input)
        expect(result).toStrictEqual({
          _tag: 'Success',
          reproScript: "#!/usr/bin/env node\nconsole.log('test')",
          observedBehavior: 'The HLC implementation has a clock skew bug',
          expectedBehavior: 'The HLC should merge properly',
          isFlaky: false,
          confidence: 1.0,
        })
      })

      it('should handle nested objects and arrays', () => {
        const NestedStruct = Schema.Struct({
          config: Schema.Struct({
            settings: Schema.Array(Schema.String),
            metadata: Schema.Record({ key: Schema.String, value: Schema.Any }),
          }),
        })
        const nestedSchema = parseJsonLlmResponse(NestedStruct)

        const input = `Configuration updated: {
  "config": {
    "settings": ["debug", "verbose"],
    "metadata": {"version": "1.0", "author": "test"}
  }
}`

        const result = Schema.decodeUnknownSync(nestedSchema)(input)
        expect(result.config.settings).toStrictEqual(['debug', 'verbose'])
        expect(result.config.metadata).toStrictEqual({ version: '1.0', author: 'test' })
      })

      it('should handle escaped quotes and special characters', () => {
        const input = 'Result: {"message": "He said \\"Hello\\" and left", "path": "/tmp/test"}'
        const MessageStruct = Schema.Struct({
          message: Schema.String,
          path: Schema.String,
        })
        const messageSchema = parseJsonLlmResponse(MessageStruct)

        const result = Schema.decodeUnknownSync(messageSchema)(input)
        expect(result).toStrictEqual({
          message: 'He said "Hello" and left',
          path: '/tmp/test',
        })
      })
    })

    describe('multiple JSON objects', () => {
      it('should return the last valid JSON when multiple exist', () => {
        const input = 'Example: {"key": "first"} Another: {"key": "second"} Final: {"key": "last"}'
        const result = Schema.decodeUnknownSync(schema)(input)
        expect(result).toStrictEqual({ key: 'last' })
      })

      it('should return last balanced brace pair (validation happens later)', () => {
        const input = 'First: {broken json} Last: {"key": "value"}'
        const extracted = Schema.decodeUnknownSync(llmJsonStringResponse)(input)
        expect(extracted).toBe('{"key": "value"}')
      })

      it('should prioritize markdown code block over embedded JSON', () => {
        const input = 'Here: {"key": "embedded"}\n\n```json\n{"key": "markdown"}\n```'
        const result = Schema.decodeUnknownSync(schema)(input)
        expect(result).toStrictEqual({ key: 'markdown' })
      })
    })

    describe('edge cases', () => {
      it('should handle plain JSON string (backward compatibility)', () => {
        const input = '{"key": "value"}'
        const result = Schema.decodeUnknownSync(schema)(input)
        expect(result).toStrictEqual({ key: 'value' })
      })

      it('should handle empty string', () => {
        const input = ''
        const result = Schema.decodeUnknownSync(llmJsonStringResponse)(input)
        expect(result).toBe('')
      })

      it('should return original text when no valid JSON found', () => {
        const input = 'This is just plain text with no JSON'
        const result = Schema.decodeUnknownSync(llmJsonStringResponse)(input)
        expect(result).toBe('This is just plain text with no JSON')
      })

      it('should extract balanced braces even if not valid JSON', () => {
        const input = 'This { has unbalanced } braces { but no valid JSON'
        const result = Schema.decodeUnknownSync(llmJsonStringResponse)(input)
        expect(result).toBe('{ has unbalanced }')
      })

      it('should handle JSON with nested braces in strings', () => {
        const input = 'Result: {"script": "if (obj.prop) { return \\"nested { } braces\\"; }"}'
        const ScriptStruct = Schema.Struct({
          script: Schema.String,
        })
        const scriptSchema = parseJsonLlmResponse(ScriptStruct)

        const result = Schema.decodeUnknownSync(scriptSchema)(input)
        expect(result).toStrictEqual({
          script: 'if (obj.prop) { return "nested { } braces"; }',
        })
      })
    })

    describe('encoding', () => {
      it('should encode passthrough without modification', () => {
        const input = '{"key": "value"}'
        const result = Schema.encodeSync(llmJsonStringResponse)(input)
        expect(result).toBe('{"key": "value"}')
      })
    })
  })
})
