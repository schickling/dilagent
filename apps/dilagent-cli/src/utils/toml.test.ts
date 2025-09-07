import { describe, expect, it } from 'vitest'
import { toTomlString } from './toml.ts'

describe('toTomlString', () => {
  it('serializes flat primitives as inline table', () => {
    const out = toTomlString({ a: 1, b: 'x', c: true })
    expect(out).toBe('{ a = 1, b = "x", c = true }')
  })

  it('serializes arrays of primitives', () => {
    const out = toTomlString({ arr: [1, 2, 3], names: ['a', 'b'] })
    expect(out).toBe('{ arr = [1, 2, 3], names = ["a", "b"] }')
  })

  it('serializes nested objects as dotted keys', () => {
    const out = toTomlString({ mcp: { servers: { one: { url: 'http://x' } } } })
    expect(out).toBe('{ mcp = { servers = { one = { url = "http://x" } } } }')
  })

  it('serializes Date to ISO string', () => {
    const date = new Date('2020-01-02T03:04:05.000Z')
    const out = toTomlString({ when: date })
    expect(out).toContain('when = "2020-01-02T03:04:05.000Z"')
  })

  it('falls back to JSON for complex arrays', () => {
    const out = toTomlString({ list: [{ a: 1 }, { b: 2 }] })
    expect(out).toBe('{ list = [{ a = 1 }, { b = 2 }] }')
  })

  it('ignores undefined fields', () => {
    const out = toTomlString({ a: undefined, b: { c: undefined, d: 2 } })
    expect(out).toBe('{ b = { d = 2 } }')
  })

  it('serializes array of inline tables', () => {
    const out = toTomlString({ servers: [{ url: 'x' }, { url: 'y', enabled: false }] })
    expect(out).toBe('{ servers = [{ url = "x" }, { enabled = false, url = "y" }] }')
  })

  it('serializes nested arrays', () => {
    const out = toTomlString({
      grid: [
        [1, 2],
        [3, 4],
      ],
    })
    expect(out).toBe('{ grid = [[1, 2], [3, 4]] }')
  })

  it('serializes date arrays', () => {
    const out = toTomlString({ dates: [new Date('2020-01-01T00:00:00Z'), new Date('2020-01-02T00:00:00Z')] })
    expect(out).toBe('{ dates = ["2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z"] }')
  })

  it('quotes keys that need quoting', () => {
    const out = toTomlString({ 'a.b': { 'weird key': 1 } })
    expect(out).toBe('{ "a.b" = { "weird key" = 1 } }')
  })

  it('supports top-level array of primitives', () => {
    const out = toTomlString([1, 2, 3])
    expect(out).toBe('[1, 2, 3]')
  })

  it('supports top-level array of inline tables', () => {
    const out = toTomlString([{ a: 1 }, { b: 2 }])
    expect(out).toBe('[{ a = 1 }, { b = 2 }]')
  })
})
