export type TomlSerializable =
  | string
  | number
  | boolean
  | Date
  | TomlSerializable[]
  | { [key: string]: TomlSerializable | undefined }

export const toTomlString = (value: TomlSerializable | undefined | null): string => {
  const isPrimitive = (value: unknown): value is string | number | boolean =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

  const isPlainObject = (value: unknown): value is Record<string, any> =>
    value !== undefined &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    !(value instanceof Date)

  const quoteKey = (key: string): string => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key))

  const formatPrimitive = (value: string | number | boolean): string => {
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value))
    return value === true ? 'true' : 'false'
  }

  const valueToToml = (value: any): string | undefined => {
    if (value === undefined || value === null) return undefined
    if (isPrimitive(value)) return formatPrimitive(value)
    if (value instanceof Date) return JSON.stringify(value.toISOString())
    if (Array.isArray(value)) {
      const items = value.map((v) => valueToToml(v)).filter((v): v is string => v !== undefined)
      return `[${items.join(', ')}]`
    }
    if (isPlainObject(value)) {
      const entries = Object.keys(value)
        .sort()
        .map((k) => {
          const vv = valueToToml(value[k])
          if (vv === undefined) return undefined
          return `${quoteKey(k)} = ${vv}`
        })
        .filter((e): e is string => e !== undefined)
      return `{ ${entries.join(', ')} }`
    }
    return JSON.stringify(String(value))
  }

  const inner = valueToToml(value)
  return inner ?? '{ }'
}

// no default export
