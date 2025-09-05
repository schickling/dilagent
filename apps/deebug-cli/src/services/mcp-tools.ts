import { AiTool, AiToolkit, McpServer } from '@effect/ai'
import { Console, Effect, Layer, Schema } from 'effect'
import { StateStore } from './state-store.js'

const GetTool = AiTool.make('state.get', {
  description: 'Get a value from the state store by key',
  parameters: {
    key: Schema.String.annotations({
      description: 'The key to retrieve',
    }),
  },
  success: Schema.Union(Schema.String, Schema.Undefined),
})

const SetTool = AiTool.make('state.set', {
  description: 'Set a key-value pair in the state store',
  parameters: {
    key: Schema.String.annotations({
      description: 'The key to set',
    }),
    value: Schema.String.annotations({
      description: 'The value to store',
    }),
  },
  success: Schema.String,
})

const DeleteTool = AiTool.make('state.delete', {
  description: 'Delete a key from the state store',
  parameters: {
    key: Schema.String.annotations({
      description: 'The key to delete',
    }),
  },
  success: Schema.Boolean,
})

const ListTool = AiTool.make('state.list', {
  description: 'List all key-value pairs in the state store',
  success: Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  }),
})

const KeysTool = AiTool.make('state.keys', {
  description: 'List all keys in the state store',
  success: Schema.Struct({
    keys: Schema.Array(Schema.String),
  }),
})

const ClearTool = AiTool.make('state.clear', {
  description: 'Clear all entries from the state store',
  success: Schema.String,
})

const toolkit = AiToolkit.make(GetTool, SetTool, DeleteTool, ListTool, KeysTool, ClearTool)

const makeHandlers = Effect.gen(function* () {
  const store = yield* StateStore

  return toolkit.of({
    'state.get': ({ key }) =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] state.get called with key: "${key}"`)
        const value = yield* store.get(key)
        yield* Console.log(`[MCP] state.get returning: ${value ?? 'undefined'}`)
        return value ?? undefined
      }),

    'state.set': ({ key, value }) =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] state.set called with key: "${key}", value: "${value}"`)
        yield* store.set(key, value)
        const message = `Set ${key} = ${value}`
        yield* Console.log(`[MCP] state.set returning: ${message}`)
        return message
      }),

    'state.delete': ({ key }) =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] state.delete called with key: "${key}"`)
        const result = yield* store.delete(key)
        yield* Console.log(`[MCP] state.delete returning: ${result}`)
        return result
      }),

    'state.list': () =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] state.list called`)
        const entries = yield* store.list()
        yield* Console.log(`[MCP] state.list found ${entries.length} entries:`)
        for (const entry of entries) {
          yield* Console.log(`[MCP]   - ${entry.key} = ${entry.value}`)
        }
        return { entries }
      }),

    'state.keys': () =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] state.keys called`)
        const keys = yield* store.keys()
        yield* Console.log(`[MCP] state.keys returning ${keys.length} keys: ${keys.join(', ')}`)
        return { keys }
      }),

    'state.clear': () =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] state.clear called`)
        yield* store.clear()
        yield* Console.log(`[MCP] state.clear completed`)
        return 'State store cleared'
      }),
  })
})

export const McpToolsLayer = McpServer.toolkit(toolkit).pipe(
  Layer.provide(Layer.unwrapEffect(makeHandlers.pipe(Effect.map((handlers) => toolkit.toLayer(handlers))))),
)
