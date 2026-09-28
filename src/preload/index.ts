import { contextBridge, ipcRenderer } from 'electron'
import type {
  CardRecord,
  GameId,
  ImportResult,
  MpcAutomationEvent,
  MpcAutomationRequest,
  MpcProofRequest,
  PdfExportRequest,
  PrintPreviewRequest,
  ProjectDocument,
  RendererApi
} from '../shared/contracts.js'

const api: RendererApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  loadCatalog: (game, forceRefresh) => ipcRenderer.invoke('catalog:load', game, forceRefresh),
  searchCatalog: (game: GameId, query: string) => ipcRenderer.invoke('catalog:search', game, query),
  loadPrintings: (game: GameId, cardId: string) => ipcRenderer.invoke('catalog:printings', game, cardId),
  importText: (game, text) => ipcRenderer.invoke('import:text', game, text),
  importDeckCode: (code) => ipcRenderer.invoke('import:code', code),
  importPiltoverUrl: (url) => ipcRenderer.invoke('import:piltover', url),
  resolveImport: (game: GameId, result: ImportResult, catalog: CardRecord[]) => ipcRenderer.invoke('import:resolve', game, result, catalog),
  chooseArtwork: () => ipcRenderer.invoke('artwork:choose'),
  getDefaultBack: (game) => ipcRenderer.invoke('artwork:default-back', game),
  saveProject: (document: ProjectDocument) => ipcRenderer.invoke('project:save', document),
  openProject: () => ipcRenderer.invoke('project:open'),
  exportPdf: (request: PdfExportRequest) => ipcRenderer.invoke('pdf:export', request),
  renderPrintPreview: (request: PrintPreviewRequest) => ipcRenderer.invoke('print:preview', request),
  renderMpcProof: (request: MpcProofRequest) => ipcRenderer.invoke('mpc:proof', request),
  startMpcAutomation: (request: MpcAutomationRequest) => ipcRenderer.invoke('mpc:start', request),
  cancelMpcAutomation: () => ipcRenderer.invoke('mpc:cancel'),
  onMpcProgress: (callback: (event: MpcAutomationEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: MpcAutomationEvent): void => callback(progress)
    ipcRenderer.on('mpc:progress', listener)
    return () => ipcRenderer.removeListener('mpc:progress', listener)
  }
}

contextBridge.exposeInMainWorld('riftboundStudio', api)
