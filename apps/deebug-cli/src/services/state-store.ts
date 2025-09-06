import { Effect, Ref, Schema } from 'effect'
import { ExperimentResult, ExperimentStatusUpdate } from '../schemas/experiment.ts'

const schema = Schema.Union(ExperimentResult, ExperimentStatusUpdate)

export class StateStore extends Effect.Service<StateStore>()('StateStore', {
  effect: Effect.gen(function* () {
    const store = yield* Ref.make<Map<string, typeof schema.Type>>(new Map())

    const get = (key: string) =>
      Ref.get(store).pipe(
        Effect.map((map) => map.get(key)),
        // Effect.andThen(Schema.validate(schema)),
      )

    const set = (key: string, value: typeof schema.Type) =>
      Ref.update(store, (map) => {
        const newMap = new Map<string, typeof schema.Type>(map)
        newMap.set(key, value)
        return newMap
      })

    const deleteKey = (key: string) =>
      Ref.modify(store, (map) => {
        const newMap = new Map(map)
        const existed = newMap.delete(key)
        return [existed, newMap]
      })

    const list = () =>
      Ref.get(store).pipe(Effect.map((map) => Array.from(map.entries()).map(([key, value]) => ({ key, value }))))

    const clear = () => Ref.set(store, new Map())

    const keys = () => Ref.get(store).pipe(Effect.map((map) => Array.from(map.keys())))

    return { get, set, delete: deleteKey, list, clear, keys } as const
  }),
}) {}
