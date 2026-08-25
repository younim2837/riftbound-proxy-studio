import { describe, expect, it } from 'vitest'
import { DEFAULT_MPC_SETTINGS, DEFAULT_PRINT_SETTINGS, PROJECT_SCHEMA_VERSION, type ProjectManifest } from '../src/shared/contracts.js'
import { expandProjectCopies, projectCardCount } from '../src/shared/project-copies.js'
import { projectManifestSchema } from '../src/shared/schemas.js'

describe('combined project copy expansion', () => {
  it('preserves deck, entry, allocation, and copy order with back fallbacks', () => {
    const manifest = makeManifest()
    const copies = expandProjectCopies(manifest)
    expect(copies.map((copy) => `${copy.deckTitle}:${copy.entryName}:${copy.front.kind === 'official' ? copy.front.cardId : copy.front.assetId}`)).toEqual([
      'Deck One:Rune:base',
      'Deck One:Rune:base',
      'Deck One:Rune:alt',
      'Deck Two:Unit:other'
    ])
    expect(projectCardCount(manifest)).toBe(4)
    expect(copies.every((copy) => copy.back?.kind === 'custom')).toBe(true)
  })

  it('rejects allocation totals that differ from the imported quantity', () => {
    const manifest = makeManifest()
    manifest.decks[0]!.entries[0]!.allocations[0]!.quantity = 1
    expect(() => projectManifestSchema.parse(manifest)).toThrow(/total 3/)
  })
})

function makeManifest(): ProjectManifest {
  const now = new Date().toISOString()
  const official = (cardId: string) => ({ kind: 'official' as const, cardId, imageUrl: `https://example.com/${cardId}.png` })
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: '33333333-3333-4333-8333-333333333333',
    title: 'Combined', createdAt: now, updatedAt: now,
    decks: [
      { id: 'one', title: 'Deck One', entries: [{ id: 'rune', rawName: 'Rune', quantity: 3, section: 'runes', resolvedCardId: 'base', candidateCardIds: ['base'], resolution: 'resolved', allocations: [{ id: 'base-art', quantity: 2, front: official('base') }, { id: 'alt-art', quantity: 1, front: official('alt') }] }] },
      { id: 'two', title: 'Deck Two', entries: [{ id: 'unit', rawName: 'Unit', quantity: 1, section: 'main', resolvedCardId: 'other', candidateCardIds: ['other'], resolution: 'resolved', allocations: [{ id: 'other-art', quantity: 1, front: official('other') }] }] }
    ],
    globalBack: { kind: 'custom', assetId: 'back', archivePath: 'assets/back.png', displayName: 'Back' },
    printSettings: { ...DEFAULT_PRINT_SETTINGS }, mpcSettings: { ...DEFAULT_MPC_SETTINGS }
  }
}
