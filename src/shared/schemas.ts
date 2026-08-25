import { z } from 'zod'
import { MAX_MPC_CARDS, PROJECT_SCHEMA_VERSION, type ProjectManifest } from './contracts.js'

const officialArtworkSchema = z.object({
  kind: z.literal('official'),
  cardId: z.string().min(1),
  imageUrl: z.string().url().refine((url) => url.startsWith('https://'), 'Official art must use HTTPS')
})

const customArtworkSchema = z.object({
  kind: z.literal('custom'),
  assetId: z.string().min(1),
  archivePath: z.string().regex(/^assets\/[a-zA-Z0-9._/-]+$/),
  displayName: z.string().min(1)
})

export const artworkSelectionSchema = z.discriminatedUnion('kind', [
  officialArtworkSchema,
  customArtworkSchema
])

export const artworkAllocationSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().positive().max(MAX_MPC_CARDS),
  front: artworkSelectionSchema,
  back: artworkSelectionSchema.optional()
})

export const deckEntrySchema = z.object({
  id: z.string().min(1),
  rawName: z.string().min(1),
  quantity: z.number().int().positive().max(MAX_MPC_CARDS),
  section: z.enum(['main', 'sideboard', 'runes', 'legend', 'battlefields', 'other']),
  resolvedCardId: z.string().min(1).optional(),
  candidateCardIds: z.array(z.string()),
  allocations: z.array(artworkAllocationSchema),
  resolution: z.enum(['resolved', 'ambiguous', 'missing'])
}).superRefine((entry, context) => {
  const allocated = entry.allocations.reduce((total, allocation) => total + allocation.quantity, 0)
  if (entry.resolution === 'resolved' && allocated !== entry.quantity) {
    context.addIssue({
      code: 'custom',
      path: ['allocations'],
      message: `Artwork allocation quantities must total ${entry.quantity}.`
    })
  }
  if (entry.resolution !== 'resolved' && entry.allocations.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['allocations'],
      message: 'Unresolved entries cannot contain artwork allocations.'
    })
  }
})

export const projectDeckSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  entries: z.array(deckEntrySchema),
  defaultBack: artworkSelectionSchema.optional()
})

const printSettingsSchema = z.object({
  pageSize: z.enum(['letter', 'a4']),
  mode: z.enum(['fronts', 'duplex']),
  bleedMm: z.number().min(0).max(2),
  cropMarks: z.boolean(),
  dpi: z.literal(300),
  cardWidthMm: z.literal(63),
  cardHeightMm: z.literal(88)
})

const mpcSettingsSchema = z.object({
  product: z.literal('custom-game-cards-63x88'),
  stock: z.literal('A35'),
  finish: z.literal('MPC game card finish'),
  foil: z.literal(false)
})

export const projectManifestSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  decks: z.array(projectDeckSchema).min(1),
  globalBack: artworkSelectionSchema.optional(),
  printSettings: printSettingsSchema,
  mpcSettings: mpcSettingsSchema
}).superRefine((manifest, context) => {
  const count = manifest.decks.reduce(
    (projectTotal, deck) => projectTotal + deck.entries.reduce(
      (deckTotal, entry) => deckTotal + entry.quantity,
      0
    ),
    0
  )
  if (count > MAX_MPC_CARDS) {
    context.addIssue({
      code: 'custom',
      path: ['decks'],
      message: `A project cannot exceed ${MAX_MPC_CARDS} cards.`
    })
  }
})

const legacyDeckEntrySchema = z.object({
  id: z.string().min(1),
  rawName: z.string().min(1),
  quantity: z.number().int().positive().max(MAX_MPC_CARDS),
  section: z.enum(['main', 'sideboard', 'runes', 'legend', 'battlefields', 'other']),
  resolvedCardId: z.string().min(1).optional(),
  candidateCardIds: z.array(z.string()),
  front: artworkSelectionSchema.optional(),
  back: artworkSelectionSchema.optional(),
  resolution: z.enum(['resolved', 'ambiguous', 'missing'])
})

const legacyManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  entries: z.array(legacyDeckEntrySchema),
  globalBack: artworkSelectionSchema.optional(),
  printSettings: printSettingsSchema,
  mpcSettings: mpcSettingsSchema
})

export function migrateProjectManifest(input: unknown): ProjectManifest {
  if (typeof input === 'object' && input !== null && 'schemaVersion' in input && input.schemaVersion === 1) {
    const legacy = legacyManifestSchema.parse(input)
    return projectManifestSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: legacy.projectId,
      title: legacy.title,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      decks: [{
        id: `legacy-deck-${legacy.projectId}`,
        title: legacy.title,
        entries: legacy.entries.map(({ front, back, ...entry }) => ({
          ...entry,
          allocations: entry.resolution === 'resolved' && front
            ? [{ id: `legacy-art-${entry.id}`, quantity: entry.quantity, front, back }]
            : []
        }))
      }],
      globalBack: legacy.globalBack,
      printSettings: legacy.printSettings,
      mpcSettings: legacy.mpcSettings
    }) as unknown as ProjectManifest
  }
  return projectManifestSchema.parse(input) as unknown as ProjectManifest
}

export function assertSafeArchivePath(path: string): void {
  const normalized = path.replaceAll('\\', '/')
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    throw new Error(`Unsafe archive path: ${path}`)
  }
}

export function assertAllowedHttpsUrl(input: string, allowedHosts: readonly string[]): URL {
  const parsed = new URL(input)
  if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) {
    throw new Error(`URL host is not allowed: ${parsed.hostname}`)
  }
  return parsed
}
