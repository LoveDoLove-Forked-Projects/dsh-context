/**
 * The Context card: what the session's context IS and how it evolved — a
 * seven-cell grid of the session's shape (turns / steps / human inputs /
 * live tool calls), the whole-session cache-hit rate, and the cost estimate
 * at two scopes: the family total (the current agent plus every subagent
 * session) and the subagents' own share.
 * Count figures only: nothing here is part of a spendable whole, so no pie —
 * proportions live in the composition card, and the context-event tallies
 * live on the events card's kind filters (contextView.tsx). The cache-hit
 * cell reads the official `tokenUsage` projection — the same source and
 * formula as the harness chat stats line under the composer, shown with one
 * decimal — and dashes until a provider reports usage. The cost cells price
 * the host-folded cumulative billed totals (complete session logs, never
 * trimmed; the subagents' usage folds out of the session-list snapshot,
 * `makeSubagentCost` below) from the models.dev price book (modelPrices.ts)
 * in the locale's currency; their hover bubbles (a '?' marker + styled DOM
 * tip) explain each scope and list the per-1M-token rates of the models the
 * family actually billed, straight from the same book (cost.ts), so printed
 * rates can never drift from the math. A book that has not loaded (or
 * failed) dashes the cells and notes the outage.
 *
 * The counts arrive precomputed: the split-generation wire head carries them
 * (shared/types.ts `TimelineCounts` — computed over the retained records),
 * and the caller derives them from the collections on the inline generation
 * (`countsOfRecords`). The card itself never touches the collections.
 */

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { ContextEventRecord, ContextTimeline, RequestRecord, SessionCostUsage, TimelineCounts, TokenUsage } from '../../shared/types'
import { estimateSessionCost, formatCost, formatPriceRate, mergeCostUsage, priceFaceOf, toCurrency } from '../cost'
import type { CostCurrency, ModelBook, PriceFace } from '../cost'
import { sessionsFaceOf, subagentCostFoldOf } from '../agentTree'
import type { AgentHeads } from '../agentHeads'
import { useSessionsSnapshot } from '../agentHeads'
import { cacheHitPercent } from '../format'
import { useModelPrices } from '../modelPrices'
import { asRecord, numOf, type ClientCtx } from '../services'
import { isDeepSeekProvider } from '../../shared/providers'
import type { ViewKit } from '../viewkit'

/** One billed model's tooltip block: the usage key and the registry face its price resolved to. */
interface PriceRow { key: string; face: PriceFace }

/** The four billed buckets of a price block, in display order, with their label keys. */
const BANDS: readonly (readonly [keyof PriceFace['rate'], string])[] = [
  ['hit', 'stats.costHit'],
  ['miss', 'stats.costMiss'],
  ['write', 'stats.costWrite'],
  ['out', 'stats.costOut'],
]

/**
 * The billed models' price blocks — the usage keys priced against the book,
 * in fold order, each carrying the registry face (models.dev provider id ·
 * model id) its rates resolved from. Hostile branches skip; unpriced models
 * drop (their buckets simply do not contribute).
 */
function priceRowsOf(usage: SessionCostUsage | undefined, book: ModelBook | null): PriceRow[] {
  if (usage === undefined || book === null) return []
  const rows: PriceRow[] = []
  for (const provider of Object.keys(usage)) {
    const models = asRecord(usage[provider])
    /* v8 ignore next 1 -- the fold's inputs are mergeCostUsage's own output
       (hostile branches dropped at the merge), so a non-record branch never
       reaches here; the guard stays for the helper's own contract. */
    if (models === null) continue
    for (const model of Object.keys(models)) {
      const face = priceFaceOf(book, provider, model)
      if (face === null) continue
      rows.push({ key: provider + '/' + model, face })
    }
  }
  return rows
}

/**
 * The inline generation's counter derivation — the exact tally the card ran
 * over the served collections before the split (distinct turn values, record
 * count, per-kind event tallies). The host's split-generation counts match
 * it by construction (fold.ts buildTimelineHead).
 */
export function countsOfRecords(requests: readonly RequestRecord[], events: readonly ContextEventRecord[]): TimelineCounts {
  const turns = new Set<number>()
  for (const req of requests) turns.add(req.turn ?? 0)
  let injects = 0
  let compactions = 0
  let prunes = 0
  for (const ev of events) {
    if (ev.kind === 'inject') injects++
    else if (ev.kind === 'compaction') compactions++
    else if (ev.kind === 'prune') prunes++
  }
  return { turns: turns.size, steps: requests.length, injects, compactions, prunes }
}

/**
 * The stats board's subagent-cost seat: the merged billed-token usage of the
 * current session's whole subagent subtree, folded from the session-list
 * snapshot's warm rows (`subagentCostFoldOf`) with fetched slim heads
 * standing in for cold relatives. Null = nothing reported yet (no
 * subagents, no usage, or no sessions face on this harness).
 */
export function makeSubagentCost(
  ctx: ClientCtx,
  heads: AgentHeads,
): (sessionId: string | undefined) => SessionCostUsage | null {
  return function useSubagentCost(sessionId: string | undefined): SessionCostUsage | null {
    // Resolved lazily at mount: a deployment without the outward sessions
    // service simply prices no subagent cost.
    const face = useMemo(() => sessionsFaceOf(ctx), [])
    const snapshot = useSessionsSnapshot(face)
    const [landed, setLanded] = useState<ReadonlyMap<string, ContextTimeline>>(new Map())
    const fold = useMemo(
      () => subagentCostFoldOf(snapshot, sessionId, landed),
      [snapshot, sessionId, landed],
    )
    // Fetch every cold descendant's slim head through the shared page-scope
    // cache; a landed head re-folds the subtree with its usage. Same value →
    // same state: the identity bail-out keeps a settled replay on every
    // snapshot tick from looping.
    useEffect(() => {
      for (const id of fold.cold) {
        void heads.headOf(id).then((head) => {
          if (head !== null) setLanded(prev => prev.get(id) === head ? prev : new Map(prev).set(id, head))
        }).catch(() => {})
      }
    }, [fold, heads])
    return fold.usage
  }
}

export function makeStatsContext(
  kit: ViewKit,
  useSubagentCost: (sessionId: string | undefined) => SessionCostUsage | null,
): (props: {
  /** The session-shape tally (host-precomputed on the split generation). */
  counts: TimelineCounts
  /** The whole-session human-input tally (the user's messages + question answers; absent on older hosts). */
  humanInputs?: number
  /** Tool calls with a result live in the current context (absent on older hosts). */
  toolCalls?: number
  /** The official tokenUsage projection — the cache-hit cell's source (null until a provider reports). */
  usage: TokenUsage | null
  cost?: SessionCostUsage
  locale: string
  /** The current session id, anchoring the subagent-cost fold (absent = nothing to fold). */
  sessionId?: string
}) => ReactElement {
  const { t, fmt } = kit
  return function StatsContext(props: {
    counts: TimelineCounts
    humanInputs?: number
    toolCalls?: number
    usage: TokenUsage | null
    cost?: SessionCostUsage
    locale: string
    sessionId?: string
  }): ReactElement {
    const currency: CostCurrency = props.locale === 'zh' ? 'cny' : 'usd'
    const { book, failed } = useModelPrices()
    // Both cost cells price the same host-folded cumulative totals, at one
    // scope each: the family total (the current agent's own usage plus every
    // subagent session's) in the cost cell, the subagents' share alone in
    // the subagent-cost cell.
    const subUsage = useSubagentCost(props.sessionId)
    const usage = mergeCostUsage(props.cost, subUsage) ?? undefined
    const cost = estimateSessionCost(usage, book, currency)
    const subCost = estimateSessionCost(subUsage, book, currency)
    const fmtRate = (usd: number): string => formatPriceRate(toCurrency(usd, currency), currency)
    const rows = priceRowsOf(usage, book)
    const subRows = priceRowsOf(subUsage ?? undefined, book)
    // DeepSeek's peak/off-peak scheme is explained only when the tip's own
    // scope actually billed a DeepSeek provider — other sessions see nothing
    // of it.
    const deepseek = usage !== undefined && Object.keys(usage).some(p => isDeepSeekProvider(p))
    const subDeepseek = subUsage !== null && Object.keys(subUsage).some(p => isDeepSeekProvider(p))
    // Usage folded but nothing priced (the book has not loaded, or carries
    // none of this scope's models): say so instead of a bare dash.
    const unpriced = rows.length === 0 && usage !== undefined && Object.keys(usage).length > 0
      && (failed || book !== null)
    const subUnpriced = subRows.length === 0 && subUsage !== null && (failed || book !== null)
    // One scope's price table: the billed buckets' rates at the book's list
    // per model — a zero list price carries no information, so its band drops
    // (free/token-plan listings keep only their listing line) — each block
    // closed by the listing line naming the registry face (provider id ·
    // model id) the rates resolved from.
    const pricesBlock = (blocks: PriceRow[]): ReactNode =>
      blocks.length > 0 ? (
        <span key="prices" className="lc-stat-tip-prices">
          <span className="lc-stat-tip-head">{t('stats.costPriceHead')}</span>
          {blocks.map(r => (
            <span key={r.key} className="lc-stat-tip-row">
              {BANDS.filter(([bucket]) => r.face.rate[bucket] > 0).map(([bucket, label]) => (
                <span key={bucket} className="lc-stat-tip-band">
                  <i>{t(label)}</i>
                  {' '}
                  <b>{fmtRate(r.face.rate[bucket])}</b>
                </span>
              ))}
              <span className="lc-stat-tip-by">{t('stats.costPriceBy', { p: r.face.pid, m: r.face.mid })}</span>
            </span>
          ))}
        </span>
      ) : null
    // The shared footnotes: the CNY conversion note in the CNY display, and
    // DeepSeek's peak-window scheme when the scope billed a DeepSeek provider.
    const notes = (deep: boolean): ReactElement[] =>
      [
        currency === 'cny' ? <span key="cny">{t('stats.costTipCny')}</span> : null,
        deep ? <span key="peak">{t('stats.costTipDeepseek')}</span> : null,
      ].filter((el): el is ReactElement => el !== null)
    const costTip: ReactNode = [
      t('stats.costTip'),
      pricesBlock(rows),
      ...notes(deepseek),
      unpriced ? <span key="unavailable">{t('stats.costUnavailable')}</span> : null,
    ]
    // The subagents' own share: scope explanation, its own price table, then
    // the outage note when the subagents' models priced against nothing.
    const subTip: ReactNode = [
      t('stats.subCostTip'),
      pricesBlock(subRows),
      ...notes(subDeepseek),
      subUnpriced ? <span key="unavailable">{t('stats.costUnavailable')}</span> : null,
    ]
    // The harness chat stats line's own formula, shown two decimals deep:
    // prompt-side cache reads over the whole billed input (output excluded),
    // dashed until reported.
    const hit = props.usage === null ? null
      : cacheHitPercent(
        numOf(props.usage.cacheReadTokens),
        numOf(props.usage.uncachedInputTokens) + numOf(props.usage.cacheReadTokens) + numOf(props.usage.cacheWriteTokens),
      )
    const cell = (label: string, value: string | number, tip?: ReactNode, href?: string): ReactElement => {
      // The framed cell body, as a div — or as an anchor opening the models.dev
      // provider listing in a new tab when the caller hands a destination (the
      // tooltip still frames and reveals off this same element).
      const body = (
        <>
          <span className="lc-stat-label">
            {label}
            {tip !== undefined && <i className="lc-stat-q group-hover/tip:text-(--dsw-alias-label-primary) group-hover/tip:border-(--dsw-alias-label-primary)" aria-hidden="true">?</i>}
          </span>
          <b className="lc-stat-value">{typeof value === 'number' ? fmt(value) : value}</b>
          {tip !== undefined && <span className="lc-tip lc-stat-tip group-hover/tip:opacity-100" role="tooltip">{tip}</span>}
        </>
      )
      const className = 'lc-stat' + (tip === undefined ? '' : ' lc-stat-tipped group/tip')
      return href === undefined
        ? <div className={className}>{body}</div>
        : <a className={className} href={href} target="_blank" rel="noreferrer noopener">{body}</a>
    }
    // The cost cell links to the listing when ONE models.dev provider priced
    // the whole scope — the natural "check these rates" destination. A
    // multi-provider scope names each face in the tooltip instead and stays
    // unlinked.
    const costPids = new Set(rows.map(r => r.face.pid).filter(p => p !== ''))
    const costHref = costPids.size === 1 ? 'https://models.dev/providers/' + [...costPids][0] + '/' : undefined
    return (
      <div className="lc-card lc-col-stats flex-[3] min-w-[min(360px,100%)]">
        <div className="lc-card-title">
          <span className="lc-card-title-text">{t('stats.title')}</span>
        </div>
        {/* The count grid: auto-fit keeps every cell ≥108px (the floor where the longest
            English label still fits), so cells fill the card — 6 across at the card's
            three-quarter head-row share, 2 on a phone-width one. */}
        <div className="lc-stats grid grid-cols-[repeat(auto-fit,minmax(108px,1fr))] gap-1.5">
          {cell(t('stats.turns'), props.counts.turns)}
          {cell(t('stats.steps'), props.counts.steps)}
          {cell(t('stats.humanInputs'), props.humanInputs ?? 0, t('stats.humanInputsTip'))}
          {cell(t('stats.toolCalls'), props.toolCalls ?? 0)}
          {cell(t('stats.cacheHit'), hit === null ? '—' : `${hit}%`, t('stats.cacheHitTip'))}
          {cell(t('stats.cost'), cost === null ? '—' : formatCost(cost, currency), costTip, costHref)}
          {cell(t('stats.subCost'), subCost === null ? '—' : formatCost(subCost, currency), subTip)}
        </div>
      </div>
    )
  }
}
