import { describe, expect, it } from 'vitest'
import { legendTitleKeys, resolveImportedDeck } from '../src/main/services/resolver.js'
import type { CardRecord, ImportResult } from '../src/shared/contracts.js'

const cards: CardRecord[] = [
  card('base', 'OGN-007', false),
  card('alt', 'OGN-007A', true),
  { ...card('other', 'SFD-009', false), name: 'Other Card' }
]

describe('card resolver', () => {
  it('selects the base printing by default', () => {
    const result: ImportResult = { lines: [{ lineNumber: 1, raw: '3 Ahri', name: 'Ahri', quantity: 3, section: 'main' }], warnings: [] }
    expect(resolveImportedDeck(result, cards)[0]).toMatchObject({ resolvedCardId: 'base', resolution: 'resolved' })
  })

  it('honors an exact requested code', () => {
    const result: ImportResult = { lines: [{ lineNumber: 1, raw: '1 OGN-007A Ahri', name: 'Ahri', quantity: 1, section: 'main', requestedCode: 'OGN-007A' }], warnings: [] }
    expect(resolveImportedDeck(result, cards)[0]?.resolvedCardId).toBe('alt')
  })

  it('leaves unknown cards unresolved', () => {
    const result: ImportResult = { lines: [{ lineNumber: 1, raw: '1 Missing', name: 'Missing', quantity: 1, section: 'main' }], warnings: [] }
    expect(resolveImportedDeck(result, cards)[0]).toMatchObject({ resolution: 'missing', candidateCardIds: [] })
  })

  it('matches champion-prefixed Legend names to their catalog title', () => {
    const legendCards = [
      { ...card('defender-base', 'VEN-149', false), name: 'Defender of Tomorrow', type: 'Legend', baseCode: 'VEN-149' },
      { ...card('defender-alt', 'VEN-194', false), name: 'Defender of Tomorrow', type: 'Legend', baseCode: 'VEN-194' }
    ]
    const result: ImportResult = { lines: [{ lineNumber: 1, raw: '1 Jayce, Defender of Tomorrow', name: 'Jayce, Defender of Tomorrow', quantity: 1, section: 'legend' }], warnings: [] }
    expect(resolveImportedDeck(result, [...cards, ...legendCards])[0]).toMatchObject({
      resolution: 'ambiguous',
      candidateCardIds: ['defender-base', 'defender-alt']
    })
  })

  it('auto-resolves a unique dash-separated Legend title', () => {
    const legend = { ...card('fox', 'OGN-255', false), name: 'Nine-Tailed Fox', type: 'Legend', baseCode: 'OGN-255' }
    const result: ImportResult = { lines: [{ lineNumber: 1, raw: '1 Ahri - Nine-Tailed Fox', name: 'Ahri - Nine-Tailed Fox', quantity: 1, section: 'legend' }], warnings: [] }
    expect(resolveImportedDeck(result, [...cards, legend])[0]).toMatchObject({ resolution: 'resolved', resolvedCardId: 'fox' })
  })

  it('does not use Legend aliases outside the Legend section', () => {
    const legend = { ...card('defender', 'VEN-149', false), name: 'Defender of Tomorrow', type: 'Legend', baseCode: 'VEN-149' }
    const result: ImportResult = { lines: [{ lineNumber: 1, raw: '1 Jayce, Defender of Tomorrow', name: 'Jayce, Defender of Tomorrow', quantity: 1, section: 'main' }], warnings: [] }
    expect(resolveImportedDeck(result, [...cards, legend])[0]).toMatchObject({ resolution: 'missing', candidateCardIds: [] })
  })

  it('extracts comma and spaced-dash Legend titles without splitting hyphenated words', () => {
    expect(legendTitleKeys('Jayce, Defender of Tomorrow')).toEqual(['defender of tomorrow'])
    expect(legendTitleKeys('Ahri - Nine-Tailed Fox')).toEqual(['nine tailed fox'])
  })
})

function card(id: string, code: string, isVariant: boolean): CardRecord {
  return {
    id, code, publicCode: code, setCode: 'OGN', setName: 'Origins', collectorNumber: '7', name: 'Ahri',
    type: 'Unit', rarity: 'Rare', orientation: 'portrait', isVariant, baseCode: 'OGN-007',
    imageUrl: `https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/${'a'.repeat(40)}-744x1039.png`
  }
}
