import { McpServer } from '@effect/ai'
import { HttpRouter } from '@effect/platform'
import { NodeHttpServer } from '@effect/platform-node'
import * as Http from 'node:http'
import { Config, Effect, Layer } from 'effect'
import { McpToolsLayer } from './mcp-tools.js'

const Port = Config.integer('MCP_PORT').pipe(
  Config.withDefault(3000)
)

export const createMcpServerLayer = (port: number = 3000) => {
  // Stack all layers together - StateStore will be provided externally for sharing
  return Layer.mergeAll(
    McpToolsLayer,
    HttpRouter.Default.serve()
  ).pipe(
    Layer.provide(
      McpServer.layerHttp({
        name: 'Deebug State Manager',
        version: '1.0.0',
        path: '/mcp'
      })
    ),
    Layer.provide(NodeHttpServer.layer(() => Http.createServer(), { port }))
  )
}

export const McpServerLive = Port.pipe(
  Effect.map(createMcpServerLayer),
  Layer.unwrapEffect
)