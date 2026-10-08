/**
 * The skill catalog behind the Insights page's skill card: one POST to the
 * plugin's `/api/dsh-context/skills` route (host/skills.ts) per panel open,
 * anchored on the current session (its workspace selects the registry's
 * project layer; its preset selects the discovery scope). The card joins the
 * answer by name onto the activity ledger's load tallies, so a missing or
 * failed read is no error state — the rows render their tallies unenriched.
 */

import type { SkillInfo } from '../shared/types'
import { asRecord } from './services'

// The skills route of host/skills.ts — re-declared here (the client bundle
// inlines every import, and the host module must never reach it). Same-origin
// POST under the harness's authenticated `/api` fence.
const SKILLS_ROUTE = '/api/dsh-context/skills'

/**
 * Narrow the route's payload to render-safe entries (the boundary rigor
 * every parser owes untrusted input): each entry's name is the join key and
 * must prove itself, the description defaults to empty, path and source ride
 * only when proved — an entry failing the shape drops whole and the readable
 * siblings keep serving.
 */
export function skillInfoListOf(value: unknown): SkillInfo[] | null {
  const list = asRecord(value)?.skills
  if (!Array.isArray(list)) return null
  const out: SkillInfo[] = []
  for (const item of list) {
    const record = asRecord(item)
    if (record === null || typeof record.name !== 'string' || record.name === '') continue
    out.push({
      name: record.name,
      description: typeof record.description === 'string' ? record.description : '',
      ...(typeof record.path === 'string' && record.path !== '' ? { path: record.path } : {}),
      ...(typeof record.source === 'string' && record.source !== '' ? { source: record.source } : {}),
    })
  }
  return out
}

/**
 * One route read for one viewing context, narrowed through `skillInfoListOf`
 * into the card's name-keyed join map. The session id lets the host resolve
 * the session's workspace AND preset scope (web compositions mount skill
 * discovery on agent presets — a cwd alone lists only the global layers);
 * the cwd rides as the fallback when the session cannot be observed. Never
 * rejects and never reports an empty answer: a served catalog with no usable
 * entry reads the same as no route at all (`null` — the rows render
 * unenriched either way). Later names win the map slot, matching the
 * registry's own last-wins merge.
 */
export async function readSkillCatalog(
  cwd: string | undefined,
  sessionId: string | undefined,
): Promise<ReadonlyMap<string, SkillInfo> | null> {
  try {
    const response = await fetch(SKILLS_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(cwd === undefined ? {} : { cwd }),
        ...(sessionId === undefined ? {} : { sessionId }),
      }),
    })
    if (!response.ok) return null
    const body = asRecord(await response.json())
    const list = body === null || body.ok !== true ? null : skillInfoListOf(body.value)
    if (list === null || list.length === 0) return null
    return new Map(list.map(info => [info.name, info]))
  } catch {
    return null
  }
}

/** The clipboard write behind the card's path footer (test seam; the real write). */
type TextCopier = (text: string) => Promise<void>

/** The clipboard write through the platform API (absent off a secure context). */
const defaultCopier: TextCopier = async (text) => {
  const clipboard = (globalThis.navigator as { clipboard?: { writeText?: unknown } } | undefined)?.clipboard
  if (typeof clipboard?.writeText !== 'function') throw new Error('clipboard unavailable')
  await (clipboard.writeText as (text: string) => Promise<void>).call(clipboard, text)
}

let copier: TextCopier = defaultCopier

/** Test seam: replace the clipboard write; null restores the default. */
export function setSkillCopier(next: TextCopier | null): void {
  copier = next ?? defaultCopier
}

/**
 * Copy the skill's path for the card's footer click. Resolves whether the
 * write landed, so the footer's "copied" flash never claims a write that
 * failed (an insecure context, a denied permission).
 */
export async function copySkillPath(path: string): Promise<boolean> {
  try {
    await copier(path)
    return true
  } catch {
    return false
  }
}
