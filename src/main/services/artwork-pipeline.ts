import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import type { ArtworkPipeline } from './interfaces.js'
import type { ArtworkSelection, ImageDerivative, MpcPlacementProof } from '../../shared/contracts.js'
import { assertAllowedHttpsUrl } from '../../shared/schemas.js'

const TRIM_WIDTH_PX = 744
const TRIM_HEIGHT_PX = 1038
const MPC_BLEED_PX = 36
const MPC_CANVAS_WIDTH_PX = 816 as const
const MPC_CANVAS_HEIGHT_PX = 1110 as const
const MPC_SAFE_X_PX = MPC_BLEED_PX * 2
const MPC_SAFE_Y_PX = MPC_BLEED_PX * 2
const MPC_SAFE_WIDTH_PX = TRIM_WIDTH_PX - MPC_BLEED_PX * 2
const MPC_SAFE_HEIGHT_PX = TRIM_HEIGHT_PX - MPC_BLEED_PX * 2
const MPC_MAX_HORIZONTAL_SAFE_OVERSCAN_PX = 12
const EDGE_UNDERLAY_INSET_PX = 24
const DERIVATIVE_PROFILE_VERSION = 'v6-max-height-soft-underlay'

export class SharpArtworkPipeline implements ArtworkPipeline {
  constructor(private readonly cacheDirectory: string) {}

  async createMpcDerivative(
    sourceId: string,
    bytes: Uint8Array,
    landscape?: boolean
  ): Promise<ImageDerivative> {
    const derivative = await this.createDerivative(sourceId, bytes, MPC_BLEED_PX, 'mpc', landscape)
    await assertMpcDerivative(derivative)
    return derivative
  }

  async createPdfDerivative(
    sourceId: string,
    bytes: Uint8Array,
    bleedMm: number,
    landscape?: boolean
  ): Promise<ImageDerivative> {
    const bleedPx = Math.round((bleedMm / 25.4) * 300)
    return this.createDerivative(sourceId, bytes, bleedPx, `pdf-${bleedPx}`, landscape)
  }

  private async createDerivative(
    sourceId: string,
    bytes: Uint8Array,
    bleedPx: number,
    profile: string,
    landscape?: boolean
  ): Promise<ImageDerivative> {
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const cacheKey = createHash('sha256')
      .update(`${DERIVATIVE_PROFILE_VERSION}:${sourceId}:${contentHash}:${profile}:${landscape ?? 'auto'}`)
      .digest('hex')
    const folder = join(this.cacheDirectory, 'derivatives')
    const filePath = join(folder, `${cacheKey}.png`)
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
    if (!metadata.width || !metadata.height) throw new Error('Artwork has no readable dimensions.')
    const shouldRotate = landscape ?? metadata.width > metadata.height
    const orientedWidth = shouldRotate ? metadata.height : metadata.width
    const orientedHeight = shouldRotate ? metadata.width : metadata.height
    const sourceRect = profile === 'mpc' ? calculateMpcSourceRect(orientedWidth, orientedHeight) : undefined
    const existing = await readDerivative(filePath, sourceId)
    if (existing) return sourceRect ? { ...existing, sourceRect } : existing

    await mkdir(folder, { recursive: true })
    let normalized = sharp(bytes, { failOn: 'error', limitInputPixels: 150_000_000 })
    if (shouldRotate) normalized = normalized.rotate(90)
    const orientedSource = await normalized.png().toBuffer()
    const normalizedTrim = await normalized
      .resize(TRIM_WIDTH_PX, TRIM_HEIGHT_PX, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()
    const underlay = await sharp(normalizedTrim)
      .extract({
        left: EDGE_UNDERLAY_INSET_PX,
        top: EDGE_UNDERLAY_INSET_PX,
        width: TRIM_WIDTH_PX - EDGE_UNDERLAY_INSET_PX * 2,
        height: TRIM_HEIGHT_PX - EDGE_UNDERLAY_INSET_PX * 2
      })
      .resize(TRIM_WIDTH_PX, TRIM_HEIGHT_PX, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .flatten({ background: '#000000' })
      .removeAlpha()
      .png()
      .toBuffer()
    let image: Sharp
    if (profile === 'mpc') {
      if (!sourceRect) throw new Error('MPC source placement could not be calculated.')
      const safeSource = await sharp(orientedSource)
        .resize(sourceRect.width, sourceRect.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer()
      const canvasUnderlay = await sharp(underlay)
        .resize(MPC_CANVAS_WIDTH_PX, MPC_CANVAS_HEIGHT_PX, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .blur(18)
        .flatten({ background: '#000000' })
        .removeAlpha()
        .png()
        .toBuffer()
      image = sharp(canvasUnderlay).composite([{
        input: safeSource,
        left: sourceRect.x,
        top: sourceRect.y,
        blend: 'over'
      }])
    } else {
      const opaqueTrim = await sharp(underlay)
        .composite([{ input: normalizedTrim, blend: 'over' }])
        .flatten({ background: '#000000' })
        .removeAlpha()
        .png()
        .toBuffer()
      image = sharp(opaqueTrim)
      if (bleedPx > 0) {
        image = image.extend({
          top: bleedPx,
          right: bleedPx,
          bottom: bleedPx,
          left: bleedPx,
          extendWith: 'copy'
        })
      }
    }
    await image.removeAlpha().png({ compressionLevel: 9 }).withMetadata({ density: 300 }).toFile(filePath)
    const output = await readDerivative(filePath, sourceId)
    if (!output) throw new Error('Artwork derivative could not be written.')
    return sourceRect ? { ...output, sourceRect } : output
  }

  async createMpcPlacementProof(derivative: ImageDerivative): Promise<MpcPlacementProof> {
    const metadata = await sharp(derivative.filePath).metadata()
    const transparentPixels = await countTransparentPixels(derivative.filePath)
    const opaque = !metadata.hasAlpha && transparentPixels === 0
    return {
      width: MPC_CANVAS_WIDTH_PX,
      height: MPC_CANVAS_HEIGHT_PX,
      opaque,
      transparentPixels,
      bleedPx: 36,
      trimRect: { x: 36, y: 36, width: 744, height: 1038 },
      safeRect: { x: MPC_SAFE_X_PX, y: MPC_SAFE_Y_PX, width: MPC_SAFE_WIDTH_PX, height: MPC_SAFE_HEIGHT_PX },
      sourceRect: derivative.sourceRect ?? { x: MPC_SAFE_X_PX, y: MPC_SAFE_Y_PX, width: MPC_SAFE_WIDTH_PX, height: MPC_SAFE_HEIGHT_PX },
      sourcePreserved: true,
      sourceContainedInSafeArea: isRectContained(
        derivative.sourceRect ?? { x: MPC_SAFE_X_PX, y: MPC_SAFE_Y_PX, width: MPC_SAFE_WIDTH_PX, height: MPC_SAFE_HEIGHT_PX },
        { x: MPC_SAFE_X_PX, y: MPC_SAFE_Y_PX, width: MPC_SAFE_WIDTH_PX, height: MPC_SAFE_HEIGHT_PX }
      ),
      placementVerified:
        derivative.width === MPC_CANVAS_WIDTH_PX &&
        derivative.height === MPC_CANVAS_HEIGHT_PX &&
        opaque &&
        isMpcSourcePlacementSafe(derivative.sourceRect),
      warnings: opaque ? [] : ['The MPC derivative contains transparent pixels.']
    }
  }
}

export class ArtworkSourceResolver {
  constructor(private readonly cacheDirectory: string) {}

  async load(
    selection: ArtworkSelection,
    customAssets: Record<string, Uint8Array>
  ): Promise<{ sourceId: string; bytes: Uint8Array }> {
    if (selection.kind === 'custom') {
      const bytes = customAssets[selection.assetId]
      if (!bytes) throw new Error(`Custom artwork is missing: ${selection.displayName}`)
      return { sourceId: `custom:${selection.assetId}`, bytes }
    }

    const url = assertAllowedHttpsUrl(selection.imageUrl, ['cmsassets.rgpub.io'])
    const key = createHash('sha256').update(url.href).digest('hex')
    const folder = join(this.cacheDirectory, 'official')
    const path = join(folder, `${key}.img`)
    try {
      return { sourceId: `official:${selection.cardId}`, bytes: new Uint8Array(await readFile(path)) }
    } catch {
      // Download below.
    }
    const response = await fetch(url, {
      headers: { 'user-agent': 'RiftboundProxyStudio/0.1 private-prototype' }
    })
    if (!response.ok) throw new Error(`Artwork download failed (${response.status}).`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 40 * 1024 * 1024) throw new Error('Artwork download exceeds 40 MB.')
    await mkdir(folder, { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, bytes)
    return { sourceId: `official:${selection.cardId}`, bytes }
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

async function assertMpcDerivative(derivative: ImageDerivative): Promise<void> {
  if (derivative.width !== 816 || derivative.height !== 1110) {
    throw new Error(`MPC artwork must be exactly 816×1110 px; generated ${derivative.width}×${derivative.height}.`)
  }
  const metadata = await sharp(derivative.filePath).metadata()
  const transparentPixels = await countTransparentPixels(derivative.filePath)
  if (metadata.hasAlpha || transparentPixels > 0) {
    throw new Error(`MPC artwork is not fully opaque (${transparentPixels} transparent pixels).`)
  }
  if (!isMpcSourcePlacementSafe(derivative.sourceRect)) {
    throw new Error('MPC artwork source placement exceeds the bounded trim/safe-area limits.')
  }
}

function calculateMpcSourceRect(sourceWidth: number, sourceHeight: number): { x: number; y: number; width: number; height: number } {
  const maxWidth = MPC_SAFE_WIDTH_PX + MPC_MAX_HORIZONTAL_SAFE_OVERSCAN_PX * 2
  const scale = Math.min(MPC_SAFE_HEIGHT_PX / sourceHeight, maxWidth / sourceWidth)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return {
    x: Math.round((MPC_CANVAS_WIDTH_PX - width) / 2),
    y: Math.round((MPC_CANVAS_HEIGHT_PX - height) / 2),
    width,
    height
  }
}

function isRectContained(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

function isMpcSourcePlacementSafe(sourceRect: ImageDerivative['sourceRect']): boolean {
  if (!sourceRect) return false
  const trim = { x: MPC_BLEED_PX, y: MPC_BLEED_PX, width: TRIM_WIDTH_PX, height: TRIM_HEIGHT_PX }
  const withinTrim = isRectContained(sourceRect, trim)
  const verticalInsideSafe = sourceRect.y >= MPC_SAFE_Y_PX && sourceRect.y + sourceRect.height <= MPC_SAFE_Y_PX + MPC_SAFE_HEIGHT_PX
  const leftOverscan = Math.max(0, MPC_SAFE_X_PX - sourceRect.x)
  const rightOverscan = Math.max(0, sourceRect.x + sourceRect.width - (MPC_SAFE_X_PX + MPC_SAFE_WIDTH_PX))
  return withinTrim && verticalInsideSafe && leftOverscan <= MPC_MAX_HORIZONTAL_SAFE_OVERSCAN_PX && rightOverscan <= MPC_MAX_HORIZONTAL_SAFE_OVERSCAN_PX
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
  trimWidth: TRIM_WIDTH_PX,
  trimHeight: TRIM_HEIGHT_PX,
  mpcBleed: MPC_BLEED_PX,
  mpcCanvasWidth: MPC_CANVAS_WIDTH_PX,
  mpcCanvasHeight: MPC_CANVAS_HEIGHT_PX,
  mpcSafeX: MPC_SAFE_X_PX,
  mpcSafeY: MPC_SAFE_Y_PX,
  mpcSafeWidth: MPC_SAFE_WIDTH_PX,
  mpcSafeHeight: MPC_SAFE_HEIGHT_PX,
  mpcMaxHorizontalSafeOverscan: MPC_MAX_HORIZONTAL_SAFE_OVERSCAN_PX,
  profileVersion: DERIVATIVE_PROFILE_VERSION
} as const
