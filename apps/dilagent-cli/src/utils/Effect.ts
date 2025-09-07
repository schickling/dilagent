import { Duration, Effect } from 'effect'

export const logDuration =
  (label: string) =>
  <R, E, A>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const start = Date.now()
      const res = yield* eff
      const end = Date.now()
      yield* Effect.log(`${label}: ${Duration.format(end - start)}`)
      return res
    })
