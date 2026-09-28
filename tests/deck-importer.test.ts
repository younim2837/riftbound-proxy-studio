import { describe, expect, it } from 'vitest'
import {
  extractPiltoverDeck,
  MtgDeckImporter,
  normalizeCardName,
  parseMtgDeckLine,
  parseDeckLine,
  RiftboundDeckImporter
} from '../src/main/services/deck-importer.js'

describe('deck text import', () => {
  it('parses common quantities, sections, and requested codes', () => {
    const importer = new RiftboundDeckImporter()
    const result = importer.importText(`Legend:\n1 Ahri - Nine-Tailed Fox\nMain Deck:\n3x Charm\nDisarming Rake x2\n3 OGN-007 Ahri - Alluring`)
    expect(result.warnings).toEqual([])
    expect(result.lines).toHaveLength(4)
    expect(result.lines[0]).toMatchObject({ quantity: 1, section: 'legend' })
    expect(result.lines[1]).toMatchObject({ quantity: 3, name: 'Charm', section: 'main' })
    expect(result.lines[2]).toMatchObject({ quantity: 2, name: 'Disarming Rake' })
    expect(result.lines[3]).toMatchObject({ requestedCode: 'OGN-007', name: 'Ahri - Alluring' })
  })

  it('rejects impossible quantities and reports malformed rows', () => {
    const result = new RiftboundDeckImporter().importText('0 Charm\n613 Ahri\nnot a card')
    expect(result.lines).toHaveLength(0)
    expect(result.warnings).toHaveLength(4)
  })

  it('normalizes punctuation without conflating words', () => {
    expect(normalizeCardName('  Kai’Sa — Survivor! ')).toBe('kai sa survivor')
  })

  it('parses one line directly', () => {
    expect(parseDeckLine('4 [VEN-SP1a] Kai Sa', 9, 'sideboard')).toMatchObject({
      lineNumber: 9,
      quantity: 4,
      requestedCode: 'VEN-SP1A',
      name: 'Kai Sa',
      section: 'sideboard'
    })
  })
})

describe('Magic deck text import', () => {
  it('parses Arena, Commander, sideboard, and set-qualified lines', () => {
    const result = new MtgDeckImporter().importText(`Commander\n1 Atraxa, Praetors' Voice (2X2) 190\n\nDeck\n4 Lightning Bolt\n1 Delver of Secrets // Insectile Aberration\n\nSideboard\n2 Negate [M20] 69`)
    expect(result.warnings).toEqual([])
    expect(result.lines).toMatchObject([
      { quantity: 1, name: "Atraxa, Praetors' Voice", section: 'commander', requestedSetCode: '2X2', requestedCollectorNumber: '190' },
      { quantity: 4, name: 'Lightning Bolt', section: 'main' },
      { quantity: 1, name: 'Delver of Secrets // Insectile Aberration', section: 'main' },
      { quantity: 2, name: 'Negate', section: 'sideboard', requestedSetCode: 'M20', requestedCollectorNumber: '69' }
    ])
  })

  it('parses a Moxfield-style line directly', () => {
    expect(parseMtgDeckLine('1x Sol Ring (CMM) 396', 4, 'main')).toMatchObject({
      lineNumber: 4,
      quantity: 1,
      name: 'Sol Ring',
      requestedSetCode: 'CMM',
      requestedCollectorNumber: '396'
    })
  })
})

describe('Piltover RSC import', () => {
  it('extracts balanced escaped deck JSON', () => {
    const deck = {
      id: 'deck-1',
      name: 'Test Deck',
      maindeck: [{ quantity: 3, card: { name: 'Charm', cardVariants: [] } }]
    }
    const html = `<script>self.__next_f.push([1,",{\\"deck\\":${JSON.stringify(deck).replaceAll('"', '\\"')}}"])</script>`
    expect(extractPiltoverDeck(html)).toMatchObject({ name: 'Test Deck' })
  })
})
