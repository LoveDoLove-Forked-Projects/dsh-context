/**
 * Best-effort jump to this plugin's preferences on the Config-form
 * generation (every supported line): the preferences live on the bundle's
 * page of the Plugins main panel — the jump clicks the panel's sidebar entry
 * (its shipped aria-label), then follows the page with a bounded poll for the
 * bundle card's open control, found by the shipped, locale-independent
 * `data-plugin-package` list identity: the card lists once the page's package
 * load settles, and inside it the one button that is not the enable switch is
 * the title that opens the page. A poll that never finds the card (still
 * loading, plugin absent, or the page already open on the detail view — the
 * list unmounts there) degrades to the card list, and every step stays
 * silent: a shell that doesn't match (different layout, missing sidebar)
 * degrades the whole jump to a silent no-op — this path must never throw
 * into the caller's render.
 */

/**
 * The shipped Plugins label in both locales — the main-panel entry's
 * aria-label.
 */
const PLUGIN_LABELS = new Set(['Plugins', '插件'])

/** The bundle card's shipped list identity (locale-independent). */
const PACKAGE_KEY = 'dsh-context'

/** How long the card poll follows the panel: 40 ticks at the 100ms tick, enough for the page's package load. */
const POLL_TICKS = 40

/** Buttons the jump may operate on, in document order. */
function buttonsOf(doc: Document): HTMLButtonElement[] {
  return [...doc.querySelectorAll<HTMLButtonElement>('button')]
}

/** The Plugins main-panel entry, matched by its shipped aria-label. */
function findPanelEntry(doc: Document): HTMLButtonElement | undefined {
  return buttonsOf(doc).find(b => PLUGIN_LABELS.has(b.getAttribute('aria-label') ?? ''))
}

/**
 * The bundle card's open control: the one button inside the card that is not
 * the enable switch (the primitives switch carries `role="switch"`); the
 * title button's own aria-label is localized.
 */
function findCardOpenControl(doc: Document): HTMLButtonElement | undefined {
  const card = doc.querySelector(`[data-plugin-package="${PACKAGE_KEY}"]`)
  if (card === null) return undefined
  const open = [...card.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.getAttribute('role') !== 'switch')
  return open.length === 1 ? open[0] : undefined
}

export function openPluginSettings(
  doc: Document = document,
  schedule: (run: () => void, ms: number) => void = (run, ms) => { window.setTimeout(run, ms) },
): void {
  try {
    // The panel entry is the one seat both locales ship; without it this
    // shell has no Plugins page and the jump is a no-op.
    const panel = findPanelEntry(doc)
    if (panel === undefined) return
    panel.click()
    const poll = (left: number): void => {
      try {
        const open = findCardOpenControl(doc)
        if (open !== undefined) {
          open.click()
          return
        }
      } catch { /* a hostile card: stay on the card list */ }
      if (left > 0) schedule(() => { poll(left - 1) }, 100)
    }
    schedule(() => { poll(POLL_TICKS) }, 200)
  } catch { /* the settings surface doesn't match: silent no-op */ }
}
