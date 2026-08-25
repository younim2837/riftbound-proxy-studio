import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { DevelopmentCatalogProvider } from './services/catalog-provider.js'
import { RiftboundDeckImporter } from './services/deck-importer.js'
import { resolveImportedDeck } from './services/resolver.js'
import { ZipProjectStore } from './services/project-store.js'
import { ArtworkSourceResolver, SharpArtworkPipeline } from './services/artwork-pipeline.js'
import { PrintPdfExporter } from './services/pdf-exporter.js'
import { PlaywrightMpcAutomationDriver } from './services/mpc-automation.js'
import type {
  ImportResult,
  MpcAutomationRequest,
  MpcProofRequest,
  PdfExportRequest,
  PrintPreviewRequest,
  ProjectDocument
} from '../shared/contracts.js'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0d1117',
    show: false,
    title: 'Riftbound Proxy Studio',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const cacheDirectory = join(app.getPath('userData'), 'cache')
  registerIpc(cacheDirectory)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(cacheDirectory: string): void {
  const catalog = new DevelopmentCatalogProvider(
    cacheDirectory,
    join(app.getAppPath(), 'resources', 'dev-catalog-v1.json')
  )
  const importer = new RiftboundDeckImporter()
  const projects = new ZipProjectStore()
  const pipeline = new SharpArtworkPipeline(cacheDirectory)
  const resolver = new ArtworkSourceResolver(cacheDirectory)
  const pdf = new PrintPdfExporter(pipeline, resolver)
  const mpc = new PlaywrightMpcAutomationDriver(cacheDirectory, pipeline, resolver)

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    cacheDirectory
  }))
  ipcMain.handle('catalog:load', (_event, forceRefresh?: boolean) => catalog.load(forceRefresh))
  ipcMain.handle('import:text', (_event, text: string) => importer.importText(text))
  ipcMain.handle('import:code', (_event, code: string) => importer.importDeckCode(code))
  ipcMain.handle('import:piltover', (_event, url: string) => importer.importPiltoverUrl(url))
  ipcMain.handle('import:resolve', (_event, result: ImportResult, cards) => resolveImportedDeck(result, cards))

  ipcMain.handle('artwork:choose', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: 'Choose proxy artwork',
      properties: ['openFile'],
      filters: [{ name: 'Card artwork', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const bytes = new Uint8Array(await readFile(path))
    if (bytes.byteLength > 40 * 1024 * 1024) throw new Error('Artwork cannot exceed 40 MB.')
    const assetId = randomUUID()
    const extension = extname(path).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png'
    return {
      assetId,
      archivePath: `assets/${assetId}${extension}`,
      displayName: path.split(/[\\/]/).at(-1) ?? 'Custom artwork',
      bytes
    }
  })

  ipcMain.handle('artwork:default-back', async () => ({
    assetId: 'built-in-proxy-back',
    archivePath: 'assets/built-in-proxy-back.png',
    displayName: 'Proxy - Not For Sale',
    bytes: new Uint8Array(await createDefaultProxyBack())
  }))

  ipcMain.handle('project:save', async (_event, document: ProjectDocument) => {
    const result = await dialog.showSaveDialog(requireWindow(), {
      title: 'Save Riftbound Proxy Studio project',
      defaultPath: `${safeFileName(document.manifest.title)}.rbproxy`,
      filters: [{ name: 'Riftbound Proxy Studio Project', extensions: ['rbproxy'] }]
    })
    if (result.canceled || !result.filePath) return null
    await projects.save(document, result.filePath)
    return { filePath: result.filePath }
  })

  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: 'Open Riftbound Proxy Studio project',
      properties: ['openFile'],
      filters: [{ name: 'Riftbound Proxy Studio Project', extensions: ['rbproxy'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return projects.open(path)
  })

  ipcMain.handle('pdf:export', async (_event, request: PdfExportRequest) => {
    const result = await dialog.showSaveDialog(requireWindow(), {
      title: 'Export print-ready PDF',
      defaultPath: `${safeFileName(request.manifest.title)}-print.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return null
    return pdf.export({ ...request, destination: result.filePath })
  })
  ipcMain.handle('print:preview', (_event, request: PrintPreviewRequest) => pdf.renderPreview(request))
  ipcMain.handle('mpc:proof', async (_event, request: MpcProofRequest) => {
    const requestedDeck = request.manifest.decks.find((candidate) => candidate.id === request.deckId)
    const decks = requestedDeck ? [requestedDeck] : request.manifest.decks
    const requested = decks.flatMap((deck) => deck.entries.map((entry) => ({ deck, entry })))
      .find(({ entry }) => entry.id === request.entryId)
    const selected = requested ?? request.manifest.decks
      .flatMap((deck) => deck.entries.map((entry) => ({ deck, entry })))
      .find(({ entry }) => entry.resolution === 'resolved' && entry.allocations.length > 0)
    const allocation = selected?.entry.allocations.find((candidate) => candidate.id === request.allocationId)
      ?? selected?.entry.allocations[0]
    if (!selected || !allocation) throw new Error('Choose a resolved card before rendering the MPC proof.')
    const source = await resolver.load(allocation.front, request.customAssets)
    const derivative = await pipeline.createMpcDerivative(source.sourceId, source.bytes)
    const proof = await pipeline.createMpcPlacementProof(derivative)
    return {
      png: new Uint8Array(await readFile(derivative.filePath)),
      deckId: selected.deck.id,
      entryId: selected.entry.id,
      allocationId: allocation.id,
      label: `${selected.deck.title} · ${selected.entry.rawName} ×${allocation.quantity}`,
      proof
    }
  })

  ipcMain.handle('mpc:start', async (_event, request: MpcAutomationRequest) => {
    await mpc.run(request, (progress) => mainWindow?.webContents.send('mpc:progress', progress))
  })
  ipcMain.handle('mpc:cancel', () => mpc.cancel())
}

function requireWindow(): BrowserWindow {
  if (!mainWindow) throw new Error('The application window is not available.')
  return mainWindow
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim() || 'riftbound-project'
}

async function createDefaultProxyBack(): Promise<Buffer> {
  const svg = `
    <svg width="744" height="1038" viewBox="0 0 744 1038" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="42%" r="75%">
          <stop offset="0" stop-color="#1e4b57"/>
          <stop offset="0.55" stop-color="#111c2a"/>
          <stop offset="1" stop-color="#070b12"/>
        </radialGradient>
      </defs>
      <rect width="744" height="1038" rx="42" fill="url(#bg)"/>
      <rect x="28" y="28" width="688" height="982" rx="32" fill="none" stroke="#54d3c2" stroke-width="6"/>
      <rect x="48" y="48" width="648" height="942" rx="24" fill="none" stroke="#d8ad5f" stroke-width="2" opacity="0.9"/>
      <circle cx="372" cy="382" r="168" fill="none" stroke="#54d3c2" stroke-width="8" opacity="0.8"/>
      <circle cx="372" cy="382" r="118" fill="none" stroke="#d8ad5f" stroke-width="4"/>
      <path d="M372 222 L411 343 L538 343 L435 418 L474 539 L372 464 L270 539 L309 418 L206 343 L333 343 Z" fill="#54d3c2" opacity="0.16" stroke="#d8ad5f" stroke-width="5"/>
      <text x="372" y="650" fill="#f5f7fa" font-family="Arial, sans-serif" font-size="58" font-weight="700" text-anchor="middle" letter-spacing="6">PROXY</text>
      <text x="372" y="716" fill="#54d3c2" font-family="Arial, sans-serif" font-size="27" font-weight="700" text-anchor="middle" letter-spacing="4">PLAYTEST CARD</text>
      <line x1="190" y1="758" x2="554" y2="758" stroke="#d8ad5f" stroke-width="2"/>
      <text x="372" y="820" fill="#f5f7fa" font-family="Arial, sans-serif" font-size="25" text-anchor="middle" letter-spacing="3">NOT FOR SALE</text>
      <text x="372" y="918" fill="#a8b4c2" font-family="Arial, sans-serif" font-size="18" text-anchor="middle">Riftbound Proxy Studio</text>
    </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
