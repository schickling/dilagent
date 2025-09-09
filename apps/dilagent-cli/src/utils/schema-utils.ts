import { Schema } from 'effect'

export const llmJsonStringResponse = Schema.transform(Schema.String, Schema.String, {
  decode: (jsonString) => {
    // Extract JSON if it's wrapped in ```json...```
    const jsonMatch = jsonString.match(/^```json\s*\n([\s\S]*?)\n```$/)
    return jsonMatch?.[1]?.trim() ?? jsonString
  },
  // We don't care about encoding really...
  encode: (jsonString) => jsonString,
})

export const parseJsonLlmResponse = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Schema.compose(llmJsonStringResponse, Schema.parseJson(schema))
