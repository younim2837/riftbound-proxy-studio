import type { PrintLayout, PrintLayoutPage, PrintLayoutSlot, PrintLine, PrintSettings } from './contracts.js'

export const PRINT_PAGE_MM = {
  letter: { width: 215.9, height: 279.4 },
  a4: { width: 210, height: 297 }
} as const

export const PRINT_GAP_MM = 2
export const PRINT_MIN_MARGIN_MM = 1.2
const CROP_MARK_OFFSET_MM = 0.15
const CROP_MARK_LENGTH_MM = 0.8

export function createPrintLayout(cardCount: number, settings: PrintSettings): PrintLayout {
  const page = PRINT_PAGE_MM[settings.pageSize]
  const cellWidth = settings.cardWidthMm + settings.bleedMm * 2
  const cellHeight = settings.cardHeightMm + settings.bleedMm * 2
  const columns = Math.min(3, Math.floor((page.width - PRINT_MIN_MARGIN_MM * 2 + PRINT_GAP_MM) / (cellWidth + PRINT_GAP_MM)))
  const rows = Math.min(3, Math.floor((page.height - PRINT_MIN_MARGIN_MM * 2 + PRINT_GAP_MM) / (cellHeight + PRINT_GAP_MM)))
  if (columns < 1 || rows < 1) throw new Error('The selected card and bleed settings do not fit on the page.')

  const cardsPerSheet = columns * rows
  const sheetCount = Math.ceil(cardCount / cardsPerSheet)
  const warnings: string[] = []
  if (columns < 3 || rows < 3) warnings.push(`The selected ${settings.bleedMm.toFixed(1)} mm bleed produces a ${columns}×${rows} grid.`)
  const pages: PrintLayoutPage[] = []

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex++) {
    const firstSource = sheetIndex * cardsPerSheet
    const count = Math.min(cardsPerSheet, cardCount - firstSource)
    pages.push(buildPage(pages.length, sheetIndex, 'front', firstSource, count, columns, rows, page, settings))
    if (settings.mode === 'duplex') {
      pages.push(buildPage(pages.length, sheetIndex, 'back', firstSource, count, columns, rows, page, settings))
    }
  }

  return {
    pageWidthMm: page.width,
    pageHeightMm: page.height,
    columns,
    rows,
    cardsPerSheet,
    pageCount: pages.length,
    warnings,
    pages
  }
}

function buildPage(
  index: number,
  sheetIndex: number,
  side: 'front' | 'back',
  firstSource: number,
  count: number,
  columns: number,
  rows: number,
  page: { width: number; height: number },
  settings: PrintSettings
): PrintLayoutPage {
  const cellWidth = settings.cardWidthMm + settings.bleedMm * 2
  const cellHeight = settings.cardHeightMm + settings.bleedMm * 2
  const gridWidth = columns * cellWidth + (columns - 1) * PRINT_GAP_MM
  const gridHeight = rows * cellHeight + (rows - 1) * PRINT_GAP_MM
  const originX = (page.width - gridWidth) / 2
  const originY = (page.height - gridHeight) / 2
  const slots: PrintLayoutSlot[] = []

  for (let offset = 0; offset < count; offset++) {
    const row = Math.floor(offset / columns)
    const rawColumn = offset % columns
    const column = side === 'back' ? columns - 1 - rawColumn : rawColumn
    const x = originX + column * (cellWidth + PRINT_GAP_MM)
    const y = originY + row * (cellHeight + PRINT_GAP_MM)
    const bleedRect = { x, y, width: cellWidth, height: cellHeight }
    const trimRect = {
      x: x + settings.bleedMm,
      y: y + settings.bleedMm,
      width: settings.cardWidthMm,
      height: settings.cardHeightMm
    }
    slots.push({
      sourceIndex: firstSource + offset,
      row,
      column,
      bleedRect,
      trimRect,
      cropLines: settings.cropMarks ? cropLinesFor(bleedRect, trimRect) : []
    })
  }
  return { index, sheetIndex, side, slots }
}

function cropLinesFor(bleed: PrintLayoutSlot['bleedRect'], trim: PrintLayoutSlot['trimRect']): PrintLine[] {
  const left = bleed.x
  const right = bleed.x + bleed.width
  const top = bleed.y
  const bottom = bleed.y + bleed.height
  const before = (edge: number): [number, number] => [edge - CROP_MARK_OFFSET_MM - CROP_MARK_LENGTH_MM, edge - CROP_MARK_OFFSET_MM]
  const after = (edge: number): [number, number] => [edge + CROP_MARK_OFFSET_MM, edge + CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM]
  const [topStart, topEnd] = before(top)
  const [bottomStart, bottomEnd] = after(bottom)
  const [leftStart, leftEnd] = before(left)
  const [rightStart, rightEnd] = after(right)
  const trimRight = trim.x + trim.width
  const trimBottom = trim.y + trim.height
  return [
    { x1: trim.x, y1: topStart, x2: trim.x, y2: topEnd },
    { x1: trimRight, y1: topStart, x2: trimRight, y2: topEnd },
    { x1: trim.x, y1: bottomStart, x2: trim.x, y2: bottomEnd },
    { x1: trimRight, y1: bottomStart, x2: trimRight, y2: bottomEnd },
    { x1: leftStart, y1: trim.y, x2: leftEnd, y2: trim.y },
    { x1: leftStart, y1: trimBottom, x2: leftEnd, y2: trimBottom },
    { x1: rightStart, y1: trim.y, x2: rightEnd, y2: trim.y },
    { x1: rightStart, y1: trimBottom, x2: rightEnd, y2: trimBottom }
  ]
}
