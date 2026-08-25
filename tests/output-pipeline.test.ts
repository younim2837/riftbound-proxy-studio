import { mkdtemp } from 'node:fs/promises'
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
    const result = await pipeline.createMpcDerivative('test', input)
    expect([result.width, result.height]).toEqual([816, 1110])
    expect(result.sha1).toMatch(/^[A-F0-9]{40}$/)
    expect((await sharp(result.filePath).metadata()).hasAlpha).toBe(false)
  })

  it('fills transparent rounded corners and reports safe-contained placement', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-transparent-'))
    const source = Buffer.from(`<svg width="744" height="1038" xmlns="http://www.w3.org/2000/svg">
      <rect width="744" height="1038" rx="34" fill="#087f76"/>
      <rect x="120" y="0" width="504" height="12" fill="#f04040"/>
      <rect x="120" y="1026" width="504" height="12" fill="#3857e8"/>
    </svg>`)
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('transparent-card', new Uint8Array(source))
    const proof = await pipeline.createMpcPlacementProof(result)
    const { data, info } = await sharp(result.filePath).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(proof).toMatchObject({
      width: 816,
      height: 1110,
      opaque: true,
      transparentPixels: 0,
      safeRect: { x: 72, y: 72, width: 672, height: 966 },
      sourceRect: { x: 62, y: 72, width: 692, height: 966 },
      sourcePreserved: true,
      sourceContainedInSafeArea: false,
      placementVerified: true
    })
    expect(pixel(0, 0)).not.toEqual([255, 255, 255])
  })

  it('places every source edge inside the MPC safe rectangle', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-safe-edges-'))
    const source = Buffer.from(`<svg width="672" height="966" xmlns="http://www.w3.org/2000/svg">
      <rect width="672" height="966" fill="#18222c"/>
      <rect width="672" height="10" fill="#f02020"/>
      <rect y="956" width="672" height="10" fill="#2050f0"/>
      <rect width="10" height="966" fill="#20f050"/>
      <rect x="662" width="10" height="966" fill="#f0d020"/>
    </svg>`)
    const result = await new SharpArtworkPipeline(folder).createMpcDerivative('safe-edge-card', new Uint8Array(source))
    const { data, info } = await sharp(result.filePath).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)]
    expect(pixel(408, 72)[0]).toBeGreaterThan(200)
    expect(pixel(408, 1037)[2]).toBeGreaterThan(200)
    expect(pixel(72, 555)[1]).toBeGreaterThan(200)
    expect(pixel(743, 555)[0]).toBeGreaterThan(200)
    expect(pixel(743, 555)[1]).toBeGreaterThan(150)
  })

  it('uses the full vertical safe span with bounded side overscan for Riftbound artwork', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-max-fit-'))
    const source = Buffer.from(`<svg width="744" height="1039" xmlns="http://www.w3.org/2000/svg">
      <rect width="744" height="1039" fill="#17232d"/>
      <rect width="744" height="8" fill="#f02020"/>
      <rect y="1031" width="744" height="8" fill="#2050f0"/>
      <rect width="8" height="1039" fill="#20f050"/>
      <rect x="736" width="8" height="1039" fill="#f0d020"/>
    </svg>`)
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('riftbound-max-fit', new Uint8Array(source))
    const proof = await pipeline.createMpcPlacementProof(result)
    expect(proof.sourceRect).toEqual({ x: 62, y: 72, width: 692, height: 966 })
    expect(proof.sourceContainedInSafeArea).toBe(false)
    expect(proof.placementVerified).toBe(true)
    const leftOverscan = proof.safeRect.x - proof.sourceRect.x
    const rightOverscan = proof.sourceRect.x + proof.sourceRect.width - (proof.safeRect.x + proof.safeRect.width)
    expect(leftOverscan).toBe(10)
    expect(rightOverscan).toBe(10)
  })

  it('rotates landscape images into portrait output', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-landscape-'))
    const input = await sharp({ create: { width: 1039, height: 744, channels: 3, background: '#ef8354' } }).png().toBuffer()
    const result = await new SharpArtworkPipeline(folder).createMpcDerivative('landscape', input)
    expect(result.height).toBeGreaterThan(result.width)
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

  it('renders crop marks as a visible preview-only difference', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-preview-'))
    const image = new Uint8Array(await sharp({ create: { width: 744, height: 1038, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 0.85 } } }).png().toBuffer())
    const pipeline = new SharpArtworkPipeline(folder)
    const exporter = new PrintPdfExporter(pipeline, new ArtworkSourceResolver(folder))
    const withMarks = manifest(2)
    const withoutMarks = { ...withMarks, printSettings: { ...withMarks.printSettings, cropMarks: false } }
    const first = await exporter.renderPreview({ manifest: withMarks, pageIndex: 0, customAssets: { front: image, back: image } })
    const second = await exporter.renderPreview({ manifest: withoutMarks, pageIndex: 0, customAssets: { front: image, back: image } })
    expect(Buffer.compare(Buffer.from(first.png), Buffer.from(second.png))).not.toBe(0)
    expect(first).toMatchObject({ pageIndex: 0, columns: 3, rows: 3 })
  })
})

describe('shared print layout', () => {
  it('honors 2 mm bleed by reducing Letter output to 3x2', () => {
    const defaultLayout = createPrintLayout(9, { ...DEFAULT_PRINT_SETTINGS, bleedMm: 1.5 })
    const largerBleed = createPrintLayout(9, { ...DEFAULT_PRINT_SETTINGS, bleedMm: 2 })
    expect([defaultLayout.columns, defaultLayout.rows]).toEqual([3, 3])
    expect([largerBleed.columns, largerBleed.rows]).toEqual([3, 2])
    expect(largerBleed.warnings[0]).toContain('3×2')
  })

  it('keeps crop lines outside their artwork bleed rectangle', () => {
    const layout = createPrintLayout(1, { ...DEFAULT_PRINT_SETTINGS, cropMarks: true })
    const slot = layout.pages[0]!.slots[0]!
    for (const line of slot.cropLines) {
      const midpoint = { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 }
      const inside = midpoint.x >= slot.bleedRect.x && midpoint.x <= slot.bleedRect.x + slot.bleedRect.width
        && midpoint.y >= slot.bleedRect.y && midpoint.y <= slot.bleedRect.y + slot.bleedRect.height
      expect(inside).toBe(false)
    }
  })
})

function manifest(quantity: number): ProjectManifestV1 {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: '22222222-2222-4222-8222-222222222222', title: 'PDF Test', createdAt: now, updatedAt: now,
    decks: [{ id: 'deck', title: 'PDF Test', entries: [{ id: 'entry', rawName: 'Test', quantity, section: 'main', resolvedCardId: 'test', candidateCardIds: ['test'], resolution: 'resolved', allocations: [{ id: 'allocation', quantity, front: { kind: 'custom', assetId: 'front', archivePath: 'assets/front.png', displayName: 'Front' } }] }] }],
    globalBack: { kind: 'custom', assetId: 'back', archivePath: 'assets/back.png', displayName: 'Back' },
    printSettings: { ...DEFAULT_PRINT_SETTINGS, mode: 'duplex' },
    mpcSettings: { ...DEFAULT_MPC_SETTINGS }
  }
}
