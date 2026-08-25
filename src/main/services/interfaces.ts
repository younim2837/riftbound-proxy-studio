import type {
  CatalogSnapshot,
  ImageDerivative,
  ImportResult,
  MpcAutomationEvent,
  MpcAutomationRequest,
  MpcPlacementProof,
  PdfExportRequest,
  PdfExportResult,
  ProjectDocument
} from '../../shared/contracts.js'

export interface CardCatalogProvider {
  readonly name: string
  load(forceRefresh?: boolean): Promise<CatalogSnapshot>
}

export interface DeckImporter {
  importText(input: string): ImportResult
  importDeckCode(code: string): ImportResult
  importPiltoverUrl(url: string): Promise<ImportResult>
}

export interface ArtworkPipeline {
  createMpcDerivative(sourceId: string, bytes: Uint8Array, landscape?: boolean): Promise<ImageDerivative>
  createMpcPlacementProof(derivative: ImageDerivative): Promise<MpcPlacementProof>
  createPdfDerivative(
    sourceId: string,
    bytes: Uint8Array,
    bleedMm: number,
    landscape?: boolean
  ): Promise<ImageDerivative>
}

export interface PdfExporter {
  export(request: PdfExportRequest): Promise<PdfExportResult>
}

export interface ProjectStore {
  save(document: ProjectDocument, destination: string): Promise<void>
  open(path: string): Promise<ProjectDocument>
}

export interface MpcAutomationDriver {
  run(request: MpcAutomationRequest, onProgress: (event: MpcAutomationEvent) => void): Promise<void>
  cancel(): Promise<void>
}
