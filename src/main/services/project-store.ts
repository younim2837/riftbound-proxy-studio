import AdmZip from 'adm-zip'
import type { ProjectDocument, ProjectManifest } from '../../shared/contracts.js'
import { assertSafeArchivePath, migrateProjectManifest, projectManifestSchema } from '../../shared/schemas.js'
import type { ProjectStore } from './interfaces.js'

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024
const MAX_ASSET_BYTES = 40 * 1024 * 1024

export class ZipProjectStore implements ProjectStore {
  async save(document: ProjectDocument, destination: string): Promise<void> {
    const manifest = projectManifestSchema.parse({
      ...document.manifest,
      updatedAt: new Date().toISOString()
    }) as ProjectManifest
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))

    for (const selection of collectCustomSelections(manifest)) {
      assertSafeArchivePath(selection.archivePath)
      const bytes = document.customAssets[selection.assetId]
      if (!bytes) throw new Error(`Custom artwork is missing: ${selection.displayName}`)
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        throw new Error(`Custom artwork exceeds 40 MB: ${selection.displayName}`)
      }
      zip.addFile(selection.archivePath, Buffer.from(bytes))
    }

    await new Promise<void>((resolve, reject) => {
      zip.writeZip(destination, (error) => (error ? reject(error) : resolve()))
    })
  }

  async open(path: string): Promise<ProjectDocument> {
    const zip = new AdmZip(path)
    const entries = zip.getEntries()
    const uncompressedSize = entries.reduce((total, entry) => total + entry.header.size, 0)
    if (uncompressedSize > MAX_ARCHIVE_BYTES) throw new Error('Project archive exceeds 250 MB.')
    for (const entry of entries) assertSafeArchivePath(entry.entryName)

    const manifestEntry = zip.getEntry('manifest.json')
    if (!manifestEntry) throw new Error('Project archive does not contain manifest.json.')
    const manifest = migrateProjectManifest(JSON.parse(manifestEntry.getData().toString('utf8')))
    const customAssets: Record<string, Uint8Array> = {}
    for (const selection of collectCustomSelections(manifest)) {
      const asset = zip.getEntry(selection.archivePath)
      if (!asset || asset.isDirectory) {
        throw new Error(`Project artwork is missing: ${selection.displayName}`)
      }
      if (asset.header.size > MAX_ASSET_BYTES) {
        throw new Error(`Project artwork exceeds 40 MB: ${selection.displayName}`)
      }
      customAssets[selection.assetId] = new Uint8Array(asset.getData())
    }
    return { manifest, customAssets, filePath: path }
  }
}

function collectCustomSelections(manifest: ProjectManifest) {
  const all = [
    manifest.globalBack,
    ...manifest.decks.flatMap((deck) => [
      deck.defaultBack,
      ...deck.entries.flatMap((entry) =>
        entry.allocations.flatMap((allocation) => [allocation.front, allocation.back])
      )
    ])
  ]
  const unique = new Map<string, Extract<NonNullable<(typeof all)[number]>, { kind: 'custom' }>>()
  for (const selection of all) {
    if (selection?.kind === 'custom') unique.set(selection.assetId, selection)
  }
  return [...unique.values()]
}
