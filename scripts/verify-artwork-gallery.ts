import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Page, type Locator } from 'playwright-core'
import type { RendererApi } from '../src/shared/contracts.js'

// Exercise the real renderer against its development-only, offline catalog.
// No MPC sessions, network card downloads, or user project files are involved.
const server = await createServer({
  configFile: false,
  root: resolve('src/renderer'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 0 }
})
await server.listen()
const address = server.httpServer!.address()
assert(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}/?browserPreview`
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let checks = 0

async function insideViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()!
  assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
    'Confirmation must be fully visible without scrolling')
  await locator.click({ trial: true })
  checks++
}

async function customize(page: Page, game: 'mtg' | 'riftbound'): Promise<void> {
  await page.goto(url)
  if (game === 'mtg') await page.getByRole('button', { name: /Magic: The Gathering/ }).click()
  await page.locator('textarea').fill(game === 'mtg' ? '6 Sol Ring' : '2 Charm')
  await page.getByRole('button', { name: /Import and resolve/ }).click()
  await page.getByRole('button', { name: 'Continue to artwork' }).click()
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  for (const viewport of [{ width: 1419, height: 872 }, { width: 1280, height: 660 }, { width: 1100, height: 560 }]) {
    await page.setViewportSize(viewport)
    await customize(page, 'mtg')
    await page.getByRole('button', { name: 'Split one copy' }).click()
    const groups = page.locator('.art-card')
    const original = await groups.nth(0).locator('.artwork-choice-summary strong').innerText()
    await groups.nth(1).getByRole('button', { name: 'Browse artwork gallery' }).click()
    const dialog = page.getByRole('dialog')
    const tiles = dialog.locator('.artwork-tile')
    await tiles.nth(1).click()
    const selection = dialog.locator('.artwork-browser-selection')
    const chosen = await selection.innerText()
    await tiles.nth(2).hover()
    assert.equal(await selection.innerText(), chosen, 'Hover must not replace the clicked choice')
    checks++
    await dialog.getByRole('textbox').fill('no-matching-artwork')
    await page.getByText('No artwork matches that search.').waitFor()
    assert.equal(await selection.innerText(), chosen, 'Searching must not replace the clicked choice')
    const accept = dialog.getByRole('button', { name: 'Use this artwork', exact: true })
    await insideViewport(page, accept)
    await accept.click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await groups.nth(0).locator('.artwork-choice-summary strong').innerText(), original)
    assert.match(await groups.nth(1).locator('.artwork-choice-summary strong').innerText(), /Doctor Who/)
    assert.equal(await groups.nth(0).locator('input').inputValue(), '5')
    assert.equal(await groups.nth(1).locator('input').inputValue(), '1')
    checks++

    // Keyboard selection, scroll independence, and Cancel/Escape rollback.
    await groups.nth(1).getByRole('button', { name: 'Browse artwork gallery' }).click()
    await tiles.nth(2).focus()
    await page.keyboard.press('Enter')
    await dialog.locator('.artwork-focus-preview').evaluate((element) => { element.scrollTop = element.scrollHeight })
    await insideViewport(page, accept)
    await accept.focus()
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'hidden' })
    assert.match(await groups.nth(1).locator('.artwork-choice-summary strong').innerText(), /Commander Masters/)
    checks++
    for (const action of ['Cancel', 'Escape']) {
      await groups.nth(1).getByRole('button', { name: 'Browse artwork gallery' }).click()
      await tiles.nth(3).click()
      if (action === 'Cancel') await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      else await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.match(await groups.nth(1).locator('.artwork-choice-summary strong').innerText(), /Commander Masters/)
      assert.equal(await page.locator('body').evaluate((element) => element.style.overflow), '')
      checks++
    }
    if (process.env.PROXY_GALLERY_SCREENSHOT && viewport.width === 1419) {
      await groups.nth(1).getByRole('button', { name: 'Browse artwork gallery' }).click()
      await page.screenshot({ path: process.env.PROXY_GALLERY_SCREENSHOT })
      await page.keyboard.press('Escape')
    }
  }

  // A loading/error banner must not push confirmation outside the small window.
  await customize(page, 'mtg')
  await page.evaluate(() => {
    (window as unknown as { riftboundStudio: RendererApi }).riftboundStudio.loadPrintings = async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 800))
      throw new Error('Fixture printing service unavailable')
    }
  })
  await page.getByRole('button', { name: 'Browse artwork gallery' }).click()
  const keep = page.getByRole('dialog').getByRole('button', { name: 'Keep this artwork' })
  await insideViewport(page, keep)
  await page.getByText(/Fixture printing service unavailable/).waitFor()
  await insideViewport(page, keep)
  await keep.click()

  await customize(page, 'riftbound')
  await page.getByRole('button', { name: 'Browse artwork gallery' }).click()
  await insideViewport(page, keep)
  await keep.click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [], 'The real renderer must not throw')
  console.log(`Artwork gallery: ${checks} checks passed (Magic/Riftbound, 3 window sizes, mouse/keyboard, split copies, search, Cancel/Escape, loading/error).`)
} finally {
  await browser?.close()
  await server.close()
}
