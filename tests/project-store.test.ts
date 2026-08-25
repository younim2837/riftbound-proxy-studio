import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ZipProjectStore } from '../src/main/services/project-store.js'
import { assertSafeArchivePath, migrateProjectManifest, projectManifestSchema } from '../src/shared/schemas.js'
import { DEFAULT_MPC_SETTINGS, DEFAULT_PRINT_SETTINGS, PROJECT_SCHEMA_VERSION, type ProjectDocument } from '../src/shared/contracts.js'

describe('portable project files', () => {
  it('round-trips the manifest and custom assets', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rbproxy-'))
    const destination = join(folder, 'test.rbproxy')
    const document = makeDocument()
    const store = new ZipProjectStore()
    await store.save(document, destination)
    expect((await readFile(destination)).byteLength).toBeGreaterThan(0)
    const opened = await store.open(destination)
    expect(opened.manifest.title).toBe('Test Deck')
    expect([...opened.customAssets.back!]).toEqual([1, 2, 3, 4])
  })

  it('rejects unsafe archive paths', () => {
    expect(() => assertSafeArchivePath('../escape.png')).toThrow(/Unsafe/)
    expect(() => assertSafeArchivePath('C:\\escape.png')).toThrow(/Unsafe/)
    expect(() => assertSafeArchivePath('assets/good.png')).not.toThrow()
  })

  it('enforces the MPC card maximum', () => {
    const manifest = makeDocument().manifest
    manifest.decks[0]!.entries[0]!.quantity = 613
    manifest.decks[0]!.entries[0]!.allocations[0]!.quantity = 613
    expect(() => projectManifestSchema.parse(manifest)).toThrow(/612/)
  })

  it('migrates a v1 single-deck project into one deck and one artwork group', () => {
    const now = new Date().toISOString()
    const migrated = migrateProjectManifest({
      schemaVersion: 1,
      projectId: '11111111-1111-4111-8111-111111111111',
      title: 'Legacy Deck', createdAt: now, updatedAt: now,
      entries: [{ id: 'entry', rawName: 'Ahri', quantity: 3, section: 'main', candidateCardIds: ['card'], resolvedCardId: 'card', resolution: 'resolved', front: { kind: 'official', cardId: 'card', imageUrl: `https://cmsassets.rgpub.io/${'a'.repeat(40)}.png` } }],
      printSettings: { ...DEFAULT_PRINT_SETTINGS }, mpcSettings: { ...DEFAULT_MPC_SETTINGS }
    })
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.decks).toHaveLength(1)
    expect(migrated.decks[0]?.entries[0]?.allocations[0]?.quantity).toBe(3)
  })
})

function makeDocument(): ProjectDocument {
  const now = new Date().toISOString()
  return {
    manifest: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: '11111111-1111-4111-8111-111111111111',
      title: 'Test Deck', createdAt: now, updatedAt: now,
      decks: [{ id: 'deck', title: 'Test Deck', entries: [{ id: 'entry', rawName: 'Ahri', quantity: 1, section: 'main', candidateCardIds: ['card'], resolvedCardId: 'card', resolution: 'resolved', allocations: [{ id: 'allocation', quantity: 1, front: { kind: 'official', cardId: 'card', imageUrl: `https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/${'a'.repeat(40)}-744x1039.png` } }] }] }],
      globalBack: { kind: 'custom', assetId: 'back', archivePath: 'assets/back.png', displayName: 'Back' },
      printSettings: { ...DEFAULT_PRINT_SETTINGS }, mpcSettings: { ...DEFAULT_MPC_SETTINGS }
    },
    customAssets: { back: new Uint8Array([1, 2, 3, 4]) }
  }
}
