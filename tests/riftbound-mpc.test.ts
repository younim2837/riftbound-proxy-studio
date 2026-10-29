import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { artworkPixelConstants, calculateMpcSourceRect, SharpArtworkPipeline } from '../src/main/services/artwork-pipeline.js'
import { GAME_PROFILES } from '../src/shared/contracts.js'

describe('Riftbound full-card MPC treatment', () => {
  it('preserves the original black border width and all face pixels at nominal trim', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-black-border-'))
    const source = await sharp(Buffer.from(`<svg width="744" height="1038" xmlns="http://www.w3.org/2000/svg"><rect width="744" height="1038" fill="#000000"/><rect x="14" y="14" width="716" height="1010" fill="#a83c7f"/><rect x="30" y="1005" width="500" height="5" fill="#ffffff"/></svg>`)).png().toBuffer()
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('riftbound', 'bordered', source)
    const cut = await pipeline.createMpcCutPreview('riftbound', result)
    expect((await sharp(cut).removeAlpha().raw().toBuffer()).equals(await sharp(source).removeAlpha().raw().toBuffer())).toBe(true)
    const proof = await pipeline.createMpcPlacementProof('riftbound', result)
    expect(proof).toMatchObject({ trimRect: { x: 36, y: 36, width: 744, height: 1038 }, sourceRect: { x: 36, y: 36, width: 744, height: 1038 }, edgeBleedVerified: true, nonEdgeBleedPixels: 0 })
  })

  it.each(['bordered', 'borderless'])('repairs rounded transparent %s corners without a matte or changed opaque face pixels', async (kind) => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-rounded-'))
    const edge = kind === 'bordered' ? '#000000' : '#245a92'
    const source = await sharp(Buffer.from(`<svg width="744" height="1038" xmlns="http://www.w3.org/2000/svg"><rect width="744" height="1038" rx="45" fill="${edge}"/><rect x="70" y="70" width="604" height="898" fill="#c86b28"/></svg>`)).png().toBuffer()
    const pipeline = new SharpArtworkPipeline(folder)
    const result = await pipeline.createMpcDerivative('riftbound', kind, source)
    const expected = await sharp(source).ensureAlpha().raw().toBuffer()
    const actual = await sharp(await pipeline.createMpcCutPreview('riftbound', result)).raw().toBuffer()
    let changedOpaquePixels = 0
    for (let i = 0; i < 744 * 1038; i++) {
      if (expected[i * 4 + 3] !== 255) continue
      for (let channel = 0; channel < 3; channel++) {
        if (actual[i * 3 + channel] !== expected[i * 4 + channel]) { changedOpaquePixels++; break }
      }
    }
    expect(changedOpaquePixels).toBe(0)
    expect([...actual.subarray(0, 3)]).toEqual(kind === 'bordered' ? [0, 0, 0] : [36, 90, 146])
    const proof = await pipeline.createMpcPlacementProof('riftbound', result)
    expect(proof).toMatchObject({ opaque: true, transparentPixels: 0, edgeBleedVerified: true, nonEdgeBleedPixels: 0, placementVerified: true })
  })

  it('copies sharp borderless edge pixels through the whole bleed, including shifted cuts', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-borderless-'))
    const source = await sharp(Buffer.from(`<svg width="744" height="1038" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#ee3a20"/><stop offset="1" stop-color="#2072dd"/></linearGradient></defs><rect width="744" height="1038" fill="url(#g)"/><path d="M0 0H744V10H0ZM0 1028H744V1038H0Z" fill="#22cc66"/></svg>`)).png().toBuffer()
    const result = await new SharpArtworkPipeline(folder).createMpcDerivative('riftbound', 'edge-art', source)
    const expected = await sharp(source).removeAlpha().extend({ top: 36, right: 36, bottom: 36, left: 36, extendWith: 'copy' }).raw().toBuffer()
    const actual = await sharp(result.filePath).raw().toBuffer()
    expect(actual.equals(expected)).toBe(true)
    // These are illustrative offsets, not an assertion of MPC's cut tolerance.
    for (const x of [24, 36, 48]) for (const y of [24, 36, 48]) {
      const cut = await sharp(result.filePath).extract({ left: x, top: y, width: 744, height: 1038 }).raw().toBuffer()
      const expectedCut = await sharp(expected, { raw: { width: 816, height: 1110, channels: 3 } }).extract({ left: x, top: y, width: 744, height: 1038 }).raw().toBuffer()
      expect(cut.equals(expectedCut)).toBe(true)
    }
  })

  it('rotates landscape faces without losing or distorting their edges', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-rotation-'))
    const portrait = await sharp(Buffer.from('<svg width="744" height="1038" xmlns="http://www.w3.org/2000/svg"><rect width="744" height="1038" fill="#308fa4"/><rect width="744" height="30" fill="#ee4422"/></svg>')).png().toBuffer()
    const landscape = await sharp(portrait).rotate(-90).png().toBuffer()
    const pipeline = new SharpArtworkPipeline(folder)
    const derivative = await pipeline.createMpcDerivative('riftbound', 'landscape', landscape, true)
    const cut = await pipeline.createMpcCutPreview('riftbound', derivative)
    expect((await sharp(cut).raw().toBuffer()).equals(await sharp(portrait).removeAlpha().raw().toBuffer())).toBe(true)
  })

  it('blocks a corrupt cached bleed instead of uploading it', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-bad-cache-'))
    const source = await sharp({ create: { width: 744, height: 1039, channels: 3, background: '#253647' } }).png().toBuffer()
    const pipeline = new SharpArtworkPipeline(folder)
    const derivative = await pipeline.createMpcDerivative('riftbound', 'cached', source)
    const corrupt = await sharp(derivative.filePath).composite([{ input: await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ff00ff' } }).png().toBuffer(), left: 0, top: 500 }]).removeAlpha().png().toBuffer()
    await writeFile(derivative.filePath, corrupt)
    expect(await pipeline.createMpcPlacementProof('riftbound', derivative)).toMatchObject({ edgeBleedVerified: false, nonEdgeBleedPixels: 1, placementVerified: false })
    await expect(pipeline.createMpcDerivative('riftbound', 'cached', source)).rejects.toThrow('Upload blocked')
  })

  it('rejects fully transparent inputs and invalid source dimensions', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-empty-'))
    const source = await sharp({ create: { width: 744, height: 1038, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer()
    await expect(new SharpArtworkPipeline(folder).createMpcDerivative('riftbound', 'invisible', source)).rejects.toThrow('completely transparent')
    for (const width of [0, -1, NaN, Infinity]) expect(() => calculateMpcSourceRect(GAME_PROFILES.riftbound, width, 1039)).toThrow('positive finite')
  })

  it('invalidates only Riftbound MPC cache keys, retaining Magic and PDF profiles', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rb-cache-scope-'))
    const source = await sharp({ create: { width: 744, height: 1039, channels: 3, background: '#334455' } }).png().toBuffer()
    const contentHash = createHash('sha256').update(source).digest('hex')
    const key = (profile: string, game: string, output: string) => createHash('sha256').update(`${profile}:${game}:cache-test:${contentHash}:${output}:auto`).digest('hex') + '.png'
    const pipeline = new SharpArtworkPipeline(folder)
    const riftbound = await pipeline.createMpcDerivative('riftbound', 'cache-test', source)
    const magic = await pipeline.createMpcDerivative('mtg', 'cache-test', source)
    const pdf = await pipeline.createPdfDerivative('riftbound', 'cache-test', source, 1.5)
    expect(basename(riftbound.filePath)).toBe(key(artworkPixelConstants.riftboundMpcProfileVersion, 'riftbound', 'mpc'))
    expect(basename(riftbound.filePath)).not.toBe(key('v11-magic-full-trim-face', 'riftbound', 'mpc'))
    expect(basename(magic.filePath)).toBe(key('v11-magic-full-trim-face', 'mtg', 'mpc'))
    expect(basename(pdf.filePath)).toBe(key('v11-magic-full-trim-face', 'riftbound', 'pdf-18'))
  })
})
