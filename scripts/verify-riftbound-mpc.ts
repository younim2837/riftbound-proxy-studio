import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { ArtworkSourceResolver, SharpArtworkPipeline } from '../src/main/services/artwork-pipeline.js'
import { PlaywrightMpcAutomationDriver } from '../src/main/services/mpc-automation.js'
import { defaultMpcSettings, defaultPrintSettings, PROJECT_SCHEMA_VERSION, type CardRecord, type ProjectManifest } from '../src/shared/contracts.js'

// Official CDN artwork is fetched/cached on demand, never bundled in the repo.
const artCache = process.env.PROXY_STUDIO_ART_CACHE ?? join(process.env.APPDATA ?? '', 'riftbound-proxy-studio', 'cache')
const catalog = JSON.parse(await readFile('resources/dev-catalog-v1.json', 'utf8')) as { cards: CardRecord[] }
const codes = ['OGN-066', 'OGN-066A', 'OGN-166A', 'VEN-149', 'VEN-194', 'OGN-292']
const cards = codes.map((code) => {
  const card = catalog.cards.find((candidate) => candidate.code === code)
  assert(card, `Missing verification specimen: ${code}`)
  return card
})
const directory = await mkdtemp(join(tmpdir(), 'proxy-studio-riftbound-full-face-'))
const pipeline = new SharpArtworkPipeline(directory)
const resolver = new ArtworkSourceResolver(artCache)
const previews: OverlayOptions[] = []
const comparisons: OverlayOptions[] = []
const records = []
for (const [index, card] of cards.entries()) {
  const source = await resolver.load({ kind: 'official', cardId: card.id, imageUrl: card.imageUrl }, {})
  await writeFile(join(directory, `${card.code}-source.png`), source.bytes)
  const metadata = await sharp(source.bytes).metadata()
  console.log(JSON.stringify({ code: card.code, name: card.name, width: metadata.width, height: metadata.height, alpha: metadata.hasAlpha }))
  const preview = await sharp(source.bytes).resize(300, 420, { fit: 'contain', background: '#777777' }).png().toBuffer()
  const label = Buffer.from(`<svg width="320" height="35" xmlns="http://www.w3.org/2000/svg"><text x="10" y="25" font-family="Arial" font-size="18" fill="white">${card.code}</text></svg>`)
  previews.push({ input: preview, left: (index % 3) * 320 + 10, top: Math.floor(index / 3) * 465 + 35 }, { input: label, left: (index % 3) * 320, top: Math.floor(index / 3) * 465 })
  if (!process.argv.includes('--sources')) {
    const derivative = await pipeline.createMpcDerivative('riftbound', source.sourceId, source.bytes, card.orientation === 'landscape')
    const proof = await pipeline.createMpcPlacementProof('riftbound', derivative)
    assert(proof.placementVerified && proof.edgeBleedVerified && proof.nonEdgeBleedPixels === 0, `${card.code}: placement/bleed failed`)
    const normalized = sharp(source.bytes)
    if (card.orientation === 'landscape') normalized.rotate(90)
    const normalizedPng = await normalized.png().toBuffer()
    const { data: expected, info: expectedInfo } = await sharp(normalizedPng).resize(744, 1038, { fit: 'inside', kernel: sharp.kernel.lanczos3 }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const rect = proof.sourceRect
    assert.equal(rect.width, expectedInfo.width)
    assert.equal(rect.height, expectedInfo.height)
    assert(rect.width >= 742 && rect.height === 1038, `${card.code}: source face unexpectedly shrunk`)
    const actualFace = await sharp(derivative.filePath).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }).raw().toBuffer()
    let opaquePixels = 0
    let changedOpaquePixels = 0
    for (let i = 0; i < expectedInfo.width * expectedInfo.height; i++) {
      if (expected[i * 4 + 3] !== 255) continue
      opaquePixels++
      if ([0, 1, 2].some((channel) => expected[i * 4 + channel] !== actualFace[i * 3 + channel])) changedOpaquePixels++
    }
    assert.equal(changedOpaquePixels, 0, `${card.code}: preserved face pixels changed`)
    const cut = await pipeline.createMpcCutPreview('riftbound', derivative)
    await writeFile(join(directory, `${card.code}-cut.png`), cut)
    records.push({ code: card.code, name: card.name, proof, opaquePixelsCompared: opaquePixels, changedOpaquePixels, fitPaddingPx: { horizontal: 744 - rect.width, vertical: 1038 - rect.height }, physicalPrintVerified: false })
    const comparisonX = (index % 2) * 660
    const comparisonY = Math.floor(index / 2) * 490
    const label = Buffer.from(`<svg width="660" height="42" xmlns="http://www.w3.org/2000/svg"><text x="10" y="23" font-family="Arial" font-size="16" fill="white">${card.code} - Riot source</text><text x="340" y="23" font-family="Arial" font-size="16" fill="white">After nominal trim</text></svg>`)
    comparisons.push({ input: label, left: comparisonX, top: comparisonY }, { input: await sharp(normalizedPng).resize(310, 435, { fit: 'contain', background: '#777777' }).png().toBuffer(), left: comparisonX + 5, top: comparisonY + 42 }, { input: await sharp(cut).resize(310, 435).png().toBuffer(), left: comparisonX + 335, top: comparisonY + 42 })
  }
}
await sharp({ create: { width: 960, height: 930, channels: 3, background: '#505050' } }).composite(previews).png().toFile(join(directory, 'sources.png'))
await writeFile(join(directory, 'verification.json'), JSON.stringify({ physicalPrintVerified: false, records }, null, 2))
if (comparisons.length) await sharp({ create: { width: 1320, height: 1470, channels: 3, background: '#555555' } }).composite(comparisons).png().toFile(join(directory, 'source-vs-trim.png'))
console.log(`RIFTBOUND VERIFICATION: ${directory}`)

if (process.argv.includes('--mpc') && !process.argv.includes('--sources')) {
  const back = await sharp(Buffer.from('<svg width="744" height="1038" xmlns="http://www.w3.org/2000/svg"><rect width="744" height="1038" fill="#111111"/><text x="372" y="490" text-anchor="middle" fill="white" font-family="Arial" font-size="64">PROXY</text><text x="372" y="550" text-anchor="middle" fill="white" font-family="Arial" font-size="24">RIFTBOUND VERIFICATION</text><text x="372" y="610" text-anchor="middle" fill="white" font-family="Arial" font-size="24">NOT FOR SALE</text></svg>')).png().toBuffer()
  const now = new Date().toISOString()
  const manifest: ProjectManifest = {
    schemaVersion: PROJECT_SCHEMA_VERSION, game: 'riftbound', projectId: randomUUID(), title: 'Riftbound full-face border verification', createdAt: now, updatedAt: now,
    decks: [{ id: 'verification', title: 'Bordered, borderless, and landscape', entries: cards.map((card, index) => ({
      id: `card-${index}`, rawName: card.name, quantity: 1, section: 'main', resolvedCardId: card.id, candidateCardIds: [card.id], resolution: 'resolved',
      allocations: [{ id: `art-${index}`, quantity: 1, front: { kind: 'official', cardId: card.id, imageUrl: card.imageUrl } }]
    })) }],
    globalBack: { kind: 'custom', assetId: 'back', archivePath: 'assets/back.png', displayName: 'Verification proxy back' },
    printSettings: defaultPrintSettings('riftbound'), mpcSettings: defaultMpcSettings('riftbound')
  }
  const driver = new PlaywrightMpcAutomationDriver(directory, pipeline, resolver)
  try {
    await driver.run({ manifest, customAssets: { back } }, (event) => console.log(`${event.stage}: ${event.message}`))
    await writeFile(join(directory, 'mpc-result.json'), JSON.stringify({ reviewReached: true, checkoutPerformed: false, physicalPrintVerified: false }, null, 2))
    console.log(`MPC editor/review screenshots: ${join(directory, 'automation', 'proofs')}`)
  } finally {
    await driver.cancel()
  }
}
