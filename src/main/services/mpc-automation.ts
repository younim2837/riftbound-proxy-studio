import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright-core'
import type {
  ArtworkSelection,
  MpcAutomationEvent,
  MpcAutomationRequest,
  MpcAutomationStage,
  ProjectManifest
} from '../../shared/contracts.js'
import { MAX_MPC_CARDS } from '../../shared/contracts.js'
import { expandProjectCopies, projectCardCount, unresolvedEntryCount } from '../../shared/project-copies.js'
import { projectManifestSchema } from '../../shared/schemas.js'
import type { MpcAutomationDriver } from './interfaces.js'
import { ArtworkSourceResolver, SharpArtworkPipeline } from './artwork-pipeline.js'

const MPC_START_URL = 'https://www.makeplayingcards.com/design/custom-blank-card.html'
const MPC_ACCEPT_URL = 'https://www.makeplayingcards.com/products/pro_item_process_flow.aspx'

interface FaceJob {
  mpcPid?: string
  filePath: string
  slots: number[]
}

export class PlaywrightMpcAutomationDriver implements MpcAutomationDriver {
  private context: BrowserContext | null = null
  private cancelled = false
  private currentStage: MpcAutomationStage = 'idle'

  constructor(
    private readonly cacheDirectory: string,
    private readonly pipeline: SharpArtworkPipeline,
    private readonly resolver: ArtworkSourceResolver
  ) {}

  async run(
    request: MpcAutomationRequest,
    onProgress: (event: MpcAutomationEvent) => void
  ): Promise<void> {
    if (this.context && (this.currentStage === 'failed' || this.currentStage === 'cancelled')) {
      await this.context.close().catch(() => undefined)
      this.context = null
    }
    if (this.context) throw new Error('MPC automation is already running or its review browser is still open.')
    this.cancelled = false
    const emit = (stage: MpcAutomationStage, message: string, completed = 0, total = 0): void => {
      this.currentStage = stage
      onProgress({ stage, message, completed, total, timestamp: new Date().toISOString() })
      void this.saveCheckpoint(stage, message)
    }

    try {
      emit('preflight', 'Preparing print-safe images…')
      const manifest = projectManifestSchema.parse(request.manifest) as unknown as ProjectManifest
      const count = projectCardCount(manifest)
      if (count < 1) throw new Error('The project has no cards.')
      if (count > MAX_MPC_CARDS) throw new Error(`MPC projects are limited to ${MAX_MPC_CARDS} cards.`)
      if (unresolvedEntryCount(manifest) > 0) {
        throw new Error('Every card must be resolved and have front artwork before MPC automation starts.')
      }
      if (expandProjectCopies(manifest).some((copy) => !copy.back)) {
        throw new Error('Choose a card back for every card before MPC automation starts.')
      }
      const fronts = await this.buildFaceJobs(manifest, request.customAssets, 'front')
      const backs = await this.buildFaceJobs(manifest, request.customAssets, 'back')
      if (backs.length === 0) throw new Error('Choose a card back before MPC automation starts.')
      this.assertNotCancelled()

      emit('launching', 'Opening a dedicated Chrome window…')
      this.context = await chromium.launchPersistentContext(join(this.cacheDirectory, 'mpc-browser-profile'), {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1200, height: 900 },
        args: ['--disable-features=Translate']
      })
      const page = this.context.pages()[0] ?? (await this.context.newPage())
      page.on('dialog', (dialog) => void dialog.accept())
      await page.goto(MPC_START_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      this.assertNotCancelled()

      emit('configuring-project', 'Selecting 63×88 mm, A35, non-foil settings…')
      await this.configureProject(page, count)
      let editorFrame = await this.openFrontEditor(page, count)

      emit('uploading-fronts', 'Uploading front images…', 0, fronts.length)
      await this.uploadJobs(editorFrame, fronts, 'uploading-fronts', emit)
      emit('assigning-fronts', 'Assigning fronts to card slots…', 0, count)
      await this.assignJobs(editorFrame, fronts, 'assigning-fronts', emit)
      await assertNoMpcPlacementWarnings(editorFrame)
      await this.captureProof(page, 'front-editor')

      emit('uploading-backs', 'Opening the card-back editor…')
      editorFrame = await this.openBackEditor(page, backs.length === 1)
      const optimizedBacks = backs.length === 1 ? [{ ...backs[0]!, slots: [0] }] : backs
      emit('uploading-backs', 'Uploading back images…', 0, optimizedBacks.length)
      await this.uploadJobs(editorFrame, optimizedBacks, 'uploading-backs', emit)
      emit('assigning-backs', 'Assigning backs to card slots…', 0, count)
      await this.assignJobs(editorFrame, optimizedBacks, 'assigning-backs', emit)
      await assertNoMpcPlacementWarnings(editorFrame)
      await this.captureProof(page, 'back-editor')

      emit('opening-review', 'Opening MPC review…')
      await advanceToUrl(page, /\/dn_texteditor_back\.aspx/i, 'back text editor')
      await advanceToUrl(page, /\/dn_preview_layout\.aspx/i, 'review screen')
      await waitForReviewCardImages(page, count)
      await this.captureProof(page, 'final-review')
      emit('complete', 'MPC is ready for your review. Checkout remains manual.', count, count)
    } catch (error) {
      if (this.cancelled) {
        emit('cancelled', 'MPC automation was cancelled.')
      } else {
        const message = error instanceof Error ? error.message : String(error)
        emit('failed', message)
        await this.captureDiagnostics(message)
        throw error
      }
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    await this.context?.close()
    this.context = null
  }

  private async configureProject(page: Page, count: number): Promise<void> {
    await page.locator('#dro_paper_type').waitFor({ state: 'attached', timeout: 30_000 })
    await selectOptionContaining(page, '#dro_paper_type', 'A35')
    await selectQuantityBracket(page, '#dro_choosesize', count)
    const finish = page.locator('#dro_product_effect')
    if (await finish.count()) {
      const options = await finish.locator('option').allTextContents()
      const nonFoil = options.find((value) => /normal|standard|full color|non.?foil/i.test(value))
      if (nonFoil) await finish.selectOption({ label: nonFoil })
    }
  }

  private async openFrontEditor(page: Page, count: number): Promise<Frame> {
    await waitForGlobal(page, 'doPersonalize')
    await page.evaluate((url) => {
      const scope = globalThis as unknown as { doPersonalize: (target: string) => void }
      scope.doPersonalize(url)
    }, MPC_ACCEPT_URL)
    const frame = await waitForEditorFrame(page)
    const quantity = frame.locator('#txt_card_number')
    await quantity.waitFor({ state: 'attached', timeout: 45_000 })
    await quantity.fill(String(count))
    await setImageMode(frame, false)
    return waitForDesignFrame(page)
  }

  private async openBackEditor(page: Page, sameBack: boolean): Promise<Frame> {
    await advanceToUrl(page, /\/dn_texteditor_front\.aspx/i, 'front text editor')
    const close = page.locator('#closeBtn')
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined)
    await advanceToUrl(page, /\/dn_playingcards_back_dynamic\.aspx/i, 'back image editor')
    const frame = await waitForEditorFrame(page)
    await setImageMode(frame, sameBack)
    return waitForDesignFrame(page)
  }

  private async uploadJobs(
    frame: Frame,
    jobs: FaceJob[],
    stage: MpcAutomationStage,
    emit: (stage: MpcAutomationStage, message: string, completed?: number, total?: number) => void
  ): Promise<void> {
    const input = frame.locator('#uploadId')
    await input.waitFor({ state: 'attached', timeout: 30_000 })
    for (const [index, job] of jobs.entries()) {
      this.assertNotCancelled()
      if (!job.mpcPid) {
        for (let attempt = 1; attempt <= 3 && !job.mpcPid; attempt++) {
          const before = await getUploadedPids(frame)
          try {
            await waitForUploadIdle(frame)
            await input.setInputFiles(job.filePath)
            job.mpcPid = await waitForNewUploadedPid(frame, before)
          } catch (error) {
            if (attempt === 3) {
              const detail = error instanceof Error ? ` ${error.message}` : ''
              throw new Error(`MPC rejected an image after 3 attempts: ${job.filePath}.${detail}`)
            }
          }
        }
      }
      emit(stage, `Uploaded ${index + 1} of ${jobs.length} unique images`, index + 1, jobs.length)
    }
  }

  private async assignJobs(
    frame: Frame,
    jobs: FaceJob[],
    stage: MpcAutomationStage,
    emit: (stage: MpcAutomationStage, message: string, completed?: number, total?: number) => void
  ): Promise<void> {
    const total = jobs.reduce((sum, job) => sum + job.slots.length, 0)
    let completed = 0
    await frame.waitForFunction(() => {
      const scope = globalThis as unknown as { PageLayout?: { prototype?: { applyDragPhoto?: unknown } } }
      return typeof scope.PageLayout?.prototype?.applyDragPhoto === 'function'
    }, undefined, { timeout: 30_000 })

    for (const job of jobs) {
      if (!job.mpcPid) throw new Error(`MPC did not return an image ID for ${job.filePath}.`)
      for (const slot of job.slots) {
        this.assertNotCancelled()
        let assigned = false
        for (let attempt = 1; attempt <= 3 && !assigned; attempt++) {
          await frame.evaluate(({ slotIndex, pid }) => {
            const scope = globalThis as unknown as {
              PageLayout: {
                prototype: {
                  getElement3: (kind: string, slot: string) => Element | null
                  applyDragPhoto: (element: Element, index: number, imagePid: string) => void
                }
              }
            }
            const element = scope.PageLayout.prototype.getElement3('dnImg', String(slotIndex))
            if (!element) throw new Error(`MPC card slot ${slotIndex + 1} is unavailable.`)
            if (element.getAttribute('pid') !== pid) {
              scope.PageLayout.prototype.applyDragPhoto(element, 0, pid)
            }
          }, { slotIndex: slot, pid: job.mpcPid })
          assigned = await waitForAssignedPid(frame, slot, job.mpcPid)
        }
        if (!assigned) throw new Error(`MPC did not accept artwork for card slot ${slot + 1} after 3 attempts.`)
        completed++
        emit(stage, `Assigned ${completed} of ${total} slots`, completed, total)
      }
    }
  }

  private async buildFaceJobs(
    manifest: ProjectManifest,
    customAssets: Record<string, Uint8Array>,
    face: 'front' | 'back'
  ): Promise<FaceJob[]> {
    const jobs = new Map<string, FaceJob>()
    for (const [slot, copy] of expandProjectCopies(manifest).entries()) {
      const selection = face === 'front' ? copy.front : copy.back
      if (!selection) continue
      const source = await this.resolver.load(selection, customAssets)
      const derivative = await this.pipeline.createMpcDerivative(source.sourceId, source.bytes)
      const current = jobs.get(derivative.sha1)
      if (current) current.slots.push(slot)
      else jobs.set(derivative.sha1, { filePath: derivative.filePath, slots: [slot] })
    }
    return [...jobs.values()]
  }

  private assertNotCancelled(): void {
    if (this.cancelled) throw new Error('Cancelled')
  }

  private async saveCheckpoint(stage: MpcAutomationStage, message: string): Promise<void> {
    const folder = join(this.cacheDirectory, 'automation')
    await mkdir(folder, { recursive: true })
    await writeFile(
      join(folder, 'last-checkpoint.json'),
      JSON.stringify({ stage, message, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    )
  }

  private async captureDiagnostics(message: string): Promise<void> {
    const folder = join(this.cacheDirectory, 'automation', 'diagnostics')
    await mkdir(folder, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const page = this.context?.pages()[0]
    if (page) await page.screenshot({ path: join(folder, `${stamp}.png`), fullPage: true }).catch(() => undefined)
    await writeFile(
      join(folder, `${stamp}.json`),
      JSON.stringify({ stage: this.currentStage, message, url: page?.url(), timestamp: new Date().toISOString() }, null, 2),
      'utf8'
    )
  }

  private async captureProof(page: Page, stage: string): Promise<void> {
    const folder = join(this.cacheDirectory, 'automation', 'proofs')
    await mkdir(folder, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    await page.screenshot({ path: join(folder, `${stamp}-${stage}.png`), fullPage: true }).catch(() => undefined)
  }
}

async function selectOptionContaining(page: Page, selector: string, text: string): Promise<void> {
  const select = page.locator(selector)
  const options = await select.locator('option').allTextContents()
  const label = options.find((option) => option.toUpperCase().includes(text.toUpperCase()))
  if (!label) throw new Error(`MPC no longer offers the required ${text} option.`)
  await select.selectOption({ label })
}

async function selectQuantityBracket(page: Page, selector: string, count: number): Promise<void> {
  const select = page.locator(selector)
  const options = await select.locator('option').evaluateAll((nodes) =>
    nodes.map((node) => ({ label: node.textContent?.trim() ?? '', value: (node as HTMLOptionElement).value }))
  )
  const parsed = options
    .map((option) => ({ ...option, maximum: Math.max(...(option.label.match(/\d+/g)?.map(Number) ?? [-1])) }))
    .filter((option) => option.maximum >= count)
    .sort((left, right) => left.maximum - right.maximum)[0]
  if (!parsed) throw new Error(`MPC does not expose a quantity bracket for ${count} cards.`)
  await select.selectOption(parsed.value)
}

async function advanceToUrl(page: Page, target: RegExp, label: string): Promise<void> {
  if (target.test(page.url())) return
  for (let attempt = 1; attempt <= 3; attempt++) {
    await callGlobal(page, 'oDesign.setNextStep()')
    const reached = await page.waitForURL((url) => target.test(url.toString()), {
      timeout: 30_000,
      waitUntil: 'domcontentloaded'
    }).then(() => true, () => false)
    if (reached) {
      await waitForMpc(page)
      return
    }
  }
  throw new Error(`MPC did not advance to its ${label} after 3 attempts.`)
}

async function waitForGlobal(page: Page, name: string): Promise<void> {
  await page.waitForFunction((globalName) => typeof (globalThis as Record<string, unknown>)[globalName] === 'function', name, { timeout: 30_000 })
}

async function callGlobal(page: Page, expression: string): Promise<void> {
  const root = expression.split('.')[0]!
  await page.waitForFunction((name) => Boolean((globalThis as Record<string, unknown>)[name]), root, { timeout: 30_000 })
  await page.evaluate((source) => Function(source)(), expression)
}

async function waitForEditorFrame(page: Page): Promise<Frame> {
  const handle = await page.locator('iframe#sysifm_loginFrame, iframe[name="sysifm_loginFrame"]').elementHandle({ timeout: 45_000 })
  const frame = await handle?.contentFrame()
  if (!frame) throw new Error('MPC editor frame did not load.')
  return frame
}

async function waitForDesignFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const hasUploadInput = await frame.locator('#uploadId').count().catch(() => 0)
      if (!hasUploadInput) continue
      try {
        await frame.waitForFunction(() => {
          const scope = globalThis as unknown as { PageLayout?: { prototype?: { applyDragPhoto?: unknown } } }
          return typeof scope.PageLayout?.prototype?.applyDragPhoto === 'function'
        }, undefined, { timeout: 5_000 })
        return frame
      } catch {
        // MPC may still be replacing the setup iframe with its dynamic editor.
      }
    }
    await page.waitForTimeout(250)
  }
  throw new Error('MPC image editor did not become ready after selecting an image mode.')
}

async function setImageMode(frame: Frame, sameImage: boolean): Promise<void> {
  await frame.waitForFunction(() => typeof (globalThis as unknown as { setMode?: unknown }).setMode === 'function', undefined, { timeout: 30_000 })
  await frame.evaluate((same) => {
    const scope = globalThis as unknown as { setMode: (mode: string, value: number) => void }
    scope.setMode('ImageText', same ? 1 : 0)
  }, sameImage)
}

async function getUploadedPids(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => {
    const scope = globalThis as unknown as { oDesignImage?: { dn_getImageList?: () => string } }
    const value = scope.oDesignImage?.dn_getImageList?.() ?? ''
    return value ? value.split(';').filter(Boolean) : []
  })
}

async function waitForNewUploadedPid(frame: Frame, previousPids: string[]): Promise<string> {
  const handle = await frame.waitForFunction((previous) => {
    const scope = globalThis as unknown as { oDesignImage?: { dn_getImageList?: () => string } }
    const value = scope.oDesignImage?.dn_getImageList?.() ?? ''
    const newPid = value.split(';').filter(Boolean).find((pid) => !previous.includes(pid))
    return newPid || false
  }, previousPids, { timeout: 90_000, polling: 250 })
  const pid = await handle.jsonValue()
  if (typeof pid !== 'string' || !pid) throw new Error('MPC completed the upload without returning an image ID.')
  return pid
}

async function waitForUploadIdle(frame: Frame): Promise<void> {
  await frame.waitForFunction(() => {
    const scope = globalThis as unknown as { oDesignImage?: { UploadStatus?: string } }
    return scope.oDesignImage?.UploadStatus !== 'Uploading'
  }, undefined, { timeout: 90_000 })
}

async function waitForMpc(page: Page): Promise<void> {
  const wait = page.locator('#sysdiv_wait')
  if (await wait.count()) await wait.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(400)
}

async function waitForAssignedPid(frame: Frame, slot: number, pid: string): Promise<boolean> {
  return frame.waitForFunction(({ slotIndex, imagePid }) => {
    const scope = globalThis as unknown as {
      PageLayout?: { prototype?: { getElement3?: (kind: string, slot: string) => Element | null } }
    }
    const element = scope.PageLayout?.prototype?.getElement3?.('dnImg', String(slotIndex))
    return element?.getAttribute('pid') === imagePid
  }, { slotIndex: slot, imagePid: pid }, { timeout: 15_000, polling: 200 }).then(() => true, () => false)
}

async function assertNoMpcPlacementWarnings(frame: Frame): Promise<void> {
  const warnings = await frame.evaluate(() => {
    const pattern = /low.?resolution|image.{0,20}(?:too small|does not cover|outside)|blank area|poor quality/i
    return [...document.querySelectorAll<HTMLElement>('[class*="warn" i], [class*="error" i], [id*="warn" i], [id*="error" i]')]
      .filter((element) => element.getClientRects().length > 0 && pattern.test(element.innerText))
      .map((element) => element.innerText.trim().replaceAll(/\s+/g, ' ').slice(0, 240))
      .filter(Boolean)
  })
  if (warnings.length > 0) throw new Error(`MPC reported a placement warning: ${warnings.join(' | ')}`)
}

async function waitForReviewCardImages(page: Page, cardCount: number): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForFunction((expectedImages) => {
    const portraitImages = [...document.images].filter((image) => {
      const bounds = image.getBoundingClientRect()
      return (
        image.complete &&
        image.naturalWidth > 0 &&
        bounds.width >= 45 &&
        bounds.width <= 200 &&
        bounds.height >= 65 &&
        bounds.height <= 300 &&
        bounds.height > bounds.width * 1.15
      )
    })
    return portraitImages.length >= expectedImages
  }, cardCount * 2, { timeout: 30_000 })
  await page.waitForTimeout(1_500)
}
