import { randomUUID } from 'node:crypto'
import type { CardRecord, DeckEntry, ImportResult } from '../../shared/contracts.js'
import { normalizeCardName } from './deck-importer.js'

export function resolveImportedDeck(result: ImportResult, catalog: CardRecord[]): DeckEntry[] {
  const byCode = new Map(catalog.map((card) => [normalizeCode(card.code), card]))
  const byName = new Map<string, CardRecord[]>()
  for (const card of catalog) {
    const key = normalizeCardName(card.name)
    byName.set(key, [...(byName.get(key) ?? []), card])
  }

  return result.lines.map((line) => {
    const requested = line.requestedCode ? byCode.get(normalizeCode(line.requestedCode)) : undefined
    const directCandidates = byName.get(normalizeCardName(line.name)) ?? []
    const legendCandidates = directCandidates.length === 0 && line.section === 'legend'
      ? legendTitleKeys(line.name)
          .flatMap((key) => byName.get(key) ?? [])
          .filter((card) => card.type.toLowerCase() === 'legend')
      : []
    const candidates = requested ? [requested] : uniqueCards(directCandidates.length > 0 ? directCandidates : legendCandidates)
    const baseCandidates = candidates.filter((card) => !card.isVariant)
    const selected = requested ?? (baseCandidates.length === 1 ? baseCandidates[0] : candidates.length === 1 ? candidates[0] : undefined)
    const resolution = selected ? 'resolved' : candidates.length > 1 ? 'ambiguous' : 'missing'
    return {
      id: randomUUID(),
      rawName: line.name,
      quantity: line.quantity,
      section: line.section,
      ...(selected ? { resolvedCardId: selected.id } : {}),
      candidateCardIds: candidates.map((card) => card.id),
      allocations: selected
        ? [{
            id: randomUUID(),
            quantity: line.quantity,
            front: { kind: 'official' as const, cardId: selected.id, imageUrl: selected.imageUrl }
          }]
        : [],
      resolution
    }
  })
}

export function legendTitleKeys(value: string): string[] {
  const candidates: string[] = []
  const comma = value.indexOf(',')
  if (comma >= 0) candidates.push(value.slice(comma + 1))
  const spacedDash = /\s[-–—]\s/.exec(value)
  if (spacedDash?.index !== undefined) candidates.push(value.slice(spacedDash.index + spacedDash[0].length))
  return [...new Set(candidates.map(normalizeCardName).filter(Boolean))]
}

function uniqueCards(cards: CardRecord[]): CardRecord[] {
  return [...new Map(cards.map((card) => [card.id, card])).values()]
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\*$/, 'S')
}
