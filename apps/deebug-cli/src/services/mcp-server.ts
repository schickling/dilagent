import * as Http from 'node:http'
import { McpServer } from '@effect/ai'
import { HttpRouter } from '@effect/platform'
import { NodeHttpServer } from '@effect/platform-node'
import { Layer } from 'effect'
import { McpToolsLayer } from './mcp-tools.js'

export const createMcpServerLayer = (port: number) =>
  Layer.mergeAll(McpToolsLayer, HttpRouter.Default.serve()).pipe(
    Layer.provide(
      McpServer.layerHttp({
        name: 'Deebug State Manager',
        version: '1.0.0',
        path: '/mcp',
      }),
    ),
    Layer.provide(NodeHttpServer.layer(() => Http.createServer(), { port })),
  )
