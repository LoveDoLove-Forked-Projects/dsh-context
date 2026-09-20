/**
 * BalanceCapsule — the DeepSeek open-platform balance pill in the Context
 * Dashboard's header (the plugin's one account-level figure, beside the
 * session-level ones). Clicking it opens the platform's usage console in a
 * new tab. Mounted only by the dashboard header; it reads the
 * plugin's balance route once per open through client/balance.ts and renders
 * NOTHING while the read is pending, absent, or failed — the pill exists
 * only when there is a live figure to show. The tooltip carries the
 * breakdown (total / granted / topped-up) in the entry's own currency; the
 * entry follows the active locale (zh → CNY) with the account's first
 * currency as the fallback.
 */

import { useEffect, useState, type ReactElement } from 'react'
import { balanceEntryOf, fetchPlatformBalance } from '../balance'
import type { PlatformBalance } from '../../shared/types'
import type { ClientCtx } from '../services'
import type { ViewKit } from '../viewkit'

/** The symbol prefix for the currencies the platform serves; others show their code. */
function symbolOf(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return currency + ' '
}

/** The platform console page behind the capsule's click — usage and top-ups. */
const USAGE_URL = 'https://platform.deepseek.com/usage'

export function makeBalanceCapsule(ctx: ClientCtx, kit: ViewKit): () => ReactElement | null {
  const { t } = kit
  return function BalanceCapsule(): ReactElement | null {
    const [balance, setBalance] = useState<PlatformBalance | null>(null)
    useEffect(() => {
      let on = true
      // Fire-and-forget: fetchPlatformBalance never rejects, and the `on`
      // flag drops the result of an unmount mid-read.
      void fetchPlatformBalance().then((v) => { if (on) setBalance(v) })
      return () => { on = false }
    }, [])
    const locale = ctx.locale
    const active = typeof locale.getLocale === 'function' ? locale.getLocale().active : 'en'
    const entry = balanceEntryOf(balance, active === 'zh' ? 'cny' : 'usd')
    if (entry === null) return null
    const money = (amount: number): string => symbolOf(entry.currency) + amount.toFixed(2)
    const tip = [
      t('balance.tip.total') + ': ' + money(entry.total),
      t('balance.tip.granted') + ': ' + money(entry.granted),
      t('balance.tip.toppedUp') + ': ' + money(entry.toppedUp),
    ].join('\n')
    return (
      <a className="lc-ov-balance" title={tip} href={USAGE_URL} target="_blank" rel="noreferrer">
        <span className="lc-ov-balance-label">{t('balance.title')}</span>
        <span className="lc-ov-balance-value">{money(entry.total)}</span>
      </a>
    )
  }
}
