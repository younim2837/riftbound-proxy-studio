import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SharpArtworkPipeline } from '../src/main/services/artwork-pipeline.js'
import { ScryfallCatalogProvider } from '../src/main/services/catalog-provider.js'
import { MtgDeckImporter } from '../src/main/services/deck-importer.js'

const liveTest = process.env.RUN_SCRYFALL_LIVE === '1' ? it : it.skip
const headers = {
  accept: 'application/json;q=0.9,*/*;q=0.8',
  'user-agent': 'ProxyStudio/0.3 integration-test (+https://github.com/younim2837/riftbound-proxy-studio)'
}

describe('live Scryfall integration', () => {
  liveTest('downloads a high-resolution PNG and creates an opaque Magic MPC derivative', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'proxy-studio-scryfall-live-'))
    const imported = new MtgDeckImporter().importText('1 Lightning Bolt\n1 Delver of Secrets')
    const provider = new ScryfallCatalogProvider(folder)
    const resolved = await provider.resolveImport(imported)
    expect(resolved.entries.every((entry) => entry.resolution === 'resolved')).toBe(true)
    expect(resolved.cards.find((card) => card.faceNames?.includes('Delver of Secrets'))?.backImageUrl).toMatch(/^https:\/\/cards\.scryfall\.io\/png\//)
    const card = resolved.cards.find((candidate) => candidate.name === 'Lightning Bolt')!
    expect(card.imageQuality).toBe('highres')
    expect(card.imageUrl).toMatch(/^https:\/\/cards\.scryfall\.io\/png\//)
    const printings = await provider.printings(card.id)
    expect(printings.length).toBeGreaterThan(5)
    expect(printings.every((printing) => printing.identityId === card.identityId)).toBe(true)
    expect(printings.some((printing) => printing.releasedAt && printing.artist)).toBe(true)
    const imageResponse = await fetch(card.imageUrl, { headers: { 'user-agent': headers['user-agent'] } })
    expect(imageResponse.ok).toBe(true)

    const pipeline = new SharpArtworkPipeline(folder)
    const derivative = await pipeline.createMpcDerivative('mtg', `scryfall:${card.id}`, new Uint8Array(await imageResponse.arrayBuffer()))
    const proof = await pipeline.createMpcPlacementProof('mtg', derivative)
    expect(proof).toMatchObject({
      width: 822,
      height: 1122,
      opaque: true,
      transparentPixels: 0,
      trimRect: { x: 36, y: 36, width: 750, height: 1050 },
      safeRect: { x: 72, y: 72, width: 678, height: 978 },
      sourcePreserved: true,
      placementVerified: true
    })
  }, 30_000)
})
