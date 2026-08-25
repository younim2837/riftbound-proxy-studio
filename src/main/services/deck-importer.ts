import { getDeckFromCode } from '@piltoverarchive/riftbound-deck-codes'
import type { DeckImporter } from './interfaces.js'
import type { DeckSection, ImportedDeckLine, ImportResult } from '../../shared/contracts.js'
import { assertAllowedHttpsUrl } from '../../shared/schemas.js'

const SECTION_NAMES: Record<string, DeckSection> = {
  main: 'main',
  'main deck': 'main',
  maindeck: 'main',
  sideboard: 'sideboard',
  runes: 'runes',
  rune: 'runes',
  legend: 'legend',
  legends: 'legend',
  battlefield: 'battlefields',
  battlefields: 'battlefields',
  champion: 'other',
  champions: 'other',
  bench: 'other'
}

interface PiltoverCard {
  quantity?: number
  variantId?: string
  card?: {
    id?: string
    name?: string
    cardVariants?: Array<{ id?: string; variantNumber?: string }>
  }
}

interface PiltoverDeck {
  name?: string
  legend?: PiltoverCard
  champions?: PiltoverCard[]
  battlefields?: PiltoverCard[]
  runes?: PiltoverCard[]
  maindeck?: PiltoverCard[]
  sideboard?: PiltoverCard[]
  bench?: PiltoverCard[]
}

export class RiftboundDeckImporter implements DeckImporter {
  importText(input: string): ImportResult {
    const warnings: ImportResult['warnings'] = []
    const lines: ImportedDeckLine[] = []
    let section: DeckSection = 'main'

    for (const [index, rawValue] of input.replaceAll('\r', '').split('\n').entries()) {
      const raw = rawValue.trim()
      if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue
      const heading = raw.replace(/:$/, '').trim().toLowerCase()
      if (SECTION_NAMES[heading]) {
        section = SECTION_NAMES[heading]
        continue
      }

      const parsed = parseDeckLine(raw, index + 1, section)
      if (parsed) lines.push(parsed)
      else warnings.push({ lineNumber: index + 1, message: `Could not parse: ${raw}` })
    }

    if (lines.length === 0) {
      warnings.push({ message: 'No card lines were found.' })
    }
    return { lines, warnings }
  }

  importDeckCode(code: string): ImportResult {
    const normalized = code.trim().replaceAll(/\s/g, '')
    if (!/^[A-Z2-7]+$/i.test(normalized)) {
      throw new Error('The deck code contains characters outside the Riftbound Base32 format.')
    }
    const decoded = getDeckFromCode(normalized)
    const lines: ImportedDeckLine[] = []
    let lineNumber = 1

    const addSection = (
      cards: Array<{ cardCode: string; count: number }>,
      section: DeckSection
    ): void => {
      for (const card of cards) {
        lines.push({
          lineNumber: lineNumber++,
          raw: `${card.count} ${card.cardCode}`,
          name: card.cardCode,
          quantity: card.count,
          section,
          requestedCode: card.cardCode.toUpperCase()
        })
      }
    }

    addSection(decoded.mainDeck, 'main')
    addSection(decoded.sideboard, 'sideboard')
    if (decoded.chosenChampion) {
      addSection([{ cardCode: decoded.chosenChampion, count: 1 }], 'legend')
    }
    return { lines, warnings: [] }
  }

  async importPiltoverUrl(input: string): Promise<ImportResult> {
    const url = assertAllowedHttpsUrl(input.trim(), ['piltoverarchive.com', 'www.piltoverarchive.com'])
    if (!/^\/decks\/view\/[a-f0-9-]+\/?$/i.test(url.pathname)) {
      throw new Error('Expected a Piltover Archive /decks/view/... URL.')
    }
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 RiftboundProxyStudio/0.1 private-prototype'
      }
    })
    if (!response.ok) throw new Error(`Piltover Archive returned ${response.status}.`)
    const html = await response.text()
    const deck = extractPiltoverDeck(html)
    if (!deck) throw new Error('Piltover deck data was not found. The page format may have changed.')

    const lines: ImportedDeckLine[] = []
    let lineNumber = 1
    const add = (cards: PiltoverCard[] | undefined, section: DeckSection): void => {
      for (const value of cards ?? []) {
        const name = value.card?.name?.trim()
        if (!name) continue
        const variant = value.card?.cardVariants?.find((item) => item.id === value.variantId)
        const requestedCode = variant?.variantNumber?.toUpperCase()
        const quantity = Math.max(1, Math.trunc(value.quantity ?? 1))
        lines.push({
          lineNumber: lineNumber++,
          raw: `${quantity} ${name}`,
          name,
          quantity,
          section,
          ...(requestedCode ? { requestedCode } : {})
        })
      }
    }

    add(deck.legend ? [deck.legend] : [], 'legend')
    add(deck.champions, 'other')
    add(deck.battlefields, 'battlefields')
    add(deck.runes, 'runes')
    add(deck.maindeck, 'main')
    add(deck.sideboard, 'sideboard')
    add(deck.bench, 'other')
    if (lines.length === 0) throw new Error('The Piltover deck did not contain any recognizable cards.')
    return { ...(deck.name ? { title: deck.name } : {}), lines, warnings: [] }
  }
}

export function normalizeCardName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function parseDeckLine(
  raw: string,
  lineNumber: number,
  section: DeckSection = 'main'
): ImportedDeckLine | null {
  let quantity: number | undefined
  let body = raw.trim()
  const prefix = /^(\d+)\s*[x×]?\s+(.+)$/.exec(body)
  const suffix = /^(.+?)\s+[x×]\s*(\d+)$/i.exec(body)
  if (prefix) {
    quantity = Number(prefix[1])
    body = prefix[2]!.trim()
  } else if (suffix) {
    quantity = Number(suffix[2])
    body = suffix[1]!.trim()
  }
  if (!quantity || quantity < 1 || quantity > 612 || !body) return null

  const codeMatch = /(?:^|[\s[(])([A-Z]{3}-(?:R\d{2}|SP\d+|\d{3})[A-Z*]?)(?=$|[\s)\]])/i.exec(body)
  const requestedCode = codeMatch?.[1]?.toUpperCase().replace(/\*$/, 's')
  const name = body
    .replace(/[[(]?\b[A-Z]{3}-(?:R\d{2}|SP\d+|\d{3})[A-Z*]?\b[\])]?/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || requestedCode
  if (!name) return null

  return {
    lineNumber,
    raw,
    name,
    quantity,
    section,
    ...(requestedCode ? { requestedCode } : {})
  }
}

export function extractPiltoverDeck(html: string): PiltoverDeck | null {
  const direct = /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(direct)) {
    try {
      const value = JSON.parse(match[1]!) as unknown
      const found = findDeckObject(value)
      if (found) return found
    } catch {
      // Try the RSC payload below.
    }
  }

  const markerCandidates = ['\\"deck\\":{', '\\\\"deck\\\\":{']
  for (const marker of markerCandidates) {
    const markerIndex = html.indexOf(marker)
    if (markerIndex < 0) continue
    const objectStart = markerIndex + marker.length - 1
    const window = html.slice(objectStart, objectStart + 500_000)
    for (const unescaped of [unescapeRsc(window), unescapeRsc(unescapeRsc(window))]) {
      const jsonObject = takeBalancedObject(unescaped)
      if (!jsonObject) continue
      try {
        return JSON.parse(jsonObject) as PiltoverDeck
      } catch {
        // Try the next escape depth.
      }
    }
  }
  return null
}

function unescapeRsc(value: string): string {
  return value.replaceAll('\\"', '"').replaceAll('\\/', '/').replaceAll('\\\\', '\\')
}

function takeBalancedObject(value: string): string | null {
  const start = value.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < value.length; index++) {
    const character = value[index]!
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth++
    else if (character === '}' && --depth === 0) return value.slice(start, index + 1)
  }
  return null
}

function findDeckObject(value: unknown): PiltoverDeck | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.deck && typeof record.deck === 'object') return record.deck as PiltoverDeck
  for (const child of Object.values(record)) {
    const found = findDeckObject(child)
    if (found) return found
  }
  return null
}
