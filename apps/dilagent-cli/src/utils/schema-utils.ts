import { Schema } from 'effect'

/**
 * Extracts JSON from text containing mixed content (markdown, explanations, etc).
 *
 * Uses a multi-strategy approach:
 * 1. First tries to extract JSON from markdown code blocks (```json...```)
 * 2. Falls back to finding balanced brace pairs { ... } in the text
 * 3. Returns the last potential JSON found (typically the actual LLM response)
 *
 * Note: Does not validate JSON syntax - validation is handled by Effect's parseJson
 *
 * Handles:
 * - JSON wrapped in markdown code blocks
 * - JSON embedded in explanatory text
 * - Multiple JSON objects in the same text
 * - Escaped characters and nested structures
 * - Complex objects with arrays and nested properties
 *
 * @param text - Input text that may contain JSON
 * @returns Extracted JSON string or original text if no valid JSON found
 *
 * @example
 * ```typescript
 * // Extracts from markdown
 * extractJsonFromText('```json\n{"key": "value"}\n```') // '{"key": "value"}'
 *
 * // Extracts from mixed content
 * extractJsonFromText('Here is the result: {"_tag": "Success", "data": 123}') // '{"_tag": "Success", "data": 123}'
 *
 * // Returns last valid JSON when multiple exist
 * extractJsonFromText('Example: {"temp": 1} Actual: {"result": 2}') // '{"result": 2}'
 * ```
 */
const extractJsonFromText = (text: string): string => {
  // Strategy 1: Try markdown code block first (most explicit)
  const codeBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/)
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim()
  }

  // Strategy 2: Find all potential JSON objects by balanced brace parsing
  const jsonCandidates: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escapeNext = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"' && depth > 0) {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') {
      if (depth === 0) start = i
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1)
        jsonCandidates.push(candidate)
        start = -1
      }
    }
  }

  // Return the last potential JSON (usually the actual response)
  // or original text if no candidates found
  return jsonCandidates[jsonCandidates.length - 1] ?? text
}

/**
 * Schema transformer that extracts JSON strings from LLM responses containing mixed content.
 *
 * LLMs often return JSON responses wrapped in markdown code blocks or embedded within
 * explanatory text. This transformer intelligently extracts the JSON content using
 * multiple detection strategies.
 *
 * @example
 * ```typescript
 * const MySchema = Schema.Struct({ result: Schema.String })
 * const parser = parseJsonLlmResponse(MySchema)
 *
 * // Works with markdown
 * Schema.decodeSync(parser)('```json\n{"result": "success"}\n```')
 *
 * // Works with embedded JSON
 * Schema.decodeSync(parser)('Analysis complete: {"result": "success"}')
 * ```
 */
export const llmJsonStringResponse = Schema.transform(Schema.String, Schema.String, {
  decode: extractJsonFromText,
  encode: (jsonString) => jsonString,
})

export const parseJsonLlmResponse = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Schema.compose(llmJsonStringResponse, Schema.parseJson(schema))
