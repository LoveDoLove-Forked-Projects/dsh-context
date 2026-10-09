/** Agent-graph derivation — the pure model behind the Agent network card. The
 * session-list snapshot carries everything the card needs, and this folds it
 * into the current session's family: the topmost known ancestor's whole subtree, per-node stats, and a depth/DFS layout. */

import type { PartsPart } from './categories'
import type { ContextTimeline, SessionCostUsage } from '../shared/types'
import { mergeCostUsage } from './cost'
import { headlineOf, occupancyPercent, type Headline } from './headline'
import { asRecord, contextBreakdownOf, contextPressureOf, numOf, timelineOf, tokenUsageOf } from './services'

/** The outward `ctx.sessions` client face. Session navigation is NOT here: the
 * view owner's `openSession` is (services.ts `openSessionVia`). */
export interface SessionsFaceLike {
  list?: {
    getSnapshot(): unknown
    subscribe(fn: () => void): () => void
  }
  refreshSubagents?(parentSessionId: string): Promise<unknown>
}

export interface AgentRow {
  displayTitle?: string
  title?: string
  parentId?: string
  origin?: string
  running: boolean
  completed: boolean
  blank: boolean
  updatedAt: number
  projections?: Record<string, unknown>
}

/** The subagent domain's `subagent` identity projection (descriptor mode + durable label). */
export interface AgentIdentity {
  mode: 'one-shot' | 'continuable'
  label?: string
}

export interface AgentStats {
  head: Headline | null
  requests: number
  billed: number | null
  durationMs: number | null
  identity: AgentIdentity | null
}

/** Live stats of the CURRENT session, fresher than any list row. */
export interface AgentSelfStats {
  head: Headline | null
  billed: number | null
  requests: number
}

export interface AgentNode extends AgentStats {
  id: string
  label: string
  parentId?: string
  depth: number
  /** Which level-1 subtree this node belongs to (root = -1) — drives the family link hue. */
  family: number
  isCurrent: boolean
  running: boolean
  completed: boolean
  subagent: boolean
}

export interface AgentForest {
  /** DFS pre-order (parents ahead of their children). */
  nodes: AgentNode[]
  edges: { from: string; to: string }[]
  overflow: number
  solo: boolean
}

/** The card stays readable up to this many nodes; the rest folds into an overflow note. */
export const AGENT_TREE_LIMIT = 25

/** Donut geometry: node disc radius and the fused composition/occupancy ring radius (SVG units). */
export const AGENT_NODE_R = 26
export const AGENT_RING_R = 20
/** Horizontal cell pitch adapts to the stage width between these bounds; each
 * node owns one cell, so the caption box (cell minus an 8px gutter) can never clip at a neighbor or the stage edge. */
const SLOT_MAX = 184
const SLOT_MIN = 112
const CAPTION_GUTTER = 8
/** Vertical pitch between depth levels: node radius + caption zone + a dedicated 28px link channel below it. */
const LEVEL_H = 154
/** Bottom edge of a node cell — links exit here, below the caption zone, so a connector never crosses a label. */
const CELL_H = AGENT_NODE_R + 64
const PAD_Y = 56

export function agentRowOf(value: unknown): AgentRow | null {
  const rec = asRecord(value)
  if (rec === null) return null
  const projections = asRecord(rec.projectionValues)
  return {
    ...(typeof rec.displayTitle === 'string' ? { displayTitle: rec.displayTitle } : {}),
    ...(typeof rec.title === 'string' ? { title: rec.title } : {}),
    ...(typeof rec.parentId === 'string' ? { parentId: rec.parentId } : {}),
    ...(typeof rec.origin === 'string' ? { origin: rec.origin } : {}),
    running: rec.running === true,
    completed: rec.completed === true,
    blank: rec.blank === true,
    updatedAt: numOf(rec.updatedAt),
    ...(projections !== null ? { projections } : {}),
  }
}

export function agentIdentityOf(value: unknown): AgentIdentity | null {
  const rec = asRecord(value)
  if (rec === null) return null
  if (rec.mode !== 'one-shot' && rec.mode !== 'continuable') return null
  return {
    mode: rec.mode,
    ...(typeof rec.label === 'string' && rec.label !== '' ? { label: rec.label } : {}),
  }
}

export function agentDurationOf(value: unknown): number | null {
  const rec = asRecord(value)
  if (rec === null) return null
  const settled = numOf(rec.settledMs)
  const active = asRecord(rec.active)
  const openMs = active !== null ? Math.max(0, numOf(active.through) - numOf(active.since)) : 0
  const total = settled + openMs
  return total > 0 ? total : null
}

/** Fold one row's projection values into render-ready stats. The composition
 * prefers the plugin's own `contextTimeline`; a pressure-only row still yields an occupancy ring without slices. */
export function agentStatsOf(values: Record<string, unknown> | undefined): AgentStats {
  const timeline = timelineOf(values?.contextTimeline)
  const pressure = contextPressureOf(values?.contextPressure)
  const breakdown = contextBreakdownOf(values?.contextBreakdown)
  const usage = tokenUsageOf(values?.tokenUsage)
  let head: Headline | null = null
  if (timeline !== null) {
    head = headlineOf(timeline, pressure, breakdown)
  } else if (pressure !== null) {
    const tokens = typeof pressure.projectedTokens === 'number' ? pressure.projectedTokens
      : typeof pressure.pressureTokens === 'number' ? pressure.pressureTokens
        : null
    if (tokens !== null) {
      const window = typeof pressure.contextWindow === 'number' && pressure.contextWindow > 0
        ? pressure.contextWindow
        : undefined
      head = {
        tokens,
        window,
        pct: window !== undefined ? occupancyPercent(tokens, window) : null,
        parts: [],
      }
    }
  }
  const billed = usage !== null
    ? numOf(usage.uncachedInputTokens) + numOf(usage.outputTokens) + numOf(usage.cacheReadTokens) + numOf(usage.cacheWriteTokens)
    : null
  return {
    head,
    // The split-generation wire head carries the tally precomputed; the inline generation's rows count their served records.
    requests: timeline !== null ? (timeline.counts?.steps ?? timeline.requests.length) : 0,
    billed,
    durationMs: agentDurationOf(values?.subagentTiming),
    identity: agentIdentityOf(values?.subagent),
  }
}

interface AgentChild {
  id: string
  row: AgentRow
}

/**
 * Build the current session's agent family: walk up `parentId` to the topmost
 * known ancestor, then DFS its whole subtree (blank rows excluded). Null when
 * there is no anchor; the current session synthesizes a row when the list has
 * not delivered it yet.
 * @param fetched - detail-channel heads for COLD rows, keyed by session id.
 *   The list block serves projection values only from the projection cache, so
 *   these fill in relatives that would otherwise list pressure-only; a row's
 *   own value always wins.
 */
export function agentForestOf(
  snapshot: unknown,
  currentId: string | undefined,
  self?: AgentSelfStats,
  fetched?: ReadonlyMap<string, unknown>,
): AgentForest | null {
  const byId = asRecord(asRecord(snapshot)?.byId)
  if (byId === null || currentId === undefined || currentId === '') return null

  const rows = new Map<string, AgentRow>()
  for (const key of Object.keys(byId)) {
    const row = agentRowOf(byId[key])
    // Blank placeholder sessions (never engaged) are not agents; the current session always stays.
    if (row !== null && (!row.blank || key === currentId)) rows.set(key, row)
  }
  if (!rows.has(currentId)) {
    rows.set(currentId, { running: false, completed: false, blank: false, updatedAt: 0 })
  }

  // Topmost known ancestor; a lineage cycle anchors at the first repeated id.
  let root = currentId
  const chain = new Set<string>([currentId])
  for (;;) {
    const parent = rows.get(root)?.parentId
    if (parent === undefined || !rows.has(parent) || chain.has(parent)) break
    chain.add(parent)
    root = parent
  }
  const rootRow = rows.get(root)
  /** v8 ignore next 2 -- root is currentId (inserted above) or a parent verified with rows.has, so its row always exists. */
  if (rootRow === undefined) return null

  const childrenOf = new Map<string, AgentChild[]>()
  for (const [id, row] of rows) {
    if (row.parentId === undefined || !rows.has(row.parentId)) continue
    const list = childrenOf.get(row.parentId) ?? []
    list.push({ id, row })
    childrenOf.set(row.parentId, list)
  }
  for (const kids of childrenOf.values()) {
    kids.sort((a, b) => {
      const runDelta = Number(b.row.running) - Number(a.row.running)
      if (runDelta !== 0) return runDelta
      const timeDelta = b.row.updatedAt - a.row.updatedAt
      return timeDelta !== 0 ? timeDelta : (a.id < b.id ? -1 : 1)
    })
  }

  // Measured before the DFS so the overflow note is exact even when the cap cuts the walk short.
  const measure = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    let total = 1
    for (const kid of childrenOf.get(id) ?? []) total += measure(kid.id, seen)
    return total
  }
  const total = measure(root, new Set())

  const nodes: AgentNode[] = []
  const edges: { from: string; to: string }[] = []
  const visit = (id: string, row: AgentRow, parentId: string | undefined, depth: number, seen: Set<string>, family: number): void => {
    if (seen.has(id) || nodes.length >= AGENT_TREE_LIMIT) return
    seen.add(id)
    const values = row.projections
    const fetchedHead = fetched !== undefined ? fetched.get(id) : undefined
    const stats = agentStatsOf(fetchedHead !== undefined && values?.contextTimeline === undefined
      ? { ...values, contextTimeline: fetchedHead }
      : values)
    const identity = stats.identity
    const node: AgentNode = {
      ...stats,
      id,
      label: identity?.label ?? row.title ?? row.displayTitle ?? id,
      ...(parentId !== undefined ? { parentId } : {}),
      depth,
      family,
      isCurrent: id === currentId,
      running: row.running,
      completed: row.completed,
      subagent: row.origin === 'subagent' || identity !== null,
    }
    if (node.isCurrent && self !== undefined) {
      node.head = self.head ?? node.head
      node.billed = self.billed ?? node.billed
      node.requests = self.requests > 0 ? self.requests : node.requests
    }
    nodes.push(node)
    if (parentId !== undefined) edges.push({ from: parentId, to: id })
    const kids = childrenOf.get(id) ?? []
    kids.forEach((kid, ki) => {
      visit(kid.id, kid.row, id, depth + 1, seen, depth === 0 ? ki : family)
    })
  }
  visit(root, rootRow, undefined, 0, new Set(), -1)

  return { nodes, edges, overflow: Math.max(0, total - nodes.length), solo: nodes.length === 1 }
}

export interface SubagentCostFold {
  usage: SessionCostUsage | null
  /** Descendants with no timeline row and no landed head — the slim-head fetch targets. */
  cold: string[]
  count: number
}

/** Merge the current session's SUBAGENT subtree cost: warm rows'
 * `contextTimeline` cost first, fetched slim heads (`landed`) standing in for
 * rows with no timeline value. Blank rows are not agents; the current session
 * itself is never counted — the caller already holds its own usage. */
export function subagentCostFoldOf(
  snapshot: unknown,
  currentId: string | undefined,
  landed?: ReadonlyMap<string, ContextTimeline>,
): SubagentCostFold {
  const byId = asRecord(asRecord(snapshot)?.byId)
  if (byId === null || currentId === undefined || currentId === '') return { usage: null, cold: [], count: 0 }
  const childrenOf = new Map<string, string[]>()
  for (const key of Object.keys(byId)) {
    const row = agentRowOf(byId[key])
    if (row === null || row.blank || row.parentId === undefined) continue
    const list = childrenOf.get(row.parentId) ?? []
    list.push(key)
    childrenOf.set(row.parentId, list)
  }
  const parts: SessionCostUsage[] = []
  const cold: string[] = []
  const seen = new Set<string>([currentId])
  const queue = [currentId]
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const kid of childrenOf.get(id) ?? []) {
      if (seen.has(kid)) continue
      seen.add(kid)
      const head = landed?.get(kid)
      const values = agentRowOf(byId[kid])?.projections
      if (values?.contextTimeline === undefined) {
        // A cold relative's usage rides its fetched slim head; until one lands
        // the id stays a fetch target, and a landed head is final either way.
        if (head === undefined) cold.push(kid)
        else if (head.cost !== undefined) parts.push(head.cost)
      } else {
        const cost = timelineOf(values.contextTimeline)?.cost
        if (cost !== undefined) parts.push(cost)
      }
      queue.push(kid)
    }
  }
  return { usage: parts.length > 0 ? mergeCostUsage(...parts) : null, cold, count: seen.size - 1 }
}

export interface AgentPoint {
  id: string
  x: number
  y: number
  depth: number
}

export interface AgentLink {
  to: string
  running: boolean
  color: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface AgentLayout {
  width: number
  height: number
  captionW: number
  points: AgentPoint[]
  links: AgentLink[]
}

/** Tidy top-down tree layout: siblings claim leaf slots and parents center over
 * their children. The slot pitch adapts to the stage width between SLOT_MAX and
 * SLOT_MIN; a level that still overflows wraps into bands, since vertical room is cheaper than horizontal scrolling. */
export function layoutForest(forest: AgentForest, stageWidth = 0): AgentLayout {
  // Nodes are DFS pre-order, so plain iteration appends children in visit order.
  const childrenOf = new Map<string, AgentNode[]>()
  for (const n of forest.nodes) {
    if (n.parentId === undefined) continue
    const kids = childrenOf.get(n.parentId) ?? []
    kids.push(n)
    childrenOf.set(n.parentId, kids)
  }

  const slotOf = new Map<string, number>()
  let leafSlots = 0
  const place = (node: AgentNode): number => {
    const kids = childrenOf.get(node.id) ?? []
    if (kids.length === 0) {
      const slot = leafSlots
      leafSlots++
      slotOf.set(node.id, slot)
      return slot
    }
    let first = 0
    let last = 0
    kids.forEach((kid, index) => {
      const slot = place(kid)
      if (index === 0) first = slot
      last = slot
    })
    const slot = (first + last) / 2
    slotOf.set(node.id, slot)
    return slot
  }
  /** v8 ignore next 1 -- a forest always holds at least the (possibly synthesized) current node. */
  if (forest.nodes.length > 0) place(forest.nodes[0])

  const perLevel = stageWidth > 0 ? Math.max(2, Math.floor(stageWidth / SLOT_MIN)) : 0

  if (perLevel > 0 && leafSlots > perLevel) {
    // Wrapped layout: bands interleaved by kinship, so after each parent band
    // come the bands of exactly those parents' children and sibling groups never split unless one group alone exceeds the band.
    const bandSlot = Math.min(SLOT_MAX, stageWidth / perLevel)
    const width = perLevel * bandSlot
    const points: AgentPoint[] = []
    let row = 0
    const emitBand = (nodes: AgentNode[], depth: number): void => {
      const inset = (width - nodes.length * bandSlot) / 2
      nodes.forEach((node, i) => {
        points.push({ id: node.id, x: inset + (i + 0.5) * bandSlot, y: PAD_Y + row * LEVEL_H, depth })
      })
      row++
      let band: AgentNode[] = []
      const flush = (): void => {
        if (band.length === 0) return
        const packed = band
        band = []
        emitBand(packed, depth + 1)
      }
      for (const node of nodes) {
        const kids = childrenOf.get(node.id) ?? []
        for (let start = 0; start < kids.length; start += perLevel) {
          const group = kids.slice(start, start + perLevel)
          if (band.length + group.length > perLevel) flush()
          band.push(...group)
          if (band.length === perLevel) flush()
        }
      }
      flush()
    }
    /* v8 ignore next 1 -- a forest always holds at least the current node. */
    if (forest.nodes.length > 0) emitBand([forest.nodes[0]], 0)
    return {
      width,
      height: PAD_Y + (row - 1) * LEVEL_H + CELL_H + 28,
      captionW: bandSlot - CAPTION_GUTTER,
      points,
      links: linksOf(forest, points),
    }
  }

  // Adaptive pitch; 0 = unmeasured stage (the natural maximum).
  const slot = stageWidth > 0 && leafSlots > 1 ? Math.min(SLOT_MAX, stageWidth / leafSlots) : SLOT_MAX
  const points: AgentPoint[] = forest.nodes.map(node => ({
    id: node.id,
    /** v8 ignore next 1 -- place() visits every node: the forest is exactly the root's subtree by construction. */
    x: (slotOf.get(node.id) ?? 0) * slot + slot / 2,
    y: PAD_Y + node.depth * LEVEL_H,
    depth: node.depth,
  }))
  const maxDepth = points.reduce((max, p) => Math.max(max, p.depth), 0)
  return {
    width: leafSlots * slot,
    height: PAD_Y + maxDepth * LEVEL_H + CELL_H + 28,
    captionW: slot - CAPTION_GUTTER,
    points,
    links: linksOf(forest, points),
  }
}

/** Family hue by level-1 subtree index: the golden angle keeps consecutive
 * families separated on the color wheel without a hand-tuned palette. */
export function familyHue(index: number): string {
  return `hsl(${Math.round(index * 137.508) % 360} 58% 52%)`
}

function linksOf(forest: AgentForest, points: AgentPoint[]): AgentLink[] {
  const pointOf = new Map(points.map(p => [p.id, p]))
  const nodeOf = new Map(forest.nodes.map(n => [n.id, n]))
  const runningIds = new Set(forest.nodes.filter(n => n.running).map(n => n.id))
  const links: AgentLink[] = []
  for (const edge of forest.edges) {
    const from = pointOf.get(edge.from)
    const to = pointOf.get(edge.to)
    /** v8 ignore next 2 -- edges are emitted only for visited parent/child pairs, so both points always exist. */
    if (from === undefined || to === undefined) continue
    links.push({
      to: edge.to,
      running: runningIds.has(edge.to),
      /* v8 ignore next 1 -- edges only connect visited nodes. */
      color: familyHue(nodeOf.get(edge.to)?.family ?? 0),
      x1: from.x,
      y1: from.y + CELL_H,
      x2: to.x,
      y2: to.y - AGENT_NODE_R - 10,
    })
  }
  return links
}

export interface RingSeg {
  key: string
  /** Segment color; the free remainder is styled by its CSS class instead. */
  color: string
  len: number
  offset: number
  free: boolean
}

/** One fused ring per agent — the chat composer ring's own semantics: the
 * composition parts, scaled to the occupancy share, fill the circle and a
 * neutral remainder marks the free window. No known window fills the whole
 * circle; no composition falls back to a single occupancy arc. */
export function ringSegments(parts: PartsPart[], pct: number | null, radius: number, fallbackColor: string): RingSeg[] {
  const circumference = 2 * Math.PI * radius
  const occ = pct === null ? 1 : Math.min(100, Math.max(0, pct)) / 100
  let total = 0
  for (const p of parts) total += p.value > 0 ? p.value : 0
  const segs: RingSeg[] = []
  let offset = 0
  if (total > 0) {
    for (const p of parts) {
      if (p.value <= 0) continue
      const len = circumference * (p.value / total) * occ
      if (len <= 0) continue
      segs.push({ key: p.key, color: p.color, len, offset, free: false })
      offset += len
    }
  } else if (pct !== null && occ > 0) {
    segs.push({ key: 'fill', color: fallbackColor, len: circumference * occ, offset: 0, free: false })
    offset = circumference * occ
  }
  if (pct !== null && offset < circumference) {
    segs.push({ key: 'free', color: '', len: circumference - offset, offset, free: true })
  }
  return segs
}

export function sessionsFaceOf(ctx: { get(name: string): unknown }): SessionsFaceLike | null {
  const rec = asRecord(ctx.get('sessions'))
  if (rec === null) return null
  const list = asRecord(rec.list)
  if (list === null || typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') return null
  return rec
}

/** Compact duration: `42s`, `3m05s`, `1h07m`. Distinct from format.ts's
 * `fmtDuration`, whose decimal seconds the inspector's fixed-width caption column cannot use. */
export function fmtDurationCompact(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}
