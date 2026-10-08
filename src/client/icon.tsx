/**
 * The Context emblem: the colourful document sheet, bundled rather than read
 * off the harness primitives so the plugin's identity is self-contained.
 *
 * The single graphic source is the package-root `icon.svg` — the same file
 * package.json `icon` hands to the Host's package-meta reader, which serves
 * it to the Plugins page's package cards. The client bundle inlines the
 * file's markup at build time (the `?raw` channel in tsdown.config.ts) and
 * re-renders it at every requested size. The identity seats (tab chip,
 * command, sidebar registration) keep the sheet's fixed fills —
 * deliberately polychrome on both light and dark chrome — while the
 * sidebar's panel-list seat (insightPage.ts) opts into `mono`: the sheet in
 * the surrounding text colour at the harness's own line weight, so the
 * shell-owned row weighs what the shipped rows beside it weigh.
 */

import sheetMarkup from '../../icon.svg?raw'
import { useId, type ReactElement } from 'react'
import type { Translate } from './i18n'

/** Everything between the file's `<svg>` tags: the sheet's strokes in paint order, whitespace-folded. */
const SHEET_MARKUP = sheetMarkup
  .slice(sheetMarkup.indexOf('>') + 1, sheetMarkup.lastIndexOf('</svg>'))
  .trim()
  .replace(/>\s+</g, '><')

/** The same strokes with their palette dropped — the shape alone, which the mono seat's masks paint. */
const SHEET_OUTLINE = SHEET_MARKUP.replace(/fill="#[0-9A-Fa-f]{6}"/g, '')

/** The harness icon set's line weight: one unit of its 16-unit box, which this artboard spells as 64. */
const HARNESS_STROKE = 1024 / 16

/** The source artboard's own bar weight: every pill and the dot measures 98 to 101 units. */
const SHEET_STROKE = 98

/** What the mono seat's mask takes off each side of every stroke to reach the harness weight. */
const INSET = (SHEET_STROKE - HARNESS_STROKE) / 2

/** The mask canvas: the artboard grown past every shifted copy of itself, so no edge clips. */
const CANVAS = { x: -2 * INSET, y: -2 * INSET, width: 1024 + 4 * INSET, height: 1024 + 4 * INSET }
const CANVAS_ATTRS = `x="${CANVAS.x}" y="${CANVAS.y}" width="${CANVAS.width}" height="${CANVAS.height}"`

/** One canvas-covering rect — the mask flood, a shift's paint, or the mono seat's own ink. */
const canvasRect = (fill: string, rest = ''): string => `<rect ${CANVAS_ATTRS} fill="${fill}"${rest}/>`

/** The axes the mono seat erodes along, one shift per direction. */
const SHIFTS: [number, number][] = [[INSET, 0], [-INSET, 0], [0, INSET], [0, -INSET]]

/**
 * The mono seat's markup: the sheet masked down to the harness line weight
 * rather than redrawn — the plugin ships ONE artwork, and the shell's rows
 * want thin strokes. Erosion is the intersection of a shape with its own
 * copies shifted along each axis; a mask intersects as a white flood with
 * one black shift per direction, every shift painted through the sheet's
 * own complement (the `-hole` mask), which is the only copy of the drawing.
 * Compositing rather than a filter: `feMorphology` rounds its radius to
 * whole device pixels, so it would thin the glyph on a 2× display and leave
 * it untouched (or over-thin it) at 1×.
 * @param id - this instance's def prefix; two emblems on a page may not share mask ids.
 */
function monoMarkup(id: string): string {
  const hole = `${id}-hole`
  const thin = `${id}-thin`
  const shifts = SHIFTS
    .map(([dx, dy]) => canvasRect('#000', ` mask="url(#${hole})" transform="translate(${dx} ${dy})"`))
    .join('')
  return '<defs>'
    + `<mask id="${hole}" maskUnits="userSpaceOnUse" ${CANVAS_ATTRS}>`
    + `${canvasRect('#fff')}<g fill="#000">${SHEET_OUTLINE}</g>`
    + '</mask>'
    + `<mask id="${thin}" maskUnits="userSpaceOnUse" ${CANVAS_ATTRS}>${canvasRect('#fff')}${shifts}</mask>`
    + '</defs>'
    + canvasRect('currentColor', ` mask="url(#${thin})"`)
}

/** The emblem's props, matching the harness `IconProps` the guide capsule hands it. */
export interface ContextIconProps {
  /** Square edge in px. */
  size?: number
  /** Extra class for layout placement. */
  className?: string
  /** The sidebar panel-list seat: the surrounding text colour at the harness line weight, not the palette. */
  mono?: boolean
}

/** The document sheet at the requested square edge — polychrome by default, the shell row's own weight in `mono`. */
export function ContextIcon({ size = 20, className, mono = false }: ContextIconProps): ReactElement {
  // Mask defs are per instance: a second emblem on the page would otherwise
  // resolve `url(#…)` against this one's defs, and lose them when it unmounts.
  const id = `dsh-context-sheet-${useId().replaceAll(':', '')}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={{ __html: mono ? monoMarkup(id) : SHEET_MARKUP }}
    />
  )
}

/**
 * The sidebar panel-list glyph (`sidebar.panellist`): the emblem in `mono` at
 * the size the shell asks for, so the shell-owned row's hover/active colors
 * paint it like the shipped panel glyphs. The shell owns the row's label,
 * and the row's selected state its own styling, so — as on the shipped
 * glyphs — the owner props' `active` goes unread.
 */
export function InsightPanelIcon({ size = 18 }: { size?: number }): ReactElement {
  return <ContextIcon size={size} mono />
}

/**
 * The tab chip's title seat (`sidebar.right.pane.tab.title`): the emblem before
 * the label, so the chip reads as the files chip does. The label comes from the
 * plugin's own bound translate — read at render, so the chip follows the active
 * locale — rather than the tab-information hook, which a foreign or
 * not-yet-committed tab record can throw on. It carries a trailing gutter
 * (`.lc-title-label`) so the active chip's fade lands past the text, never on
 * the last glyphs.
 * @param t - the plugin-namespace translate bound in `apply`.
 * @returns the title component to register under the tab type's id.
 */
export function makeContextTabTitle(t: Translate): () => ReactElement {
  return function ContextTabTitle(): ReactElement {
    return (
      <>
        <ContextIcon size={16} className="lc-title-icon" />
        <span className="lc-title-label">{t('tab')}</span>
      </>
    )
  }
}
