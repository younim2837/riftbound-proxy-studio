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

  it('stores every supported MPC card stock while retaining A35 as the default', () => {
    expect(DEFAULT_MPC_SETTINGS.stock).toBe('A35')
    for (const stock of ['S30', 'S33', 'A35'] as const) {
      const manifest = makeDocument().manifest
      manifest.mpcSettings.stock = stock
      expect(projectManifestSchema.parse(manifest).mpcSettings.stock).toBe(stock)
    }
    const unsupported = makeDocument().manifest as unknown as { mpcSettings: { stock: string } }
    unsupported.mpcSettings.stock = 'S20'
    expect(() => projectManifestSchema.parse(unsupported)).toThrow()
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
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.game).toBe('riftbound')
    expect(migrated.decks).toHaveLength(1)
    expect(migrated.decks[0]?.entries[0]?.allocations[0]?.quantity).toBe(3)
  })

  it('migrates a v2 multi-deck project to the Riftbound game profile', () => {
    const current = makeDocument().manifest
    const { game: _game, schemaVersion: _schemaVersion, ...legacy } = current
    const migrated = migrateProjectManifest({ ...legacy, schemaVersion: 2 })
    expect(migrated).toMatchObject({
      schemaVersion: 3,
      game: 'riftbound',
      printSettings: { cardWidthMm: 63, cardHeightMm: 88 },
      mpcSettings: { product: 'custom-game-cards-63x88' }
    })
  })
})

function makeDocument(): ProjectDocument {
  const now = new Date().toISOString()
  return {
    manifest: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      game: 'riftbound',
      projectId: '11111111-1111-4111-8111-111111111111',
      title: 'Test Deck', createdAt: now, updatedAt: now,
      decks: [{ id: 'deck', title: 'Test Deck', entries: [{ id: 'entry', rawName: 'Ahri', quantity: 1, section: 'main', candidateCardIds: ['card'], resolvedCardId: 'card', resolution: 'resolved', allocations: [{ id: 'allocation', quantity: 1, front: { kind: 'official', cardId: 'card', imageUrl: `https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/${'a'.repeat(40)}-744x1039.png` } }] }] }],
      globalBack: { kind: 'custom', assetId: 'back', archivePath: 'assets/back.png', displayName: 'Back' },
      printSettings: { ...DEFAULT_PRINT_SETTINGS }, mpcSettings: { ...DEFAULT_MPC_SETTINGS }
    },
    customAssets: { back: new Uint8Array([1, 2, 3, 4]) }
  }
}
