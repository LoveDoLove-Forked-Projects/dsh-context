/**
 * Named imports from the ui-primitives platform module, resolved defensively.
 *
 * Every supported line ships the `Icon*OutlineRegular` / `Icon*OutlineMedium`
 * vocabulary, but the import arrives through the shell's module table at
 * runtime: a renamed or absent export reads as `undefined`, which renders as
 * React error #130 inside the Context tab. Each icon here resolves by name
 * through a bounded read; a missing or non-component export (a future rename,
 * a partial module mock, a hostile namespace) degrades to a render-nothing
 * fallback — a missing glyph, never a crashed tab.
 */

import type { ReactElement } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** One platform icon component, as the call sites render it. */
export type IconComponent = (props: IconProps) => ReactElement | null

/** The platform module's export surface, read by name. */
const ns = primitives as unknown as Record<string, unknown>

/**
 * Resolve one icon by its export name; absent or not a component (or a
 * namespace whose property READ throws — partial mocks, hostile modules)
 * renders nothing. `source` overrides the platform namespace for tests.
 */
export function resolveIcon(name: string, source: Record<string, unknown> = ns): IconComponent {
  try {
    const found = source[name]
    if (typeof found === 'function') return found as IconComponent
  } catch { /* a hostile namespace: the fallback below */ }
  return () => null
}

export const IconBranch = resolveIcon('IconBranchOutlineRegular')
export const IconPlus = resolveIcon('IconPlusOutlineRegular')
export const IconCheck = resolveIcon('IconCheckOutlineRegular')
export const IconCopy = resolveIcon('IconCopyOutlineRegular')
export const IconClose = resolveIcon('IconCloseOutlineRegular')
export const IconSettings = resolveIcon('IconSettingsOutlineMedium')
export const IconChevronDown = resolveIcon('IconChevronDownOutlineMedium')
export const IconChevronUp = resolveIcon('IconChevronUpOutlineMedium')
export const IconSearch = resolveIcon('IconSearchOutlineRegular')
