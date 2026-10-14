import { readFile, writeFile } from 'node:fs/promises'
import sharp, { type OverlayOptions } from 'sharp'
import { PDFDocument, rgb, type PDFImage, type PDFPage } from 'pdf-lib'
import type {
  ArtworkSelection,
  PdfExportRequest,
  PdfExportResult,
  PrintLayoutPage,
  PrintLine,
  PrintPreviewRequest,
  PrintPreviewResult,
  PrintSettings,
  ProjectManifest
} from '../../shared/contracts.js'
import { createPrintLayout } from '../../shared/print-layout.js'
import { expandProjectCopies, unresolvedEntryCount } from '../../shared/project-copies.js'
import { projectManifestSchema } from '../../shared/schemas.js'
import type { PdfExporter } from './interfaces.js'
import { ArtworkSourceResolver, SharpArtworkPipeline } from './artwork-pipeline.js'

const MM_TO_POINTS = 72 / 25.4
const PREVIEW_DPI = 100

interface CardSlot {
  front: ArtworkSelection
  back?: ArtworkSelection
}

export class PrintPdfExporter implements PdfExporter {
  constructor(
    private readonly pipeline: SharpArtworkPipeline,
    private readonly resolver: ArtworkSourceResolver
  ) {}

  async export(request: PdfExportRequest): Promise<PdfExportResult> {
    const manifest = projectManifestSchema.parse(request.manifest) as unknown as ProjectManifest
    const slots = expandSlots(manifest)
    validateSlots(slots, manifest)
    const layout = createPrintLayout(slots.length, manifest.printSettings)
    const pdf = await PDFDocument.create()
    pdf.setTitle(`${manifest.title} - proxy print sheets`)
    pdf.setProducer('Proxy Studio')
    const images = new Map<string, PDFImage>()

    for (const layoutPage of layout.pages) {
      const page = pdf.addPage([mm(layout.pageWidthMm), mm(layout.pageHeightMm)])
      if (manifest.printSettings.blackGutters && layoutPage.gridRect) {
        const rect = layoutPage.gridRect
        page.drawRectangle({
          x: mm(rect.x),
          y: mm(layout.pageHeightMm - rect.y - rect.height),
          width: mm(rect.width),
          height: mm(rect.height),
          color: rgb(0, 0, 0)
        })
      }
      for (const layoutSlot of layoutPage.slots) {
        const slot = slots[layoutSlot.sourceIndex]
        if (!slot) continue
        const selection = selectionFor(slot, layoutPage.side)
        if (!selection) continue
        const derivative = await this.derivativeFor(manifest.game, selection, request.customAssets, manifest.printSettings.bleedMm)
        let image = images.get(derivative.filePath)
        if (!image) {
          image = await pdf.embedPng(await readFile(derivative.filePath))
          images.set(derivative.filePath, image)
        }
        const rect = layoutSlot.bleedRect
        page.drawImage(image, {
          x: mm(rect.x),
          y: mm(layout.pageHeightMm - rect.y - rect.height),
          width: mm(rect.width),
          height: mm(rect.height)
        })
      }
      drawSheetGuides(page, layoutPage, layout.pageHeightMm, manifest.printSettings)
    }

    const bytes = await pdf.save({ useObjectStreams: false })
    await writeFile(request.destination, bytes)
    return {
      destination: request.destination,
      pages: pdf.getPageCount(),
      cards: slots.length,
      columns: layout.columns,
      rows: layout.rows,
      warnings: layout.warnings
    }
  }

  async renderPreview(request: PrintPreviewRequest): Promise<PrintPreviewResult> {
    const manifest = projectManifestSchema.parse(request.manifest) as unknown as ProjectManifest
    const slots = expandSlots(manifest)
    validateSlots(slots, manifest)
    const layout = createPrintLayout(slots.length, manifest.printSettings)
    const pageIndex = Math.max(0, Math.min(request.pageIndex, layout.pageCount - 1))
    const layoutPage = layout.pages[pageIndex]
    if (!layoutPage) throw new Error('The requested preview page does not exist.')
    const width = px(layout.pageWidthMm)
    const height = px(layout.pageHeightMm)
    const composites: OverlayOptions[] = []
    if (manifest.printSettings.blackGutters && layoutPage.gridRect) {
      const rect = layoutPage.gridRect
      composites.push({ input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${pxFloat(rect.x)}" y="${pxFloat(rect.y)}" width="${pxFloat(rect.width)}" height="${pxFloat(rect.height)}" fill="#000000"/></svg>`) })
    }

    for (const layoutSlot of layoutPage.slots) {
      const slot = slots[layoutSlot.sourceIndex]
      if (!slot) continue
      const selection = selectionFor(slot, layoutPage.side)
      if (!selection) continue
      const derivative = await this.derivativeFor(manifest.game, selection, request.customAssets, manifest.printSettings.bleedMm)
      const rect = layoutSlot.bleedRect
      const input = await sharp(derivative.filePath)
        .resize(px(rect.width), px(rect.height), { fit: 'fill' })
        .png()
        .toBuffer()
      composites.push({ input, left: px(rect.x), top: px(rect.y) })
    }

    if (layoutPage.cutLines.length > 0 || layoutPage.slots.some((slot) => slot.guideLines.length > 0)) {
      composites.push({ input: Buffer.from(sheetGuidesSvg(layoutPage, width, height, manifest.printSettings)) })
    }
    const png = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
      .composite(composites)
      .png({ compressionLevel: 8 })
      .toBuffer()
    return {
      png: new Uint8Array(png),
      pageIndex,
      pageCount: layout.pageCount,
      side: layoutPage.side,
      sheetIndex: layoutPage.sheetIndex,
      columns: layout.columns,
      rows: layout.rows,
      warnings: layout.warnings
    }
  }

  private async derivativeFor(
    game: ProjectManifest['game'],
    selection: ArtworkSelection,
    customAssets: Record<string, Uint8Array>,
    bleedMm: number
  ) {
    const { sourceId, bytes } = await this.resolver.load(selection, customAssets)
    return this.pipeline.createPdfDerivative(game, sourceId, bytes, bleedMm)
  }
}

export function expandSlots(manifest: ProjectManifest): CardSlot[] {
  return expandProjectCopies(manifest).map((copy) => ({
    front: copy.front,
    ...(copy.back ? { back: copy.back } : {})
  }))
}

function validateSlots(slots: CardSlot[], manifest: ProjectManifest): void {
  if (unresolvedEntryCount(manifest) > 0) throw new Error('Resolve every card in every deck before exporting a PDF.')
  if (slots.length === 0) throw new Error('There are no resolved cards to export.')
  if (manifest.printSettings.mode === 'duplex' && slots.some((slot) => !slot.back)) {
    throw new Error('Duplex export requires a back image for every card.')
  }
}

function selectionFor(slot: CardSlot, side: 'front' | 'back'): ArtworkSelection | undefined {
  return side === 'back' ? slot.back : slot.front
}

function drawSheetGuides(page: PDFPage, layoutPage: PrintLayoutPage, pageHeightMm: number, settings: PrintSettings): void {
  const guideColor = hexColor(settings.cornerGuideColor)
  for (const line of layoutPage.cutLines) {
    page.drawLine({
      start: { x: mm(line.x1), y: mm(pageHeightMm - line.y1) },
      end: { x: mm(line.x2), y: mm(pageHeightMm - line.y2) },
      thickness: mm(0.18),
      color: rgb(0, 0, 0)
    })
  }
  for (const slot of layoutPage.slots) {
    for (const line of slot.guideLines) {
      page.drawLine({
        start: { x: mm(line.x1), y: mm(pageHeightMm - line.y1) },
        end: { x: mm(line.x2), y: mm(pageHeightMm - line.y2) },
        thickness: mm(0.3),
        color: guideColor
      })
    }
  }
}

function sheetGuidesSvg(layoutPage: PrintLayoutPage, width: number, height: number, settings: PrintSettings): string {
  const cutLines = layoutPage.cutLines.map((line) =>
    `<line x1="${pxFloat(line.x1)}" y1="${pxFloat(line.y1)}" x2="${pxFloat(line.x2)}" y2="${pxFloat(line.y2)}"/>`
  ).join('')
  const guides = layoutPage.slots.flatMap((slot) => slot.guideLines).map((line: PrintLine) =>
    `<line x1="${pxFloat(line.x1)}" y1="${pxFloat(line.y1)}" x2="${pxFloat(line.x2)}" y2="${pxFloat(line.y2)}"/>`
  ).join('')
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#000000" stroke-width="${pxFloat(0.18)}">${cutLines}</g><g fill="none" stroke="${settings.cornerGuideColor}" stroke-width="${pxFloat(0.3)}">${guides}</g></svg>`
}

function hexColor(hex: string) {
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255)
}

function mm(value: number): number {
  return value * MM_TO_POINTS
}

function px(value: number): number {
  return Math.max(1, Math.round(pxFloat(value)))
}

function pxFloat(value: number): number {
  return (value / 25.4) * PREVIEW_DPI
}

export const pdfLayoutConstants = { MM_TO_POINTS, PREVIEW_DPI } as const
