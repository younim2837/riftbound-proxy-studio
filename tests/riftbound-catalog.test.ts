import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DevelopmentCatalogProvider } from '../src/main/services/catalog-provider.js'
import { parseRiftboundGallery, parseRiftboundSnapshot, RIFTBOUND_CATALOG_VERSION, RIFTBOUND_GALLERY_URL } from '../src/main/services/riftbound-gallery.js'
import { RiftboundDeckImporter } from '../src/main/services/deck-importer.js'
import { resolveImportedDeck } from '../src/main/services/resolver.js'
import type { CatalogSnapshot } from '../src/shared/contracts.js'

const html = await readFile('tests/fixtures/riftbound-gallery.html', 'utf8')
const cards = parseRiftboundGallery(html)
const snapshot = (ageMs = 0): CatalogSnapshot => ({ cards, source: RIFTBOUND_GALLERY_URL, fetchedAt: new Date(Date.now() - ageMs).toISOString(), game: 'riftbound', developmentOnly: true, catalogVersion: RIFTBOUND_CATALOG_VERSION })
const response = () => new Response(html, { headers: { 'content-type': 'text/html' } })

async function setup(cached?: CatalogSnapshot, bundled?: CatalogSnapshot) {
  const folder = await mkdtemp(join(tmpdir(), 'rb-catalog-refresh-'))
  const cache = join(folder, 'cache')
  const cacheFile = join(cache, 'catalog', 'development-catalog.json')
  await mkdir(join(cache, 'catalog'), { recursive: true })
  if (cached) await writeFile(cacheFile, JSON.stringify(cached))
  const fixture = join(folder, 'bundled.json')
  if (bundled) await writeFile(fixture, JSON.stringify(bundled))
  return { provider: new DevelopmentCatalogProvider(cache, bundled ? fixture : undefined), cacheFile }
}

function changedHtml(change: (items: Array<Record<string, any>>) => void): string {
  const root = JSON.parse(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!)
  change(root.props.pageProps.page.blades[1].cards.items)
  return `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify(root)}</script>`
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Riot gallery adapter', () => {
  it('parses Radiance subtitles, original IDs, art variants, signatures, and landscape orientation', () => {
    expect(cards[0]).toMatchObject({ id: 'rad-065-167', code: 'RAD-065', name: 'Seraphine, Inspiring', setName: 'Radiance', identityId: 'RAD-065', isVariant: false, artist: 'Fixture Artist', imageHash: 'a'.repeat(40) })
    expect(cards[1]).toMatchObject({ code: 'RAD-065A', baseCode: 'RAD-065', isVariant: true })
    expect(cards[4]).toMatchObject({ type: 'Battlefield', orientation: 'landscape' })
    expect(cards[5]).toMatchObject({ id: 'ogn-299-star-298', code: 'OGN-299S', publicCode: 'OGN-299*/298', isVariant: true })
    expect(cards[6]).toMatchObject({ type: 'Token' })
  })

  it('keeps rune and starter identities separate despite repeated collector numbers', () => {
    expect(cards[2]?.collectorNumber).toBe(cards[3]?.collectorNumber)
    expect(cards[2]?.baseCode).toBe('RAD-R05')
    expect(cards[3]?.baseCode).toBe('RAD-SP5')
    const imported = new RiftboundDeckImporter().importText('1 RAD-R05 Chaos Rune\n1 RAD-SP5 Seraphine, Not Alone\n1 Seraphine, Inspiring')
    expect(resolveImportedDeck(imported, cards).map((entry) => entry.resolvedCardId)).toEqual(['rad-r05', 'rad-sp5-005', 'rad-065-167'])
  })

  it('fails clearly on a changed layout, empty lists, invalid JSON, or duplicate identities', () => {
    expect(() => parseRiftboundGallery('<html>maintenance</html>')).toThrow('__NEXT_DATA__')
    expect(() => parseRiftboundGallery('<script id="__NEXT_DATA__">invalid</script>')).toThrow('invalid JSON')
    expect(() => parseRiftboundGallery('<script id="__NEXT_DATA__">{}</script>')).toThrow('page metadata')
    expect(() => parseRiftboundGallery(changedHtml((items) => { items.length = 0 }))).toThrow('invalid')
    expect(() => parseRiftboundGallery(changedHtml((items) => { items.push(items[0]!) }))).toThrow('duplicate')
  })

  it('rejects non-HTTPS or unapproved artwork hosts', () => {
    for (const url of ['http://cmsassets.rgpub.io/card.png', 'https://cmsassets.rgpub.io.evil.example/card.png']) {
      expect(() => parseRiftboundGallery(changedHtml((items) => { items[0]!.cardImage.url = url }))).toThrow()
    }
  })

  it('retains cards with incomplete optional type metadata rather than dropping their artwork', () => {
    expect(parseRiftboundGallery(changedHtml((items) => { items[0]!.cardType.type = [] }))[0]?.type).toBe('Unknown')
  })

  it('bundles Radiance metadata without image bytes and keeps a known original card ID', async () => {
    const bundled = parseRiftboundSnapshot(JSON.parse(await readFile('resources/dev-catalog-v1.json', 'utf8')))
    expect(bundled.cards.filter((card) => card.setCode === 'RAD').length).toBeGreaterThan(0)
    expect(bundled.cards.some((card) => card.id === 'ogn-066-298' && card.name === 'Ahri, Alluring')).toBe(true)
    expect(bundled.catalogVersion).toBe(RIFTBOUND_CATALOG_VERSION)
  })
})

describe('catalog freshness and offline safety', () => {
  it('fetches the live gallery before using a bundled snapshot and atomically caches the result', async () => {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    const { provider, cacheFile } = await setup(undefined, snapshot(7 * 86_400_000))
    const loaded = await provider.load()
    expect(loaded).toMatchObject({ cacheStatus: 'live', source: RIFTBOUND_GALLERY_URL, catalogVersion: RIFTBOUND_CATALOG_VERSION })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await readFile(cacheFile, 'utf8')).cards[0].id).toBe('rad-065-167')
  })

  it('uses a fresh live cache without a network request but allows forced refresh', async () => {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    const { provider } = await setup(snapshot())
    expect((await provider.load()).cacheStatus).toBe('cached')
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await provider.load(true)).cacheStatus).toBe('live')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not mistake a newly written old snapshot or a legacy fixture for fresh live data', async () => {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    const legacy = { ...snapshot(), source: 'fixture:dev-catalog-v1' }
    delete legacy.catalogVersion
    for (const old of [snapshot(3 * 86_400_000), legacy]) {
      const { provider } = await setup(old, snapshot(10 * 86_400_000))
      expect((await provider.load()).cacheStatus).toBe('live')
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('chooses the newer bundled offline fallback without overwriting or re-dating the saved cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Fixture offline') }))
    const old = snapshot(10 * 86_400_000)
    const bundled = snapshot(2 * 86_400_000)
    const { provider, cacheFile } = await setup(old, bundled)
    const loaded = await provider.load()
    expect(loaded).toMatchObject({ cacheStatus: 'bundled', fetchedAt: bundled.fetchedAt })
    expect(loaded.warning).toContain('Fixture offline')
    expect(JSON.parse(await readFile(cacheFile, 'utf8')).fetchedAt).toBe(old.fetchedAt)
  })

  it('retains a good cache on malformed responses and HTTP failures', async () => {
    const old = snapshot(2 * 86_400_000)
    for (const result of [new Response('maintenance'), new Response('unavailable', { status: 503 }), new Response(html, { headers: { 'content-length': String(21 * 1024 * 1024) } })]) {
      vi.stubGlobal('fetch', vi.fn(async () => result))
      const { provider, cacheFile } = await setup(old)
      const before = await readFile(cacheFile, 'utf8')
      expect((await provider.load(true)).cacheStatus).toBe('offline')
      expect(await readFile(cacheFile, 'utf8')).toBe(before)
    }
  })

  it('recovers from corrupt cache files without losing the bundled fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline') }))
    const { provider, cacheFile } = await setup(undefined, snapshot())
    await writeFile(cacheFile, '{broken')
    expect((await provider.load()).cacheStatus).toBe('bundled')
  })

  it('backs off failed automatic refreshes but lets the manual button retry immediately', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    const { provider } = await setup(undefined, snapshot(86_400_000))
    expect((await provider.load()).cacheStatus).toBe('bundled')
    expect((await provider.load()).cacheStatus).toBe('bundled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await provider.load(true)).cacheStatus).toBe('live')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent requests', async () => {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    const { provider } = await setup()
    const results = await Promise.all([provider.load(), provider.load(), provider.load(true)])
    expect(results.every((value) => value.cacheStatus === 'live')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not swallow a forced refresh behind a concurrent fresh-cache read', async () => {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    const { provider } = await setup(snapshot())
    const [cached, refreshed] = await Promise.all([provider.load(), provider.load(true)])
    expect(cached.cacheStatus).toBe('cached')
    expect(refreshed.cacheStatus).toBe('live')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails explicitly without an offline catalog and rejects unapproved source overrides', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline') }))
    const { provider } = await setup()
    await expect(provider.load()).rejects.toThrow('no offline catalog')
    vi.stubEnv('RIFTBOUND_CATALOG_URL', 'https://evil.example/cards.json')
    await expect(provider.load(true)).rejects.toThrow()
  })
})
