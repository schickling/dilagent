/*
  Basic script to demonstrate the subtle HLC/LWW bug in code.ts by running it repeatedly
  and checking if replicas disagree on the winner for a key. No test framework used.
*/

import { spawn } from 'node:child_process'

type TNodeSummary = Record<string, string | undefined>

type TRunResult = {
  A: TNodeSummary
  b: TNodeSummary
  C: TNodeSummary
}

const CODE_PATH = new URL('code.ts', import.meta.url).pathname

const tryParseRunOutput = (stdout: string): TRunResult | undefined => {
  const line = stdout.split('\n').find((l) => l.includes('{ A: ') || l.includes('A: {'))
  if (line === undefined) return undefined

  const extractNodeBlock = (label: string): string | undefined => {
    const re = new RegExp(`${label}:(.*?)(?:,\\s*(?:A|b|C):|}$)`) // naive block capture
    const m = line.match(re)
    return m !== null && m[1] !== undefined ? m[1] : undefined
  }

  const extractKeyValue = (block: string | undefined, key: string): string | undefined => {
    if (block === undefined) return undefined
    const re = new RegExp(`${key}:\\s*'([^']*)'`)
    const m = block.match(re)
    if (m === null || m[1] === undefined) return undefined
    const full = m[1]
    const at = full.indexOf('@')
    return at === -1 ? full : full.slice(0, at)
  }

  const aBlock = extractNodeBlock('A')
  const bBlock = extractNodeBlock('b')
  const cBlock = extractNodeBlock('C')

  const result: TRunResult = {
    A: {
      x: extractKeyValue(aBlock, 'x'),
      y: extractKeyValue(aBlock, 'y'),
    },
    b: {
      x: extractKeyValue(bBlock, 'x'),
      y: extractKeyValue(bBlock, 'y'),
    },
    C: {
      x: extractKeyValue(cBlock, 'x'),
      y: extractKeyValue(cBlock, 'y'),
    },
  }

  return result
}

const runOnce = async (): Promise<TRunResult | undefined> => {
  return await new Promise<TRunResult | undefined>((resolve) => {
    const child = spawn('bun', [CODE_PATH], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8')
    })
    child.on('close', () => {
      const parsed = tryParseRunOutput(out)
      resolve(parsed)
    })
  })
}

const valuesAgree = (res: TRunResult, key: string): boolean => {
  const a = res.A[key]
  const b = res.b[key]
  const c = res.C[key]
  if (a === undefined || b === undefined || c === undefined) return false
  return a === b && b === c
}

const main = async (): Promise<void> => {
  const trialsEnv = process.env.TRIALS
  const trials = trialsEnv !== undefined ? Number(trialsEnv) : 40
  for (let i = 1; i <= trials; i++) {
    const res = await runOnce()
    if (res === undefined) {
      // eslint-disable-next-line no-console
      console.log(`trial ${i}: no parseable output`)
      continue
    }
    const agreeX = valuesAgree(res, 'x')
    const agreeY = valuesAgree(res, 'y')
    if (agreeX !== true || agreeY !== true) {
      // eslint-disable-next-line no-console
      console.log('BUG REPRODUCED in trial', i)
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(res, undefined, 2))
      return
    }
    // eslint-disable-next-line no-console
    console.log(`trial ${i}: consistent`) // keep a heartbeat while trying
  }
  // eslint-disable-next-line no-console
  console.log('No divergence observed. Re-run or increase TRIALS.')
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(String(err))
})
