import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { ArtworkSourceResolver, SharpArtworkPipeline } from '../src/main/services/artwork-pipeline.js'
import { PrintPdfExporter } from '../src/main/services/pdf-exporter.js'
import { DEFAULT_MPC_SETTINGS, DEFAULT_PRINT_SETTINGS, PROJECT_SCHEMA_VERSION, type ProjectManifestV1 } from '../src/shared/contracts.js'
import { createPrintLayout } from '../src/shared/print-layout.js'

describe('artwork derivatives', () => {
  it('produces an exact opaque MPC canvas with edge bleed', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-images-'))
    const pipeline = new SharpArtworkPipeline(folder)
    const input = await sharp({ create: { width: 744, height: 1039, channels: 3, background: '#2ec4b6' } }).png().toBuffer()
    const result = await pipeline.createMpcDerivative('riftbound', 'test', input)
    expect([result.width, result.height]).toEqual([816, 1110])
    expect(result.sha1).toMatch(/^[A-F0-9]{40}$/)
    expect((await sharp(result.filePath).metadata()).hasAlpha).toBe(false)
  })

  it('fills transparent rounded corners without shrinking the complete face', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-transparent-'))
    const source = Buffer.from(`<svg width="744" height="1038" xmlns="http://www.w3.org/2000/svg">
      <rect width="744" height="1038" rx="34" fill="#087f76"/>
      <rect x="120" y="0" width="504" height="12" fill="#f04040"/>
      <rect x="120" y="1026" width="504" height="12" fill="#3857e8"/>
    </svg>`)
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('riftbound', 'transparent-card', new Uint8Array(source))
    const proof = await pipeline.createMpcPlacementProof('riftbound', result)
    const { data, info } = await sharp(result.filePath).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(proof).toMatchObject({
      width: 816,
      height: 1110,
      opaque: true,
      transparentPixels: 0,
      safeRect: { x: 72, y: 72, width: 672, height: 966 },
      sourceRect: { x: 36, y: 36, width: 744, height: 1038 },
      sourcePreserved: true,
      sourceContainedInSafeArea: false,
      placementVerified: true,
      edgeBleedVerified: true,
      nonEdgeBleedPixels: 0
    })
    expect(pixel(0, 0)).not.toEqual([255, 255, 255])
  })

  it('keeps every source edge inside trim without treating the safe guide as the card size', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-safe-edges-'))
    const source = Buffer.from(`<svg width="672" height="966" xmlns="http://www.w3.org/2000/svg">
      <rect width="672" height="966" fill="#18222c"/>
      <rect width="672" height="10" fill="#f02020"/>
      <rect y="956" width="672" height="10" fill="#2050f0"/>
      <rect width="10" height="966" fill="#20f050"/>
      <rect x="662" width="10" height="966" fill="#f0d020"/>
    </svg>`)
    const result = await new SharpArtworkPipeline(folder).createMpcDerivative('riftbound', 'safe-edge-card', new Uint8Array(source))
    const { data, info } = await sharp(result.filePath).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(result.sourceRect).toEqual({ x: 47, y: 36, width: 722, height: 1038 })
    expect(pixel(408, 36)[0]).toBeGreaterThan(200)
    expect(pixel(408, 1073)[2]).toBeGreaterThan(200)
    expect(pixel(47, 555)[1]).toBeGreaterThan(200)
    expect(pixel(768, 555)[0]).toBeGreaterThan(200)
    expect(pixel(768, 555)[1]).toBeGreaterThan(150)
  })

  it('uses full Riftbound trim with only one pixel of aspect-ratio padding', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-max-fit-'))
    const source = Buffer.from(`<svg width="744" height="1039" xmlns="http://www.w3.org/2000/svg">
      <rect width="744" height="1039" fill="#17232d"/>
      <rect width="744" height="8" fill="#f02020"/>
      <rect y="1031" width="744" height="8" fill="#2050f0"/>
      <rect width="8" height="1039" fill="#20f050"/>
      <rect x="736" width="8" height="1039" fill="#f0d020"/>
    </svg>`)
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('riftbound', 'riftbound-max-fit', new Uint8Array(source))
    const proof = await pipeline.createMpcPlacementProof('riftbound', result)
    expect(proof.sourceRect).toEqual({ x: 36, y: 36, width: 743, height: 1038 })
    expect(proof.sourceContainedInSafeArea).toBe(false)
    expect(proof.placementVerified).toBe(true)
    expect(proof.edgeBleedVerified).toBe(true)
    const rasterSource = await sharp(source).png().toBuffer()
    const expectedFace = await sharp(rasterSource).resize(744, 1038, { fit: 'inside', kernel: sharp.kernel.lanczos3 }).removeAlpha().png().toBuffer()
    const expectedUpload = await sharp(expectedFace).extend({ left: 36, top: 36, right: 37, bottom: 36, extendWith: 'copy' }).raw().toBuffer()
    expect((await sharp(result.filePath).raw().toBuffer()).equals(expectedUpload)).toBe(true)
  })

  it('rotates landscape images into portrait output', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-landscape-'))
    const input = await sharp({ create: { width: 1039, height: 744, channels: 3, background: '#ef8354' } }).png().toBuffer()
    const result = await new SharpArtworkPipeline(folder).createMpcDerivative('riftbound', 'landscape', input)
    expect(result.height).toBeGreaterThan(result.width)
  })

  it('uses the Traditional Poker 822x1122 profile for Magic artwork', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mtg-profile-'))
    const source = Buffer.from(`<svg width="745" height="1040" xmlns="http://www.w3.org/2000/svg"><rect width="745" height="1040" rx="32" fill="#17130f"/><rect x="18" y="18" width="709" height="1004" fill="none" stroke="#f0c860" stroke-width="8"/></svg>`)
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('mtg', 'scryfall-png', new Uint8Array(source))
    const proof = await pipeline.createMpcPlacementProof('mtg', result)
    const cutPreview = await pipeline.createMpcCutPreview('mtg', result)
    const expectedCutPixels = await sharp(result.filePath).extract({ left: 36, top: 36, width: 750, height: 1050 }).raw().toBuffer()
    expect((await sharp(cutPreview).metadata())).toMatchObject({ width: 750, height: 1050 })
    expect(await sharp(cutPreview).raw().toBuffer()).toEqual(expectedCutPixels)
    expect([result.width, result.height]).toEqual([822, 1122])
    expect(proof).toMatchObject({
      trimRect: { x: 36, y: 36, width: 750, height: 1050 },
      safeRect: { x: 72, y: 72, width: 678, height: 978 },
      sourceRect: { x: 36, y: 37, width: 750, height: 1047 },
      opaque: true,
      transparentPixels: 0,
      sourcePreserved: true,
      placementVerified: true
    })
  }, 15_000)

  it('fills Magic trim with the complete full-scale face and adds black bleed only outside it', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mtg-black-border-'))
    const source = Buffer.from(`<svg width="745" height="1040" xmlns="http://www.w3.org/2000/svg">
      <rect width="745" height="1040" fill="#18222c"/>
      <rect width="745" height="16" fill="#f02020"/>
      <rect y="1024" width="745" height="16" fill="#2050f0"/>
      <rect width="16" height="1040" fill="#20f050"/>
      <rect x="729" width="16" height="1040" fill="#f0d020"/>
    </svg>`)
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('mtg', 'edge-bands', new Uint8Array(source))
    const { data, info } = await sharp(result.filePath).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    const rect = result.sourceRect!
    let nonBlackPixels = 0
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) continue
        if (pixel(x, y).some((channel) => channel !== 0)) nonBlackPixels++
      }
    }
    expect(nonBlackPixels).toBe(0)
    const rasterSource = await sharp(source).png().toBuffer()
    const expectedTrim = await sharp(rasterSource).resize(750, 1050, { fit: 'contain', background: '#000000', kernel: sharp.kernel.lanczos3 }).flatten({ background: '#000000' }).removeAlpha().raw().toBuffer()
    const actualTrim = await sharp(result.filePath).extract({ left: 36, top: 36, width: 750, height: 1050 }).raw().toBuffer()
    expect(actualTrim.equals(expectedTrim)).toBe(true)
    expect(rect).toEqual({ x: 36, y: 37, width: 750, height: 1047 })
    expect(pixel(36, 500)[1]).toBeGreaterThan(200)
    expect(pixel(785, 500)[0]).toBeGreaterThan(200)
    expect(pixel(400, 37)[0]).toBeGreaterThan(200)
    expect(pixel(400, 1083)[2]).toBeGreaterThan(200)
    const proof = await pipeline.createMpcPlacementProof('mtg', result)
    expect(proof).toMatchObject({ borderTreatment: 'solid-black', blackBorderVerified: true, nonBlackBorderPixels: 0, placementVerified: true })
    expect(proof.sourceContainedInSafeArea).toBe(false)
    expect(proof.warnings.join(' ')).toContain('shifted physical cut')
  }, 15_000)

  it('flattens Magic transparent corners against black and blocks an unsafe cached upload', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mtg-cache-border-'))
    const source = await sharp(Buffer.from('<svg width="744" height="1040" xmlns="http://www.w3.org/2000/svg"><rect width="744" height="1040" rx="36" fill="#ebc270"/></svg>')).png().toBuffer()
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('mtg', 'rounded-corners', source)
    const rect = result.sourceRect!
    expect((await sharp(result.filePath).metadata()).hasAlpha).toBe(false)
    const corner = await sharp(result.filePath).extract({ left: rect.x, top: rect.y, width: 1, height: 1 }).raw().toBuffer()
    expect([...corner]).toEqual([0, 0, 0])
    const corrupt = await sharp(result.filePath).composite([{ input: await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffeebb' } }).png().toBuffer(), left: 0, top: 0 }]).removeAlpha().png().toBuffer()
    await writeFile(result.filePath, corrupt)
    expect(await pipeline.createMpcPlacementProof('mtg', result)).toMatchObject({ blackBorderVerified: false, nonBlackBorderPixels: 1, placementVerified: false })
    await expect(pipeline.createMpcDerivative('mtg', 'rounded-corners', source)).rejects.toThrow('Upload blocked')
  })

  it('fills the PDF trim with the full source and stretches its edge into bleed', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mtg-pdf-edge-'))
    const source = Buffer.from(`<svg width="745" height="1040" xmlns="http://www.w3.org/2000/svg"><rect width="745" height="1040" fill="#203040"/><rect width="745" height="15" fill="#ee4422"/><rect x="0" y="0" width="15" height="1040" fill="#33dd55"/></svg>`)
    const result = await new SharpArtworkPipeline(folder).createPdfDerivative('mtg', 'full-face', new Uint8Array(source), 1.5)
    const { data, info } = await sharp(result.filePath).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect([result.width, result.height]).toEqual([786, 1086])
    expect(result.sourceRect).toEqual({ x: 36, y: 36, width: 750, height: 1050 })
    expect(pixel(0, 500)).toEqual(pixel(18, 500))
    expect(pixel(400, 0)).toEqual(pixel(400, 18))
    expect(pixel(18, 500)[1]).toBeGreaterThan(150)
    expect(pixel(400, 18)[0]).toBeGreaterThan(150)
  })
})

describe('PDF export', () => {
  it('creates 3x3 duplex sheets with a mirrored back page', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-pdf-'))
    const image = new Uint8Array(await sharp({ create: { width: 744, height: 1039, channels: 3, background: '#264653' } }).png().toBuffer())
    const pipeline = new SharpArtworkPipeline(folder)
    const exporter = new PrintPdfExporter(pipeline, new ArtworkSourceResolver(folder))
    const destination = join(folder, 'print.pdf')
    const result = await exporter.export({
      manifest: manifest(10), destination,
      customAssets: { front: image, back: image }
    })
    expect(result).toMatchObject({ cards: 10, pages: 4, columns: 3, rows: 3 })
    const loaded = await PDFDocument.load(await import('node:fs/promises').then((fs) => fs.readFile(destination)))
    expect(loaded.getPageCount()).toBe(4)
    const [width, height] = loaded.getPage(0).getSize().width > 0
      ? [loaded.getPage(0).getSize().width, loaded.getPage(0).getSize().height]
      : [0, 0]
    expect(width).toBeCloseTo(612, 0)
    expect(height).toBeCloseTo(792, 0)
  })

  it('renders sheet guides and black gutters as immediate preview differences', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-preview-'))
    const image = new Uint8Array(await sharp({ create: { width: 744, height: 1038, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 0.85 } } }).png().toBuffer())
    const pipeline = new SharpArtworkPipeline(folder)
    const exporter = new PrintPdfExporter(pipeline, new ArtworkSourceResolver(folder))
    const withMarks = manifest(2)
    const withoutMarks = { ...withMarks, printSettings: { ...withMarks.printSettings, cropMarks: false } }
    const first = await exporter.renderPreview({ manifest: withMarks, pageIndex: 0, customAssets: { front: image, back: image } })
    const second = await exporter.renderPreview({ manifest: withoutMarks, pageIndex: 0, customAssets: { front: image, back: image } })
    const redGuides = await exporter.renderPreview({ manifest: { ...withMarks, printSettings: { ...withMarks.printSettings, cornerGuideColor: '#ff2222' } }, pageIndex: 0, customAssets: { front: image, back: image } })
    const insideGuides = await exporter.renderPreview({ manifest: { ...withMarks, printSettings: { ...withMarks.printSettings, cornerGuidePlacement: 'inside', cornerGuideSizeMm: 5 } }, pageIndex: 0, customAssets: { front: image, back: image } })
    const whiteGutters = await exporter.renderPreview({ manifest: { ...withMarks, printSettings: { ...withMarks.printSettings, blackGutters: false } }, pageIndex: 0, customAssets: { front: image, back: image } })
    expect(Buffer.compare(Buffer.from(first.png), Buffer.from(second.png))).not.toBe(0)
    expect(Buffer.compare(Buffer.from(first.png), Buffer.from(redGuides.png))).not.toBe(0)
    expect(Buffer.compare(Buffer.from(first.png), Buffer.from(insideGuides.png))).not.toBe(0)
    expect(Buffer.compare(Buffer.from(first.png), Buffer.from(whiteGutters.png))).not.toBe(0)
    expect(first).toMatchObject({ pageIndex: 0, columns: 3, rows: 3 })
  }, 20_000)
})

describe('shared print layout', () => {
  it('honors 2 mm bleed by reducing Letter output to 3x2', () => {
    const defaultLayout = createPrintLayout(9, { ...DEFAULT_PRINT_SETTINGS, bleedMm: 1.5 })
    const largerBleed = createPrintLayout(9, { ...DEFAULT_PRINT_SETTINGS, bleedMm: 2 })
    expect([defaultLayout.columns, defaultLayout.rows]).toEqual([3, 3])
    expect([largerBleed.columns, largerBleed.rows]).toEqual([3, 2])
    expect(largerBleed.warnings[0]).toContain('3×2')
  })

  it('runs black cut lines to the page edge without crossing artwork', () => {
    const layout = createPrintLayout(1, { ...DEFAULT_PRINT_SETTINGS, cropMarks: true })
    const page = layout.pages[0]!
    const slot = page.slots[0]!
    expect(page.cutLines.some((line) => line.y1 === 0 || line.y2 === layout.pageHeightMm)).toBe(true)
    expect(page.cutLines.some((line) => line.x1 === 0 || line.x2 === layout.pageWidthMm)).toBe(true)
    for (const line of page.cutLines) {
      const midpoint = { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 }
      const inside = midpoint.x > slot.bleedRect.x && midpoint.x < slot.bleedRect.x + slot.bleedRect.width
        && midpoint.y > slot.bleedRect.y && midpoint.y < slot.bleedRect.y + slot.bleedRect.height
      expect(inside).toBe(false)
    }
  })

  it('moves and resizes colored corner guides on both sides of trim', () => {
    const outside = createPrintLayout(1, { ...DEFAULT_PRINT_SETTINGS, cornerGuideSizeMm: 3, cornerGuidePlacement: 'outside' }).pages[0]!.slots[0]!
    const inside = createPrintLayout(1, { ...DEFAULT_PRINT_SETTINGS, cornerGuideSizeMm: 5, cornerGuidePlacement: 'inside' }).pages[0]!.slots[0]!
    expect(outside.guideLines).toHaveLength(8)
    expect(outside.guideLines[0]!.y1).toBeLessThan(outside.trimRect.y)
    expect(inside.guideLines[0]!.y1).toBeGreaterThan(inside.trimRect.y)
    expect(Math.abs(outside.guideLines[0]!.x2 - outside.guideLines[0]!.x1)).toBe(3)
    expect(Math.abs(inside.guideLines[0]!.x2 - inside.guideLines[0]!.x1)).toBe(5)
  })

  it('mirrors duplex backs and keeps guides attached to each card', () => {
    const layout = createPrintLayout(4, { ...DEFAULT_PRINT_SETTINGS, mode: 'duplex' })
    const front = layout.pages[0]!
    const back = layout.pages[1]!
    expect(front.slots.map((slot) => slot.column)).toEqual([0, 1, 2, 0])
    expect(back.slots.map((slot) => slot.column)).toEqual([2, 1, 0, 2])
    expect(back.slots.every((slot) => slot.guideLines.length === 8)).toBe(true)
    expect(back.cutLines.length).toBeGreaterThan(0)
  })
})

function manifest(quantity: number): ProjectManifestV1 {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    game: 'riftbound',
    projectId: '22222222-2222-4222-8222-222222222222', title: 'PDF Test', createdAt: now, updatedAt: now,
    decks: [{ id: 'deck', title: 'PDF Test', entries: [{ id: 'entry', rawName: 'Test', quantity, section: 'main', resolvedCardId: 'test', candidateCardIds: ['test'], resolution: 'resolved', allocations: [{ id: 'allocation', quantity, front: { kind: 'custom', assetId: 'front', archivePath: 'assets/front.png', displayName: 'Front' } }] }] }],
    globalBack: { kind: 'custom', assetId: 'back', archivePath: 'assets/back.png', displayName: 'Back' },
    printSettings: { ...DEFAULT_PRINT_SETTINGS, mode: 'duplex' },
    mpcSettings: { ...DEFAULT_MPC_SETTINGS }
  }
}
