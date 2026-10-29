import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import type { ArtworkPipeline } from './interfaces.js'
import {
  GAME_PROFILES,
  type ArtworkSelection,
  type GameId,
  type GameProfile,
  type ImageDerivative,
  type MpcPlacementProof,
  type PrintRect
} from '../../shared/contracts.js'
import { assertAllowedHttpsUrl } from '../../shared/schemas.js'

const DERIVATIVE_PROFILE_VERSION = 'v11-magic-full-trim-face'
// Invalidate only Riftbound MPC output. Sampled Magic and PDF keys stay intact.
const RIFTBOUND_MPC_PROFILE_VERSION = 'v12-riftbound-full-trim-edge-bleed'
const OFFICIAL_ART_HOSTS = ['cmsassets.rgpub.io', 'cards.scryfall.io'] as const

export class SharpArtworkPipeline implements ArtworkPipeline {
  constructor(private readonly cacheDirectory: string) {}

  async createMpcDerivative(
    game: GameId,
    sourceId: string,
    bytes: Uint8Array,
    landscape?: boolean
  ): Promise<ImageDerivative> {
    const derivative = await this.createDerivative(game, sourceId, bytes, GAME_PROFILES[game].mpcBleedPx, 'mpc', landscape)
    await assertMpcDerivative(game, derivative)
    return derivative
  }

  async createPdfDerivative(
    game: GameId,
    sourceId: string,
    bytes: Uint8Array,
    bleedMm: number,
    landscape?: boolean
  ): Promise<ImageDerivative> {
    const bleedPx = Math.round((bleedMm / 25.4) * 300)
    return this.createDerivative(game, sourceId, bytes, bleedPx, `pdf-${bleedPx}`, landscape)
  }

  private async createDerivative(
    game: GameId,
    sourceId: string,
    bytes: Uint8Array,
    bleedPx: number,
    outputProfile: string,
    landscape?: boolean
  ): Promise<ImageDerivative> {
    const cardProfile = GAME_PROFILES[game]
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const profileVersion = game === 'riftbound' && outputProfile === 'mpc'
      ? RIFTBOUND_MPC_PROFILE_VERSION : DERIVATIVE_PROFILE_VERSION
    const cacheKey = createHash('sha256')
      .update(`${profileVersion}:${game}:${sourceId}:${contentHash}:${outputProfile}:${landscape ?? 'auto'}`)
      .digest('hex')
    const folder = join(this.cacheDirectory, 'derivatives')
    const filePath = join(folder, `${cacheKey}.png`)
    const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 150_000_000 }).metadata()
    if (!metadata.width || !metadata.height) throw new Error('Artwork has no readable dimensions.')
    const shouldRotate = landscape ?? metadata.width > metadata.height
    const orientedWidth = shouldRotate ? metadata.height : metadata.width
    const orientedHeight = shouldRotate ? metadata.width : metadata.height
    const sourceRect = outputProfile === 'mpc'
      ? calculateMpcSourceRect(cardProfile, orientedWidth, orientedHeight)
      : trimRectFor(cardProfile)
    const existing = await readDerivative(filePath, sourceId)
    if (existing) return { ...existing, sourceRect }

    await mkdir(folder, { recursive: true })
    let normalized = sharp(bytes, { failOn: 'error', limitInputPixels: 150_000_000 })
    if (shouldRotate) normalized = normalized.rotate(90)
    const orientedSource = await normalized.png().toBuffer()
    let image: Sharp
    if (outputProfile === 'mpc') {
      if (game === 'mtg') {
        const face = await sharp(orientedSource)
          .resize(cardProfile.trimWidthPx, cardProfile.trimHeightPx, {
            fit: 'contain', background: '#000000', kernel: sharp.kernel.lanczos3
          })
          .flatten({ background: '#000000' })
          .removeAlpha()
          .png()
          .toBuffer()
        // Scryfall is already a finished card face. Fit it to physical trim,
        // never to MPC's internal safe guide; the 36 px bleed is added outside it.
        image = sharp({ create: {
          width: cardProfile.mpcCanvasWidthPx,
          height: cardProfile.mpcCanvasHeightPx,
          channels: 3,
          background: '#000000'
        } }).composite([{ input: face, left: cardProfile.mpcBleedPx, top: cardProfile.mpcBleedPx }])
      } else {
        // A Riftbound image is already a complete finished card, not artwork to
        // shrink inside the safety guide. Preserve its full face and proportions.
        const resizedFace = await sharp(orientedSource)
          .resize(cardProfile.trimWidthPx, cardProfile.trimHeightPx, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
          .png().toBuffer()
        const face = await fillTransparentRiftboundPixels(resizedFace)
        const faceMetadata = await sharp(face).metadata()
        if (faceMetadata.width !== sourceRect.width || faceMetadata.height !== sourceRect.height) {
          throw new Error('Riftbound normalized face dimensions do not match its trim placement.')
        }
        const trimRect = trimRectFor(cardProfile)
        const crispTrim = await sharp(face)
          .extend({
            left: sourceRect.x - trimRect.x,
            top: sourceRect.y - trimRect.y,
            right: trimRect.x + trimRect.width - sourceRect.x - sourceRect.width,
            bottom: trimRect.y + trimRect.height - sourceRect.y - sourceRect.height,
            extendWith: 'copy'
          })
          .png()
          .toBuffer()
        // Copy only the source's own edge into any sub-pixel fit padding and
        // the external bleed. Black borders stay black; borderless art stays
        // borderless. No blur, frame detection, crop, or generated surround.
        image = sharp(crispTrim).extend({
          left: cardProfile.mpcBleedPx, top: cardProfile.mpcBleedPx,
          right: cardProfile.mpcBleedPx, bottom: cardProfile.mpcBleedPx,
          extendWith: 'copy'
        })
      }
    } else {
      const trim = await sharp(orientedSource)
        .resize(cardProfile.trimWidthPx, cardProfile.trimHeightPx, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .flatten({ background: '#000000' })
        .removeAlpha()
        .png()
        .toBuffer()
      image = sharp(trim)
      if (bleedPx > 0) {
        image = image.extend({ top: bleedPx, right: bleedPx, bottom: bleedPx, left: bleedPx, extendWith: 'copy' })
      }
    }

    await image.removeAlpha().png({ compressionLevel: 9 }).withMetadata({ density: 300 }).toFile(filePath)
    const output = await readDerivative(filePath, sourceId)
    if (!output) throw new Error('Artwork derivative could not be written.')
    return { ...output, sourceRect }
  }

  async createMpcPlacementProof(game: GameId, derivative: ImageDerivative): Promise<MpcPlacementProof> {
    const profile = GAME_PROFILES[game]
    const metadata = await sharp(derivative.filePath).metadata()
    const transparentPixels = await countTransparentPixels(derivative.filePath)
    const opaque = !metadata.hasAlpha && transparentPixels === 0
    const trimRect = trimRectFor(profile)
    const safeRect = safeRectFor(profile)
    const sourceRect = derivative.sourceRect ?? safeRect
    const nonBlackBorderPixels = game === 'mtg'
      ? await countNonBlackGeneratedBorderPixels(derivative.filePath, sourceRect)
      : null
    const blackBorderVerified = nonBlackBorderPixels === null ? null : nonBlackBorderPixels === 0
    const nonEdgeBleedPixels = game === 'riftbound'
      ? await countNonEdgeGeneratedPixels(derivative.filePath, sourceRect) : null
    const edgeBleedVerified = nonEdgeBleedPixels === null ? null : nonEdgeBleedPixels === 0
    const placementVerified = derivative.width === profile.mpcCanvasWidthPx &&
      derivative.height === profile.mpcCanvasHeightPx && opaque && isMpcSourcePlacementValid(profile, sourceRect) && blackBorderVerified !== false && edgeBleedVerified !== false
    return {
      width: profile.mpcCanvasWidthPx,
      height: profile.mpcCanvasHeightPx,
      opaque,
      transparentPixels,
      bleedPx: profile.mpcBleedPx,
      trimRect,
      safeRect,
      sourceRect,
      sourcePreserved: true,
      sourceContainedInSafeArea: isRectContained(sourceRect, safeRect),
      placementVerified,
      borderTreatment: game === 'mtg' ? 'solid-black' : 'edge-extended',
      blackBorderVerified,
      nonBlackBorderPixels,
      edgeBleedVerified,
      nonEdgeBleedPixels,
      warnings: [
        ...(!opaque ? ['The MPC derivative contains transparent pixels.'] : []),
        ...(blackBorderVerified === false ? ['The generated Magic border or bleed contains non-black pixels.'] : []),
        ...(edgeBleedVerified === false ? ['The generated Riftbound fit padding or bleed does not match the source edge pixels.'] : []),
        ...(!isMpcSourcePlacementValid(profile, sourceRect) ? ['The complete card face is outside the trim placement.'] : []),
        ...(!isRectContained(sourceRect, safeRect) ? ['Full-card scale preserves the complete face at nominal trim. Source edge details may be outside MPC’s safe-area guide and can be affected by a shifted physical cut.'] : [])
      ]
    }
  }

  async createMpcCutPreview(game: GameId, derivative: ImageDerivative): Promise<Uint8Array> {
    const trim = trimRectFor(GAME_PROFILES[game])
    return new Uint8Array(await sharp(derivative.filePath)
      .extract({ left: trim.x, top: trim.y, width: trim.width, height: trim.height })
      .png()
      .toBuffer())
  }
}

export class ArtworkSourceResolver {
  constructor(private readonly cacheDirectory: string) {}

  async load(selection: ArtworkSelection, customAssets: Record<string, Uint8Array>): Promise<{ sourceId: string; bytes: Uint8Array }> {
    if (selection.kind === 'custom') {
      const bytes = customAssets[selection.assetId]
      if (!bytes) throw new Error(`Custom artwork is missing: ${selection.displayName}`)
      return { sourceId: `custom:${selection.assetId}`, bytes }
    }

    const url = assertAllowedHttpsUrl(selection.imageUrl, OFFICIAL_ART_HOSTS)
    const key = createHash('sha256').update(url.href).digest('hex')
    const folder = join(this.cacheDirectory, 'official')
    const path = join(folder, `${key}.img`)
    const sourceId = `official:${selection.cardId}:${selection.face ?? 'front'}:${key}`
    try {
      return { sourceId, bytes: new Uint8Array(await readFile(path)) }
    } catch {
      // Download below.
    }
    const response = await fetch(url, {
      headers: {
        accept: 'image/png,image/jpeg,image/webp,*/*;q=0.5',
        'user-agent': 'ProxyStudio/0.3 (+https://github.com/younim2837/riftbound-proxy-studio)'
      }
    })
    if (!response.ok) throw new Error(`Artwork download failed (${response.status}).`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 40 * 1024 * 1024) throw new Error('Artwork download exceeds 40 MB.')
    await mkdir(folder, { recursive: true })
    await writeFile(path, bytes)
    return { sourceId, bytes }
  }
}

async function readDerivative(filePath: string, sourceId: string): Promise<ImageDerivative | null> {
  try {
    const metadata = await sharp(filePath).metadata()
    if (!metadata.width || !metadata.height) return null
    const bytes = await readFile(filePath)
    return {
      sourceId,
      filePath,
      sha1: createHash('sha1').update(bytes).digest('hex').toUpperCase(),
      width: metadata.width,
      height: metadata.height
    }
  } catch {
    return null
  }
}

async function assertMpcDerivative(game: GameId, derivative: ImageDerivative): Promise<void> {
  const profile = GAME_PROFILES[game]
  if (derivative.width !== profile.mpcCanvasWidthPx || derivative.height !== profile.mpcCanvasHeightPx) {
    throw new Error(`MPC artwork must be exactly ${profile.mpcCanvasWidthPx}×${profile.mpcCanvasHeightPx} px; generated ${derivative.width}×${derivative.height}.`)
  }
  const metadata = await sharp(derivative.filePath).metadata()
  const transparentPixels = await countTransparentPixels(derivative.filePath)
  if (metadata.hasAlpha || transparentPixels > 0) {
    throw new Error(`MPC artwork is not fully opaque (${transparentPixels} transparent pixels).`)
  }
  if (!isMpcSourcePlacementValid(profile, derivative.sourceRect)) {
    throw new Error('MPC artwork source placement exceeds its allowed trim placement.')
  }
  if (game === 'mtg') {
    const nonBlackPixels = await countNonBlackGeneratedBorderPixels(derivative.filePath, derivative.sourceRect!)
    if (nonBlackPixels > 0) {
      throw new Error(`Magic MPC artwork has ${nonBlackPixels} non-black pixels in its generated border/bleed. Upload blocked.`)
    }
  } else {
    const nonEdgePixels = await countNonEdgeGeneratedPixels(derivative.filePath, derivative.sourceRect!)
    if (nonEdgePixels > 0) {
      throw new Error(`Riftbound MPC artwork has ${nonEdgePixels} pixels that do not match the source edge in its generated padding/bleed. Upload blocked.`)
    }
  }
}

async function countNonBlackGeneratedBorderPixels(filePath: string, sourceRect: PrintRect): Promise<number> {
  const { data, info } = await sharp(filePath).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x >= sourceRect.x && x < sourceRect.x + sourceRect.width && y >= sourceRect.y && y < sourceRect.y + sourceRect.height) continue
      const index = (y * info.width + x) * info.channels
      if (data[index] !== 0 || data[index + 1] !== 0 || data[index + 2] !== 0) count++
    }
  }
  return count
}

async function countNonEdgeGeneratedPixels(filePath: string, sourceRect: PrintRect): Promise<number> {
  const { data, info } = await sharp(filePath).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x >= sourceRect.x && x < sourceRect.x + sourceRect.width && y >= sourceRect.y && y < sourceRect.y + sourceRect.height) continue
      const sourceX = Math.max(sourceRect.x, Math.min(sourceRect.x + sourceRect.width - 1, x))
      const sourceY = Math.max(sourceRect.y, Math.min(sourceRect.y + sourceRect.height - 1, y))
      const pixel = (y * info.width + x) * info.channels
      const edge = (sourceY * info.width + sourceX) * info.channels
      if (data[pixel] !== data[edge] || data[pixel + 1] !== data[edge + 1] || data[pixel + 2] !== data[edge + 2]) count++
    }
  }
  return count
}

async function fillTransparentRiftboundPixels(face: Uint8Array): Promise<Buffer> {
  // Repair only missing coverage, e.g. a PNG's rounded transparent corners.
  // Nearest opaque colors (Manhattan distance, deterministic four-way fill)
  // avoid white/black mattes on borderless art. Fully opaque pixels are exact.
  const { data, info } = await sharp(face).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixels = info.width * info.height
  let maxAlpha = 0
  let transparent = false
  for (let i = 0; i < pixels; i++) {
    maxAlpha = Math.max(maxAlpha, data[i * 4 + 3]!)
    if (data[i * 4 + 3] !== 255) transparent = true
  }
  if (maxAlpha === 0) throw new Error('Riftbound artwork is completely transparent; choose a visible card image.')
  if (!transparent) return sharp(face).removeAlpha().png().toBuffer()

  const nearest = new Int32Array(pixels).fill(-1)
  const queue = new Int32Array(pixels)
  let tail = 0
  for (let i = 0; i < pixels; i++) {
    if (data[i * 4 + 3] === maxAlpha) { nearest[i] = i; queue[tail++] = i }
  }
  function visit(index: number, seed: number): void {
    if (nearest[index] === -1) { nearest[index] = seed; queue[tail++] = index }
  }
  for (let head = 0; head < tail; head++) {
    const pixel = queue[head]!
    const seed = nearest[pixel]!
    const x = pixel % info.width
    if (x > 0) visit(pixel - 1, seed)
    if (x + 1 < info.width) visit(pixel + 1, seed)
    if (pixel >= info.width) visit(pixel - info.width, seed)
    if (pixel + info.width < pixels) visit(pixel + info.width, seed)
  }
  const rgb = Buffer.allocUnsafe(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    const alpha = data[i * 4 + 3]!
    for (let channel = 0; channel < 3; channel++) {
      rgb[i * 3 + channel] = Math.round((data[i * 4 + channel]! * alpha + data[nearest[i]! * 4 + channel]! * (255 - alpha)) / 255)
    }
  }
  return sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
}

export function calculateMpcSourceRect(profile: GameProfile, sourceWidth: number, sourceHeight: number): PrintRect {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Artwork dimensions must be positive finite numbers.')
  }
  const trim = trimRectFor(profile)
  const scale = Math.min(trim.width / sourceWidth, trim.height / sourceHeight)
  const width = Math.min(trim.width, Math.round(sourceWidth * scale))
  const height = Math.min(trim.height, Math.round(sourceHeight * scale))
  return { x: trim.x + Math.floor((trim.width - width) / 2), y: trim.y + Math.floor((trim.height - height) / 2), width, height }
}

function trimRectFor(profile: GameProfile): PrintRect {
  return { x: profile.mpcBleedPx, y: profile.mpcBleedPx, width: profile.trimWidthPx, height: profile.trimHeightPx }
}

function safeRectFor(profile: GameProfile): PrintRect {
  const inset = profile.mpcBleedPx + profile.mpcSafeInsetPx
  return {
    x: inset,
    y: inset,
    width: profile.trimWidthPx - profile.mpcSafeInsetPx * 2,
    height: profile.trimHeightPx - profile.mpcSafeInsetPx * 2
  }
}

function isRectContained(inner: PrintRect, outer: PrintRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

function isMpcSourcePlacementValid(profile: GameProfile, sourceRect: ImageDerivative['sourceRect']): boolean {
  if (!sourceRect) return false
  const trim = trimRectFor(profile)
  return Object.values(sourceRect).every(Number.isInteger) && sourceRect.width > 0 && sourceRect.height > 0 && isRectContained(sourceRect, trim)
}

async function countTransparentPixels(filePath: string): Promise<number> {
  const metadata = await sharp(filePath).metadata()
  if (!metadata.hasAlpha) return 0
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let index = 3; index < data.length; index += info.channels) {
    if (data[index]! < 255) count++
  }
  return count
}

export const artworkPixelConstants = {
  trimWidth: GAME_PROFILES.riftbound.trimWidthPx,
  trimHeight: GAME_PROFILES.riftbound.trimHeightPx,
  mpcBleed: GAME_PROFILES.riftbound.mpcBleedPx,
  mpcCanvasWidth: GAME_PROFILES.riftbound.mpcCanvasWidthPx,
  mpcCanvasHeight: GAME_PROFILES.riftbound.mpcCanvasHeightPx,
  mpcSafeX: GAME_PROFILES.riftbound.mpcBleedPx + GAME_PROFILES.riftbound.mpcSafeInsetPx,
  mpcSafeY: GAME_PROFILES.riftbound.mpcBleedPx + GAME_PROFILES.riftbound.mpcSafeInsetPx,
  mpcSafeWidth: GAME_PROFILES.riftbound.trimWidthPx - GAME_PROFILES.riftbound.mpcSafeInsetPx * 2,
  mpcSafeHeight: GAME_PROFILES.riftbound.trimHeightPx - GAME_PROFILES.riftbound.mpcSafeInsetPx * 2,
  mpcMaxHorizontalSafeOverscan: GAME_PROFILES.riftbound.mpcMaxHorizontalSafeOverscanPx,
  profileVersion: DERIVATIVE_PROFILE_VERSION,
  riftboundMpcProfileVersion: RIFTBOUND_MPC_PROFILE_VERSION,
  profiles: GAME_PROFILES
} as const
