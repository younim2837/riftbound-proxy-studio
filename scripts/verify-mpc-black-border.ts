import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { ArtworkSourceResolver, SharpArtworkPipeline } from '../src/main/services/artwork-pipeline.js'
import { PlaywrightMpcAutomationDriver } from '../src/main/services/mpc-automation.js'
import { DEFAULT_MPC_SETTINGS, DEFAULT_PRINT_SETTINGS, GAME_PROFILES, PROJECT_SCHEMA_VERSION, type CardRecord, type ProjectManifest, type MpcPlacementProof } from '../src/shared/contracts.js'

// Uses selected Scryfall images on demand; no official artwork is committed.
const artCache = process.env.PROXY_STUDIO_ART_CACHE ?? join(process.env.APPDATA ?? '', 'riftbound-proxy-studio', 'cache')
const catalog = JSON.parse(await readFile(join(artCache, 'catalog', 'scryfall-cards.json'), 'utf8')) as { cards: CardRecord[] }
const specimens = [
  ['Cormela, Glamour Thief', 'SNC', '177'],
  ['Vial Smasher the Fierce', 'DSC', '239'],
  ['Talisman of Creativity', 'MSC', '218'],
  ['Cormela, Glamour Thief', 'SNC', '301']
]
const cards = specimens.map(([name, set, number]) => {
  const card = catalog.cards.find((candidate) => candidate.name === name && candidate.setCode === set && candidate.collectorNumber === number)
  assert(card, `Select/cache ${name} (${set} ${number}) before this verification.`)
  return card
})
const directory = await mkdtemp(join(tmpdir(), 'proxy-studio-full-face-'))
const pipeline = new SharpArtworkPipeline(directory)
const resolver = new ArtworkSourceResolver(artCache)
const records: { name: string; proof: MpcPlacementProof; fullScaleTrimPixelsEqual: boolean; horizontalFitPaddingPx: number; verticalFitPaddingPx: number }[] = []
const previews: OverlayOptions[] = []
for (const [index, card] of cards.entries()) {
  const source = await resolver.load({ kind: 'official', cardId: card.id, imageUrl: card.imageUrl }, {})
  const derivative = await pipeline.createMpcDerivative('mtg', source.sourceId, source.bytes)
  const proof = await pipeline.createMpcPlacementProof('mtg', derivative)
  assert(proof.placementVerified && proof.blackBorderVerified && proof.nonBlackBorderPixels === 0)
  const rect = proof.sourceRect
  const expected = await sharp(source.bytes).resize(750, 1050, { fit: 'contain', background: '#000000', kernel: sharp.kernel.lanczos3 }).flatten({ background: '#000000' }).removeAlpha().raw().toBuffer()
  const actual = await sharp(derivative.filePath).extract({ left: 36, top: 36, width: 750, height: 1050 }).raw().toBuffer()
  assert(actual.equals(expected), `${card.name}: cut preview differs from the full-scale Scryfall face`)
  assert(rect.width >= 747 && rect.height >= 1047, `${card.name}: face is still shrunk instead of fitted to trim`)
  records.push({ name: `${card.name} (${card.setCode} ${card.collectorNumber})`, proof, fullScaleTrimPixelsEqual: true, horizontalFitPaddingPx: 750 - rect.width, verticalFitPaddingPx: 1050 - rect.height })
  const cut = await pipeline.createMpcCutPreview('mtg', derivative)
  await writeFile(join(directory, `cut-${index + 1}.png`), cut)
  previews.push({ input: await sharp(cut).resize(375, 525).png().toBuffer(), left: index * 395 + 15, top: 15 })
  if (index === 0) {
    const originalPreview = await sharp(source.bytes).resize(375, 525, { fit: 'contain', background: '#000000' }).flatten({ background: '#000000' }).removeAlpha().png().toBuffer()
    const cutPreview = await sharp(cut).resize(375, 525).png().toBuffer()
    const label = Buffer.from('<svg width="800" height="40" xmlns="http://www.w3.org/2000/svg"><text x="205" y="26" text-anchor="middle" fill="white" font-family="Arial" font-size="18">Scryfall face</text><text x="600" y="26" text-anchor="middle" fill="white" font-family="Arial" font-size="18">MPC after nominal trim</text></svg>')
    await sharp({ create: { width: 800, height: 580, channels: 3, background: '#666666' } }).composite([{ input: label, left: 0, top: 0 }, { input: originalPreview, left: 15, top: 45 }, { input: cutPreview, left: 410, top: 45 }]).png().toFile(join(directory, 'source-vs-cut.png'))
  }
}
await sharp({ create: { width: cards.length * 395 + 10, height: 555, channels: 3, background: '#7b7b7b' } }).composite(previews).png().toFile(join(directory, 'cut-comparison.png'))
await writeFile(join(directory, 'pixels.json'), JSON.stringify(records, null, 2))
console.log(`PIXEL PROOF: ${directory}`)
console.log(`${cards.length} real printings: full-scale nominal trim matches Scryfall pixels exactly; only 0-3 px total fit padding; separate bleed black.`)

if (process.argv.includes('--mpc')) {
  const back = await sharp(Buffer.from('<svg width="750" height="1050" xmlns="http://www.w3.org/2000/svg"><rect width="750" height="1050" fill="#111111"/><text x="375" y="490" text-anchor="middle" fill="white" font-size="64" font-family="Arial">PROXY</text><text x="375" y="560" text-anchor="middle" fill="white" font-size="28" font-family="Arial">FULL FACE VERIFICATION</text></svg>')).png().toBuffer()
  const now = new Date().toISOString()
  const manifest: ProjectManifest = {
    schemaVersion: PROJECT_SCHEMA_VERSION, game: 'mtg', projectId: randomUUID(), title: 'Black border verification', createdAt: now, updatedAt: now,
    decks: [{ id: 'verification', title: 'Border specimens', entries: cards.map((card, index) => ({
      id: `card-${index}`, rawName: card.name, quantity: 1, section: 'main', resolvedCardId: card.id, candidateCardIds: [card.id], resolution: 'resolved',
      allocations: [{ id: `art-${index}`, quantity: 1, front: { kind: 'official', cardId: card.id, imageUrl: card.imageUrl } }]
    })) }],
    globalBack: { kind: 'custom', assetId: 'back', archivePath: 'assets/back.png', displayName: 'Verification proxy back' },
    printSettings: { ...DEFAULT_PRINT_SETTINGS, cardWidthMm: GAME_PROFILES.mtg.cardWidthMm, cardHeightMm: GAME_PROFILES.mtg.cardHeightMm },
    mpcSettings: { ...DEFAULT_MPC_SETTINGS, product: GAME_PROFILES.mtg.mpcProduct }
  }
  const driver = new PlaywrightMpcAutomationDriver(directory, pipeline, resolver)
  try {
    await driver.run({ manifest, customAssets: { back } }, (event) => console.log(`${event.stage}: ${event.message}`))
    const proofs = join(directory, 'automation', 'proofs')
    console.log(`MPC SCREENSHOTS: ${(await readdir(proofs)).map((name) => join(proofs, name)).join('\n')}`)
    await mkdir(join(directory, 'verification'), { recursive: true })
    await writeFile(join(directory, 'verification', 'complete.json'), JSON.stringify({ reviewReached: true, checkoutPerformed: false, records }, null, 2))
  } finally {
    await driver.cancel()
  }
}
