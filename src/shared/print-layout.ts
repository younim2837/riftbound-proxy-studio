import type { PrintLayout, PrintLayoutPage, PrintLayoutSlot, PrintLine, PrintRect, PrintSettings } from './contracts.js'

export const PRINT_PAGE_MM = {
  letter: { width: 215.9, height: 279.4 },
  a4: { width: 210, height: 297 }
} as const

export const PRINT_GAP_MM = 2
export const PRINT_MIN_MARGIN_MM = 1.2
const PRINT_RECOMMENDED_MARGIN_MM = 3
const GUIDE_OFFSET_MM = 0.35
const EPSILON = 0.0001

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
  const marginX = (page.width - columns * cellWidth - (columns - 1) * PRINT_GAP_MM) / 2
  const marginY = (page.height - rows * cellHeight - (rows - 1) * PRINT_GAP_MM) / 2
  if (Math.min(marginX, marginY) < PRINT_RECOMMENDED_MARGIN_MM) {
    warnings.push('This grid leaves less than 3 mm at a page edge. Office printers may clip edge-reaching cut lines; use borderless printing or a smaller grid.')
  }
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
      guideLines: settings.cornerGuides ? cornerGuideLines(trimRect, settings.cornerGuideSizeMm, settings.cornerGuidePlacement) : []
    })
  }
  return {
    index,
    sheetIndex,
    side,
    slots,
    gridRect: boundingRect(slots.map((slot) => slot.bleedRect)),
    cutLines: settings.cropMarks ? fullPageCutLines(slots, page) : []
  }
}

function cornerGuideLines(trim: PrintRect, size: number, placement: PrintSettings['cornerGuidePlacement']): PrintLine[] {
  const left = trim.x
  const right = trim.x + trim.width
  const top = trim.y
  const bottom = trim.y + trim.height
  const offset = placement === 'inside' ? GUIDE_OFFSET_MM : -GUIDE_OFFSET_MM
  const corners = [
    { x: left + offset, y: top + offset, dx: 1, dy: 1 },
    { x: right - offset, y: top + offset, dx: -1, dy: 1 },
    { x: left + offset, y: bottom - offset, dx: 1, dy: -1 },
    { x: right - offset, y: bottom - offset, dx: -1, dy: -1 }
  ]
  return corners.flatMap(({ x, y, dx, dy }) => [
    { x1: x, y1: y, x2: x + dx * size, y2: y },
    { x1: x, y1: y, x2: x, y2: y + dy * size }
  ])
}

function boundingRect(rects: PrintRect[]): PrintRect | null {
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function fullPageCutLines(slots: PrintLayoutSlot[], page: { width: number; height: number }): PrintLine[] {
  const xPositions = uniquePositions(slots.flatMap((slot) => [slot.trimRect.x, slot.trimRect.x + slot.trimRect.width]))
  const yPositions = uniquePositions(slots.flatMap((slot) => [slot.trimRect.y, slot.trimRect.y + slot.trimRect.height]))
  const vertical = xPositions.flatMap((x) => openSegments(page.height, slots
    .filter((slot) => x >= slot.bleedRect.x - EPSILON && x <= slot.bleedRect.x + slot.bleedRect.width + EPSILON)
    .map((slot) => [slot.bleedRect.y, slot.bleedRect.y + slot.bleedRect.height] as const))
    .map(([start, end]) => ({ x1: x, y1: start, x2: x, y2: end })))
  const horizontal = yPositions.flatMap((y) => openSegments(page.width, slots
    .filter((slot) => y >= slot.bleedRect.y - EPSILON && y <= slot.bleedRect.y + slot.bleedRect.height + EPSILON)
    .map((slot) => [slot.bleedRect.x, slot.bleedRect.x + slot.bleedRect.width] as const))
    .map(([start, end]) => ({ x1: start, y1: y, x2: end, y2: y })))
  return [...vertical, ...horizontal]
}

function uniquePositions(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b)
}

function openSegments(limit: number, occupied: readonly (readonly [number, number])[]): [number, number][] {
  const segments: [number, number][] = []
  let cursor = 0
  for (const [start, end] of [...occupied].sort((a, b) => a[0] - b[0])) {
    if (start > cursor + EPSILON) segments.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < limit - EPSILON) segments.push([cursor, limit])
  return segments
}
