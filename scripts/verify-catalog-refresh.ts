import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Page } from 'playwright-core'
import type { CatalogSnapshot, RendererApi } from '../src/shared/contracts.js'

type Probe = { mode: 'live' | 'offline' | 'throw'; calls: boolean[]; finish?: () => void }
type TestWindow = { riftboundStudio: RendererApi; catalogProbe: Probe }
const server = await createServer({ configFile: false, root: resolve('src/renderer'), plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const address = server.httpServer!.address()
assert(address && typeof address !== 'string')
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let checks = 0

async function installProbe(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Refresh catalog', exact: true }).waitFor()
  await page.evaluate(async () => {
    const target = window as unknown as TestWindow
    const api = target.riftboundStudio
    const originalLoad = api.loadCatalog
    const base = await originalLoad('riftbound')
    const probe: Probe = { mode: 'live', calls: [] }
    target.catalogProbe = probe
    const card = { ...base.cards[0]!, id: 'rad-065-167', code: 'RAD-065', publicCode: 'RAD-065/167', baseCode: 'RAD-065', identityId: 'RAD-065', name: 'Seraphine, Inspiring', setCode: 'RAD', setName: 'Radiance' }
    api.loadCatalog = async (game, force) => {
      if (game !== 'riftbound' || !force) return originalLoad(game, force)
      probe.calls.push(force)
      await new Promise<void>((resolve) => { probe.finish = resolve })
      if (probe.mode === 'throw') throw new Error('Fixture refresh failure')
      const snapshot: CatalogSnapshot = probe.mode === 'live'
        ? { ...base, cards: [...base.cards, card], source: 'https://playriftbound.com/en-us/card-gallery/', fetchedAt: new Date().toISOString(), cacheStatus: 'live', catalogVersion: 2 }
        : { ...base, fetchedAt: '2026-08-25T00:00:00.000Z', cacheStatus: 'bundled', warning: 'Online refresh failed; using the bundled catalog. Fixture offline' }
      return snapshot
    }
    api.resolveImport = async (_game, imported, cards) => ({ cards, entries: imported.lines.map((line) => {
      const chosen = cards.find((candidate) => candidate.name === line.name)!
      return { id: 'entry', rawName: line.name, quantity: line.quantity, section: line.section, resolvedCardId: chosen.id, candidateCardIds: [chosen.id], resolution: 'resolved' as const,
        allocations: [{ id: 'allocation', quantity: line.quantity, front: { kind: 'official' as const, cardId: chosen.id, imageUrl: chosen.imageUrl } }] }
    }) })
  })
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const url = `http://127.0.0.1:${address.port}/?browserPreview`
  await page.goto(url)
  await installProbe(page)
  assert.match(await page.locator('.catalog-info-bar').innerText(), /Radiance: 0/)
  await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Refreshing catalog…' }).isDisabled(), true)
  await page.evaluate(() => { (window as unknown as TestWindow).catalogProbe.finish?.() })
  await page.getByText(/Radiance: 1/).waitFor()
  assert.deepEqual(await page.evaluate(() => (window as unknown as TestWindow).catalogProbe.calls), [true])
  checks++

  await page.locator('textarea').fill('1 Seraphine, Inspiring')
  await page.getByRole('button', { name: 'Import and resolve cards' }).click()
  assert.match(await page.locator('.table-card').innerText(), /RAD-065.*Seraphine|Seraphine[\s\S]*RAD-065/)
  await page.getByRole('button', { name: 'Continue to artwork' }).click()
  assert.match(await page.locator('.artwork-choice-summary').innerText(), /Radiance/)
  await page.getByRole('button', { name: 'Browse artwork gallery' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep this artwork' }).click()
  checks++

  for (const mode of ['offline', 'throw'] as const) {
    await page.evaluate((mode) => { (window as unknown as TestWindow).catalogProbe.mode = mode }, mode)
    await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
    await page.evaluate(() => { (window as unknown as TestWindow).catalogProbe.finish?.() })
    await page.getByText(mode === 'offline' ? /Fixture offline/ : /Fixture refresh failure/).waitFor()
    assert.match(await page.locator('.artwork-choice-summary').innerText(), /Radiance/)
    assert.equal(await page.locator('.quantity-input').inputValue(), '1')
    assert.equal(await page.getByRole('button', { name: 'Refresh catalog', exact: true }).isEnabled(), true)
    checks++
  }

  // A delayed Riftbound response must not overwrite the catalog after switching games.
  await page.goto(url)
  await installProbe(page)
  await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
  await page.getByRole('button', { name: /Magic: The Gathering/ }).click()
  await page.getByRole('heading', { name: 'Bring in a Magic: The Gathering deck' }).waitFor()
  await page.evaluate(() => { (window as unknown as TestWindow).catalogProbe.finish?.() })
  assert.equal(await page.locator('.catalog-info-bar').count(), 0)
  assert.match(await page.locator('.catalog-status').innerText(), /Scryfall/)
  checks++
  assert.deepEqual(errors, [])
  if (process.env.PROXY_CATALOG_SCREENSHOT) {
    await page.goto(url)
    await page.getByRole('button', { name: 'Refresh catalog', exact: true }).waitFor()
    const bundled = JSON.parse(await readFile('resources/dev-catalog-v1.json', 'utf8')) as CatalogSnapshot
    await page.evaluate((snapshot) => {
      (window as unknown as TestWindow).riftboundStudio.loadCatalog = async () => ({ ...snapshot, cacheStatus: 'cached' })
    }, bundled)
    await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
    await page.getByText(new RegExp(`Radiance: ${bundled.cards.filter((card) => card.setCode === 'RAD').length}`)).waitFor()
    await page.locator('.panel').evaluate(async (panel) => { await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => undefined))) })
    await page.screenshot({ path: process.env.PROXY_CATALOG_SCREENSHOT })
  }
  console.log(`Catalog refresh: ${checks} scenario checks passed (forced reload, Radiance resolve/artwork, offline/error preservation, cross-game race).`)
} finally {
  await browser?.close()
  await server.close()
}
