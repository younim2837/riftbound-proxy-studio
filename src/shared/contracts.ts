export const PROJECT_SCHEMA_VERSION = 2 as const
export const MAX_MPC_CARDS = 612

export type CardOrientation = 'portrait' | 'landscape'
export type DeckSection = 'main' | 'sideboard' | 'runes' | 'legend' | 'battlefields' | 'other'
export type PageSize = 'letter' | 'a4'
export type PrintMode = 'fronts' | 'duplex'

export interface CardRecord {
  id: string
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
  imageHash?: string
}

export interface ImportedDeckLine {
  lineNumber: number
  raw: string
  name: string
  quantity: number
  section: DeckSection
  requestedCode?: string
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
  cardWidthMm: 63
  cardHeightMm: 88
}

export interface MpcSettings {
  product: 'custom-game-cards-63x88'
  stock: 'A35'
  finish: 'MPC game card finish'
  foil: false
}

export interface ProjectManifest {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
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
  developmentOnly: true
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
  width: 816
  height: 1110
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
  loadCatalog(forceRefresh?: boolean): Promise<CatalogSnapshot>
  importText(text: string): Promise<ImportResult>
  importDeckCode(code: string): Promise<ImportResult>
  importPiltoverUrl(url: string): Promise<ImportResult>
  resolveImport(result: ImportResult, catalog: CardRecord[]): Promise<DeckEntry[]>
  chooseArtwork(): Promise<{ assetId: string; archivePath: string; displayName: string; bytes: Uint8Array } | null>
  getDefaultBack(): Promise<{ assetId: string; archivePath: string; displayName: string; bytes: Uint8Array }>
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
