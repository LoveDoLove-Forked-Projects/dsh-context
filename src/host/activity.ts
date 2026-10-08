/**
 * The `contextActivity` session projection unit — the per-day activity
 * ledger behind the Context Dashboard's heatmap and its last-7-days usage
 * chart.
 *
 * The timeline unit (fold.ts) is a "current snapshot" fold: it prices the
 * context as it stands NOW, which cannot draw a per-day chart. This unit
 * folds the same committed event stream into a ledger keyed by local
 * calendar day (shared/days.ts): every assistant settlement adds one
 * completed request to its day and, when the provider reported a usage
 * object, the day's billed-token figure grows by the disjoint buckets
 * (uncached input + cache read + cache write + output — the same semantics
 * the timeline's request records and the official token meter use). Each
 * metered settlement also books its buckets into the day's per-(provider,
 * model, period) pricing record — the same raw material the timeline's
 * session-cost totals carry (SessionCostUsage), so the client prices every
 * day off the SAME model-price book and estimator it prices the KPI band
 * with. Buckets attribute to the day the open STEP STARTED (the turn's
 * initiation, armed by `step/start` and cleared by `step/end` — the
 * timeline fold's own pending-slot protocol), falling back to the
 * settlement instant when no stamp is armed; the peak/off split prices the
 * same instant, so a fee always lands on one day at one rate. Each day also
 * tallies its skill loads (skill name → count and last load instant, from
 * both durable load gestures) — the Insights page's skill card's raw
 * material.
 *
 * One wire contract, one small state: a day entry is two integers plus the
 * optional pricing record and skill table, the route in force rides the
 * state (last `request/header` wins), and the retention cap keeps at most
 * {@link MAX_KEPT_DAYS} keys, so the value riding every session-list row
 * stays trivial next to the timeline head. Same projection contract as the
 * sibling units: pure init/apply/view, unknown or malformed events return
 * the state unchanged, and no `undefined`-valued property ever materializes
 * (the plain-JSON persisted-state precondition).
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from './compat'
import { addBilledUsage, skillNameOf, tokenCountOf, type BilledUsage, type UsageLike } from './fold'
import { costUsageSchema } from './timeline'
import { dayKeyOf } from '../shared/days'
import type { ActivityDay, ContextActivity } from '../shared/types'

/**
 * Retention cap on ledger days. A little over a year of daily-active
 * sessions; the oldest keys drop first (key order IS chronological order).
 */
const MAX_KEPT_DAYS = 400

/**
 * A hostile replay could stuff a distinct skill name into every injection;
 * cap one day's name table so the ledger stays trivial next to the timeline
 * head. Real inventories are tens of names at most.
 */
const MAX_SKILLS_PER_DAY = 100

/**
 * The pending `skill`-call id list's bound (see ActivityState.skillCalls) —
 * a call whose result never commits would otherwise linger forever.
 */
const MAX_PENDING_SKILL_CALLS = 100

/** The persisted fold state (the registry's `stateSchema` contract). */
export interface ActivityState {
  days: Record<string, ActivityDay>
  /** The route in force (last `request/header`'s config wins) — prices each settlement. */
  model?: string
  provider?: string
  /** The open step's start instant (armed by `step/start`, cleared by `step/end`). */
  stepStart?: number
  /**
   * Pending `skill`-tool call ids (armed by `tool/call`, consumed by the
   * pairing `tool/result`). The wrapper match alone is not trusted: a `read`
   * of source text quoting `<skill_content name="…">` (this very file's
   * comments, say) must not book a load — the timeline fold's pairing
   * authority (fold.ts) applies here too. Bounded at
   * {@link MAX_PENDING_SKILL_CALLS}; a never-answered call's id drops oldest
   * first.
   */
  skillCalls?: string[]
}

const activitySkillSchema = z.object({
  n: z.number().int().nonnegative(),
  last: z.number(),
}).strict()

const activityDaySchema = z.object({
  tokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  cost: costUsageSchema.optional(),
  skills: z.record(z.string(), activitySkillSchema).optional(),
}).strict()
/** Validate the wire payload before it leaves the host (strict: no drift). */
export const contextActivitySchema = z.object({
  days: z.record(z.string(), activityDaySchema),
}).strict() as unknown as z.ZodType<ContextActivity>

/** The persisted fold-state schema — validated before a checkpoint row seeds a fold. */
const activityStateSchema = z.object({
  days: z.record(z.string(), activityDaySchema),
  model: z.string().optional(),
  provider: z.string().optional(),
  stepStart: z.number().optional(),
  skillCalls: z.array(z.string()).optional(),
}) as unknown as z.ZodType<ActivityState>

/**
 * One durable usage object's billed buckets, or null when NO bucket is
 * readable (the same rule the timeline fold bills by: a settlement that
 * carried no usage still counts its request without fabricating tokens).
 * Every bucket passes the shared per-bucket sanitizer ({@link tokenCountOf}
 * — fractions round, negatives clamp, garbage reads absent).
 */
function billedBucketsOf(value: unknown): BilledUsage | null {
  if (value === null || typeof value !== 'object') return null
  const usage = value as UsageLike
  const input = tokenCountOf(usage.inputTokens)
  const cacheRead = tokenCountOf(usage.cacheReadTokens)
  const cacheWrite = tokenCountOf(usage.cacheWriteTokens)
  const output = tokenCountOf(usage.outputTokens)
  if (input === null && cacheRead === null && cacheWrite === null && output === null) return null
  return { input: input ?? 0, cacheRead: cacheRead ?? 0, cacheWrite: cacheWrite ?? 0, output: output ?? 0 }
}

/**
 * Write one day entry back into the ledger under the retention cap (the
 * oldest keys drop first — key order IS chronological order). A dynamic
 * `delete` per evicted key would deopt the record into dictionary mode, so
 * the kept suffix rebuilds.
 */
function withDayEntry(state: ActivityState, key: string, entry: ActivityDay): ActivityState {
  let days = { ...state.days, [key]: entry }
  const keys = Object.keys(days)
  if (keys.length > MAX_KEPT_DAYS) {
    keys.sort()
    const drop = new Set(keys.slice(0, keys.length - MAX_KEPT_DAYS))
    days = Object.fromEntries(Object.entries(days).filter(([k]) => !drop.has(k)))
  }
  return { ...state, days }
}

/**
 * Book one skill load against its day: the name's tally grows and `last`
 * moves to the load instant (max, so a disordered replay never walks it
 * back). The day's skills record copies along the mutated path only — the
 * persisted previous state is never mutated in place (the cost record's own
 * discipline). A day whose name table hit the cap keeps its booked names and
 * drops the newcomer's count rather than growing unboundedly.
 */
function bookSkillLoad(state: ActivityState, name: string, time: number): ActivityState {
  const key = dayKeyOf(time)
  if (key === null) return state
  // A Record index read CAN miss at runtime (no noUncheckedIndexedAccess
  // here), so the value type is widened honestly before the read.
  const byKey: Record<string, ActivityDay | undefined> = state.days
  const prev = byKey[key]
  const existing = prev?.skills?.[name]
  if (existing === undefined && prev?.skills !== undefined && Object.keys(prev.skills).length >= MAX_SKILLS_PER_DAY) return state
  const skills = {
    ...prev?.skills,
    [name]: { n: (existing?.n ?? 0) + 1, last: existing === undefined ? time : Math.max(existing.last, time) },
  }
  const entry: ActivityDay = {
    tokens: prev?.tokens ?? 0,
    requests: prev?.requests ?? 0,
    ...(prev?.cost !== undefined ? { cost: prev.cost } : {}),
    skills,
  }
  return withDayEntry(state, key, entry)
}

/**
 * The skill name a `user/message` (or `developer/message`) load gesture
 * carries: the durable source of a user-explicit `/name` invocation is the
 * `skill-invocation` envelope — the timeline fold's own first skill path
 * (fold.ts). Anything else reads as no load ('' — the shared no-name
 * sentinel), including a hostile source.
 */
function invokedSkillOf(event: SessionEvent): string {
  const data = event.data as { source?: unknown; message?: unknown } | null | undefined
  const carrier = event.type === 'developer/message' ? data?.message : data
  const source = carrier !== null && typeof carrier === 'object'
    ? (carrier as { source?: unknown }).source
    : undefined
  if (source === null || typeof source !== 'object') return ''
  const rec = source as { kind?: unknown; name?: unknown }
  return rec.kind === 'skill-invocation' && typeof rec.name === 'string' ? rec.name : ''
}

/** The pairing call id of a `tool/result`'s message: the lifted `toolCallId`, else the durable source's. */
function toolResultCallIdOf(message: unknown): string | null {
  if (message === null || typeof message !== 'object') return null
  const rec = message as { toolCallId?: unknown; source?: unknown }
  if (typeof rec.toolCallId === 'string' && rec.toolCallId !== '') return rec.toolCallId
  const source = rec.source
  if (source === null || typeof source !== 'object') return null
  const callId = (source as { callId?: unknown }).callId
  return typeof callId === 'string' && callId !== '' ? callId : null
}
/**
 * Fold one committed event into the ledger. Seven event types advance it:
 * `request/header` tracks the route in force (the timeline fold's rule —
 * last header wins), `step/start`/`step/end` maintain the initiation stamp,
 * `assistant/message` (the step settlement — both supported log generations)
 * books the day's tokens and request, and the skill-load gestures tally the
 * day's skill names — a `skill-invocation` injection message directly, a
 * `skill`-tool load through its `tool/call` → `tool/result` pair (the same
 * pair the timeline fold tags `sub: 'skill'`). Everything else returns the
 * state reference unchanged, as does a settlement with no attributable
 * instant. The next state is a copy along the mutated path only — the
 * persisted previous state is never mutated in place.
 */
export function applyActivity(state: ActivityState, event: SessionEvent): ActivityState {
  if (event.type === 'request/header') {
    const data = event.data as { header?: { config?: { model?: unknown; provider?: unknown } | null } | null } | undefined
    const config = data?.header?.config
    if (config === null || typeof config !== 'object') return state
    const model = typeof config.model === 'string' ? config.model : undefined
    const provider = typeof config.provider === 'string' ? config.provider : undefined
    const nextModel = model !== undefined ? model : state.model
    const nextProvider = provider !== undefined ? provider : state.provider
    if (nextModel === state.model && nextProvider === state.provider) return state
    return {
      ...state,
      ...(nextModel !== undefined ? { model: nextModel } : {}),
      ...(nextProvider !== undefined ? { provider: nextProvider } : {}),
    }
  }
  if (event.type === 'step/start') {
    if (!Number.isFinite(event.time)) return state
    return state.stepStart === event.time ? state : { ...state, stepStart: event.time }
  }
  if (event.type === 'step/end') {
    if (state.stepStart === undefined) return state
    // DELETE the field — assigning `undefined` would break the plain-JSON
    // persisted-state precondition (see TimelineState.stepStart).
    const next = { ...state }
    delete next.stepStart
    return next
  }
  if (event.type === 'session/end-seed') {
    // The tagged fork/seed boundary (the cost-semantics decision in
    // fold.ts): settlements before it are the inherited parent-log prefix —
    // spend the session it forked from already booked — so the ledger
    // resets and a seeded session's days count post-seed activity only
    // (issue #94). The untagged resume marker returns the state unchanged.
    // `stepStart` dies with the cut: a slot armed by the inherited tail
    // must not attribute the child's first settlement to a parent-day.
    const data = event.data as { inherited?: unknown } | null | undefined
    if (data?.inherited !== true) return state
    return { days: {} }
  }
  if (event.type === 'user/message' || event.type === 'developer/message') {
    const name = invokedSkillOf(event)
    return name === '' ? state : bookSkillLoad(state, name, event.time)
  }
  if (event.type === 'tool/call') {
    // Arm the pairing claim for a `skill`-tool dispatch; the wrapper match in
    // the result is trusted only under this pairing (a `read` of source text
    // quoting the wrapper must not book a load — see ActivityState.skillCalls).
    const data = event.data as { callId?: unknown; name?: unknown } | null | undefined
    const callId = data?.callId
    if (data?.name !== 'skill' || typeof callId !== 'string' || callId === '') return state
    const pending = state.skillCalls ?? []
    if (pending.includes(callId)) return state
    return { ...state, skillCalls: [...pending, callId].slice(-MAX_PENDING_SKILL_CALLS) }
  }
  if (event.type === 'tool/result') {
    // The model-initiated load path: the `skill` tool's result renders the
    // loaded instructions behind the `<skill_content name="…">` wrapper (the
    // timeline fold's second skill path). An unpaired result books nothing —
    // the fold reads full logs in order, so a missing claim means the call
    // named another tool. The claim consumes once either way.
    const message = (event.data as { message?: unknown } | null | undefined)?.message
    const callId = toolResultCallIdOf(message)
    const pending = state.skillCalls
    if (callId === null || pending === undefined || !pending.includes(callId)) return state
    const skillCalls = pending.filter(id => id !== callId)
    const next: ActivityState = { ...state }
    // DELETE the drained field — an undefined-valued property would break the
    // plain-JSON persisted-state precondition (see TimelineState.stepStart).
    if (skillCalls.length > 0) next.skillCalls = skillCalls
    else delete next.skillCalls
    const name = skillNameOf(message)
    return name === '' ? next : bookSkillLoad(next, name, event.time)
  }
  if (event.type !== 'assistant/message') return state
  // Attribute the settlement to the open step's initiation instant, falling
  // back to the settlement's own instant (the pending slot stays armed — the
  // timeline fold's protocol — so a second settlement of the same step still
  // reads it; `step/end` clears it).
  const initiated = state.stepStart !== undefined ? state.stepStart : event.time
  const key = dayKeyOf(initiated)
  if (key === null) return state
  const data = event.data as { usage?: unknown } | undefined
  const buckets = billedBucketsOf(data?.usage)
  // A Record index read CAN miss at runtime (no noUncheckedIndexedAccess
  // here), so the value type is widened honestly before the read.
  const byKey: Record<string, ActivityDay | undefined> = state.days
  const prev = byKey[key]
  // A settlement prices only when a model is in force (the accumulateCost
  // rule): a model-less or unmetered settlement still counts its tokens and
  // request, never a fabricated fee. The pricing period splits off the SAME
  // instant the day bucket does: a fee can never land on one day at the
  // neighbouring window's rate.
  let cost = prev?.cost
  if (buckets !== null && state.model !== undefined) {
    cost = addBilledUsage(cost, state.provider ?? '', state.model, initiated, buckets)
  }
  const entry = {
    tokens: (prev === undefined ? 0 : prev.tokens)
      + (buckets === null ? 0 : buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output),
    requests: (prev === undefined ? 0 : prev.requests) + 1,
    ...(cost !== undefined ? { cost } : {}),
    // The day's skill tallies ride the entry untouched — a settlement never
    // rewrites them, and the shared reference is safe under the fold's
    // clone-on-write discipline (bookSkillLoad copies before it grows).
    ...(prev?.skills !== undefined ? { skills: prev.skills } : {}),
  }
  return withDayEntry(state, key, entry)
}

/**
 * The daily-activity projection unit, registered alongside the timeline and
 * headers units (host/index.ts); the overview reads it through the session
 * list's projection column. `stateVersion` 4: the day entry gains the
 * skill-load table (`skills`), which later events cannot backfill for days
 * already folded — cached rows read version-stale on upgrade and the
 * dashboard's warm-up cold-refolds them from the durable log (the v2
 * pricing-record precedent). On the wire the field is additive-optional: a
 * day folded before it existed serves without it and the skill card shows
 * nothing for that day.
 */
export function createContextActivityDefinition(): ProjectionDefinition<'contextActivity', ActivityState> {
  return {
    key: 'contextActivity',
    stateSchema: activityStateSchema,
    init: (): ActivityState => ({ days: {} }),
    apply: (state: ActivityState, event: SessionEvent) => applyActivity(state, event),
    // The view copies the ledger (entries included) so the registry, the
    // cache writer, and the wire can never share — and mutate — the fold's
    // own record. The nested pricing records ride the entry copy by
    // reference: every mutation above clones along its path, so a shared
    // record can never diverge (the same immutability the timeline fold's
    // shared request/event records rely on).
    wire: {
      viewSchema: contextActivitySchema,
      view: state => ({
        days: Object.fromEntries(Object.entries(state.days).map(([k, v]) => [k, { ...v }])),
      }),
    },
    stateVersion: 4,
  }
}
