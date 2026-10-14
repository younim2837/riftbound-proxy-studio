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
const directory = await mkdtemp(join(tmpdir(), 'proxy-studio-black-border-'))
const pipeline = new SharpArtworkPipeline(directory)
const resolver = new ArtworkSourceResolver(artCache)
const records: { name: string; proof: MpcPlacementProof; sourcePixelsEqual: boolean; cutStressPixelsNonBlack: number }[] = []
const previews: OverlayOptions[] = []
for (const [index, card] of cards.entries()) {
  const source = await resolver.load({ kind: 'official', cardId: card.id, imageUrl: card.imageUrl }, {})
  const derivative = await pipeline.createMpcDerivative('mtg', source.sourceId, source.bytes)
  const proof = await pipeline.createMpcPlacementProof('mtg', derivative)
  assert(proof.placementVerified && proof.blackBorderVerified && proof.nonBlackBorderPixels === 0)
  const rect = proof.sourceRect
  const expected = await sharp(source.bytes).resize(rect.width, rect.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).flatten({ background: '#000000' }).removeAlpha().raw().toBuffer()
  const actual = await sharp(derivative.filePath).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }).raw().toBuffer()
  assert(actual.equals(expected), `${card.name}: normalized source face changed`)
  const { data, info } = await sharp(derivative.filePath).raw().toBuffer({ resolveWithObject: true })
  const isBlack = (x: number, y: number): boolean => {
    const offset = (y * info.width + x) * info.channels
    return data[offset] === 0 && data[offset + 1] === 0 && data[offset + 2] === 0
  }
  let nonBlack = 0
  for (let dx = -23; dx <= 23; dx++) {
    for (let dy = -23; dy <= 23; dy++) {
      for (let x = 36 + dx; x < 786 + dx; x++) {
        if (!isBlack(x, 36 + dy)) nonBlack++
        if (!isBlack(x, 1085 + dy)) nonBlack++
      }
      for (let y = 36 + dy; y < 1086 + dy; y++) {
        if (!isBlack(36 + dx, y)) nonBlack++
        if (!isBlack(785 + dx, y)) nonBlack++
      }
    }
  }
  assert.equal(nonBlack, 0, `${card.name}: colored pixels reach a +/-23 px stress-test cut`)
  records.push({ name: `${card.name} (${card.setCode} ${card.collectorNumber})`, proof, sourcePixelsEqual: true, cutStressPixelsNonBlack: nonBlack })
  const cut = await pipeline.createMpcCutPreview('mtg', derivative)
  await writeFile(join(directory, `cut-${index + 1}.png`), cut)
  previews.push({ input: await sharp(cut).resize(375, 525).png().toBuffer(), left: index * 395 + 15, top: 15 })
}
await sharp({ create: { width: cards.length * 395 + 10, height: 555, channels: 3, background: '#7b7b7b' } }).composite(previews).png().toFile(join(directory, 'cut-comparison.png'))
await writeFile(join(directory, 'pixels.json'), JSON.stringify(records, null, 2))
console.log(`PIXEL PROOF: ${directory}`)
console.log(`${cards.length} real printings: source pixels preserved, zero colored generated-border pixels, all 2,209 +/-23 px cut shifts black.`)

if (process.argv.includes('--mpc')) {
  const back = await sharp(Buffer.from('<svg width="750" height="1050" xmlns="http://www.w3.org/2000/svg"><rect width="750" height="1050" fill="#111111"/><text x="375" y="490" text-anchor="middle" fill="white" font-size="64" font-family="Arial">PROXY</text><text x="375" y="560" text-anchor="middle" fill="white" font-size="28" font-family="Arial">BLACK BORDER VERIFICATION</text></svg>')).png().toBuffer()
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
