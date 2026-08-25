import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DevelopmentCatalogProvider } from '../src/main/services/catalog-provider.js'
import type { CatalogSnapshot } from '../src/shared/contracts.js'

describe('development catalog provider', () => {
  it('boots from the versioned local fixture without a network request', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-catalog-'))
    const fixturePath = join(folder, 'dev-catalog-v1.json')
    const fixture: CatalogSnapshot = {
      source: 'test fixture',
      fetchedAt: '2026-08-24T00:00:00.000Z',
      developmentOnly: true,
      cards: [{
        id: 'ogn-001', code: 'OGN-001', publicCode: 'OGN-001/298', setCode: 'OGN', setName: 'Origins',
        collectorNumber: '1', name: 'Blazing Scorcher', type: 'Unit', rarity: 'Common', orientation: 'portrait',
        isVariant: false, baseCode: 'OGN-001', imageUrl: 'https://cmsassets.rgpub.io/example.png'
      }]
    }
    await writeFile(fixturePath, JSON.stringify(fixture), 'utf8')

    const loaded = await new DevelopmentCatalogProvider(join(folder, 'cache'), fixturePath).load()

    expect(loaded.cards).toHaveLength(1)
    expect(loaded.source).toBe('fixture:dev-catalog-v1')
  })
})
