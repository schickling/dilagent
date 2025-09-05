import { Context, Effect, Layer, Ref } from 'effect'

export interface StateStoreService {
  readonly get: (key: string) => Effect.Effect<string | undefined>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly delete: (key: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<Array<{ key: string; value: string }>>
  readonly clear: () => Effect.Effect<void>
  readonly keys: () => Effect.Effect<Array<string>>
}

export class StateStore extends Context.Tag('StateStore')<StateStore, StateStoreService>() {
  static readonly Live = Layer.effect(
    StateStore,
    Effect.gen(function* () {
      const store = yield* Ref.make<Map<string, string>>(new Map())

      return StateStore.of({
        get: (key: string) => Ref.get(store).pipe(Effect.map((map) => map.get(key))),

        set: (key: string, value: string) =>
          Ref.update(store, (map) => {
            const newMap = new Map(map)
            newMap.set(key, value)
            return newMap
          }),

        delete: (key: string) =>
          Ref.modify(store, (map) => {
            const newMap = new Map(map)
            const existed = newMap.delete(key)
            return [existed, newMap]
          }),

        list: () =>
          Ref.get(store).pipe(Effect.map((map) => Array.from(map.entries()).map(([key, value]) => ({ key, value })))),

        clear: () => Ref.set(store, new Map()),

        keys: () => Ref.get(store).pipe(Effect.map((map) => Array.from(map.keys()))),
      })
    }),
  )
}
