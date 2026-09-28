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

const EDGE_UNDERLAY_INSET_PX = 24
const DERIVATIVE_PROFILE_VERSION = 'v7-multigame-protected-edge-underlay'
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
    const cacheKey = createHash('sha256')
      .update(`${DERIVATIVE_PROFILE_VERSION}:${game}:${sourceId}:${contentHash}:${outputProfile}:${landscape ?? 'auto'}`)
      .digest('hex')
    const folder = join(this.cacheDirectory, 'derivatives')
    const filePath = join(folder, `${cacheKey}.png`)
    const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 150_000_000 }).metadata()
    if (!metadata.width || !metadata.height) throw new Error('Artwork has no readable dimensions.')
    const shouldRotate = landscape ?? metadata.width > metadata.height
    const orientedWidth = shouldRotate ? metadata.height : metadata.width
    const orientedHeight = shouldRotate ? metadata.width : metadata.height
    const sourceRect = calculateMpcSourceRect(cardProfile, orientedWidth, orientedHeight)
    const existing = await readDerivative(filePath, sourceId)
    if (existing) return { ...existing, sourceRect }

    await mkdir(folder, { recursive: true })
    let normalized = sharp(bytes, { failOn: 'error', limitInputPixels: 150_000_000 })
    if (shouldRotate) normalized = normalized.rotate(90)
    const orientedSource = await normalized.png().toBuffer()
    const underlay = await createTrimUnderlay(orientedSource, cardProfile)
    const face = await sharp(orientedSource)
      .resize(sourceRect.width, sourceRect.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()

    let image: Sharp
    if (outputProfile === 'mpc') {
      const canvasUnderlay = await sharp(underlay)
        .resize(cardProfile.mpcCanvasWidthPx, cardProfile.mpcCanvasHeightPx, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .blur(18)
        .flatten({ background: '#000000' })
        .removeAlpha()
        .png()
        .toBuffer()
      image = sharp(canvasUnderlay).composite([{
        input: face,
        left: sourceRect.x,
        top: sourceRect.y,
        blend: 'over'
      }])
    } else {
      const trim = await sharp(underlay)
        .composite([{
          input: face,
          left: sourceRect.x - cardProfile.mpcBleedPx,
          top: sourceRect.y - cardProfile.mpcBleedPx,
          blend: 'over'
        }])
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
    const placementVerified = derivative.width === profile.mpcCanvasWidthPx &&
      derivative.height === profile.mpcCanvasHeightPx && opaque && isMpcSourcePlacementSafe(profile, sourceRect)
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
      warnings: [
        ...(!opaque ? ['The MPC derivative contains transparent pixels.'] : []),
        ...(!isMpcSourcePlacementSafe(profile, sourceRect) ? ['The complete card face is outside the protected trim placement.'] : [])
      ]
    }
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

async function createTrimUnderlay(source: Buffer, profile: GameProfile): Promise<Buffer> {
  const normalized = await sharp(source)
    .resize(profile.trimWidthPx, profile.trimHeightPx, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .flatten({ background: '#000000' })
    .removeAlpha()
    .png()
    .toBuffer()
  const inset = Math.min(EDGE_UNDERLAY_INSET_PX, Math.floor(profile.trimWidthPx / 4), Math.floor(profile.trimHeightPx / 4))
  return sharp(normalized)
    .extract({ left: inset, top: inset, width: profile.trimWidthPx - inset * 2, height: profile.trimHeightPx - inset * 2 })
    .resize(profile.trimWidthPx, profile.trimHeightPx, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .blur(12)
    .flatten({ background: '#000000' })
    .removeAlpha()
    .png()
    .toBuffer()
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
  if (!isMpcSourcePlacementSafe(profile, derivative.sourceRect)) {
    throw new Error('MPC artwork source placement exceeds the protected trim/safe-area limits.')
  }
}

export function calculateMpcSourceRect(profile: GameProfile, sourceWidth: number, sourceHeight: number): PrintRect {
  const safe = safeRectFor(profile)
  const maxWidth = safe.width + profile.mpcMaxHorizontalSafeOverscanPx * 2
  const scale = Math.min(safe.height / sourceHeight, maxWidth / sourceWidth)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return {
    x: Math.round((profile.mpcCanvasWidthPx - width) / 2),
    y: Math.round((profile.mpcCanvasHeightPx - height) / 2),
    width,
    height
  }
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

function isMpcSourcePlacementSafe(profile: GameProfile, sourceRect: ImageDerivative['sourceRect']): boolean {
  if (!sourceRect) return false
  const trim = trimRectFor(profile)
  const safe = safeRectFor(profile)
  const withinTrim = isRectContained(sourceRect, trim)
  const verticalInsideSafe = sourceRect.y >= safe.y && sourceRect.y + sourceRect.height <= safe.y + safe.height
  const leftOverscan = Math.max(0, safe.x - sourceRect.x)
  const rightOverscan = Math.max(0, sourceRect.x + sourceRect.width - (safe.x + safe.width))
  return withinTrim && verticalInsideSafe && leftOverscan <= profile.mpcMaxHorizontalSafeOverscanPx && rightOverscan <= profile.mpcMaxHorizontalSafeOverscanPx
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
  profiles: GAME_PROFILES
} as const
