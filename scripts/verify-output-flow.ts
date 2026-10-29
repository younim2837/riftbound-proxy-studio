import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Page } from 'playwright-core'
import type { GameId, MpcAutomationRequest, PdfExportRequest, ProjectDocument, RendererApi } from '../src/shared/contracts.js'

// Real React UI, offline fixture catalog, and captured IPC calls. This never
// opens MPC, orders cards, exports files, or reads/writes a user's projects.
type Probe = {
  previewCalls: number
  proofCalls: number
  cancelCalls: number
  mpcRequests: MpcAutomationRequest[]
  pdfRequests: PdfExportRequest[]
  saved: ProjectDocument | null
  finishMpc?: () => void
}
type TestWindow = { riftboundStudio: RendererApi; outputFlowProbe: Probe }

const server = await createServer({ configFile: false, root: resolve('src/renderer'), plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const address = server.httpServer!.address()
assert(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}/?browserPreview`
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let checks = 0

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as TestWindow).outputFlowProbe
    return { previewCalls: probe.previewCalls, proofCalls: probe.proofCalls, cancelCalls: probe.cancelCalls, mpcRequests: probe.mpcRequests, pdfRequests: probe.pdfRequests, saved: probe.saved }
  })
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as unknown as TestWindow
    const api = testWindow.riftboundStudio
    const probe: Probe = { previewCalls: 0, proofCalls: 0, cancelCalls: 0, mpcRequests: [], pdfRequests: [], saved: null }
    testWindow.outputFlowProbe = probe
    const renderPreview = api.renderPrintPreview
    api.renderPrintPreview = async (request) => { probe.previewCalls++; return renderPreview(request) }
    api.renderMpcProof = async () => { probe.proofCalls++; throw new Error('The UI must not render MPC proofs') }
    api.startMpcAutomation = async (request) => {
      probe.mpcRequests.push(structuredClone(request))
      await new Promise<void>((resolve) => { probe.finishMpc = resolve })
    }
    api.cancelMpcAutomation = async () => { probe.cancelCalls++; probe.finishMpc?.() }
    api.exportPdf = async (request) => {
      probe.pdfRequests.push(structuredClone(request))
      return { destination: 'fixture.pdf', cards: 3, pages: 2, columns: 3, rows: 3, warnings: [] }
    }
    api.saveProject = async (document) => { probe.saved = structuredClone(document); return { filePath: 'fixture.proxyproject' } }
    api.openProject = async () => probe.saved ? structuredClone(probe.saved) : null
  })
}

async function capture(page: Page, name: string): Promise<void> {
  if (!process.env.PROXY_FLOW_SCREENSHOTS) return
  await mkdir(process.env.PROXY_FLOW_SCREENSHOTS, { recursive: true })
  await page.locator('.panel').evaluate(async (panel) => {
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.screenshot({ path: join(process.env.PROXY_FLOW_SCREENSHOTS, `${name}.png`), fullPage: true })
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  for (const game of ['mtg', 'riftbound'] as GameId[]) {
    await page.goto(url)
    await page.locator('textarea').waitFor()
    if (game === 'mtg') await page.getByRole('button', { name: /Magic: The Gathering/ }).click()
    await installProbe(page)
    await page.locator('textarea').fill(game === 'mtg' ? '2 Sol Ring' : '2 Charm')
    await page.getByRole('button', { name: 'Import and resolve cards' }).click()
    await page.getByRole('button', { name: 'Continue to artwork' }).click()
    await page.getByRole('button', { name: /Add deck/ }).click()
    await page.locator('textarea').fill(game === 'mtg' ? '1 Swords to Plowshares' : '1 Disarming Rake')
    await page.getByRole('button', { name: 'Add and resolve deck' }).click()
    await page.getByRole('button', { name: 'Continue to artwork' }).click()
    await page.getByRole('button', { name: 'Choose how to make proxies' }).click()
    await page.getByRole('heading', { name: 'How do you want to make your proxies?' }).waitFor()
    assert.equal(await page.locator('.stepper .step').count(), 4)
    assert.equal((await snapshot(page)).previewCalls, 0)
    assert.equal((await snapshot(page)).proofCalls, 0)
    checks++
    await capture(page, `${game}-choose-output`)

    await page.getByRole('button', { name: /Set up MPC/ }).click()
    await page.getByRole('heading', { name: 'MakePlayingCards setup' }).waitFor()
    assert.equal(await page.getByLabel('Page size').count(), 0)
    assert.equal(await page.getByText('MPC placement proof', { exact: true }).count(), 0)
    assert.equal(await page.locator('.stepper .step').count(), 5)
    const start = page.getByRole('button', { name: /Begin MPC flow/ })
    for (const stock of ['S30', 'S33', 'A35']) {
      await page.getByRole('radio', { name: new RegExp(stock) }).check()
      await start.click()
      await page.getByRole('button', { name: 'Cancel automation' }).waitFor()
      assert.equal(await page.getByRole('button', { name: /Change output/ }).isDisabled(), true)
      assert.equal(await page.getByRole('radio', { name: /S30/ }).isDisabled(), true)
      const state = await snapshot(page)
      const request = state.mpcRequests.at(-1)!
      assert.equal(request.manifest.mpcSettings.stock, stock)
      assert.equal(request.manifest.game, game)
      assert.equal(request.manifest.decks.length, 2)
      assert.equal(request.manifest.decks.flatMap((deck) => deck.entries).reduce((sum, entry) => sum + entry.quantity, 0), 3)
      assert.equal(state.previewCalls, 0, 'MPC-only flow must never request print previews')
      assert.equal(state.pdfRequests.length, 0)
      await page.getByRole('button', { name: 'Cancel automation' }).click()
      await start.waitFor()
      assert.equal(await start.isEnabled(), true)
      checks++
    }
    assert.equal((await snapshot(page)).cancelCalls, 3)
    await page.getByRole('radio', { name: /S33/ }).check()
    await capture(page, `${game}-mpc`)
    await page.getByRole('button', { name: /Change output/ }).click()
    await page.getByRole('button', { name: /Set up printing/ }).click()
    await page.getByRole('heading', { name: 'Set up printed proxies' }).waitFor()
    await page.getByRole('img', { name: /Print preview page/ }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'MPC card stock' }).count(), 0)
    assert.equal(await start.count(), 0)
    await page.getByLabel('Page size').selectOption('a4')
    await page.getByLabel('Print mode').selectOption('duplex')
    await page.getByLabel('Bleed in millimeters').fill('2')
    await page.getByLabel('Inside trim', { exact: true }).check()
    await page.getByLabel('Black cut lines to page edge').uncheck()
    await capture(page, `${game}-print`)
    await page.getByRole('button', { name: 'Export print-ready PDF' }).click()
    await page.getByText(/PDF exported: 3 cards/).waitFor()
    const printed = await snapshot(page)
    const pdf = printed.pdfRequests.at(-1)!
    assert.equal(pdf.manifest.game, game)
    assert.equal(pdf.manifest.decks.length, 2)
    assert.equal(pdf.manifest.printSettings.pageSize, 'a4')
    assert.equal(pdf.manifest.printSettings.mode, 'duplex')
    assert.equal(pdf.manifest.printSettings.bleedMm, 2)
    assert.equal(pdf.manifest.printSettings.cornerGuidePlacement, 'inside')
    assert.equal(pdf.manifest.printSettings.cropMarks, false)
    assert.equal(pdf.manifest.mpcSettings.stock, 'S33', 'PDF changes must preserve MPC stock')
    assert.equal(printed.mpcRequests.length, 3, 'PDF path must not launch MPC')
    assert.equal(printed.proofCalls, 0)
    checks++

    // Save/reopen keeps both settings, not the old combined Review/Export flow.
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Portable project saved.').waitFor()
    await page.getByRole('button', { name: 'Open project', exact: true }).click()
    await page.getByRole('button', { name: 'Continue to artwork' }).click()
    await page.getByRole('button', { name: 'Choose how to make proxies' }).click()
    assert.equal(await page.locator('.stepper .step').count(), 4)
    await page.getByRole('button', { name: /Set up MPC/ }).click()
    assert.equal(await page.getByRole('radio', { name: /S33/ }).isChecked(), true)
    await page.getByRole('button', { name: /Change output/ }).click()
    await page.getByRole('button', { name: /Set up printing/ }).click()
    assert.equal(await page.getByLabel('Page size').inputValue(), 'a4')
    assert.equal(await page.getByLabel('Bleed in millimeters').inputValue(), '2')
    checks++

    // Unresolved cards in any deck must block both output actions.
    await page.evaluate(() => {
      const saved = (window as unknown as TestWindow).outputFlowProbe.saved!
      saved.manifest.decks[0]!.entries[0]!.resolution = 'missing'
    })
    await page.getByRole('button', { name: 'Open project', exact: true }).click()
    await page.locator('.stepper').getByRole('button', { name: /Output/ }).click()
    await page.getByRole('button', { name: /Set up MPC/ }).click()
    assert.equal(await start.isDisabled(), true)
    await page.getByRole('button', { name: /Change output/ }).click()
    await page.getByRole('button', { name: /Set up printing/ }).click()
    assert.equal(await page.getByRole('button', { name: 'Export print-ready PDF' }).isDisabled(), true)
    checks++

    // A fresh PDF-only project must not touch either MPC endpoint at all.
    await page.goto(url)
    await page.locator('textarea').waitFor()
    if (game === 'mtg') await page.getByRole('button', { name: /Magic: The Gathering/ }).click()
    await installProbe(page)
    await page.locator('textarea').fill(game === 'mtg' ? '3 Sol Ring' : '3 Charm')
    await page.getByRole('button', { name: 'Import and resolve cards' }).click()
    await page.getByRole('button', { name: 'Continue to artwork' }).click()
    await page.getByRole('button', { name: 'Choose how to make proxies' }).click()
    await page.getByRole('button', { name: /Set up printing/ }).click()
    await page.getByRole('img', { name: /Print preview page/ }).waitFor()
    await page.getByRole('button', { name: 'Export print-ready PDF' }).click()
    await page.getByText(/PDF exported: 3 cards/).waitFor()
    const pdfOnly = await snapshot(page)
    assert.equal(pdfOnly.pdfRequests.length, 1)
    assert.equal(pdfOnly.mpcRequests.length, 0)
    assert.equal(pdfOnly.proofCalls, 0)
    checks++
  }
  assert.deepEqual(errors, [])
  console.log(`Output flow: ${checks} scenario checks passed (both games, separate MPC/PDF paths, all stocks, no unwanted previews, two decks, cancellation, save/reopen, unresolved gates).`)
} finally {
  await browser?.close()
  await server.close()
}
