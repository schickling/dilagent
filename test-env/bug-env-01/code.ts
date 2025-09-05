type TTimestamp = {
  wall: number
  logical: number
  nodeId: string
}

type TValue = {
  value: string
  ts: TTimestamp
}

type TMessage =
  | { _tag: 'put'; key: string; value: string; ts: TTimestamp; from: string }
  | {
      _tag: 'sync'
      entries: Array<{ key: string; value: string; ts: TTimestamp }>
      from: string
      senderClock: TTimestamp
    }

const compareTs = (a: TTimestamp, b: TTimestamp): number => {
  if (a.wall !== b.wall) return a.wall - b.wall
  if (a.logical !== b.logical) return a.logical - b.logical
  if (a.nodeId === b.nodeId) return 0
  return a.nodeId < b.nodeId ? -1 : 1
}

class HLC {
  private wall: number
  private logical: number
  public readonly nodeId: string

  constructor(nodeId: string) {
    this.nodeId = nodeId
    this.wall = Date.now()
    this.logical = 0
  }

  now(): TTimestamp {
    const now = Date.now()
    if (now > this.wall) {
      this.wall = now
      this.logical = 0
    } else {
      this.logical += 1
    }
    return { wall: this.wall, logical: this.logical, nodeId: this.nodeId }
  }

  merge(remote: TTimestamp): void {
    const now = Date.now()
    const localWall = now > this.wall ? now : this.wall
    if (remote.wall > localWall) {
      this.wall = remote.wall
      this.logical = remote.logical
      return
    }
    if (remote.wall === localWall) {
      this.wall = localWall
      this.logical = (remote.logical > this.logical ? remote.logical : this.logical) + 1
      return
    }
    this.wall = localWall
  }
}

class UnreliableNetwork {
  private nodes: Map<string, Replica> = new Map()
  private dropRate = 0.05
  private duplicateRate = 0.03
  private minDelayMs = 5
  private maxDelayMs = 40

  add(node: Replica): void {
    this.nodes.set(node.id, node)
  }

  send(to: string, msg: TMessage): void {
    const target = this.nodes.get(to)
    if (target === undefined) return
    const shouldDrop = Math.random() < this.dropRate
    if (shouldDrop === true) return
    const deliver = () => target.receive(msg)
    const delay = Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs
    setTimeout(deliver, delay)
    const shouldDuplicate = Math.random() < this.duplicateRate
    if (shouldDuplicate === true) setTimeout(deliver, delay + 1)
  }
}

class Replica {
  public readonly id: string
  private readonly net: UnreliableNetwork
  private readonly clock: HLC
  private readonly peers: Set<string>
  private readonly store: Map<string, TValue>

  constructor(id: string, net: UnreliableNetwork, peers: string[]) {
    this.id = id
    this.net = net
    this.clock = new HLC(id)
    this.peers = new Set(peers)
    this.store = new Map()
  }

  put(key: string, value: string): void {
    const ts = this.clock.now()
    this.store.set(key, { value, ts })
    for (const p of this.peers) this.net.send(p, { _tag: 'put', key, value, ts, from: this.id })
  }

  sync(): void {
    const entries: Array<{ key: string; value: string; ts: TTimestamp }> = []
    for (const [key, rec] of this.store) entries.push({ key, value: rec.value, ts: rec.ts })
    const senderClock = this.clock.now()
    for (const p of this.peers) this.net.send(p, { _tag: 'sync', entries, from: this.id, senderClock })
  }

  receive(msg: TMessage): void {
    if (msg._tag === 'put') {
      this.clock.merge(msg.ts)
      const existing = this.store.get(msg.key)
      if (existing === undefined || compareTs(existing.ts, msg.ts) < 0) {
        this.store.set(msg.key, { value: msg.value, ts: msg.ts })
      }
      return
    }

    if (msg._tag === 'sync') {
      // Subtle bug: merging the local clock with each entry's timestamp.
      // Correct would be to merge once with the envelope sender clock.
      for (const entry of msg.entries) {
        this.clock.merge(entry.ts) // BUG: this causally skews local clock per entry
        const local = this.store.get(entry.key)
        if (local === undefined || compareTs(local.ts, entry.ts) < 0) {
          this.store.set(entry.key, { value: entry.value, ts: entry.ts })
        }
      }
      return
    }
  }

  dump(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of this.store) out[k] = `${v.value}@${v.ts.wall}:${v.ts.logical}:${v.ts.nodeId}`
    return out
  }
}

const run = async (): Promise<void> => {
  const net = new UnreliableNetwork()
  const a = new Replica('A', net, ['B', 'C'])
  const b = new Replica('b', net, ['A', 'C'])
  const c = new Replica('C', net, ['A', 'b'])
  net.add(a)
  net.add(b)
  net.add(c)

  a.put('x', '1')
  b.put('x', '2')
  c.put('y', 'Y')
  a.sync()
  b.sync()
  c.sync()

  await new Promise<void>((resolve) => setTimeout(() => resolve(), 80))

  a.put('x', '3')
  b.put('y', 'Z')
  c.put('x', '4')
  a.sync()

  await new Promise<void>((resolve) => setTimeout(() => resolve(), 120))

  b.sync()
  c.sync()

  await new Promise<void>((resolve) => setTimeout(() => resolve(), 200))

  // Inconsistencies can sporadically appear because of the subtle clock skew during sync.
  // Rarely, different nodes can converge to different winners for the same key.
  // Re-run multiple times to observe.
  // eslint-disable-next-line no-console
  console.log({ A: a.dump(), b: b.dump(), C: c.dump() })
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(String(err))
})
