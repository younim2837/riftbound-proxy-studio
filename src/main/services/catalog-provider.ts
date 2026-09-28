import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CardCatalogProvider } from './interfaces.js'
import type {
  CardRecord,
  CatalogSnapshot,
  DeckEntry,
  ImportResult,
  ImportedDeckLine,
  ResolvedImport
} from '../../shared/contracts.js'
import { assertAllowedHttpsUrl } from '../../shared/schemas.js'
import { normalizeCardName } from './deck-importer.js'

const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/slimtreble/Riftbound-card-data/main/cards.json'
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface DevelopmentCatalogCard {
  id: string
  code: string
  publicCode?: string
  set: string
  setName?: string
  collectorNumber: string | number
  name: string
  type?: string
  rarity?: string
  orientation?: string
  isVariant?: boolean
  imageUrl: string
}

export class DevelopmentCatalogProvider implements CardCatalogProvider {
  readonly name = 'development-fixture'
  private readonly snapshotPath: string

  constructor(
    private readonly cacheDirectory: string,
    private readonly fixturePath?: string
  ) {
    this.snapshotPath = join(cacheDirectory, 'catalog', 'development-catalog.json')
  }

  async load(forceRefresh = false): Promise<CatalogSnapshot> {
    if (!forceRefresh && (await this.hasFreshSnapshot())) {
      const cached = JSON.parse(await readFile(this.snapshotPath, 'utf8')) as CatalogSnapshot
      return normalizeRiftboundSnapshot(cached)
    }

    if (!forceRefresh && this.fixturePath) {
      try {
        const fixture = JSON.parse(await readFile(this.fixturePath, 'utf8')) as CatalogSnapshot
        if (!Array.isArray(fixture.cards) || fixture.cards.length === 0) {
          throw new Error('The bundled development catalog contains no cards.')
        }
        const snapshot: CatalogSnapshot = {
          ...fixture,
          cards: fixture.cards.map(normalizeCachedRiftboundCard),
          source: 'fixture:dev-catalog-v1',
          game: 'riftbound',
          developmentOnly: true
        }
        await this.saveSnapshot(snapshot)
        return snapshot
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
    }

    const source = process.env.RIFTBOUND_CATALOG_URL ?? DEFAULT_CATALOG_URL
    assertAllowedHttpsUrl(source, ['raw.githubusercontent.com'])
    const response = await fetch(source, {
      headers: { 'user-agent': 'RiftboundProxyStudio/0.1 private-prototype' }
    })
    if (!response.ok) {
      throw new Error(`Card catalog request failed (${response.status}).`)
    }

    const rawCards = (await response.json()) as DevelopmentCatalogCard[]
    const snapshot: CatalogSnapshot = {
      cards: rawCards.map(normalizeDevelopmentCard),
      source,
      fetchedAt: new Date().toISOString(),
      game: 'riftbound',
      developmentOnly: true
    }
    await this.saveSnapshot(snapshot)
    return snapshot
  }

  private async saveSnapshot(snapshot: CatalogSnapshot): Promise<void> {
    await mkdir(join(this.cacheDirectory, 'catalog'), { recursive: true })
    await writeFile(this.snapshotPath, JSON.stringify(snapshot), 'utf8')
  }

  private async hasFreshSnapshot(): Promise<boolean> {
    try {
      const details = await stat(this.snapshotPath)
      return Date.now() - details.mtimeMs < CATALOG_MAX_AGE_MS
    } catch {
      return false
    }
  }
}

function normalizeRiftboundSnapshot(snapshot: CatalogSnapshot): CatalogSnapshot {
  return {
    ...snapshot,
    cards: snapshot.cards.map(normalizeCachedRiftboundCard),
    game: 'riftbound',
    developmentOnly: true
  }
}

function normalizeCachedRiftboundCard(card: CardRecord): CardRecord {
  return {
    ...card,
    game: 'riftbound',
    identityId: card.identityId ?? card.baseCode
  }
}

function normalizeDevelopmentCard(card: DevelopmentCatalogCard): CardRecord {
  assertAllowedHttpsUrl(card.imageUrl, ['cmsassets.rgpub.io'])
  const code = card.code.toUpperCase().replace(/\*$/, 's')
  const baseCode = code.replace(/(?:[a-z]|s)$/i, '')
  const imageHash = imageHashFromUrl(card.imageUrl)
  return {
    game: 'riftbound',
    id: card.id || code.toLowerCase(),
    identityId: baseCode,
    code,
    publicCode: card.publicCode ?? code,
    setCode: card.set.toUpperCase(),
    setName: card.setName ?? card.set.toUpperCase(),
    collectorNumber: String(card.collectorNumber),
    name: card.name,
    type: card.type ?? 'Unknown',
    rarity: card.rarity ?? 'Unknown',
    orientation: card.orientation === 'landscape' ? 'landscape' : 'portrait',
    isVariant: Boolean(card.isVariant),
    baseCode,
    imageUrl: card.imageUrl,
    ...(imageHash ? { imageHash } : {})
  }
}

interface ScryfallImageUris {
  png?: string
  large?: string
}

interface ScryfallCardFace {
  name: string
  image_uris?: ScryfallImageUris
}

interface ScryfallCard {
  id: string
  oracle_id?: string
  name: string
  set: string
  set_name: string
  collector_number: string
  type_line?: string
  rarity?: string
  lang?: string
  layout?: string
  image_status?: string
  image_uris?: ScryfallImageUris
  card_faces?: ScryfallCardFace[]
  promo?: boolean
  frame_effects?: string[]
  promo_types?: string[]
  finishes?: string[]
  released_at?: string
  artist?: string
}

interface ScryfallList {
  data: ScryfallCard[]
  has_more?: boolean
  next_page?: string
  not_found?: Array<Record<string, string>>
}

const SCRYFALL_API = 'https://api.scryfall.com'
const SCRYFALL_HEADERS = {
  accept: 'application/json;q=0.9,*/*;q=0.8',
  'user-agent': 'ProxyStudio/0.3 (+https://github.com/younim2837/riftbound-proxy-studio)'
}
const SCRYFALL_MIN_REQUEST_GAP_MS = 125

export class ScryfallCatalogProvider implements CardCatalogProvider {
  readonly name = 'scryfall'
  private readonly cards = new Map<string, CardRecord>()
  private readonly loadedPrintingIdentities = new Set<string>()
  private readonly snapshotPath: string
  private loaded = false
  private requestQueue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(private readonly cacheDirectory: string) {
    this.snapshotPath = join(cacheDirectory, 'catalog', 'scryfall-cards.json')
  }

  async load(): Promise<CatalogSnapshot> {
    await this.loadCache()
    return this.snapshot()
  }

  async resolveImport(result: ImportResult): Promise<ResolvedImport> {
    await this.loadCache()
    const uniqueLines = [...new Map(result.lines.map((line) => [identifierKey(line), line])).values()]
    const found: CardRecord[] = []
    for (let offset = 0; offset < uniqueLines.length; offset += 75) {
      const batch = uniqueLines.slice(offset, offset + 75)
      const response = await this.requestJson<ScryfallList>(`${SCRYFALL_API}/cards/collection`, {
        method: 'POST',
        headers: { ...SCRYFALL_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(scryfallIdentifier) })
      })
      found.push(...response.data.map(normalizeScryfallCard).filter(isCardRecord))
    }
    this.remember(found)
    const entries = result.lines.map((line) => scryfallEntry(line, found))
    await this.saveCache()
    return { entries, cards: [...this.cards.values()] }
  }

  async search(query: string): Promise<CardRecord[]> {
    await this.loadCache()
    const cleaned = query.trim()
    if (cleaned.length < 2) return []
    const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(cleaned)}&unique=prints&order=released&dir=desc`
    const cards = await this.readPages(url, 2)
    this.remember(cards)
    await this.saveCache()
    return cards
  }

  async printings(cardId: string): Promise<CardRecord[]> {
    await this.loadCache()
    let card = this.cards.get(cardId)
    if (!card) {
      const raw = await this.requestJson<ScryfallCard>(`${SCRYFALL_API}/cards/${encodeURIComponent(cardId)}`)
      card = normalizeScryfallCard(raw)
      if (!card) return []
      this.remember([card])
    }
    if (this.loadedPrintingIdentities.has(card.identityId)) {
      return [...this.cards.values()].filter((candidate) => candidate.identityId === card!.identityId)
    }
    const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(`oracleid:${card.identityId}`)}&unique=prints&order=released&dir=desc`
    const cards = await this.readPages(url, 4)
    this.remember(cards)
    this.loadedPrintingIdentities.add(card.identityId)
    await this.saveCache()
    return cards
  }

  private async readPages(initialUrl: string, maximumPages: number): Promise<CardRecord[]> {
    const cards: CardRecord[] = []
    let url: string | undefined = initialUrl
    for (let page = 0; url && page < maximumPages; page++) {
      assertAllowedHttpsUrl(url, ['api.scryfall.com'])
      const response: ScryfallList = await this.requestJson<ScryfallList>(url)
      cards.push(...response.data.map(normalizeScryfallCard).filter(isCardRecord))
      url = response.has_more ? response.next_page : undefined
    }
    return cards
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    assertAllowedHttpsUrl(url, ['api.scryfall.com'])
    const previous = this.requestQueue
    let release!: () => void
    this.requestQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const delay = Math.max(0, SCRYFALL_MIN_REQUEST_GAP_MS - (Date.now() - this.lastRequestAt))
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      const response = await fetch(url, init ?? { headers: SCRYFALL_HEADERS })
      this.lastRequestAt = Date.now()
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Scryfall request failed (${response.status})${detail ? `: ${detail.slice(0, 180)}` : '.'}`)
      }
      return await response.json() as T
    } finally {
      release()
    }
  }

  private async loadCache(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.snapshotPath, 'utf8')) as CatalogSnapshot
      for (const card of parsed.cards ?? []) {
        if (card.game === 'mtg') this.cards.set(card.id, card)
      }
    } catch {
      // A missing or stale cache is rebuilt from live requests.
    }
  }

  private remember(cards: CardRecord[]): void {
    for (const card of cards) this.cards.set(card.id, card)
  }

  private async saveCache(): Promise<void> {
    await mkdir(join(this.cacheDirectory, 'catalog'), { recursive: true })
    await writeFile(this.snapshotPath, JSON.stringify(this.snapshot()), 'utf8')
  }

  private snapshot(): CatalogSnapshot {
    return {
      cards: [...this.cards.values()],
      source: 'https://api.scryfall.com',
      fetchedAt: new Date().toISOString(),
      game: 'mtg',
      developmentOnly: false
    }
  }
}

function normalizeScryfallCard(card: ScryfallCard): CardRecord | undefined {
  const frontImages = card.image_uris ?? card.card_faces?.[0]?.image_uris
  const backImages = card.card_faces?.[1]?.image_uris
  const imageUrl = frontImages?.png ?? frontImages?.large
  if (!imageUrl) return undefined
  assertAllowedHttpsUrl(imageUrl, ['cards.scryfall.io'])
  if (backImages?.png ?? backImages?.large) assertAllowedHttpsUrl((backImages.png ?? backImages.large)!, ['cards.scryfall.io'])
  const identityId = card.oracle_id ?? card.id
  const code = `${card.set.toUpperCase()}-${card.collector_number}`
  return {
    game: 'mtg',
    id: card.id,
    identityId,
    code,
    publicCode: code,
    setCode: card.set.toUpperCase(),
    setName: card.set_name,
    collectorNumber: card.collector_number,
    name: card.name,
    type: card.type_line ?? 'Unknown',
    rarity: card.rarity ?? 'unknown',
    orientation: 'portrait',
    isVariant: Boolean(card.promo || card.frame_effects?.length),
    baseCode: identityId,
    imageUrl,
    ...(backImages?.png ?? backImages?.large ? { backImageUrl: backImages?.png ?? backImages?.large } : {}),
    imageHash: createHash('sha1').update(imageUrl).digest('hex'),
    imageQuality: frontImages?.png && card.image_status === 'highres_scan' ? 'highres' : 'fallback',
    language: card.lang ?? 'en',
    layout: card.layout ?? 'normal',
    faceNames: card.card_faces?.map((face) => face.name) ?? [card.name],
    ...(card.released_at ? { releasedAt: card.released_at } : {}),
    ...(card.artist ? { artist: card.artist } : {}),
    treatments: [...new Set([...(card.frame_effects ?? []), ...(card.promo_types ?? []), ...(card.finishes ?? [])])]
  }
}

function isCardRecord(card: CardRecord | undefined): card is CardRecord {
  return Boolean(card)
}

function scryfallIdentifier(line: ImportedDeckLine): Record<string, string> {
  if (line.requestedSetCode && line.requestedCollectorNumber) {
    return { set: line.requestedSetCode.toLowerCase(), collector_number: line.requestedCollectorNumber }
  }
  return { name: line.name }
}

function identifierKey(line: ImportedDeckLine): string {
  return line.requestedSetCode && line.requestedCollectorNumber
    ? `${line.requestedSetCode.toLowerCase()}:${line.requestedCollectorNumber.toLowerCase()}`
    : normalizeCardName(line.name)
}

function scryfallEntry(line: ImportedDeckLine, cards: CardRecord[]): DeckEntry {
  const selected = cards.find((card) => {
    if (line.requestedSetCode && line.requestedCollectorNumber) {
      return card.setCode.toLowerCase() === line.requestedSetCode.toLowerCase() &&
        card.collectorNumber.toLowerCase() === line.requestedCollectorNumber.toLowerCase()
    }
    const requested = normalizeCardName(line.name)
    return normalizeCardName(card.name) === requested || card.faceNames?.some((face) => normalizeCardName(face) === requested)
  })
  if (!selected) {
    return {
      id: randomUUID(),
      rawName: line.name,
      quantity: line.quantity,
      section: line.section,
      candidateCardIds: [],
      allocations: [],
      resolution: 'missing'
    }
  }
  return {
    id: randomUUID(),
    rawName: line.name,
    quantity: line.quantity,
    section: line.section,
    resolvedCardId: selected.id,
    candidateCardIds: [selected.id],
    allocations: [{
      id: randomUUID(),
      quantity: line.quantity,
      front: { kind: 'official', cardId: selected.id, imageUrl: selected.imageUrl, face: 'front' },
      ...(selected.backImageUrl
        ? { back: { kind: 'official' as const, cardId: selected.id, imageUrl: selected.backImageUrl, face: 'back' as const } }
        : {})
    }],
    resolution: 'resolved'
  }
}

function imageHashFromUrl(url: string): string | undefined {
  const match = /\/([a-f0-9]{40})-\d+x\d+\./i.exec(url)
  return match?.[1]
}

export function catalogFingerprint(cards: CardRecord[]): string {
  return createHash('sha256')
    .update(cards.map((card) => `${card.code}:${card.imageHash ?? card.imageUrl}`).join('\n'))
    .digest('hex')
}
