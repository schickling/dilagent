import { AiTool, AiToolkit, McpServer } from '@effect/ai'
import { Console, Effect, Layer, Schema } from 'effect'
import { ExperimentResult, ExperimentStatusUpdate } from '../schemas/experiment.ts'
import { StateStore } from './state-store.js'

const GetTool = AiTool.make('deebug_state_get', {
  description: 'Get a value from the state store by key',
  parameters: {
    key: Schema.String.annotations({
      description: 'The key to retrieve',
    }),
  },
  success: Schema.Union(ExperimentResult, ExperimentStatusUpdate, Schema.Undefined),
})

const SetTool = AiTool.make('deebug_state_set', {
  description: 'Set a key-value pair in the state store',
  parameters: {
    key: Schema.String.annotations({
      description: 'The key to set',
    }),
    value: Schema.Union(ExperimentResult, ExperimentStatusUpdate),
  },
  success: Schema.String,
})

const DeleteTool = AiTool.make('deebug_state_delete', {
  description: 'Delete a key from the state store',
  parameters: {
    key: Schema.String.annotations({
      description: 'The key to delete',
    }),
  },
  success: Schema.Boolean,
})

const ListTool = AiTool.make('deebug_state_list', {
  description: 'List all key-value pairs in the state store',
  success: Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        value: Schema.Union(ExperimentResult, ExperimentStatusUpdate),
      }),
    ),
  }),
})

const KeysTool = AiTool.make('deebug_state_keys', {
  description: 'List all keys in the state store',
  success: Schema.Struct({
    keys: Schema.Array(Schema.String),
  }),
})

const ClearTool = AiTool.make('deebug_state_clear', {
  description: 'Clear all entries from the state store',
  success: Schema.String,
})

const toolkit = AiToolkit.make(GetTool, SetTool, DeleteTool, ListTool, KeysTool, ClearTool)

const makeHandlers = Effect.gen(function* () {
  const store = yield* StateStore

  return toolkit.of({
    deebug_state_get: ({ key }) =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] deebug_state_get called with key: "${key}"`)
        const value = yield* store.get(key)
        yield* Console.log(`[MCP] deebug_state_get returning: ${value ?? 'undefined'}`)
        return value ?? undefined
      }),

    deebug_state_set: ({ key, value }) =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] deebug_state_set called with key: "${key}", value: "${value}"`)
        yield* store.set(key, value)
        const message = `Set ${key} = ${value}`
        yield* Console.log(`[MCP] deebug_state_set returning: ${message}`)
        return message
      }),

    deebug_state_delete: ({ key }) =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] deebug_state_delete called with key: "${key}"`)
        const result = yield* store.delete(key)
        yield* Console.log(`[MCP] deebug_state_delete returning: ${result}`)
        return result
      }),

    deebug_state_list: () =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] deebug_state_list called`)
        const entries = yield* store.list()
        yield* Console.log(`[MCP] deebug_state_list found ${entries.length} entries:`)
        for (const entry of entries) {
          yield* Console.log(`[MCP]   - ${entry.key} = ${entry.value}`)
        }
        return { entries }
      }),

    deebug_state_keys: () =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] deebug_state_keys called`)
        const keys = yield* store.keys()
        yield* Console.log(`[MCP] deebug_state_keys returning ${keys.length} keys: ${keys.join(', ')}`)
        return { keys }
      }),

    deebug_state_clear: () =>
      Effect.gen(function* () {
        yield* Console.log(`[MCP] deebug_state_clear called`)
        yield* store.clear()
        yield* Console.log(`[MCP] deebug_state_clear completed`)
        return 'State store cleared'
      }),
  })
})

export const McpToolsLayer = McpServer.toolkit(toolkit).pipe(
  Layer.provide(Layer.unwrapEffect(makeHandlers.pipe(Effect.map((handlers) => toolkit.toLayer(handlers))))),
)
