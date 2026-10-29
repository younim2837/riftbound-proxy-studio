import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DevelopmentCatalogProvider } from '../src/main/services/catalog-provider.js'
import { parseRiftboundSnapshot } from '../src/main/services/riftbound-gallery.js'
import { ArtworkSourceResolver, SharpArtworkPipeline } from '../src/main/services/artwork-pipeline.js'
import { RiftboundDeckImporter } from '../src/main/services/deck-importer.js'
import { resolveImportedDeck } from '../src/main/services/resolver.js'

const fixturePath = 'resources/dev-catalog-v1.json'
const previous = parseRiftboundSnapshot(JSON.parse(await readFile(fixturePath, 'utf8')))
const directory = await mkdtemp(join(tmpdir(), 'proxy-studio-radiance-'))
const snapshot = await new DevelopmentCatalogProvider(directory, fixturePath).load(true)
assert.equal(snapshot.cacheStatus, 'live', 'Do not bundle an offline fallback as a fresh catalog')
const radiance = snapshot.cards.filter((card) => card.setCode === 'RAD')
assert(radiance.length > 0, 'The live gallery has no Radiance cards')
const ids = new Set(snapshot.cards.map((card) => card.id))
const missing = previous.cards.filter((card) => !ids.has(card.id))
assert.deepEqual(missing.map((card) => card.id), [], 'Review removed card IDs before updating the bundled catalog')

const codes = ['RAD-065', 'RAD-065A', 'RAD-132', 'RAD-R05A', 'RAD-157']
const cards = codes.map((code) => {
  const card = snapshot.cards.find((candidate) => candidate.code === code)
  assert(card, `Missing Radiance specimen: ${code}`)
  return card
})
const imported = new RiftboundDeckImporter().importText(cards.map((card) => `1 ${card.code} ${card.name}`).join('\n'))
assert.equal(imported.lines.length, cards.length)
const entries = resolveImportedDeck(imported, snapshot.cards)
assert(entries.every((entry) => entry.resolution === 'resolved'))
assert.deepEqual(entries.map((entry) => entry.resolvedCardId), cards.map((card) => card.id))
const resolver = new ArtworkSourceResolver(directory)
const pipeline = new SharpArtworkPipeline(directory)
for (const card of cards) {
  const source = await resolver.load({ kind: 'official', cardId: card.id, imageUrl: card.imageUrl }, {})
  const derivative = await pipeline.createMpcDerivative('riftbound', source.sourceId, source.bytes)
  const proof = await pipeline.createMpcPlacementProof('riftbound', derivative)
  assert(proof.placementVerified && proof.edgeBleedVerified && proof.opaque)
}
if (process.argv.includes('--update-fixture')) {
  // Mechanical regeneration of metadata only. Official image bytes stay in temp/cache.
  const { cacheStatus: _status, checkedAt: _checked, warning: _warning, ...bundled } = snapshot
  await writeFile(fixturePath, JSON.stringify(bundled) + '\n', 'utf8')
}
console.log(JSON.stringify({ source: snapshot.source, fetchedAt: snapshot.fetchedAt, printings: snapshot.cards.length, sets: [...new Set(snapshot.cards.map((card) => card.setName))].sort(), radiancePrintings: radiance.length, previousIdsPreserved: previous.cards.length, importAndArtworkVerified: codes, updatedFixture: process.argv.includes('--update-fixture'), directory }, null, 2))
