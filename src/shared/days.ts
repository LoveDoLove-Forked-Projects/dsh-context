/**
 * The local-day key (`YYYY-MM-DD`) shared by the activity fold (host) and the
 * overview heatmap (client). Both halves bucket by the machine's OWN local
 * day: the harness host serves the operator's machine, so the host-folded
 * keys and the browser's cells speak the same calendar. Lexicographic order
 * on the key IS chronological order — the fold's retention cap and the
 * heatmap's week math both ride that.
 *
 * The module also owns the pure calendar arithmetic the client grids need off
 * those keys: a day's epoch bounds (the picked range's window), a day's
 * weekday, month stepping, and one month laid out as Sunday-first weeks.
 */

/** The strict key shape (round-trip validated on construction too). */
export const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The strict month-key shape (`YYYY-MM`), the stepping and header unit. */
export const MONTH_KEY_RE = /^\d{4}-\d{2}$/

/**
 * The local calendar-day key of an epoch-ms instant, or null when the time
 * is not a finite number or falls outside the representable date range —
 * untrusted log data can never produce a garbage key.
 */
export function dayKeyOf(time: number): string | null {
  if (!Number.isFinite(time)) return null
  const d = new Date(time)
  const y = d.getFullYear()
  if (!Number.isFinite(y) || y < 1970 || y > 9999) return null
  return `${String(y).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * A day key's local Date (midnight), or null when the key is malformed or its
 * fields would roll over (2026-02-30) — the one validation the key→calendar
 * helpers below share, so none of them can invent a date.
 */
function dateOfDayKey(key: string): Date | null {
  if (!DAY_KEY_RE.test(key)) return null
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7))
  const d = Number(key.slice(8, 10))
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

/**
 * Advance a day key by `delta` calendar days (local). Date-field arithmetic
 * keeps DST-short/long days exact (an epoch-ms add would drift an hour into
 * the neighbouring day). Null propagates (the caller's input guard), and a
 * malformed key — including one whose fields would roll over (2026-13-40) —
 * yields null as well.
 */
export function shiftDayKey(key: string, delta: number): string | null {
  const date = dateOfDayKey(key)
  if (date === null) return null
  date.setDate(date.getDate() + delta)
  return dayKeyOf(date.getTime())
}

/** A day key's weekday index (0=Sunday..6=Saturday, local) — the calendar month's leading blanks. Null on a malformed key. */
export function weekdayOf(key: string): number | null {
  const date = dateOfDayKey(key)
  return date === null ? null : date.getDay()
}

/** The Sunday (local) of the week containing `key` — the heatmap's column anchor. */
export function sundayOfWeek(key: string): string | null {
  const weekday = weekdayOf(key)
  // getDay: 0=Sunday..6=Saturday → days since Sunday.
  return weekday === null ? null : shiftDayKey(key, -weekday)
}

/** A day key's local midnight (epoch ms) — a picked range's inclusive start. Null on a malformed key. */
export function startOfDayKey(key: string): number | null {
  const date = dateOfDayKey(key)
  if (date === null) return null
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** A day key's last local millisecond (epoch ms) — a picked range's inclusive end, so the whole day is in. Null on a malformed key. */
export function endOfDayKey(key: string): number | null {
  const date = dateOfDayKey(key)
  if (date === null) return null
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

/**
 * Shift a month key by `delta` months (local), clamping the day overflow the
 * way `Date` does (Jan 31 + 1 month lands in March). Null on a malformed key,
 * a month outside 1-12, or a target outside the representable year range —
 * the same contract as shiftDayKey.
 */
export function shiftMonthKey(month: string, delta: number): string | null {
  if (!MONTH_KEY_RE.test(month)) return null
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  if (index < 1 || index > 12) return null
  // Months since year 0, so a step across the year boundary is plain addition.
  const total = year * 12 + (index - 1) + delta
  const y = Math.floor(total / 12)
  if (y < 1970 || y > 9999) return null
  return `${String(y).padStart(4, '0')}-${String(total - y * 12 + 1).padStart(2, '0')}`
}

/** A day key's weekday index (0=Sunday..6=Saturday, local) — the calendar month's leading blanks. Null on a malformed key. */

/**
 * One month as Sunday-first weeks of day keys, padded with nulls so every
 * week carries seven cells (the leading blanks are the 1st's weekday). Null
 * for a malformed key or a day-key math failure — the calendar then degrades
 * instead of drawing a wrong month.
 */
export function monthGridOf(month: string): (string | null)[][] | null {
  const first = `${month}-01`
  const lead = weekdayOf(first)
  if (lead === null) return null
  const weeks: (string | null)[][] = []
  // Built by pushing onto an empty week, never by sizing an array literal: the
  // lead count is the 1st's weekday, and this keeps the element type honest.
  let week: (string | null)[] = []
  for (let i = 0; i < lead; i++) week.push(null)
  for (let day = 0; ; day++) {
    const key = shiftDayKey(first, day)
    // Past the month's last day (or out of the representable range): pad the
    // open week and stop — the loop always returns.
    if (key === null || key.slice(0, 7) !== month) {
      while (week.length < 7) week.push(null)
      weeks.push(week)
      return weeks
    }
    week.push(key)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
}
