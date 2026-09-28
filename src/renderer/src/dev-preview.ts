import {
  GAME_PROFILES,
  type CardRecord,
  type GameId,
  type ImportResult,
  type RendererApi
} from '../../shared/contracts'

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export function installDevPreviewApi(): void {
  if (window.riftboundStudio || !import.meta.env.DEV || !new URLSearchParams(location.search).has('browserPreview')) return
  let game: GameId = 'riftbound'
  const api = {
    getAppInfo: async () => ({ version: '0.3.2-preview', platform: 'browser', cacheDirectory: 'preview' }),
    loadCatalog: async (selected: GameId) => {
      game = selected
      return { cards: previewCards(selected), source: 'browser preview', fetchedAt: new Date().toISOString(), game: selected, developmentOnly: true }
    },
    searchCatalog: async (selected: GameId, query: string) => previewCards(selected).filter((card) => card.name.toLowerCase().includes(query.toLowerCase())),
    loadPrintings: async (selected: GameId) => previewCards(selected),
    importText: async (selected: GameId, text: string): Promise<ImportResult> => {
      game = selected
      const section = selected === 'mtg' ? 'main' as const : 'main' as const
      const lines = text.split(/\r?\n/).map((raw) => raw.trim()).filter((raw) => /^\d+\s/.test(raw)).map((raw, index) => {
        const match = /^(\d+)\s+(.+?)(?:\s+\([A-Z0-9]+\)\s+[A-Z0-9]+)?$/i.exec(raw)!
        return { lineNumber: index + 1, raw, quantity: Number(match[1]), name: match[2]!, section }
      })
      return { title: selected === 'mtg' ? 'MTG Browser Preview' : 'Riftbound Browser Preview', lines, warnings: [] }
    },
    importDeckCode: async () => ({ lines: [], warnings: [] }),
    importPiltoverUrl: async () => ({ lines: [], warnings: [] }),
    resolveImport: async (selected: GameId, result: ImportResult) => {
      const cards = previewCards(selected)
      return {
        cards,
        entries: result.lines.map((line, index) => {
          const wanted = line.name.toLowerCase().split(' // ')[0]!
          const card = cards.find((candidate) => candidate.name.toLowerCase().split(' // ')[0] === wanted) ?? cards[index % cards.length]!
          return {
            id: `preview-entry-${index}`,
            rawName: line.name,
            quantity: line.quantity,
            section: line.section,
            resolvedCardId: card.id,
            candidateCardIds: [card.id],
            allocations: [{ id: `preview-allocation-${index}`, quantity: line.quantity, front: { kind: 'official' as const, cardId: card.id, imageUrl: card.imageUrl, face: 'front' as const } }],
            resolution: 'resolved' as const
          }
        })
      }
    },
    chooseArtwork: async () => null,
    getDefaultBack: async (selected: GameId) => ({ assetId: `preview-${selected}-back`, archivePath: `assets/preview-${selected}-back.png`, displayName: 'Proxy - Not For Sale', bytes: pngBytes() }),
    saveProject: async () => null,
    openProject: async () => null,
    exportPdf: async () => null,
    renderPrintPreview: async () => ({ png: pngBytes(), pageIndex: 0, pageCount: 1, side: 'front' as const, sheetIndex: 0, columns: 3, rows: game === 'mtg' ? 2 : 3, warnings: [] }),
    renderMpcProof: async (request: Parameters<RendererApi['renderMpcProof']>[0]) => {
      const profile = GAME_PROFILES[request.manifest.game]
      return {
        png: pngBytes(), deckId: request.deckId ?? 'preview-deck', entryId: request.entryId ?? 'preview-entry', allocationId: request.allocationId ?? 'preview-allocation', label: 'Browser proof',
        proof: {
          width: profile.mpcCanvasWidthPx, height: profile.mpcCanvasHeightPx, opaque: true, transparentPixels: 0, bleedPx: 36 as const,
          trimRect: { x: 36, y: 36, width: profile.trimWidthPx, height: profile.trimHeightPx },
          safeRect: { x: 72, y: 72, width: profile.trimWidthPx - 72, height: profile.trimHeightPx - 72 },
          sourceRect: { x: 61, y: 72, width: profile.trimWidthPx - 49, height: profile.trimHeightPx - 72 },
          sourcePreserved: true, sourceContainedInSafeArea: false, placementVerified: true, warnings: []
        }
      }
    },
    startMpcAutomation: async () => undefined,
    cancelMpcAutomation: async () => undefined,
    onMpcProgress: () => () => undefined
  } satisfies RendererApi
  window.riftboundStudio = api
}

function previewCards(game: GameId): CardRecord[] {
  if (game === 'riftbound') {
    return ['Charm', 'Disarming Rake'].map((name, index) => ({
      game,
      id: `${game}-preview-${index}`,
      identityId: `${game}-identity-${index}`,
      code: `OGN-${String(index + 1).padStart(3, '0')}`,
      publicCode: `OGN-${String(index + 1).padStart(3, '0')}`,
      setCode: 'OGN',
      setName: 'Origins',
      collectorNumber: String(index + 1),
      name,
      type: 'Spell',
      rarity: index ? 'Rare' : 'Common',
      orientation: 'portrait',
      isVariant: false,
      baseCode: `${game}-identity-${index}`,
      imageUrl: cardSvg(name, '#184c52', 'Origins'),
      imageQuality: 'highres',
      language: 'en',
      layout: 'normal'
    }))
  }

  const cards: Array<{
    name: string
    identity: string
    setCode: string
    setName: string
    collector: string
    releasedAt: string
    color: string
    artist: string
    treatments?: string[]
    layout?: string
  }> = [
    { name: 'Sol Ring', identity: 'sol-ring', setCode: 'LCC', setName: 'The Lost Caverns Commander', collector: '314', releasedAt: '2023-11-17', color: '#7a4d22', artist: 'Raoul Vitale', treatments: ['extended_art', 'nonfoil'] },
    { name: 'Sol Ring', identity: 'sol-ring', setCode: 'WHO', setName: 'Doctor Who', collector: '245', releasedAt: '2023-10-13', color: '#315d70', artist: 'David Astruga', treatments: ['showcase', 'foil'] },
    { name: 'Sol Ring', identity: 'sol-ring', setCode: 'CMM', setName: 'Commander Masters', collector: '396', releasedAt: '2023-08-04', color: '#68466f', artist: 'Drew Tucker', treatments: ['borderless', 'nonfoil'] },
    { name: 'Sol Ring', identity: 'sol-ring', setCode: '40K', setName: 'Warhammer 40,000 Commander', collector: '248', releasedAt: '2022-10-07', color: '#354f36', artist: 'Daniel Ljunggren', treatments: ['surgefoil'] },
    { name: 'Sol Ring', identity: 'sol-ring', setCode: 'C21', setName: 'Commander 2021', collector: '263', releasedAt: '2021-04-23', color: '#5c3b32', artist: 'Mark Tedin', treatments: ['nonfoil'] },
    { name: 'Sol Ring', identity: 'sol-ring', setCode: 'C16', setName: 'Commander 2016', collector: '272', releasedAt: '2016-11-11', color: '#263f55', artist: 'Mark Tedin', treatments: ['nonfoil'] },
    { name: "Atraxa, Praetors' Voice", identity: 'atraxa', setCode: '2X2', setName: 'Double Masters 2022', collector: '190', releasedAt: '2022-07-08', color: '#45634e', artist: 'Victor Adame Minguez', treatments: ['foil', 'nonfoil'] },
    { name: "Atraxa, Praetors' Voice", identity: 'atraxa', setCode: 'SLD', setName: 'Secret Lair Drop', collector: '409', releasedAt: '2022-03-18', color: '#4e365d', artist: 'Ayami Kojima', treatments: ['borderless', 'foil'] },
    { name: 'Swords to Plowshares', identity: 'swords', setCode: 'STA', setName: 'Strixhaven Mystical Archive', collector: '10', releasedAt: '2021-04-23', color: '#756b45', artist: 'Natalie Hall', treatments: ['showcase', 'nonfoil'] },
    { name: 'Delver of Secrets // Insectile Aberration', identity: 'delver', setCode: 'MID', setName: 'Innistrad: Midnight Hunt', collector: '47', releasedAt: '2021-09-24', color: '#344f74', artist: 'Nils Hamm', treatments: ['nonfoil'], layout: 'transform' }
  ]
  return cards.map((card, index) => ({
    game,
    id: `mtg-preview-${card.setCode.toLowerCase()}-${card.collector}`,
    identityId: `mtg-${card.identity}`,
    code: `${card.setCode}-${card.collector}`,
    publicCode: `${card.setCode}-${card.collector}`,
    setCode: card.setCode,
    setName: card.setName,
    collectorNumber: card.collector,
    name: card.name,
    type: card.identity === 'sol-ring' ? 'Artifact' : 'Magic card',
    rarity: index % 3 === 0 ? 'Rare' : 'Uncommon',
    orientation: 'portrait',
    isVariant: index > 0,
    baseCode: `mtg-${card.identity}`,
    imageUrl: cardSvg(card.name, card.color, `${card.setCode} · ${card.setName}`),
    imageQuality: 'highres',
    language: 'en',
    layout: card.layout ?? 'normal',
    releasedAt: card.releasedAt,
    artist: card.artist,
    ...(card.treatments ? { treatments: card.treatments } : {})
  }))
}

function cardSvg(name: string, color: string, subtitle: string): string {
  const safe = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const safeSubtitle = subtitle.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="745" height="1040"><rect width="745" height="1040" rx="38" fill="${color}"/><rect x="24" y="24" width="697" height="992" rx="28" fill="none" stroke="#d6b66d" stroke-width="8"/><circle cx="372" cy="365" r="190" fill="#ffffff12" stroke="#ffffff40" stroke-width="5"/><path d="M240 390 Q372 185 505 390 Q372 595 240 390Z" fill="#0b101666" stroke="#d6b66d" stroke-width="7"/><text x="372" y="700" fill="white" font-family="Arial" font-size="35" font-weight="700" text-anchor="middle">${safe}</text><text x="372" y="755" fill="#e9dcae" font-family="Arial" font-size="21" text-anchor="middle">${safeSubtitle}</text><text x="372" y="910" fill="#9ce7df" font-family="Arial" font-size="22" text-anchor="middle">PROXY STUDIO PREVIEW</text></svg>`)}`
}

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(ONE_PIXEL_PNG), (character) => character.charCodeAt(0))
}
