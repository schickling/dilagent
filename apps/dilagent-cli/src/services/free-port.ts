import * as Http from 'node:http'
import { Effect, Schema } from 'effect'

export const getFreePort: Effect.Effect<number, UnknownError> = Effect.async<number, UnknownError>((cb, signal) => {
  const server = Http.createServer()

  signal.addEventListener('abort', () => {
    server.close()
  })

  // Listen on port 0 to get an available port
  server.listen(0, () => {
    const address = server.address()

    if (address && typeof address === 'object') {
      const port = address.port
      server.close(() => cb(Effect.succeed(port)))
    } else {
      server.close(() => cb(Effect.fail(new UnknownError({ cause: 'Failed to get a free port' }))))
    }
  })

  // Error handling in case the server encounters an error
  server.on('error', (cause) => {
    server.close(() => cb(Effect.fail(new UnknownError({ cause, payload: 'Failed to get a free port' }))))
  })
})

export class UnknownError extends Schema.TaggedError<UnknownError>()('UnknownError', {
  cause: Schema.Any,
  payload: Schema.optional(Schema.Any),
}) {}
