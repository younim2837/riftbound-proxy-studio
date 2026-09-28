import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DevelopmentCatalogProvider, ScryfallCatalogProvider } from '../src/main/services/catalog-provider.js'
import { MtgDeckImporter } from '../src/main/services/deck-importer.js'
import type { CatalogSnapshot } from '../src/shared/contracts.js'

describe('development catalog provider', () => {
  it('boots from the versioned local fixture without a network request', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-catalog-'))
    const fixturePath = join(folder, 'dev-catalog-v1.json')
    const fixture: CatalogSnapshot = {
      source: 'test fixture',
      fetchedAt: '2026-08-24T00:00:00.000Z',
      game: 'riftbound',
      developmentOnly: true,
      cards: [{
        game: 'riftbound', id: 'ogn-001', identityId: 'OGN-001', code: 'OGN-001', publicCode: 'OGN-001/298', setCode: 'OGN', setName: 'Origins',
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

describe('Scryfall catalog provider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves named cards and assigns a transform reverse face', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'scryfall-catalog-'))
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('user-agent')).toContain('ProxyStudio/0.3')
      return new Response(JSON.stringify({
        object: 'list',
        not_found: [],
        data: [{
          id: '6904ea20-e504-47da-95a0-08739fdde260',
          oracle_id: 'oracle-delver',
          name: 'Delver of Secrets // Insectile Aberration',
          set: 'mid',
          set_name: 'Innistrad: Midnight Hunt',
          collector_number: '47',
          type_line: 'Creature — Human Wizard // Creature — Human Insect',
          rarity: 'uncommon',
          lang: 'en',
          layout: 'transform',
          image_status: 'highres_scan',
          released_at: '2021-09-24',
          artist: 'Nils Hamm',
          finishes: ['nonfoil', 'foil'],
          frame_effects: ['showcase'],
          card_faces: [
            { name: 'Delver of Secrets', image_uris: { png: 'https://cards.scryfall.io/png/front/delver.png' } },
            { name: 'Insectile Aberration', image_uris: { png: 'https://cards.scryfall.io/png/back/delver.png' } }
          ]
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const imported = new MtgDeckImporter().importText('1 Delver of Secrets')
    const resolved = await new ScryfallCatalogProvider(folder).resolveImport(imported)
    expect(resolved.cards[0]).toMatchObject({
      game: 'mtg',
      identityId: 'oracle-delver',
      imageQuality: 'highres',
      backImageUrl: 'https://cards.scryfall.io/png/back/delver.png',
      releasedAt: '2021-09-24',
      artist: 'Nils Hamm',
      treatments: ['showcase', 'nonfoil', 'foil']
    })
    expect(resolved.entries[0]).toMatchObject({
      resolution: 'resolved',
      allocations: [{
        front: { face: 'front', imageUrl: 'https://cards.scryfall.io/png/front/delver.png' },
        back: { face: 'back', imageUrl: 'https://cards.scryfall.io/png/back/delver.png' }
      }]
    })
  })
})
