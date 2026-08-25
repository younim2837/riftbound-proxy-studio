import type { ArtworkSelection, ProjectManifest } from './contracts.js'

export interface ExpandedProjectCopy {
  deckId: string
  deckTitle: string
  entryId: string
  entryName: string
  allocationId: string
  copyIndex: number
  front: ArtworkSelection
  back?: ArtworkSelection
}

export function expandProjectCopies(manifest: ProjectManifest): ExpandedProjectCopy[] {
  return manifest.decks.flatMap((deck) =>
    deck.entries.flatMap((entry) =>
      entry.allocations.flatMap((allocation) =>
        Array.from({ length: allocation.quantity }, (_, copyIndex) => {
          const back = allocation.back ?? deck.defaultBack ?? manifest.globalBack
          return {
            deckId: deck.id,
            deckTitle: deck.title,
            entryId: entry.id,
            entryName: entry.rawName,
            allocationId: allocation.id,
            copyIndex,
            front: allocation.front,
            ...(back ? { back } : {})
          }
        })
      )
    )
  )
}

export function projectCardCount(manifest: ProjectManifest): number {
  return manifest.decks.reduce(
    (projectTotal, deck) => projectTotal + deck.entries.reduce(
      (deckTotal, entry) => deckTotal + entry.quantity,
      0
    ),
    0
  )
}

export function unresolvedEntryCount(manifest: ProjectManifest): number {
  return manifest.decks.reduce(
    (projectTotal, deck) => projectTotal + deck.entries.filter(
      (entry) => entry.resolution !== 'resolved' || entry.allocations.length === 0
    ).length,
    0
  )
}
