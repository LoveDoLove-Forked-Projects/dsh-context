/**
 * The Insights page's date-range picker: one calendar panel that takes BOTH
 * ends of a custom range, parked beside the range group's own presets.
 *
 * The trigger IS the scope: one pill carrying the start and the end side by
 * side, fed the LIVE window — a picked range when one owns the scope, the
 * preset's own window read as days otherwise ("last 30 days" shows the thirty
 * days it covers). So the picker and the presets never disagree, and a scope
 * the reader has to click into to see is a scope they cannot trust. Only a
 * picked range takes the chip's brand voice and grows the way back.
 *
 * Two clicks make the range, in any order. The second click is paired against
 * the first and SORTED, so a backwards drag (end before start) simply swaps
 * the two ends rather than committing a reversed window — every reader
 * downstream (the scope window, the ledger-day predicate, the chip that names
 * the range) only ever sees `from <= to`. While the second end is pending the
 * band previews under the cursor; the pick commits on that second click and
 * hands the scope straight back to the page, so the dashboard answers
 * immediately.
 *
 * The panel itself stays a plain calendar — no second copy of the two ends:
 * the chip above it is already showing them, live, while the pick runs.
 *
 * The panel is portaled to <body> and fixed-positioned off its trigger's rect,
 * the same containment escape the page's hover tips and skill tips take: the
 * page is the `lc-ov` query container and its scroller clips an in-tree
 * popover, so an unportaled panel would be cropped and offset. It measures
 * itself after commit (hidden until then, no flash at an unmeasured spot),
 * clamps inside the viewport, and flips above the trigger when it would fall
 * off the bottom. Any scroll, resize, outside press, or Escape closes it —
 * retract rather than float detached from a moved anchor.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { MONTH_KEY_RE, monthGridOf, shiftDayKey, shiftMonthKey } from '../../shared/days'
import { orderedDayRange, type DayRange } from '../overview'
import type { ViewKit } from '../viewkit'
import { useEscapeClose } from './escapeClose'
import { IconChevronDown } from '../primitives'

export interface DateRangeProps {
  /**
   * The scope's day span — the picked range while one owns the scope, else the
   * preset's own window read as days (its open end is today). Null when the
   * scope is unbounded ("all"), where there is no span to print.
   */
  value: DayRange | null
  /** Whether `value` is a picked range rather than a preset's window — the chip's voice and the way back. */
  picked: boolean
  /** Range relay: null hands the scope back to the preset. */
  onChange: (range: DayRange | null) => void
  /** The local today key (injected so specs pin the calendar) — the last selectable day. */
  today: string
  /** The active locale tag, for the panel's month header. */
  locale: string
}

/** Trigger-to-panel distance and the viewport margin the panel clamps inside, in px. */
const GAP = 6
const MARGIN = 8

/** The grid's cell id, the target its `aria-activedescendant` cursor names. */
const CELL_ID = 'lc-dp-day'

/** The grid's arrow-key day steps: left/right one day, up/down one week. */
function dayStepOf(key: string): number | null {
  if (key === 'ArrowLeft') return -1
  if (key === 'ArrowRight') return 1
  if (key === 'ArrowUp') return -7
  if (key === 'ArrowDown') return 7
  return null
}

/** The month header's localized name, or the bare key when it does not convert. */
export function monthLabelOf(month: string, locale: string): string {
  if (!MONTH_KEY_RE.test(month)) return month
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(date)
}

export function makeDateRange(kit: ViewKit): (props: DateRangeProps) => ReactElement {
  const { t } = kit
  return function DateRange(props: DateRangeProps): ReactElement {
    const [open, setOpen] = useState(false)
    // The month the panel shows, and the grid's keyboard cursor inside it.
    const [month, setMonth] = useState('')
    const [cursor, setCursor] = useState('')
    // The first picked end, while the second is still pending.
    const [anchor, setAnchor] = useState<string | null>(null)
    const [hover, setHover] = useState<string | null>(null)
    const [spot, setSpot] = useState<{ left: number; top: number } | null>(null)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const panelRef = useRef<HTMLDivElement | null>(null)

    const close = (): void => { setOpen(false) }
    useEscapeClose(open, close)

    // Any press outside the trigger and the panel closes it. The scroll and
    // resize rules match the page's hover tips: the trigger moves with the
    // pane, so the panel retracts instead of floating off its anchor.
    useEffect(() => {
      if (!open) return undefined
      const onDown = (ev: MouseEvent): void => {
        const target = ev.target
        if (!(target instanceof Node)) return
        if (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true) return
        close()
      }
      window.addEventListener('mousedown', onDown)
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
      return () => {
        window.removeEventListener('mousedown', onDown)
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('resize', close)
      }
    }, [open])

    // Seat the panel after it commits, then keep it seated: the comparison
    // makes a re-measure that lands on the same spot a no-op, so the
    // every-render measurement cannot loop. Object.is, not ===: an
    // unmeasurable anchor reads NaN, and NaN === NaN is false — which would
    // make every re-measure a fresh object and spin the tree.
    useLayoutEffect(() => {
      const anchorEl = rootRef.current
      const panelEl = panelRef.current
      if (!open || anchorEl === null || panelEl === null) return
      const rect = anchorEl.getBoundingClientRect()
      const left = Math.max(MARGIN, Math.min(rect.right - panelEl.offsetWidth, window.innerWidth - panelEl.offsetWidth - MARGIN))
      const below = rect.bottom + GAP
      const top = below + panelEl.offsetHeight > window.innerHeight - MARGIN
        ? Math.max(MARGIN, rect.top - panelEl.offsetHeight - GAP)
        : below
      setSpot(current => current !== null && Object.is(current.left, left) && Object.is(current.top, top) ? current : { left, top })
    })

    // The committed range, or the pending pair under the cursor (the anchor
    // alone until the hover gives the second end a preview).
    const draft = anchor === null ? props.value : orderedDayRange(anchor, hover ?? anchor)
    const grid = open ? monthGridOf(month) : null

    const show = (): void => {
      // Always this month: the calendar is a picking tool, and today is where
      // a pick starts. The live scope's band is highlighted wherever it falls.
      const home = props.today.slice(0, 7)
      setMonth(home)
      setCursor(`${home}-01`)
      setAnchor(null)
      setHover(null)
      setOpen(true)
    }

    const pick = (key: string): void => {
      if (anchor === null) {
        setAnchor(key)
        setHover(null)
        return
      }
      const next = orderedDayRange(anchor, key)
      setAnchor(null)
      setHover(null)
      setOpen(false)
      props.onChange(next)
    }

    const stepMonth = (delta: number): void => {
      const next = shiftMonthKey(month, delta)
      if (next === null) return
      setMonth(next)
      setCursor(`${next}-01`)
    }

    // One tab stop for the whole grid: the arrows walk the cursor a day or a
    // week (staying inside the shown month and out of the future), Enter or
    // Space picks it.
    const onKeyDown = (ev: React.KeyboardEvent): void => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        pick(cursor)
        return
      }
      const step = dayStepOf(ev.key)
      if (step === null) return
      ev.preventDefault()
      const next = shiftDayKey(cursor, step)
      if (next !== null && next <= props.today && next.slice(0, 7) === month) setCursor(next)
    }

    const shown = spot !== null && open ? spot : null
    // The two ends the head reads: the live scope's span while it has one, the
    // placeholders otherwise. A first click with no hover yet has chosen only
    // the start, so the end keeps its placeholder rather than echoing it.
    const from = draft?.from
    const to = anchor !== null && hover === null ? undefined : draft?.to
    return (
      <div className="lc-dp" ref={rootRef}>
        <button
          type="button"
          className={'lc-dp-trigger' + (props.picked ? ' lc-dp-trigger-on' : '')}
          aria-haspopup="dialog"
          aria-expanded={grid !== null}
          aria-label={t('ov.date.open')}
          onClick={() => { if (open) { close() } else { show() } }}
        >
          <span className={'lc-dp-half' + (from === undefined ? ' lc-dp-half-empty' : '')}>{from ?? t('ov.date.from')}</span>
          <span className="lc-dp-sep">→</span>
          <span className={'lc-dp-half' + (to === undefined ? ' lc-dp-half-empty' : '')}>{to ?? t('ov.date.to')}</span>
          <IconChevronDown size={12} />
        </button>
        {grid === null ? null : createPortal(
          <div
            ref={panelRef}
            className="lc-tip lc-dp-panel"
            role="dialog"
            aria-label={t('ov.date.label')}
            style={shown === null
              ? { left: 0, top: 0, visibility: 'hidden' }
              : { left: shown.left, top: shown.top }}
          >
            <div className="lc-dp-nav">
              <button type="button" className="lc-dp-navbtn" aria-label={t('ov.date.prev')} onClick={() => { stepMonth(-1) }}>‹</button>
              <span className="lc-dp-month">{monthLabelOf(month, props.locale)}</span>
              <button
                type="button"
                className="lc-dp-navbtn"
                aria-label={t('ov.date.next')}
                disabled={month >= props.today.slice(0, 7)}
                onClick={() => { stepMonth(1) }}
              >›</button>
            </div>
            <div className="lc-dp-wds" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6].map(d => <span key={d} className="lc-dp-wd">{t(`ov.date.wd.${String(d)}`)}</span>)}
            </div>
            <div
              className="lc-dp-grid"
              role="grid"
              tabIndex={0}
              aria-label={t('ov.date.pick')}
              aria-activedescendant={CELL_ID}
              onKeyDown={onKeyDown}
            >
              {grid.map((week, w) => (
                <div className="lc-dp-week" role="row" key={w}>
                  {week.map((key, d) => {
                    if (key === null) return <span className="lc-dp-cell lc-dp-blank" key={d} />
                    const future = key > props.today
                    const edge = draft !== null && (key === draft.from || key === draft.to)
                    const inRange = draft !== null && key >= draft.from && key <= draft.to
                    // Only the cursor carries the id `aria-activedescendant` names.
                    const className = 'lc-dp-cell'
                      + (inRange ? ' lc-dp-in' : '')
                      + (edge ? ' lc-dp-edge' : '')
                      + (key === cursor ? ' lc-dp-cursor' : '')
                      + (key === props.today ? ' lc-dp-today' : '')
                      + (future ? ' lc-dp-future' : '')
                    // The day of the month, unpadded: the header already names
                    // the month, so "3" is the whole cell.
                    const day = String(Number(key.slice(8, 10)))
                    if (future) {
                      // The cursor never lands here (the keyboard stops at
                      // today), so this cell carries no activedescendant id.
                      return (
                        <span className={className} role="gridcell" aria-disabled="true" aria-label={key} key={d}>
                          {day}
                        </span>
                      )
                    }
                    return (
                      <span
                        className={className}
                        role="gridcell"
                        id={key === cursor ? CELL_ID : undefined}
                        aria-label={key}
                        aria-selected={edge}
                        key={d}
                        onMouseEnter={() => { if (anchor !== null) setHover(key) }}
                        onClick={() => { pick(key) }}
                      >
                        {day}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="lc-dp-foot">
              <span className="lc-dp-hint">{anchor === null ? t('ov.date.hint') : t('ov.date.hintEnd')}</span>
              {props.picked && (
                <button
                  type="button"
                  className="lc-dp-clear"
                  onClick={() => { props.onChange(null) }}
                >{t('ov.date.clear')}</button>
              )}
            </div>
          </div>,
          document.body,
        )}
      </div>
    )
  }
}
