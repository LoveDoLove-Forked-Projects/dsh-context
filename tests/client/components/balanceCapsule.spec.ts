// BalanceCapsule (src/client/components/balanceCapsule.tsx): renders nothing
// until a live figure lands (pending, absent, or failed all stay invisible),
// shows the locale's currency with the account's first currency as fallback,
// and carries the breakdown in the tooltip. The route read is stubbed per
// test; the module's TTL cache is reset between tests.

import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { makeBalanceCapsule } from '../../../src/client/components/balanceCapsule'
import { resetPlatformBalance } from '../../../src/client/balance'
import { asClientCtx, TestClientCtx } from '../helpers/harness'
import { flush, makeKit, mount, query, text } from '../helpers/kit'

const kit = makeKit()

const WIRE_BALANCE = {
  isAvailable: true,
  balances: [
    { currency: 'CNY', total: 110, granted: 10, toppedUp: 100 },
    { currency: 'USD', total: 12.5, granted: 2.5, toppedUp: 10 },
  ],
}

function stubRoute(body: unknown): void {
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => body }))
}

afterEach(() => {
  resetPlatformBalance()
  vi.unstubAllGlobals()
})

describe('BalanceCapsule', () => {
  test('absent, failed, and still-pending reads render nothing', async () => {
    stubRoute({ ok: true, value: null })
    const Capsule = makeBalanceCapsule(asClientCtx(new TestClientCtx({ locale: 'en' })), kit)
    const m = await mount(h(Capsule, {}))
    await flush()
    assert.equal(text(m.container), '')
    await m.unmount()

    stubRoute({ ok: false })
    const failed = makeBalanceCapsule(asClientCtx(new TestClientCtx({ locale: 'en' })), kit)
    const m2 = await mount(h(failed, {}))
    await flush()
    assert.equal(text(m2.container), '')
    await m2.unmount()
  })

  test('the en locale shows USD with the total and the breakdown tooltip', async () => {
    stubRoute({ ok: true, value: WIRE_BALANCE })
    const Capsule = makeBalanceCapsule(asClientCtx(new TestClientCtx({ locale: 'en' })), kit)
    const m = await mount(h(Capsule, {}))
    await flush()
    const pill = query(m.container, '.lc-ov-balance')
    assert.equal(pill?.tagName, 'A')
    assert.equal(pill?.getAttribute('href'), 'https://platform.deepseek.com/usage')
    assert.equal(pill?.getAttribute('target'), '_blank')
    assert.equal(pill?.getAttribute('rel'), 'noreferrer')
    assert.equal(query(m.container, '.lc-ov-balance-label')?.textContent, 'DeepSeek balance')
    assert.equal(query(m.container, '.lc-ov-balance-value')?.textContent, '$12.50')
    const tip = pill?.getAttribute('title') ?? ''
    assert.ok(tip.includes('Total balance: $12.50'), tip)
    assert.ok(tip.includes('Granted balance: $2.50'), tip)
    assert.ok(tip.includes('Topped-up balance: $10.00'), tip)
    await m.unmount()
  })

  test('the zh locale shows CNY with localized breakdown labels', async () => {
    stubRoute({ ok: true, value: WIRE_BALANCE })
    // The kit's `t` is the harness's locale-bound translate (zh), while the
    // ctx's locale service drives the currency pick.
    const Capsule = makeBalanceCapsule(asClientCtx(new TestClientCtx({ locale: 'zh' })), makeKit('zh'))
    const m = await mount(h(Capsule, {}))
    await flush()
    assert.equal(query(m.container, '.lc-ov-balance-label')?.textContent, 'DeepSeek 余额')
    assert.equal(query(m.container, '.lc-ov-balance-value')?.textContent, '¥110.00')
    const tip = query(m.container, '.lc-ov-balance')?.getAttribute('title') ?? ''
    assert.ok(tip.includes('总余额: ¥110.00'), tip)
    assert.ok(tip.includes('赠送余额: ¥10.00'), tip)
    assert.ok(tip.includes('充值余额: ¥100.00'), tip)
    await m.unmount()
  })

  test('an account without the display currency falls back to its first entry, code-prefixed', async () => {
    stubRoute({
      ok: true,
      value: { isAvailable: true, balances: [{ currency: 'EUR', total: 5, granted: 0, toppedUp: 5 }] },
    })
    const Capsule = makeBalanceCapsule(asClientCtx(new TestClientCtx({ locale: 'en' })), kit)
    const m = await mount(h(Capsule, {}))
    await flush()
    assert.equal(query(m.container, '.lc-ov-balance-value')?.textContent, 'EUR 5.00')
    await m.unmount()
  })

  test('an unmount before the read lands never updates state', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.stubGlobal('fetch', async () => {
      await gate
      return { ok: true, json: async () => ({ ok: true, value: WIRE_BALANCE }) }
    })
    const Capsule = makeBalanceCapsule(asClientCtx(new TestClientCtx({ locale: 'en' })), kit)
    const m = await mount(h(Capsule, {}))
    assert.equal(text(m.container), '', 'nothing while the read is pending')
    await m.unmount()
    release()
    await flush()
    assert.ok(true)
  })
})
