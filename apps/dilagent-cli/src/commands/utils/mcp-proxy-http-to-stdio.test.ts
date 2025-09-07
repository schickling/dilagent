import { spawn } from 'node:child_process'
import * as http from 'node:http'
import { describe, expect, it } from 'vitest'

describe('mcp-proxy-http-to-stdio', () => {
  it('should forward JSON-RPC requests from stdin to HTTP and return responses to stdout', async () => {
    // Create a mock HTTP server
    const mockServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        const request = JSON.parse(body)

        // Mock response based on the request
        let response: any
        if (request.method === 'initialize') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              serverInfo: { name: 'Mock Server', version: '1.0.0' },
            },
          }
        } else if (request.method === 'tools/list') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              tools: [
                {
                  name: 'test.tool',
                  description: 'A test tool',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            },
          }
        } else {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: 'Method not found' },
          }
        }

        // MCP HTTP endpoints return responses wrapped in an array
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([response]))
      })
    })

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })

    const port = (mockServer.address() as any).port
    const endpoint = `http://127.0.0.1:${port}/mcp`

    // Spawn the proxy process
    const proxy = spawn('bun', ['src/main.ts', 'utils', 'mcp-proxy-http-to-stdio', '--endpoint', endpoint], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const responses: string[] = []

    proxy.stdout.on('data', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line: string) => line.trim())
      responses.push(...lines)
    })

    // Send test requests
    proxy.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'Test Client', version: '1.0.0' },
        },
        id: 1,
      })}\n`,
    )

    proxy.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2,
      })}\n`,
    )

    // Wait for responses
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Kill the proxy
    proxy.kill()

    // Close the mock server
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve())
    })

    // Verify responses
    expect(responses).toHaveLength(2)

    const initResponse = JSON.parse(responses[0]!)
    expect(initResponse.id).toBe(1)
    expect(initResponse.result.serverInfo.name).toBe('Mock Server')

    const toolsResponse = JSON.parse(responses[1]!)
    expect(toolsResponse.id).toBe(2)
    expect(toolsResponse.result.tools).toHaveLength(1)
    expect(toolsResponse.result.tools[0].name).toBe('test.tool')
  })

  it('should handle HTTP errors gracefully', async () => {
    // Spawn proxy with invalid endpoint
    const proxy = spawn(
      'bun',
      ['src/main.ts', 'utils', 'mcp-proxy-http-to-stdio', '--endpoint', 'http://localhost:99999/invalid'],
      {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    const responses: string[] = []

    proxy.stdout.on('data', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line: string) => line.trim())
      responses.push(...lines)
    })

    // Send test request
    proxy.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'test',
        params: {},
        id: 1,
      })}\n`,
    )

    // Wait for error response
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Kill the proxy
    proxy.kill()

    // Verify error response
    expect(responses).toHaveLength(1)

    const errorResponse = JSON.parse(responses[0]!)
    expect(errorResponse.error).toBeDefined()
    expect(errorResponse.error.code).toBe(-32603)
    expect(errorResponse.error.message).toContain('Proxy error')
  })

  it('should handle malformed JSON gracefully', async () => {
    // Create a mock HTTP server
    const mockServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('["not valid json]')
    })

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })

    const port = (mockServer.address() as any).port
    const endpoint = `http://127.0.0.1:${port}/mcp`

    // Spawn the proxy process
    const proxy = spawn('bun', ['src/main.ts', 'utils', 'mcp-proxy-http-to-stdio', '--endpoint', endpoint], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const responses: string[] = []

    proxy.stdout.on('data', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line: string) => line.trim())
      responses.push(...lines)
    })

    // Send invalid JSON
    proxy.stdin.write('not json at all\n')

    // Wait for error response
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Kill the proxy
    proxy.kill()

    // Close the mock server
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve())
    })

    // Verify error response
    expect(responses).toHaveLength(1)

    const errorResponse = JSON.parse(responses[0]!)
    expect(errorResponse.error).toBeDefined()
    expect(errorResponse.error.code).toBe(-32700)
  })
})
