import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CardCatalogProvider } from './interfaces.js'
import type { CardRecord, CatalogSnapshot } from '../../shared/contracts.js'
import { assertAllowedHttpsUrl } from '../../shared/schemas.js'

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
      return cached
    }

    if (!forceRefresh && this.fixturePath) {
      try {
        const fixture = JSON.parse(await readFile(this.fixturePath, 'utf8')) as CatalogSnapshot
        if (!Array.isArray(fixture.cards) || fixture.cards.length === 0) {
          throw new Error('The bundled development catalog contains no cards.')
        }
        const snapshot: CatalogSnapshot = {
          ...fixture,
          source: 'fixture:dev-catalog-v1',
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

function normalizeDevelopmentCard(card: DevelopmentCatalogCard): CardRecord {
  assertAllowedHttpsUrl(card.imageUrl, ['cmsassets.rgpub.io'])
  const code = card.code.toUpperCase().replace(/\*$/, 's')
  const baseCode = code.replace(/(?:[a-z]|s)$/i, '')
  const imageHash = imageHashFromUrl(card.imageUrl)
  return {
    id: card.id || code.toLowerCase(),
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

function imageHashFromUrl(url: string): string | undefined {
  const match = /\/([a-f0-9]{40})-\d+x\d+\./i.exec(url)
  return match?.[1]
}

export function catalogFingerprint(cards: CardRecord[]): string {
  return createHash('sha256')
    .update(cards.map((card) => `${card.code}:${card.imageHash ?? card.imageUrl}`).join('\n'))
    .digest('hex')
}
