export const PROJECT_SCHEMA_VERSION = 3 as const
export const MAX_MPC_CARDS = 612

export type GameId = 'riftbound' | 'mtg'
export type CardOrientation = 'portrait' | 'landscape'
export type DeckSection =
  | 'main'
  | 'sideboard'
  | 'commander'
  | 'companion'
  | 'maybeboard'
  | 'tokens'
  | 'runes'
  | 'legend'
  | 'battlefields'
  | 'other'
export type PageSize = 'letter' | 'a4'
export type PrintMode = 'fronts' | 'duplex'
export type CardFace = 'front' | 'back'
export type ImageQuality = 'highres' | 'fallback' | 'missing'
export const MPC_STOCK_CODES = ['S30', 'S33', 'A35'] as const
export type MpcStock = (typeof MPC_STOCK_CODES)[number]

export interface GameProfile {
  id: GameId
  label: string
  cardWidthMm: number
  cardHeightMm: number
  trimWidthPx: number
  trimHeightPx: number
  mpcCanvasWidthPx: number
  mpcCanvasHeightPx: number
  mpcBleedPx: 36
  mpcSafeInsetPx: 36
  mpcMaxHorizontalSafeOverscanPx: number
  mpcProduct: MpcProduct
  mpcStartUrl: string
}

export type MpcProduct = 'custom-game-cards-63x88' | 'custom-game-cards-traditional-poker'

export const GAME_PROFILES: Record<GameId, GameProfile> = {
  riftbound: {
    id: 'riftbound',
    label: 'Riftbound',
    cardWidthMm: 63,
    cardHeightMm: 88,
    trimWidthPx: 744,
    trimHeightPx: 1038,
    mpcCanvasWidthPx: 816,
    mpcCanvasHeightPx: 1110,
    mpcBleedPx: 36,
    mpcSafeInsetPx: 36,
    mpcMaxHorizontalSafeOverscanPx: 12,
    mpcProduct: 'custom-game-cards-63x88',
    mpcStartUrl: 'https://www.makeplayingcards.com/design/custom-blank-card.html'
  },
  mtg: {
    id: 'mtg',
    label: 'Magic: The Gathering',
    cardWidthMm: 63.5,
    cardHeightMm: 88.9,
    trimWidthPx: 750,
    trimHeightPx: 1050,
    mpcCanvasWidthPx: 822,
    mpcCanvasHeightPx: 1122,
    mpcBleedPx: 36,
    mpcSafeInsetPx: 36,
    mpcMaxHorizontalSafeOverscanPx: 12,
    mpcProduct: 'custom-game-cards-traditional-poker',
    mpcStartUrl: 'https://www.makeplayingcards.com/design/custom-blank-card-traditional-size.html'
  }
}

export interface CardRecord {
  game: GameId
  id: string
  identityId: string
  code: string
  publicCode: string
  setCode: string
  setName: string
  collectorNumber: string
  name: string
  type: string
  rarity: string
  orientation: CardOrientation
  isVariant: boolean
  baseCode: string
  imageUrl: string
  backImageUrl?: string
  imageHash?: string
  imageQuality?: ImageQuality
  language?: string
  layout?: string
  faceNames?: string[]
  releasedAt?: string
  artist?: string
  treatments?: string[]
}

export interface ImportedDeckLine {
  lineNumber: number
  raw: string
  name: string
  quantity: number
  section: DeckSection
  requestedCode?: string
  requestedSetCode?: string
  requestedCollectorNumber?: string
}

export interface ImportWarning {
  lineNumber?: number
  message: string
}

export interface ImportResult {
  title?: string
  lines: ImportedDeckLine[]
  warnings: ImportWarning[]
}

export interface OfficialArtworkSelection {
  kind: 'official'
  cardId: string
  imageUrl: string
  face?: CardFace
}

export interface CustomArtworkSelection {
  kind: 'custom'
  assetId: string
  archivePath: string
  displayName: string
}

export type ArtworkSelection = OfficialArtworkSelection | CustomArtworkSelection

export interface ArtworkAllocation {
  id: string
  quantity: number
  front: ArtworkSelection
  back?: ArtworkSelection
}

export interface DeckEntry {
  id: string
  rawName: string
  quantity: number
  section: DeckSection
  resolvedCardId?: string
  candidateCardIds: string[]
  allocations: ArtworkAllocation[]
  resolution: 'resolved' | 'ambiguous' | 'missing'
}

export interface ProjectDeck {
  id: string
  title: string
  entries: DeckEntry[]
  defaultBack?: ArtworkSelection
}

export interface PrintSettings {
  pageSize: PageSize
  mode: PrintMode
  bleedMm: number
  cropMarks: boolean
  dpi: 300
  cardWidthMm: number
  cardHeightMm: number
}

export interface MpcSettings {
  product: MpcProduct
  stock: MpcStock
  finish: 'MPC game card finish'
  foil: false
}

export interface ProjectManifest {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  game: GameId
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
  decks: ProjectDeck[]
  globalBack?: ArtworkSelection
  printSettings: PrintSettings
  mpcSettings: MpcSettings
}

/** @deprecated Use ProjectManifest. Retained as a source compatibility alias. */
export type ProjectManifestV1 = ProjectManifest

export interface ProjectDocument {
  manifest: ProjectManifest
  customAssets: Record<string, Uint8Array>
  filePath?: string
}

export interface CatalogSnapshot {
  cards: CardRecord[]
  source: string
  fetchedAt: string
  game: GameId
  developmentOnly: boolean
}

export interface ResolvedImport {
  entries: DeckEntry[]
  cards: CardRecord[]
}

export interface PdfExportRequest {
  manifest: ProjectManifest
  destination: string
  customAssets: Record<string, Uint8Array>
}

export interface PdfExportResult {
  destination: string
  pages: number
  cards: number
  columns: number
  rows: number
  warnings: string[]
}

export interface PrintRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PrintLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PrintLayoutSlot {
  sourceIndex: number
  row: number
  column: number
  bleedRect: PrintRect
  trimRect: PrintRect
  cropLines: PrintLine[]
}

export interface PrintLayoutPage {
  index: number
  sheetIndex: number
  side: 'front' | 'back'
  slots: PrintLayoutSlot[]
}

export interface PrintLayout {
  pageWidthMm: number
  pageHeightMm: number
  columns: number
  rows: number
  cardsPerSheet: number
  pageCount: number
  warnings: string[]
  pages: PrintLayoutPage[]
}

export interface PrintPreviewRequest {
  manifest: ProjectManifest
  customAssets: Record<string, Uint8Array>
  pageIndex: number
}

export interface PrintPreviewResult {
  png: Uint8Array
  pageIndex: number
  pageCount: number
  side: 'front' | 'back'
  sheetIndex: number
  columns: number
  rows: number
  warnings: string[]
}

export interface MpcPlacementProof {
  width: number
  height: number
  opaque: boolean
  transparentPixels: number
  bleedPx: 36
  trimRect: PrintRect
  safeRect: PrintRect
  sourceRect: PrintRect
  sourcePreserved: boolean
  sourceContainedInSafeArea: boolean
  placementVerified: boolean
  warnings: string[]
}

export interface MpcProofRequest {
  manifest: ProjectManifest
  customAssets: Record<string, Uint8Array>
  deckId?: string
  entryId?: string
  allocationId?: string
}

export interface MpcProofResult {
  png: Uint8Array
  deckId: string
  entryId: string
  allocationId: string
  label: string
  proof: MpcPlacementProof
}

export type MpcAutomationStage =
  | 'idle'
  | 'preflight'
  | 'launching'
  | 'configuring-project'
  | 'uploading-fronts'
  | 'assigning-fronts'
  | 'uploading-backs'
  | 'assigning-backs'
  | 'opening-review'
  | 'complete'
  | 'failed'
  | 'cancelled'

export interface MpcAutomationEvent {
  stage: MpcAutomationStage
  message: string
  completed: number
  total: number
  timestamp: string
}

export interface MpcAutomationRequest {
  manifest: ProjectManifest
  customAssets: Record<string, Uint8Array>
}

export interface ImageDerivative {
  sourceId: string
  filePath: string
  sha1: string
  width: number
  height: number
  sourceRect?: PrintRect
}

export interface AppInfo {
  version: string
  platform: string
  cacheDirectory: string
}

export interface RendererApi {
  getAppInfo(): Promise<AppInfo>
  loadCatalog(game: GameId, forceRefresh?: boolean): Promise<CatalogSnapshot>
  searchCatalog(game: GameId, query: string): Promise<CardRecord[]>
  loadPrintings(game: GameId, cardId: string): Promise<CardRecord[]>
  importText(game: GameId, text: string): Promise<ImportResult>
  importDeckCode(code: string): Promise<ImportResult>
  importPiltoverUrl(url: string): Promise<ImportResult>
  resolveImport(game: GameId, result: ImportResult, catalog: CardRecord[]): Promise<ResolvedImport>
  chooseArtwork(): Promise<{ assetId: string; archivePath: string; displayName: string; bytes: Uint8Array } | null>
  getDefaultBack(game: GameId): Promise<{ assetId: string; archivePath: string; displayName: string; bytes: Uint8Array }>
  saveProject(document: ProjectDocument): Promise<{ filePath: string } | null>
  openProject(): Promise<ProjectDocument | null>
  exportPdf(request: PdfExportRequest): Promise<PdfExportResult | null>
  renderPrintPreview(request: PrintPreviewRequest): Promise<PrintPreviewResult>
  renderMpcProof(request: MpcProofRequest): Promise<MpcProofResult>
  startMpcAutomation(request: MpcAutomationRequest): Promise<void>
  cancelMpcAutomation(): Promise<void>
  onMpcProgress(callback: (event: MpcAutomationEvent) => void): () => void
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  pageSize: 'letter',
  mode: 'fronts',
  bleedMm: 1.5,
  cropMarks: true,
  dpi: 300,
  cardWidthMm: 63,
  cardHeightMm: 88
}

export const DEFAULT_MPC_SETTINGS: MpcSettings = {
  product: 'custom-game-cards-63x88',
  stock: 'A35',
  finish: 'MPC game card finish',
  foil: false
}

export function defaultPrintSettings(game: GameId): PrintSettings {
  const profile = GAME_PROFILES[game]
  return {
    ...DEFAULT_PRINT_SETTINGS,
    cardWidthMm: profile.cardWidthMm,
    cardHeightMm: profile.cardHeightMm
  }
}

export function defaultMpcSettings(game: GameId): MpcSettings {
  return {
    ...DEFAULT_MPC_SETTINGS,
    product: GAME_PROFILES[game].mpcProduct
  }
}
