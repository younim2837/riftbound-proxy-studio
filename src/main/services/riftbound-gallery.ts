import { z } from 'zod'
import type { CardRecord, CatalogSnapshot } from '../../shared/contracts.js'
import { assertAllowedHttpsUrl } from '../../shared/schemas.js'

export const RIFTBOUND_GALLERY_URL = 'https://playriftbound.com/en-us/card-gallery/'
export const RIFTBOUND_CATALOG_VERSION = 2
const text = z.string().trim().min(1).max(500)
const imageUrl = z.string().url().transform((url) => assertAllowedHttpsUrl(url, ['cmsassets.rgpub.io']).href)
const label = z.object({ label: text })
const galleryCard = z.object({
  id: text,
  publicCode: text.regex(/^[A-Z0-9]+-[A-Z0-9]+\*?(?:\/[A-Z0-9]+)?$/i),
  collectorNumber: z.union([z.number().int().nonnegative(), text]),
  name: text,
  subtitle: z.string().max(500).optional(),
  set: z.object({ value: z.object({ id: text, label: text }) }),
  cardType: z.object({ type: z.array(label), superType: z.array(label).optional() }),
  rarity: z.object({ value: label }),
  cardImage: z.object({ url: imageUrl }),
  orientation: z.enum(['portrait', 'landscape']),
  illustrator: z.object({ values: z.array(label) }).optional()
})

/** Parse JSON only; never execute scripts or render third-party gallery HTML. */
export function parseRiftboundGallery(html: string): CardRecord[] {
  const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!match?.[1]) throw new Error('Riot gallery format changed: __NEXT_DATA__ metadata was not found.')
  let root: unknown
  try { root = JSON.parse(match[1]) } catch { throw new Error('Riot gallery contains invalid JSON metadata.') }
  const page = z.object({ props: z.object({ pageProps: z.object({ page: z.object({ blades: z.array(z.unknown()) }) }) }) }).safeParse(root)
  if (!page.success) throw new Error('Riot gallery format changed: card-gallery page metadata was not found.')
  const candidates = page.data.props.pageProps.page.blades.flatMap((blade) => {
    const result = z.object({ cards: z.object({ items: z.array(z.unknown()) }) }).safeParse(blade)
    return result.success ? [result.data.cards.items] : []
  })
  if (candidates.length !== 1) throw new Error('Riot gallery format changed: expected one unambiguous card list.')
  const parsed = z.array(galleryCard).min(1).max(20_000).safeParse(candidates[0])
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Riot gallery card metadata is invalid at ${issue?.path.join('.') ?? 'cards'}: ${issue?.message ?? 'unknown error'}`)
  }
  const cards: CardRecord[] = parsed.data.map((card) => {
    const code = card.publicCode.split('/')[0]!.toUpperCase().replace(/\*$/, 'S')
    const baseCode = code.replace(/(\d)[A-Z]$/i, '$1')
    const artist = card.illustrator?.values.map((value) => value.label).join(', ')
    const hash = /\/([a-f0-9]{40})-\d+x\d+\./i.exec(card.cardImage.url)?.[1]
    return {
      game: 'riftbound', id: card.id, identityId: baseCode, code, publicCode: card.publicCode,
      setCode: card.set.value.id.toUpperCase(), setName: card.set.value.label,
      collectorNumber: String(card.collectorNumber),
      name: card.subtitle?.trim() ? `${card.name}, ${card.subtitle.trim()}` : card.name,
      type: card.cardType.type.map((type) => type.label).join(' / ') || card.cardType.superType?.map((type) => type.label).join(' / ') || 'Unknown',
      rarity: card.rarity.value.label, orientation: card.orientation,
      isVariant: /\d(?:[A-Z]|\*)$/i.test(card.publicCode.split('/')[0]!) || /showcase/i.test(card.rarity.value.label),
      baseCode, imageUrl: card.cardImage.url,
      ...(hash ? { imageHash: hash } : {}), ...(artist ? { artist } : {})
    }
  })
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error('Riot gallery contains duplicate card identities.')
  return cards
}

const cachedCard = z.object({
  id: text, code: text, publicCode: text.optional(), setCode: text, setName: text,
  collectorNumber: text, name: text,
  type: z.string().max(500).optional().transform((value) => value?.trim() || 'Unknown'),
  rarity: z.string().max(500).optional().transform((value) => value?.trim() || 'Unknown'),
  orientation: z.enum(['portrait', 'landscape']), isVariant: z.boolean(), baseCode: text,
  identityId: text.optional(), imageUrl,
  artist: z.string().optional(), imageHash: z.string().optional()
}).passthrough()

/** Older snapshots lack game/identity metadata; keep their stable Riot IDs. */
export function parseRiftboundSnapshot(value: unknown): CatalogSnapshot {
  const parsed = z.object({
    cards: z.array(cachedCard).min(1).max(20_000), source: text,
    fetchedAt: z.string().refine((date) => Number.isFinite(Date.parse(date)), 'Invalid catalog timestamp'),
    catalogVersion: z.number().int().optional()
  }).parse(value)
  if (new Set(parsed.cards.map((card) => card.id)).size !== parsed.cards.length) throw new Error('Cached catalog contains duplicate card identities.')
  return {
    source: parsed.source, fetchedAt: parsed.fetchedAt, game: 'riftbound', developmentOnly: true,
    ...(parsed.catalogVersion === undefined ? {} : { catalogVersion: parsed.catalogVersion }),
    cards: parsed.cards.map((card) => ({ ...card, game: 'riftbound', publicCode: card.publicCode ?? card.code, identityId: card.identityId ?? card.baseCode } as CardRecord))
  }
}
