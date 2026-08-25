import { contextBridge, ipcRenderer } from 'electron'
import type {
  CardRecord,
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
  loadCatalog: (forceRefresh) => ipcRenderer.invoke('catalog:load', forceRefresh),
  importText: (text) => ipcRenderer.invoke('import:text', text),
  importDeckCode: (code) => ipcRenderer.invoke('import:code', code),
  importPiltoverUrl: (url) => ipcRenderer.invoke('import:piltover', url),
  resolveImport: (result: ImportResult, catalog: CardRecord[]) => ipcRenderer.invoke('import:resolve', result, catalog),
  chooseArtwork: () => ipcRenderer.invoke('artwork:choose'),
  getDefaultBack: () => ipcRenderer.invoke('artwork:default-back'),
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
