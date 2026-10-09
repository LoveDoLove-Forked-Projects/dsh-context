/**
 * The Context Insights page — the plugin's first-level panel, opened from
 * the sidebar's panel list (insightPage.ts), a sibling of the shipped
 * Plugins and Automation tasks pages. Registered on the layout's keyed
 * `main` slot, so the shell's center column mounts it when the panel is
 * selected and unmounts it on leave — the page's mount IS its open, and its
 * data rides the root-scope `useSessions`/`useWorkspaces` standard kit
 * (every list row's host-cached projection values), so the page draws every
 * session's insight without opening one log.
 *
 * The chrome keeps the shipped first-level pages' discipline — one scroll
 * region that opens with the page heading, the title beside the preferences
 * chip, the scope cluster (the calendar date-range picker beside the range
 * group, with the DeepSeek balance capsule to their left) —
 * but the content column spans the pane's full width rather than the shipped
 * pages' centered 960px frame: the dashboard's grids and legends adapt to the
 * pane, so the width reads as more dashboard, not wider lines. The page
 * element is the `lc-ov` query container, so every fold keys off the pane's
 * own width. Hover tips portal to <body> (hoverTip.tsx) because the container
 * would otherwise capture their fixed positioning.
 *
 * The cluster holds ONE scope: a picked calendar range (an ordered day pair,
 * resolved into a closed window by dayRangeWindow) replaces the rolling
 * preset, and clicking any preset hands it back — the preset chips and the
 * picker never both claim it. Everything the presets scope (KPI band,
 * aggregate cards, skill card, session list) reads that one resolved window,
 * so a picked range narrows the whole page at once.
 *
 * The body's first row is a 1:1 column pair: the KPI metrics band (the
 * range's six figures — sessions, billed tokens, cost, cache hit, tool
 * calls, active time — three per row) beside the last-7-days usage chart
 * (each day's billed tokens and estimated cost as a bar pair, folded off the
 * merged daily ledger). Below it, the aggregate stats row folds the same
 * range's sessions into the two donut cards the per-session Context tab
 * opens with — Token Stats (the composition-split billed volume) and Timing
 * Stats (the summed totals). The body is then a 3:7 column pair: the
 * insight column (the activity heatmap over the scope's skill-load card)
 * beside the session column (search,
 * group chips, and the card grid); the heatmap keeps its own fixed 8-week
 * window and PINs both column mates to a picked day (the page's drill-down
 * gesture). The skill card's row click is the column's second drill-down:
 * the session column narrows to the pinned skill's loaders within the same
 * scope, and the card's description/origin/path enrichment rides the
 * plugin's skill-catalog route (client/skills.ts), read per open off the
 * current session's workspace.
 * A session card click jumps to that session through the harness's own
 * selection verb (openSessionVia), whose navigation returns the center column
 * to the conversation.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { estimateSessionCost, formatCost, type CostCurrency, type ModelBook } from '../cost'
import { fmt } from '../format'
import { useModelPrices } from '../modelPrices'
import {
  aggregateDays, dayRangeWindow, filterRows, groupCountsOf, inGroup, kpisOf,
  pageOf, rangeWindowOf, refreshSessions, requestActivityBackfill, rowsOfSnapshot,
  rowLoadedSkill, sessionGroupsOf, sessionsSnapshotOf, skillLoadsOf, sortRows,
  UNGROUPED_KEY, workspacesSnapshotOf,
  type DayRange, type OverviewRange, type OverviewRow, type OverviewSort, type SkillSort,
} from '../overview'
import { openSessionVia, type ClientCtx } from '../services'
import { readSkillCatalog } from '../skills'
import { openPluginSettings } from '../settingsJump'
import type { SkillInfo } from '../../shared/types'
import { dayKeyOf } from '../../shared/days'
import type { ViewKit } from '../viewkit'
import { makeBalanceCapsule } from './balanceCapsule'
import { makeDateRange } from './dateRange'
import { makeErrorBoundary } from './errorBoundary'
import { makeHeatmap, todayKey, type HeatMetric } from './heatmap'
import { makeDonut } from './donut'
import { useHoverTip } from './hoverTip'
import { makeOverviewTokens } from './overviewTokens'
import { makeOverviewUsage } from './overviewUsage'
import { makeStatsTiming } from './statsTiming'
import { makeOverviewCard } from './overviewCard'
import { makeOverviewSkills } from './overviewSkills'
import { IconSettings } from '../primitives'

export interface OverviewPanelProps {
  /** The root standard kit's sessions seat (absent on a harness without it). */
  useSessions?: unknown
  /** The root standard kit's workspaces seat (the cards' breadcrumb grouping). */
  useWorkspaces?: unknown
}

const RANGES: readonly OverviewRange[] = ['today', '7d', '30d', 'all']
const SORTS: readonly OverviewSort[] = ['recent', 'tokens', 'context']
/** The heatmap's depth metrics, in toggle order (steps is the default). */
const METRICS: readonly HeatMetric[] = ['sessions', 'steps']

export function makeOverviewPanel(ctx: ClientCtx, kit: ViewKit): (props: OverviewPanelProps) => ReactElement | null {
  const { t, fmtDuration } = kit
  const Heatmap = makeHeatmap(kit)
  const OverviewCard = makeOverviewCard(kit)
  const BalanceCapsule = makeBalanceCapsule(ctx, kit)
  const DateRange = makeDateRange(kit)
  // The first row's aggregate pair: the range's sessions folded into the two
  // donut cards the per-session Context tab opens with (Timing Stats reused
  // verbatim over the summed totals).
  const Donut = makeDonut()
  const OverviewTokens = makeOverviewTokens(kit, Donut)
  const StatsTiming = makeStatsTiming(kit, Donut)
  const OverviewUsage = makeOverviewUsage(kit)
  const OverviewSkills = makeOverviewSkills(kit)
  const ErrorBoundary = makeErrorBoundary(t)

  /** The active locale tag, read per render — the slot outlet re-renders on a locale switch. */
  function activeLocale(): string {
    const locale = ctx.locale
    return typeof locale.getLocale === 'function' ? locale.getLocale().active : 'en'
  }

  /** The display currency follows the active locale (zh → CNY). */
  function activeCurrency(): CostCurrency {
    return activeLocale() === 'zh' ? 'cny' : 'usd'
  }

  function OverviewBody(props: OverviewPanelProps): ReactElement | null {
    const { book } = useModelPrices()
    // The hook-level standard-kit reads (unconditional; guarded inside).
    const snapshot = sessionsSnapshotOf(props)
    const wsSnapshot = workspacesSnapshotOf(props)
    const [preset, setPreset] = useState<OverviewRange>('30d')
    // The calendar picker's own range; while set it replaces the preset scope.
    const [custom, setCustom] = useState<DayRange | null>(null)
    const [day, setDay] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [group, setGroup] = useState<string | null>(null)
    const [skill, setSkill] = useState<string | null>(null)
    const [skillSort, setSkillSort] = useState<SkillSort>('loads')
    const [sort, setSort] = useState<OverviewSort>('recent')
    const [metric, setMetric] = useState<HeatMetric>('steps')
    const [page, setPage] = useState(0)
    const { zoneProps, bubble } = useHoverTip()

    const rows = useMemo(() => rowsOfSnapshot(snapshot, wsSnapshot), [snapshot, wsSnapshot])
    const groups = useMemo(() => sessionGroupsOf(wsSnapshot), [wsSnapshot])
    const [catalog, setCatalog] = useState<ReadonlyMap<string, SkillInfo> | null>(null)

    // The skill card's metadata read: the registry resolves per SESSION (the
    // workspace selects the project layer, the preset selects the discovery
    // scope), so the current session anchors it; a session-less list still
    // serves the global layers. A switch re-reads; a failed read leaves the
    // card unenriched rather than stale.
    const currentRow = (rows ?? []).find(row => row.current)
    const currentCwd = currentRow?.cwd
    const currentId = currentRow?.id
    useEffect(() => {
      let alive = true
      setCatalog(null)
      void readSkillCatalog(currentCwd, currentId).then((next) => { if (alive && next !== null) setCatalog(next) })
      return () => { alive = false }
    }, [currentCwd, currentId])

    // On mount (the panel's open): summon the host's projection warm-up (this
    // page is the rows' only reader — one pass per host process) and re-pull
    // the list once, so backfilled rows reach a long-connected page.
    useEffect(() => {
      requestActivityBackfill()
      refreshSessions(ctx)
    }, [])

    // Any filter change re-anchors the pager at the first page.
    useEffect(() => { setPage(0) }, [preset, custom, day, query, group, skill, sort])

    const currency = activeCurrency()
    const now = Date.now()
    const allRows = rows ?? []
    // The scope window every figure below reads: the calendar's own picked
    // range while one is set (a malformed key keeps the preset, never an
    // unprovable window), else the preset's rolling floor.
    const scope = (custom !== null ? dayRangeWindow(custom) : null) ?? rangeWindowOf(preset, now)
    // The head's date span, read off that same window so the picker and the
    // presets can never disagree: a picked range's own two days, a preset's
    // floor through today (its end is open), nothing at all under "all".
    const spanFrom = scope.start === null ? null : dayKeyOf(scope.start)
    const spanTo = scope.start === null ? null : dayKeyOf(scope.end ?? now)
    const span = spanFrom !== null && spanTo !== null ? { from: spanFrom, to: spanTo } : null
    // The scope scopes the KPI band, the composition donut, and the grid;
    // the heatmap keeps its own fixed window over the whole list.
    const ranged = filterRows(allRows, { scope, day: null, query: '' })
    // The group chips count the day/query-scoped rows BEFORE the group filter
    // applies, so selecting a chip never collapses the row itself.
    const scoped = filterRows(ranged, { scope, day, query })
    const counts = groupCountsOf(scoped, wsSnapshot)
    // A selection whose group fell out of scope keeps a phantom chip (count
    // 0) so the active filter stays visible and one click out of it.
    const chips = group !== null && !counts.some(c => c.key === group)
      ? [...counts, { key: group, count: 0 }]
      : counts
    const visible = sortRows(
      (group === null ? scoped : scoped.filter(row => inGroup(row, group, groups)))
        // The skill card's row pin narrows the list to the skill's loaders
        // within the card's own scope (the scope window plus the pinned day).
        .filter(row => skill === null || rowLoadedSkill(row, skill, { scope, day })),
      sort,
    )
    const paged = pageOf(visible, page)
    const kpi = kpisOf(ranged, allRows.length, book, currency)
    const days = aggregateDays(allRows, book, currency)
    const openOne = (id: string): void => {
      // The view owner's verb navigates the center column back to the
      // conversation itself (selectPanel(null)), so the page needs no close.
      openSessionVia(ctx, id)
    }

    return (
      <section className="lc-ov-page" aria-label={t('ov.title')} {...zoneProps}>
        {bubble}
        {/* The page's one scroll region: the shipped first-level pages' own
            discipline — heading, stats, and body scroll as one. */}
        <div className="lc-ov-pagescroll">
          <div className="lc-ov-pagecontent">
            <div className="lc-ov-pagehead">
              <h1 className="lc-ov-pagetitle">{t('ov.title')}</h1>
              {/* The preferences entry: one quiet chip beside the title, the same
                  best-effort preferences jump the Context tab's plugin-info row
                  rides. The jump selects the Plugins panel, which unmounts this
                  page on its own; the long hint rides the hover title. */}
              <button type="button" className="lc-ov-settings" title={t('plugin.settingsOpen')} onClick={() => { openPluginSettings() }}>
                <IconSettings size={14} />{t('plugin.settings')}
              </button>
              {/* The DeepSeek platform balance (client/balance.ts): renders nothing
                  until a live figure lands, so the heading row never reflows for it. */}
              <BalanceCapsule />
              {/* One wrapper so the head's right cluster pushes once: the
                  calendar picker, then the preset group. A bare `.lc-gran`
                  sibling would eat a second slice of the free space and the
                  two would drift apart. */}
              <div className="lc-ov-headctl">
                <DateRange
                  value={span}
                  picked={custom !== null}
                  onChange={(next) => { setCustom(next) }}
                  today={todayKey()}
                  locale={activeLocale()}
                />
                <div className="lc-gran lc-ov-range" role="group" aria-label={t('ov.range.label')}>
                  {RANGES.map(r => (
                    <button
                      key={r}
                      type="button"
                      className={'lc-gran-btn' + (custom === null && preset === r ? ' lc-gran-on' : '')}
                      onClick={() => { setPreset(r); setCustom(null) }}
                    >{t('ov.range.' + r)}</button>
                  ))}
                </div>
              </div>
            </div>

            {rows === null ? (
              <div className="lc-empty">{t('ov.unavailable')}</div>
            ) : (
              <>
                {/* The first row: a 1:1 column pair — the KPI metrics band
                    (the range's six figures, three per row) beside the
                    last-7-days usage chart (per-day tokens + cost bars off
                    the merged ledger; the range selector does not scope it). */}
                <div className="lc-ov-first">
                  <div className="lc-ov-kpis">
                    <div className="lc-stat lc-ov-kpi">
                      <span className="lc-stat-label">{t('ov.kpi.sessions')}</span>
                      <span className="lc-stat-value">{kpi.sessions}</span>
                      <span className="lc-stat-sub">{t('ov.kpi.ofTotal', { n: kpi.listed })}</span>
                    </div>
                    <div className="lc-stat lc-ov-kpi">
                      <span className="lc-stat-label">{t('ov.kpi.tokens')}</span>
                      <span className="lc-stat-value">{fmt(kpi.tokens)}</span>
                      <span className="lc-stat-sub">{t('stats.turns')} {fmt(kpi.turns)}</span>
                    </div>
                    <div className="lc-stat lc-ov-kpi">
                      <span className="lc-stat-label">{t('stats.cost')}</span>
                      <span className="lc-stat-value">{kpi.cost === null ? '—' : formatCost(kpi.cost, currency)}</span>
                      <span className="lc-stat-sub">{t('ov.kpi.pricedSub', { n: kpi.costSessions, total: kpi.sessions })}</span>
                    </div>
                    <div className="lc-stat lc-ov-kpi">
                      <span className="lc-stat-label">{t('stats.cacheHit')}</span>
                      <span className="lc-stat-value">{kpi.cacheHit === null ? '—' : kpi.cacheHit + '%'}</span>
                      <span className="lc-stat-sub">{t('ov.kpi.sessionsSub', { n: kpi.usageSessions })}</span>
                    </div>
                    <div className="lc-stat lc-ov-kpi">
                      <span className="lc-stat-label">{t('stats.toolCalls')}</span>
                      <span className="lc-stat-value">{fmt(kpi.toolCalls)}</span>
                      <span className="lc-stat-sub">{t('ov.kpi.toolSub', { dur: fmtDuration(kpi.toolsMs) })}</span>
                    </div>
                    <div className="lc-stat lc-ov-kpi">
                      <span className="lc-stat-label">{t('timing.total')}</span>
                      <span className="lc-stat-value">{fmtDuration(kpi.wallMs)}</span>
                      <span className="lc-stat-sub">{t('ov.kpi.wallSub', { n: fmt(kpi.calls) })}</span>
                    </div>
                  </div>
                  <OverviewUsage days={days} currency={currency} today={todayKey()} />
                </div>
                {/* The aggregate stats row: the range's Token Stats and Timing
                    Stats, folded over the KPI band's own scope (the composition
                    split and summed totals off kpisOf). */}
                <div className="lc-ov-stats">
                  <OverviewTokens tokens={kpi.tokenParts} />
                  <StatsTiming timing={kpi.timing} />
                </div>
                <div className="lc-ov-body">
                  <div className="lc-ov-left">
                    <div className="lc-card lc-ov-heat-card">
                      <div className="lc-card-title">
                        <span className="lc-card-title-text">{t('ov.heat.title')}</span>
                        {/* One wrapper so the right side pushes with a single auto
                            margin (two bare auto-margin siblings would split the
                            free space and drift apart). */}
                        <span className="lc-heat-ctl">
                          <span className="lc-card-sub">{t('ov.heat.sub')}</span>
                          <div className="lc-gran" role="group" aria-label={t('ov.heat.metric')}>
                            {METRICS.map(m => (
                              <button
                                key={m}
                                type="button"
                                className={'lc-gran-btn' + (metric === m ? ' lc-gran-on' : '')}
                                onClick={() => { setMetric(m) }}
                              >{t('ov.heat.metric.' + m)}</button>
                            ))}
                          </div>
                        </span>
                      </div>
                      <Heatmap days={days} metric={metric} selected={day} onSelect={setDay} today={todayKey()} />
                    </div>
                    {/* The activity column's second card: the scope's skill
                        loads off the rows' family ledgers (skillLoadsOf). The
                        scope is the range group plus the heatmap's pinned day
                        — the column's own drill-down — never the list's search
                        or group chips (those are list-local). A row pin narrows
                        the session list to the skill's loaders. */}
                    <OverviewSkills
                      stats={skillLoadsOf(ranged, { scope, day, sort: skillSort })}
                      day={day}
                      selected={skill}
                      onSelect={setSkill}
                      sort={skillSort}
                      onSort={setSkillSort}
                      catalog={catalog}
                      now={now}
                    />
                  </div>

                  <div className="lc-ov-right">
                    <div className="lc-ov-list-head">
                      <span className="lc-ov-list-title">{t('ov.list.title')}</span>
                      <span className="lc-ov-list-count">{visible.length}</span>
                      {day !== null && (
                        <button type="button" className="lc-ov-day-chip" title={t('ov.list.dayClear')} onClick={() => { setDay(null) }}>
                          {t('ov.list.dayFilter', { day })} ×
                        </button>
                      )}
                      {skill !== null && (
                        <button type="button" className="lc-ov-day-chip" title={t('ov.list.skillClear')} onClick={() => { setSkill(null) }}>
                          {t('node.skillTag', { name: skill })} ×
                        </button>
                      )}
                      <input
                        className="lc-ov-search"
                        type="search"
                        value={query}
                        placeholder={t('ov.list.search')}
                        aria-label={t('ov.list.search')}
                        onChange={(ev) => { setQuery(ev.target.value) }}
                      />
                      <div className="lc-gran" role="group" aria-label={t('ov.list.sortLabel')}>
                        {SORTS.map(s => (
                          <button
                            key={s}
                            type="button"
                            className={'lc-gran-btn' + (sort === s ? ' lc-gran-on' : '')}
                            onClick={() => { setSort(s) }}
                          >{t('ov.list.sort.' + s)}</button>
                        ))}
                      </div>
                    </div>

                    {chips.length > 0 && (
                      <div className="lc-ov-groups" role="group" aria-label={t('ov.group.label')}>
                        <button
                          type="button"
                          className={'lc-ov-chip' + (group === null ? ' lc-ov-chip-on' : '')}
                          onClick={() => { setGroup(null) }}
                        >{t('ov.range.all')}<span className="lc-ov-chip-n">{scoped.length}</span></button>
                        {chips.map(c => (
                          <button
                            key={c.key}
                            type="button"
                            className={'lc-ov-chip' + (group === c.key ? ' lc-ov-chip-on' : '')}
                            onClick={() => { setGroup(group === c.key ? null : c.key) }}
                          >{c.key === UNGROUPED_KEY ? t('ov.group.ungrouped') : c.key}<span className="lc-ov-chip-n">{c.count}</span></button>
                        ))}
                      </div>
                    )}

                    {visible.length === 0 ? (
                      <div className="lc-empty">{t(allRows.length === 0 ? 'ov.list.empty' : 'ov.list.noMatch')}</div>
                    ) : (
                      <>
                        <div className="lc-ov-grid">
                          {paged.items.map(row => (
                            <OverviewCard
                              key={row.id}
                              row={row}
                              {...(groups?.[row.id] !== undefined ? { group: groups[row.id] } : {})}
                              costLabel={cardCostOf(row, book, currency)}
                              now={now}
                              onOpen={openOne}
                            />
                          ))}
                        </div>
                        {paged.count > 1 && (
                          <div className="lc-ov-pager" role="navigation" aria-label={t('ov.list.pager')}>
                            <button
                              type="button"
                              className="lc-ov-pager-btn"
                              disabled={paged.index === 0}
                              aria-label={t('ov.list.prev')}
                              onClick={() => { setPage(paged.index - 1) }}
                            >‹</button>
                            <span className="lc-ov-pager-n">{t('ov.list.page', { n: paged.index + 1, total: paged.count })}</span>
                            <button
                              type="button"
                              className="lc-ov-pager-btn"
                              disabled={paged.index === paged.count - 1}
                              aria-label={t('ov.list.next')}
                              onClick={() => { setPage(paged.index + 1) }}
                            >›</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    )
  }

  return function OverviewPanel(props: OverviewPanelProps): ReactElement | null {
    return <ErrorBoundary><OverviewBody {...props} /></ErrorBoundary>
  }
}

/** One card's priced cost label at the team scope, or the dash (no book yet, nothing billed, unpriceable models). */
function cardCostOf(row: OverviewRow, book: ModelBook | null, currency: CostCurrency): string {
  if (row.familyCost === null) return '—'
  const cost = estimateSessionCost(row.familyCost, book, currency)
  return cost === null ? '—' : formatCost(cost, currency)
}
