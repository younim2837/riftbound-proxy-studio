import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ArtworkSelection,
  ArtworkAllocation,
  CardRecord,
  CatalogSnapshot,
  DeckEntry,
  GameId,
  ImportResult,
  MpcAutomationEvent,
  MpcStock,
  PrintPreviewResult,
  ProjectDocument,
  ProjectDeck,
  ProjectManifest
} from '../../shared/contracts'
import { projectCardCount, unresolvedEntryCount } from '../../shared/project-copies'
import { installDevPreviewApi } from './dev-preview'
import {
  GAME_PROFILES,
  MAX_MPC_CARDS,
  PROJECT_SCHEMA_VERSION,
  defaultMpcSettings,
  defaultPrintSettings
} from '../../shared/contracts'

const SHARED_STEPS = ['Import', 'Resolve', 'Customize', 'Output'] as const
const MPC_STOCK_OPTIONS: Array<{ id: MpcStock; title: string; detail: string }> = [
  { id: 'S30', title: 'Professional standard', detail: 'Blue core · smooth finish' },
  { id: 'S33', title: 'Superior smooth', detail: 'Black core · smooth finish' },
  { id: 'A35', title: 'Thick standard', detail: 'The existing Proxy Studio default' }
]
installDevPreviewApi()
type OutputMode = 'mpc' | 'print'
type Step = (typeof SHARED_STEPS)[number] | 'MPC' | 'Print setup'
type ImportMode = 'text' | 'piltover' | 'code'

const SAMPLE_DECK = `Legend:
1 OGN-255 Nine-Tailed Fox

Battlefields:
1 OGN-292 The Dreaming Tree

Main Deck:
3 OGN-066 Ahri, Alluring
3 OGN-043 Charm
3 SFD-032 Disarming Rake`

const MTG_SAMPLE_DECK = `Commander
1 Atraxa, Praetors' Voice (2X2) 190

Deck
1 Sol Ring
1 Swords to Plowshares
1 Delver of Secrets // Insectile Aberration`

export default function App() {
  const [game, setGame] = useState<GameId>('riftbound')
  const [step, setStep] = useState<Step>('Import')
  const [outputMode, setOutputMode] = useState<OutputMode | null>(null)
  const [catalog, setCatalog] = useState<CardRecord[]>([])
  const [catalogSource, setCatalogSource] = useState('Loading Riot gallery catalog…')
  const [catalogSnapshot, setCatalogSnapshot] = useState<CatalogSnapshot | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null)
  const catalogRequest = useRef(0)
  const [document, setDocument] = useState<ProjectDocument | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('text')
  const [importValue, setImportValue] = useState(SAMPLE_DECK)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<MpcAutomationEvent | null>(null)
  const [activeDeckId, setActiveDeckId] = useState('')

  useEffect(() => {
    setCatalog([])
    setCatalogSnapshot(null)
    void refreshCatalog()
    return () => { catalogRequest.current++ }
  }, [game])

  useEffect(() => window.riftboundStudio.onMpcProgress(setProgress), [])

  const manifest = document?.manifest
  const totalCards = useMemo(() => manifest ? projectCardCount(manifest) : 0, [manifest])
  const unresolved = manifest ? unresolvedEntryCount(manifest) : 0
  const activeDeck = manifest?.decks.find((deck) => deck.id === activeDeckId) ?? manifest?.decks[0]
  const steps: Step[] = [...SHARED_STEPS, ...(outputMode ? [outputMode === 'mpc' ? 'MPC' as const : 'Print setup' as const] : [])]

  useEffect(() => {
    if (manifest && !manifest.decks.some((deck) => deck.id === activeDeckId)) {
      setActiveDeckId(manifest.decks[0]?.id ?? '')
    }
  }, [activeDeckId, manifest])

  async function importDeck(): Promise<void> {
    setBusy(true)
    clearMessages()
    try {
      if (game === 'riftbound' && catalog.length === 0) throw new Error('The card catalog is still loading.')
      let result: ImportResult
      if (importMode === 'text') result = await window.riftboundStudio.importText(game, importValue)
      else if (importMode === 'code') result = await window.riftboundStudio.importDeckCode(importValue)
      else result = await window.riftboundStudio.importPiltoverUrl(importValue)
      const resolved = await window.riftboundStudio.resolveImport(game, result, catalog)
      const entries = resolved.entries
      mergeCatalog(resolved.cards)
      const count = entries.reduce((total, entry) => total + entry.quantity, 0)
      if (totalCards + count > MAX_MPC_CARDS) throw new Error(`Adding this deck would create ${totalCards + count} cards; one project is limited to ${MAX_MPC_CARDS}. Split it into another project.`)
      const now = new Date().toISOString()
      const deck: ProjectDeck = {
        id: crypto.randomUUID(),
        title: result.title ?? `Deck ${(document?.manifest.decks.length ?? 0) + 1}`,
        entries
      }
      if (document) {
        setDocument({
          ...document,
          manifest: { ...document.manifest, decks: [...document.manifest.decks, deck], updatedAt: now }
        })
      } else {
        const defaultBack = await window.riftboundStudio.getDefaultBack(game)
        setDocument({
          manifest: {
            schemaVersion: PROJECT_SCHEMA_VERSION,
            game,
            projectId: crypto.randomUUID(),
            title: result.title ?? `Untitled ${GAME_PROFILES[game].label} project`,
            createdAt: now,
            updatedAt: now,
            decks: [deck],
            globalBack: customSelection(defaultBack),
            printSettings: defaultPrintSettings(game),
            mpcSettings: defaultMpcSettings(game)
          },
          customAssets: { [defaultBack.assetId]: defaultBack.bytes }
        })
      }
      setActiveDeckId(deck.id)
      setWarnings(result.warnings.map((warning) => warning.message))
      setStep('Resolve')
    } catch (reason) {
      setError(formatError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function openProject(): Promise<void> {
    clearMessages()
    try {
      const opened = await window.riftboundStudio.openProject()
      if (!opened) return
      setDocument(opened)
      setGame(opened.manifest.game)
      setActiveDeckId(opened.manifest.decks[0]?.id ?? '')
      setOutputMode(null)
      setStep('Resolve')
      setNotice(`Opened ${opened.manifest.title}`)
    } catch (reason) {
      setError(formatError(reason))
    }
  }

  async function saveProject(): Promise<void> {
    if (!document) return
    clearMessages()
    try {
      const result = await window.riftboundStudio.saveProject(touch(document))
      if (result) {
        setDocument({ ...touch(document), filePath: result.filePath })
        setNotice('Portable project saved.')
      }
    } catch (reason) {
      setError(formatError(reason))
    }
  }

  function updateManifest(update: (value: ProjectManifest) => ProjectManifest): void {
    setDocument((current) =>
      current
        ? { ...current, manifest: { ...update(current.manifest), updatedAt: new Date().toISOString() } }
        : current
    )
  }

  function mergeCatalog(cards: CardRecord[]): void {
    setCatalog((current) => [...new Map([...current, ...cards].map((card) => [card.id, card])).values()])
  }

  async function refreshCatalog(forceRefresh = false): Promise<void> {
    const request = ++catalogRequest.current
    setCatalogLoading(true)
    setCatalogWarning(null)
    setCatalogSource(game === 'mtg' ? 'Loading cached Scryfall cards…' : 'Checking Riot gallery catalog…')
    try {
      const snapshot = await window.riftboundStudio.loadCatalog(game, forceRefresh)
      if (request !== catalogRequest.current) return
      mergeCatalog(snapshot.cards)
      setCatalogSnapshot(snapshot)
      setCatalogWarning(snapshot.warning ?? null)
      setCatalogSource(game === 'mtg'
        ? `${snapshot.cards.length.toLocaleString()} cached Scryfall cards · live lookup enabled`
        : `${snapshot.cards.length.toLocaleString()} Riftbound printings · ${snapshot.cacheStatus === 'bundled' || snapshot.cacheStatus === 'offline' ? 'offline fallback' : snapshot.cacheStatus === 'cached' ? 'cached gallery' : 'Riot gallery'}`)
    } catch (reason) {
      if (request !== catalogRequest.current) return
      setCatalogWarning(`Could not refresh the catalog: ${formatError(reason)}`)
      setCatalogSource('Catalog refresh unavailable')
    } finally {
      if (request === catalogRequest.current) setCatalogLoading(false)
    }
  }

  async function searchCatalog(query: string): Promise<CardRecord[]> {
    const cards = await window.riftboundStudio.searchCatalog(game, query)
    mergeCatalog(cards)
    return cards
  }

  async function loadPrintings(cardId: string): Promise<void> {
    const cards = await window.riftboundStudio.loadPrintings(game, cardId)
    mergeCatalog(cards)
  }

  function resolveEntry(deckId: string, entryId: string, cardId: string): void {
    const card = catalog.find((value) => value.id === cardId)
    if (!card) return
    updateManifest((value) => ({
      ...value,
      decks: value.decks.map((deck) => deck.id !== deckId ? deck : {
        ...deck,
        entries: deck.entries.map((entry) => entry.id !== entryId ? entry : {
          ...entry,
          resolvedCardId: card.id,
          candidateCardIds: unique([card.id, ...entry.candidateCardIds]),
          allocations: entry.allocations.length > 0
            ? entry.allocations.map((allocation) => applyOfficialPrinting(allocation, card))
            : [{ id: crypto.randomUUID(), quantity: entry.quantity, front: officialSelection(card), ...(card.backImageUrl ? { back: { kind: 'official' as const, cardId: card.id, imageUrl: card.backImageUrl, face: 'back' as const } } : {}) }],
          resolution: 'resolved'
        })
      })
    }))
  }

  function updateEntry(deckId: string, entryId: string, update: (entry: DeckEntry) => DeckEntry): void {
    updateManifest((value) => ({
      ...value,
      decks: value.decks.map((deck) => deck.id === deckId
        ? { ...deck, entries: deck.entries.map((entry) => entry.id === entryId ? update(entry) : entry) }
        : deck)
    }))
  }

  async function chooseArtwork(target: 'global-back' | 'front' | 'back', deckId?: string, entryId?: string, allocationId?: string): Promise<void> {
    try {
      const chosen = await window.riftboundStudio.chooseArtwork()
      if (!chosen || !document) return
      const selection = customSelection(chosen)
      setDocument((current) => {
        if (!current) return current
        const nextAssets = { ...current.customAssets, [chosen.assetId]: chosen.bytes }
        if (target === 'global-back') {
          return { ...current, customAssets: nextAssets, manifest: { ...current.manifest, globalBack: selection } }
        }
        return {
          ...current,
          customAssets: nextAssets,
          manifest: {
            ...current.manifest,
            decks: current.manifest.decks.map((deck) => deck.id !== deckId ? deck : {
              ...deck,
              entries: deck.entries.map((entry) => entry.id !== entryId ? entry : {
                ...entry,
                allocations: entry.allocations.map((allocation) => allocation.id === allocationId
                  ? { ...allocation, [target]: selection }
                  : allocation)
              })
            })
          }
        }
      })
    } catch (reason) {
      setError(formatError(reason))
    }
  }

  function renameDeck(deckId: string, title: string): void {
    const normalized = title.trim().slice(0, 120)
    if (!normalized) return
    updateManifest((value) => ({ ...value, decks: value.decks.map((deck) => deck.id === deckId ? { ...deck, title: normalized } : deck) }))
  }

  function moveDeck(deckId: string, direction: -1 | 1): void {
    updateManifest((value) => {
      const from = value.decks.findIndex((deck) => deck.id === deckId)
      const to = from + direction
      if (from < 0 || to < 0 || to >= value.decks.length) return value
      const decks = [...value.decks]
      const [deck] = decks.splice(from, 1)
      if (deck) decks.splice(to, 0, deck)
      return { ...value, decks }
    })
  }

  function removeDeck(deckId: string): void {
    if (!manifest || manifest.decks.length <= 1) return
    const deck = manifest.decks.find((candidate) => candidate.id === deckId)
    if (!deck || !window.confirm(`Remove “${deck.title}” and all of its cards from this project?`)) return
    const remaining = manifest.decks.filter((candidate) => candidate.id !== deckId)
    updateManifest((value) => ({ ...value, decks: value.decks.filter((candidate) => candidate.id !== deckId) }))
    setActiveDeckId(remaining[0]?.id ?? '')
  }

  async function exportPdf(): Promise<void> {
    if (!document) return
    setBusy(true)
    clearMessages()
    try {
      const result = await window.riftboundStudio.exportPdf({
        manifest: touch(document).manifest,
        destination: '',
        customAssets: document.customAssets
      })
      if (result) {
        setNotice(`PDF exported: ${result.cards} cards across ${result.pages} pages (${result.columns}×${result.rows}).`)
        setWarnings(result.warnings)
      }
    } catch (reason) {
      setError(formatError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function startMpc(): Promise<void> {
    if (!document) return
    setBusy(true)
    clearMessages()
    setProgress(null)
    try {
      await window.riftboundStudio.startMpcAutomation({
        manifest: touch(document).manifest,
        customAssets: document.customAssets
      })
    } catch (reason) {
      setError(formatError(reason))
    } finally {
      setBusy(false)
    }
  }

  function clearMessages(): void {
    setError(null)
    setNotice(null)
    setWarnings([])
  }

  function chooseOutput(mode: OutputMode): void {
    clearMessages()
    setOutputMode(mode)
    setStep(mode === 'mpc' ? 'MPC' : 'Print setup')
  }

  function changeOutput(): void {
    clearMessages()
    setStep('Output')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">P</div>
        <div className="brand-copy">
          <strong>Proxy Studio</strong>
          <span>{GAME_PROFILES[manifest?.game ?? game].label} project</span>
        </div>
        <div className="topbar-actions">
          <span className="catalog-status"><i />{catalogSource}</span>
          <button className="button ghost" disabled={busy} onClick={() => void openProject()}>Open project</button>
          <button className="button ghost" disabled={!document || busy} onClick={() => void saveProject()}>Save</button>
        </div>
      </header>

      <div className="prototype-banner">
        {game === 'mtg'
          ? 'Magic mode uses Scryfall images for personal playtest projects. No images are bundled; public binary distribution requires separate rights review.'
          : 'Riftbound uses a development adapter for Riot’s public card gallery. Public distribution requires Riot product registration and approved API access.'}
      </div>

      {game === 'riftbound' && <div className={`catalog-info-bar ${catalogWarning ? 'offline' : ''}`}>
        <div title={catalogSnapshot?.source}>
          <strong>Riftbound catalog</strong>
          <span>{catalogSnapshot ? `${catalogSnapshot.cards.length.toLocaleString()} printings · ${new Set(catalogSnapshot.cards.map((card) => card.setCode)).size} sets · Radiance: ${catalogSnapshot.cards.filter((card) => card.setCode === 'RAD').length} · ${catalogSnapshot.cacheStatus === 'bundled' ? 'Bundled snapshot' : 'Last synced'} ${new Date(catalogSnapshot.fetchedAt).toLocaleString()}` : catalogLoading ? 'Checking for the latest cards…' : 'No catalog loaded'}</span>
          {catalogWarning && <small role="status">{catalogWarning}</small>}
        </div>
        <button type="button" className="button ghost" disabled={busy || catalogLoading} onClick={() => void refreshCatalog(true)}>{catalogLoading ? 'Refreshing catalog…' : 'Refresh catalog'}</button>
      </div>}

      <main className="workspace">
        <aside className="stepper" aria-label="Project steps">
          <div className="stepper-label">Project flow</div>
          {steps.map((value, index) => {
            const active = value === step
            const currentIndex = steps.indexOf(step)
            const enabled = !busy && (value === 'Import' || Boolean(document))
            return (
              <button
                key={value}
                className={`step ${active ? 'active' : ''} ${index < currentIndex ? 'complete' : ''}`}
                disabled={!enabled}
                aria-current={active ? 'step' : undefined}
                onClick={() => { clearMessages(); setStep(value) }}
              >
                <span>{index < currentIndex ? '✓' : index + 1}</span>
                <div><strong>{value}</strong><small>{stepCaption(value)}</small></div>
              </button>
            )
          })}
          {document && (
            <div className="project-summary">
              <span>Current project</span>
              <strong>{document.manifest.title}</strong>
              <div><b>{totalCards}</b> cards · <b>{unresolved}</b> unresolved</div>
            </div>
          )}
        </aside>

        <section className="stage">
          {manifest && (
            <DeckBar
              decks={manifest.decks}
              activeDeckId={activeDeck?.id ?? ''}
              onSelect={setActiveDeckId}
              onRename={renameDeck}
              onMove={moveDeck}
              onRemove={removeDeck}
              onAdd={() => { setImportValue(''); setStep('Import') }}
            />
          )}
          {error && <div className="message error"><strong>Couldn’t complete that action</strong>{error}</div>}
          {notice && <div className="message success">{notice}</div>}
          {warnings.length > 0 && <div className="message warning">{warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>}

          {step === 'Import' && (
            <ImportPanel
              mode={importMode}
              value={importValue}
              busy={busy}
              onMode={setImportMode}
              onValue={setImportValue}
              onImport={() => void importDeck()}
              adding={Boolean(document)}
              game={manifest?.game ?? game}
              onGame={(value) => { setGame(value); setImportMode('text'); setImportValue(value === 'riftbound' ? SAMPLE_DECK : MTG_SAMPLE_DECK) }}
            />
          )}
          {step === 'Resolve' && manifest && activeDeck && (
            <ResolvePanel
              deck={activeDeck}
              catalog={catalog}
              onResolve={(entryId, cardId) => resolveEntry(activeDeck.id, entryId, cardId)}
              game={manifest.game}
              onSearch={searchCatalog}
              onContinue={() => setStep('Customize')}
            />
          )}
          {step === 'Customize' && document && activeDeck && (
            <CustomizePanel
              document={document}
              deck={activeDeck}
              catalog={catalog}
              onUpdateEntry={(entryId, update) => updateEntry(activeDeck.id, entryId, update)}
              onChooseArtwork={chooseArtwork}
              onUpdateManifest={updateManifest}
              onLoadPrintings={loadPrintings}
              onContinue={changeOutput}
            />
          )}
          {step === 'Output' && document && (
            <OutputChoicePanel document={document} onChoose={chooseOutput} />
          )}
          {step === 'Print setup' && document && (
            <PrintSetupPanel
              document={document}
              onUpdateManifest={updateManifest}
              busy={busy}
              unresolved={unresolved}
              onPdf={() => void exportPdf()}
              onChangeOutput={changeOutput}
            />
          )}
          {step === 'MPC' && document && (
            <MpcPanel
              document={document}
              totalCards={totalCards}
              unresolved={unresolved}
              busy={busy}
              progress={progress}
              onUpdateManifest={updateManifest}
              onChangeOutput={changeOutput}
              onMpc={() => void startMpc()}
              onCancel={() => void window.riftboundStudio.cancelMpcAutomation()}
            />
          )}
        </section>
      </main>

      <footer>
        {game === 'mtg'
          ? 'Proxy Studio is unofficial and is not endorsed by Wizards of the Coast or Scryfall. Magic: The Gathering and its card images are property of Wizards of the Coast. For personal playtesting only; not for sale or sanctioned play.'
          : 'Proxy Studio isn’t endorsed by Riot Games and doesn’t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.'}
      </footer>
    </div>
  )
}

function DeckBar(props: {
  decks: ProjectDeck[]
  activeDeckId: string
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
  onAdd: () => void
}) {
  const activeIndex = props.decks.findIndex((deck) => deck.id === props.activeDeckId)
  const active = props.decks[activeIndex]
  return (
    <div className="deck-bar">
      <div className="deck-tabs" role="tablist" aria-label="Decks in this project">
        {props.decks.map((deck) => (
          <button type="button" role="tab" aria-selected={deck.id === props.activeDeckId} className={`${deck.id === props.activeDeckId ? 'active' : ''} ${deck.entries.some((entry) => entry.resolution !== 'resolved') ? 'needs-attention' : ''}`} key={deck.id} onClick={() => props.onSelect(deck.id)}>
            <strong>{deck.title}</strong><span>{deck.entries.reduce((total, entry) => total + entry.quantity, 0)} cards{deck.entries.some((entry) => entry.resolution !== 'resolved') ? ` · ${deck.entries.filter((entry) => entry.resolution !== 'resolved').length} need attention` : ''}</span>
          </button>
        ))}
        <button type="button" className="add-deck" onClick={props.onAdd}>＋ Add deck</button>
      </div>
      {active && <div className="deck-tools">
        <label>Deck name<input defaultValue={active.title} key={active.id} onBlur={(event) => props.onRename(active.id, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
        <button type="button" title="Move deck earlier" disabled={activeIndex <= 0} onClick={() => props.onMove(active.id, -1)}>←</button>
        <button type="button" title="Move deck later" disabled={activeIndex >= props.decks.length - 1} onClick={() => props.onMove(active.id, 1)}>→</button>
        <button type="button" className="remove" disabled={props.decks.length <= 1} onClick={() => props.onRemove(active.id)}>Remove</button>
      </div>}
    </div>
  )
}

function ImportPanel(props: {
  game: GameId
  onGame: (game: GameId) => void
  mode: ImportMode
  value: string
  busy: boolean
  onMode: (mode: ImportMode) => void
  onValue: (value: string) => void
  onImport: () => void
  adding: boolean
}) {
  return (
    <div className="panel narrow">
      <div className="eyebrow">{props.adding ? 'Add another deck' : 'Step 1'}</div>
      <h1>{props.adding ? 'Add a deck to this project' : `Bring in a ${GAME_PROFILES[props.game].label} deck`}</h1>
      <p className="lede">{props.game === 'mtg' ? 'Paste an Arena, MTGO, Moxfield, Archidekt, Commander, or plain-text export.' : 'Paste a list, use a Piltover Archive link, or decode a share code.'} {props.adding ? 'It will be appended to the combined PDF and MPC project.' : props.game === 'mtg' ? 'Card metadata and selected artwork are requested from Scryfall.' : 'Nothing is uploaded to our servers.'}</p>
      {!props.adding && <div className="game-picker" role="group" aria-label="Card game">
        {(['riftbound', 'mtg'] as GameId[]).map((game) => <button type="button" key={game} className={props.game === game ? 'selected' : ''} onClick={() => props.onGame(game)}><strong>{GAME_PROFILES[game].label}</strong><span>{game === 'mtg' ? 'Scryfall · 2.5×3.5 in' : 'Riot gallery · 63×88 mm'}</span></button>)}
      </div>}
      <div className="segmented">
        {(props.game === 'mtg' ? ['text'] as ImportMode[] : ['text', 'piltover', 'code'] as ImportMode[]).map((mode) => (
          <button key={mode} className={props.mode === mode ? 'selected' : ''} onClick={() => { props.onMode(mode); props.onValue('') }}>
            {mode === 'text' ? 'Deck list' : mode === 'piltover' ? 'Piltover URL' : 'Deck code'}
          </button>
        ))}
      </div>
      {props.mode === 'text' ? (
        <textarea className="deck-input" value={props.value} onChange={(event) => props.onValue(event.target.value)} placeholder={props.game === 'mtg' ? '4 Lightning Bolt (M11) 149' : '3 Ahri - Alluring'} />
      ) : (
        <input className="single-input" value={props.value} onChange={(event) => props.onValue(event.target.value)} placeholder={props.mode === 'piltover' ? 'https://piltoverarchive.com/decks/view/…' : 'Paste Riftbound deck code'} />
      )}
      <div className="tip"><strong>Accepted text</strong><code>3 Card Name</code><code>3x Card Name</code><code>Card Name x3</code><code>{props.game === 'mtg' ? '3 Lightning Bolt (M11) 149' : '3 OGN-007 Card Name'}</code></div>
      <button className="button primary large" disabled={props.busy || !props.value.trim()} onClick={props.onImport}>
        {props.busy ? 'Importing…' : props.adding ? 'Add and resolve deck' : 'Import and resolve cards'}
      </button>
    </div>
  )
}

function ResolvePanel(props: {
  game: GameId
  deck: ProjectDeck
  catalog: CardRecord[]
  onResolve: (entryId: string, cardId: string) => void
  onSearch: (query: string) => Promise<CardRecord[]>
  onContinue: () => void
}) {
  const attentionEntries = props.deck.entries.filter((entry) => entry.resolution !== 'resolved')
  const unresolved = attentionEntries.length
  const [attentionOnly, setAttentionOnly] = useState(false)
  useEffect(() => { if (unresolved === 0) setAttentionOnly(false) }, [unresolved])
  const visibleEntries = attentionOnly ? attentionEntries : props.deck.entries
  return (
    <div className="panel">
      <div className="panel-heading"><div><div className="eyebrow">Step 2 · {props.deck.title}</div><h1>Resolve every card</h1><p>Choose any printing that clearly represents the right card. You can change the official variant—or upload entirely different artwork—in Customize.</p></div><button type="button" className={`status-pill ${unresolved ? 'warn clickable' : 'good'}`} disabled={!unresolved} onClick={() => setAttentionOnly(true)}>{unresolved ? `${unresolved} need attention` : 'All resolved'}</button></div>
      <div className="resolve-tip"><strong>Unsure which printing to use?</strong><span>Hover or keyboard-focus an option to inspect it. Matching the card identity is enough at this stage; artwork is not locked in.</span></div>
      {unresolved > 0 && <div className="attention-toolbar" role="status"><div><strong>Highlighted rows need a choice.</strong><span>Amber means multiple matches; red means no automatic match.</span></div><button type="button" className="button secondary" aria-pressed={attentionOnly} onClick={() => setAttentionOnly((value) => !value)}>{attentionOnly ? 'Show all cards' : `Show ${unresolved} needing attention`}</button></div>}
      <div className="table-card">
        <div className="table-header"><span>Qty</span><span>Imported name</span><span>Section</span><span>Resolution</span></div>
        {visibleEntries.map((entry) => {
          const candidateNames = unique(entry.candidateCardIds.map((id) => props.catalog.find((card) => card.id === id)?.name).filter(Boolean) as string[])
          const legendAlias = entry.section === 'legend' && candidateNames.length === 1 && normalizeSearch(candidateNames[0]!) !== normalizeSearch(entry.rawName) ? candidateNames[0] : undefined
          return (
            <div className={`table-row ${entry.resolution !== 'resolved' ? `needs-attention ${entry.resolution}` : ''}`} data-resolution={entry.resolution} key={entry.id}>
              <span className="quantity-badge">{entry.quantity}</span>
              <div className="entry-name"><strong>{entry.rawName}</strong>{entry.resolution !== 'resolved' && <span className={`attention-badge ${entry.resolution}`}>{entry.resolution === 'ambiguous' ? 'Choose a printing' : 'No automatic match'}</span>}{legendAlias && <small>Legend title matched as “{legendAlias}”</small>}</div>
              <span className="muted capitalize">{entry.section}</span>
              <CandidatePicker game={props.game} entry={entry} catalog={props.catalog} onSearch={props.onSearch} onSelect={(cardId) => props.onResolve(entry.id, cardId)} />
            </div>
          )
        })}
      </div>
      <div className="panel-actions"><span>{props.deck.entries.length} unique entries in this deck</span><button className="button primary" disabled={unresolved > 0} onClick={props.onContinue}>Continue to artwork</button></div>
    </div>
  )
}

function CandidatePicker(props: { game: GameId; entry: DeckEntry; catalog: CardRecord[]; onSearch: (query: string) => Promise<CardRecord[]>; onSelect: (cardId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [remoteOptions, setRemoteOptions] = useState<CardRecord[]>([])
  const [searching, setSearching] = useState(false)
  const current = props.catalog.find((card) => card.id === props.entry.resolvedCardId)
  const suggested = useMemo(() => unique(props.entry.candidateCardIds)
    .map((id) => props.catalog.find((card) => card.id === id))
    .filter(Boolean) as CardRecord[], [props.catalog, props.entry.candidateCardIds])
  const options = useMemo(() => {
    const needle = normalizeSearch(query)
    if (!needle) return suggested
    const local = props.catalog.filter((card) => normalizeSearch(`${card.code} ${card.publicCode} ${card.name} ${card.setName} ${card.rarity}`).includes(needle))
    return [...new Map([...local, ...remoteOptions].map((card) => [card.id, card])).values()].slice(0, 75)
  }, [props.catalog, query, remoteOptions, suggested])
  const [focusedId, setFocusedId] = useState<string | undefined>()
  const focused = options.find((card) => card.id === focusedId) ?? options[0] ?? current

  useEffect(() => {
    if (!open || props.game !== 'mtg' || query.trim().length < 2) { setRemoteOptions([]); return }
    let disposed = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      void props.onSearch(query)
        .then((cards) => { if (!disposed) setRemoteOptions(cards) })
        .catch(() => { if (!disposed) setRemoteOptions([]) })
        .finally(() => { if (!disposed) setSearching(false) })
    }, 350)
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [open, props.game, query])

  return (
    <div className={`candidate-picker ${props.entry.resolution}`}>
      <button className={`candidate-trigger ${open ? 'open' : ''}`} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{current ? `${current.code} · ${current.name}` : props.entry.resolution === 'missing' ? 'Search catalog…' : 'Choose printing…'}</span><b>⌄</b>
      </button>
      {open && (
        <div className="candidate-popover">
          <div className="candidate-browser">
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, set, or card code…" aria-label="Search card catalog" />
            <div className="candidate-options" role="listbox" aria-label={`Printings for ${props.entry.rawName}`}>
              {!query && suggested.length > 0 && <div className="candidate-caption">Suggested matches</div>}
              {searching && <div className="candidate-caption">Searching Scryfall…</div>}
              {options.map((card) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={card.id === current?.id}
                  key={card.id}
                  onMouseEnter={() => setFocusedId(card.id)}
                  onFocus={() => setFocusedId(card.id)}
                  onClick={() => { props.onSelect(card.id); setOpen(false); setQuery('') }}
                >
                  <strong>{card.name}</strong>
                  <span>{card.code} · {card.setName}</span>
                  <small>#{card.collectorNumber} · {card.rarity}{card.language ? ` · ${card.language.toUpperCase()}` : ''}{card.imageQuality === 'fallback' ? ' · lower resolution' : ''}{card.isVariant ? ' · Alternate' : ' · Base'}</small>
                </button>
              ))}
              {options.length === 0 && <div className="candidate-empty">{query ? 'No catalog matches.' : 'Type to search the full catalog.'}</div>}
            </div>
          </div>
          <div className="candidate-preview">
            {focused ? <><img src={focused.imageUrl} alt={`${focused.name} preview`} /><strong>{focused.name}</strong><span>{focused.publicCode} · {focused.rarity}</span></> : <span>Hover a result to preview it.</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function CustomizePanel(props: {
  document: ProjectDocument
  deck: ProjectDeck
  catalog: CardRecord[]
  onUpdateEntry: (id: string, update: (entry: DeckEntry) => DeckEntry) => void
  onChooseArtwork: (target: 'global-back' | 'front' | 'back', deckId?: string, entryId?: string, allocationId?: string) => Promise<void>
  onUpdateManifest: (update: (value: ProjectManifest) => ProjectManifest) => void
  onLoadPrintings: (cardId: string) => Promise<void>
  onContinue: () => void
}) {
  const [artworkBrowser, setArtworkBrowser] = useState<{ entryId: string; allocationId: string; seedCardId: string } | null>(null)
  const [artworkLoading, setArtworkLoading] = useState(false)
  const [artworkError, setArtworkError] = useState<string | null>(null)

  function splitArtwork(entry: DeckEntry): void {
    const source = [...entry.allocations].sort((a, b) => b.quantity - a.quantity).find((allocation) => allocation.quantity > 1)
    if (!source) return
    props.onUpdateEntry(entry.id, (value) => ({
      ...value,
      allocations: value.allocations.flatMap((allocation) => allocation.id === source.id
        ? [
            { ...allocation, quantity: allocation.quantity - 1 },
            { ...allocation, id: crypto.randomUUID(), quantity: 1 }
          ]
        : [allocation])
    }))
  }

  function removeArtwork(entry: DeckEntry, allocationId: string): void {
    props.onUpdateEntry(entry.id, (value) => {
      const removed = value.allocations.find((allocation) => allocation.id === allocationId)
      const remaining = value.allocations.filter((allocation) => allocation.id !== allocationId)
      if (!removed || remaining.length === 0) return value
      return { ...value, allocations: remaining.map((allocation, index) => index === 0 ? { ...allocation, quantity: allocation.quantity + removed.quantity } : allocation) }
    })
  }

  function openArtworkBrowser(entry: DeckEntry, allocation: ArtworkAllocation): void {
    const seedCardId = allocation.front.kind === 'official' ? allocation.front.cardId : entry.resolvedCardId
    if (!seedCardId) return
    setArtworkBrowser({ entryId: entry.id, allocationId: allocation.id, seedCardId })
    setArtworkError(null)
    setArtworkLoading(true)
    void props.onLoadPrintings(seedCardId)
      .catch((reason) => setArtworkError(formatError(reason)))
      .finally(() => setArtworkLoading(false))
  }

  const browserEntry = artworkBrowser ? props.deck.entries.find((entry) => entry.id === artworkBrowser.entryId) : undefined
  const browserAllocation = browserEntry?.allocations.find((allocation) => allocation.id === artworkBrowser?.allocationId)
  const browserSeed = artworkBrowser ? props.catalog.find((card) => card.id === artworkBrowser.seedCardId) : undefined

  return (
    <>
    <div className="panel">
      <div className="panel-heading"><div><div className="eyebrow">Step 3 · {props.deck.title}</div><h1>Choose artwork and backs</h1><p>Split a card into artwork groups to give individual copies different printings, custom fronts, or backs. Group quantities always total the imported quantity.</p></div></div>
      <div className="back-card">
        <ArtworkPreview selection={props.document.manifest.globalBack} assets={props.document.customAssets} />
        <div><span className="eyebrow">Project card back</span><h3>{artworkName(props.document.manifest.globalBack, props.catalog)}</h3><p>Applied across every deck unless an artwork group has its own override.</p></div>
        <button className="button secondary" onClick={() => void props.onChooseArtwork('global-back')}>Choose custom back</button>
      </div>
      <div className="art-entry-list">
        {props.deck.entries.map((entry) => {
          const card = props.catalog.find((value) => value.id === entry.resolvedCardId)
          return (
            <section className="art-entry" key={entry.id}>
              <div className="art-entry-heading">
                <div><strong>{card?.name ?? entry.rawName}</strong><span>{card?.code ?? 'Custom'} · {entry.section} · {entry.quantity} total</span></div>
                <button type="button" className="button secondary" disabled={entry.allocations.length >= entry.quantity} onClick={() => splitArtwork(entry)}>Split one copy</button>
              </div>
              <div className="art-grid">
                {entry.allocations.map((allocation, allocationIndex) => (
                  <article className="art-card" key={allocation.id}>
                    <ArtworkPreview selection={allocation.front} assets={props.document.customAssets} />
                    <div className="art-card-body">
                      <div className="art-title"><strong>Artwork {allocationIndex + 1}</strong><span>×{allocation.quantity}</span></div>
                      <label>Copies in this group<input className="quantity-input" type="number" min="1" max={entry.quantity - (entry.allocations.length - 1)} disabled={entry.allocations.length === 1} value={allocation.quantity} onChange={(event) => props.onUpdateEntry(entry.id, (value) => ({ ...value, allocations: rebalanceAllocations(value.allocations, allocation.id, Number(event.target.value)) }))} /></label>
                      <ArtworkChoiceSummary
                        selection={allocation.front}
                        catalog={props.catalog}
                        disabled={!card && allocation.front.kind !== 'official'}
                        onBrowse={() => openArtworkBrowser(entry, allocation)}
                      />
                      {card?.layout && ['transform', 'modal_dfc'].includes(card.layout) && <div className="dfc-note">Double-faced card · its Scryfall reverse face is assigned as this copy’s back unless you override it.</div>}
                      <div className="mini-actions"><button onClick={() => void props.onChooseArtwork('front', props.deck.id, entry.id, allocation.id)}>Custom front</button><button onClick={() => void props.onChooseArtwork('back', props.deck.id, entry.id, allocation.id)}>{allocation.back ? 'Replace back' : 'Override back'}</button>{entry.allocations.length > 1 && <button className="danger" onClick={() => removeArtwork(entry, allocation.id)}>Merge group</button>}</div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      <div className="panel-actions"><span>Artwork and backs apply to either output.</span><button className="button primary" onClick={props.onContinue}>Choose how to make proxies</button></div>
    </div>
    {artworkBrowser && browserEntry && browserAllocation && browserSeed && (
      <ArtworkBrowserDialog
        game={props.document.manifest.game}
        entry={browserEntry}
        allocation={browserAllocation}
        seed={browserSeed}
        catalog={props.catalog}
        loading={artworkLoading}
        error={artworkError}
        onClose={() => setArtworkBrowser(null)}
        onChoose={(selected) => {
          props.onUpdateEntry(browserEntry.id, (value) => ({
            ...value,
            resolvedCardId: selected.id,
            candidateCardIds: unique([selected.id, ...value.candidateCardIds]),
            allocations: value.allocations.map((item) => item.id === browserAllocation.id ? applyOfficialPrinting(item, selected) : item)
          }))
          setArtworkBrowser(null)
        }}
      />
    )}
    </>
  )
}

function ArtworkChoiceSummary(props: {
  selection: ArtworkSelection
  catalog: CardRecord[]
  disabled: boolean
  onBrowse: () => void
}) {
  const selectedCardId = props.selection.kind === 'official' ? props.selection.cardId : undefined
  const card = selectedCardId ? props.catalog.find((candidate) => candidate.id === selectedCardId) : undefined
  return (
    <div className="artwork-choice-summary">
      <span>Official printing</span>
      <strong>{card ? `${card.setName} · #${card.collectorNumber}` : 'Custom artwork selected'}</strong>
      {card && <small>{card.releasedAt ? `${formatReleaseDate(card.releasedAt)} · ` : ''}{card.rarity}{card.language ? ` · ${card.language.toUpperCase()}` : ''}</small>}
      <button type="button" className="button secondary artwork-browser-button" disabled={props.disabled} onClick={props.onBrowse}>Browse artwork gallery</button>
    </div>
  )
}

function ArtworkBrowserDialog(props: {
  game: GameId
  entry: DeckEntry
  allocation: ArtworkAllocation
  seed: CardRecord
  catalog: CardRecord[]
  loading: boolean
  error: string | null
  onClose: () => void
  onChoose: (card: CardRecord) => void
}) {
  const currentCardId = props.allocation.front.kind === 'official' ? props.allocation.front.cardId : undefined
  const candidates = useMemo(() => artworkCandidates(props.catalog, props.seed), [props.catalog, props.seed])
  const [query, setQuery] = useState('')
  const [focusedId, setFocusedId] = useState(currentCardId ?? props.seed.id)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const needle = normalizeSearch(query)
    if (!needle) return candidates
    return candidates.filter((card) => normalizeSearch([
      card.name,
      card.code,
      card.setName,
      card.collectorNumber,
      card.rarity,
      card.language,
      card.artist,
      ...(card.treatments ?? [])
    ].filter(Boolean).join(' ')).includes(needle))
  }, [candidates, query])
  // Browsing/searching must not silently replace the printing awaiting confirmation.
  const chosen = candidates.find((card) => card.id === focusedId)
  const focused = filtered.find((card) => card.id === hoveredId)
    ?? filtered.find((card) => card.id === focusedId) ?? filtered[0]

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [props.onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  return (
    <div className="artwork-browser-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <section className="artwork-browser-dialog" role="dialog" aria-modal="true" aria-labelledby="artwork-browser-title">
        <header className="artwork-browser-header">
          <div><div className="eyebrow">Artwork gallery · {props.allocation.quantity} {props.allocation.quantity === 1 ? 'copy' : 'copies'}</div><h2 id="artwork-browser-title">Choose your favorite {props.seed.name} artwork</h2><p>{props.game === 'mtg' ? 'Every available Scryfall printing is shown visually. ' : ''}Click a printing, then use the button below to apply it to this artwork group.</p></div>
          <button type="button" className="artwork-browser-close" aria-label="Close artwork gallery" onClick={props.onClose}>×</button>
        </header>
        <div className="artwork-browser-toolbar">
          <label><span>Search printings</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Set, year, artist, treatment, collector number…" /></label>
          <div><strong>{filtered.length}</strong><span>{filtered.length === 1 ? 'artwork' : 'artworks'}</span></div>
        </div>
        {props.loading && <div className="artwork-browser-status">Loading every official printing{props.game === 'mtg' ? ' from Scryfall' : ''}…</div>}
        {props.error && <div className="message error artwork-browser-error">Could not load all printings: {props.error}</div>}
        <div className="artwork-browser-body">
          <div className="artwork-gallery" aria-label="Available artwork printings">
            {filtered.map((card) => {
              const selected = card.id === currentCardId
              const active = card.id === chosen?.id
              return (
                <button
                  type="button"
                  className={`artwork-tile ${selected ? 'selected' : ''} ${active ? 'focused' : ''}`}
                  key={card.id}
                  aria-pressed={active}
                  onClick={() => { setFocusedId(card.id); setHoveredId(null) }}
                  onFocus={() => { setFocusedId(card.id); setHoveredId(null) }}
                  onMouseEnter={() => setHoveredId(card.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span className="artwork-tile-image"><img loading="lazy" src={card.imageUrl} alt={`${card.name}, ${card.setName} artwork`} />{selected && <b>Current</b>}{card.imageQuality === 'fallback' && <em>Lower resolution</em>}</span>
                  <span className="artwork-tile-copy"><strong>{card.setName}</strong><small>{formatPrintingCaption(card)}</small></span>
                </button>
              )
            })}
            {!props.loading && filtered.length === 0 && <div className="artwork-gallery-empty"><strong>No artwork matches that search.</strong><span>Try a set name, artist, year, or collector number.</span></div>}
          </div>
          <aside className="artwork-focus-preview">
            {focused ? (
              <>
                <div className="artwork-focus-image"><img src={focused.imageUrl} alt={`Large preview of ${focused.name} from ${focused.setName}`} /></div>
                <div className="artwork-focus-details">
                  <div><span className="eyebrow">Focused artwork</span><h3>{focused.setName}</h3><p>{focused.code} · #{focused.collectorNumber} · {focused.rarity}{focused.language ? ` · ${focused.language.toUpperCase()}` : ''}</p></div>
                  <dl>
                    {focused.releasedAt && <><dt>Released</dt><dd>{formatReleaseDate(focused.releasedAt)}</dd></>}
                    {focused.artist && <><dt>Artist</dt><dd>{focused.artist}</dd></>}
                    {!!focused.treatments?.length && <><dt>Treatments</dt><dd>{focused.treatments.map(formatTreatment).join(' · ')}</dd></>}
                  </dl>
                  {focused.imageQuality === 'fallback' && <div className="artwork-quality-warning">This printing uses a lower-resolution source and may look softer in print.</div>}
                </div>
              </>
            ) : <div className="artwork-gallery-empty">Choose an artwork to see it larger.</div>}
          </aside>
        </div>
        <div className="artwork-browser-actions">
          <div className="artwork-browser-selection" aria-live="polite">
            <strong>{chosen ? `${chosen.setName} · #${chosen.collectorNumber}` : 'Click an artwork to select it'}</strong>
            <span>{chosen ? `Selected for ${props.allocation.quantity} ${props.allocation.quantity === 1 ? 'copy' : 'copies'} · ${chosen.code}` : 'Hover to preview; click or keyboard-focus to choose.'}</span>
          </div>
          <button type="button" className="button ghost" onClick={props.onClose}>Cancel</button>
          <button type="button" className="button primary large" disabled={!chosen} onClick={() => { if (chosen) props.onChoose(chosen) }}>{chosen?.id === currentCardId ? 'Keep this artwork' : 'Use this artwork'}</button>
        </div>
      </section>
    </div>
  )
}

function OutputChoicePanel(props: {
  document: ProjectDocument
  onChoose: (mode: OutputMode) => void
}) {
  const manifest = props.document.manifest
  return (
    <div className="panel narrow output-choice-panel">
      <div className="eyebrow">Step 4 · Choose an output</div>
      <h1>How do you want to make your proxies?</h1>
      <p className="lede">Your project contains {projectCardCount(manifest)} cards across {manifest.decks.length} {manifest.decks.length === 1 ? 'deck' : 'decks'}. Choose professional cards from MakePlayingCards or printable sheets to cut yourself.</p>
      <button type="button" className="output-card featured" onClick={() => props.onChoose('mpc')}>
        <span className="output-icon">↗</span><div><strong>MakePlayingCards</strong><small>Choose card stock, then let Proxy Studio populate a new MPC project. No PDF or sheet setup needed.</small></div><b>Set up MPC →</b>
      </button>
      <button type="button" className="output-card" onClick={() => props.onChoose('print')}>
        <span className="output-icon">▦</span><div><strong>Printed proxies / PDF</strong><small>Set up paper size, bleed, cutting guides, and backs. Preview your sheets and export a print-ready PDF.</small></div><b>Set up printing →</b>
      </button>
      <p className="output-choice-note">Both paths use the same artwork and quantities. You can switch outputs at any time without losing your settings. Save your project using Save above.</p>
    </div>
  )
}

function PrintSetupPanel(props: {
  document: ProjectDocument
  onUpdateManifest: (update: (value: ProjectManifest) => ProjectManifest) => void
  busy: boolean
  unresolved: number
  onPdf: () => void
  onChangeOutput: () => void
}) {
  const manifest = props.document.manifest
  const gameProfile = GAME_PROFILES[manifest.game]
  const total = projectCardCount(manifest)
  const [pageIndex, setPageIndex] = useState(0)
  const [preview, setPreview] = useState<(Omit<PrintPreviewResult, 'png'> & { url: string }) | null>(null)
  const [previewBusy, setPreviewBusy] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let objectUrl: string | undefined
    const timer = window.setTimeout(() => {
      setPreviewBusy(true)
      setPreviewError(null)
      void window.riftboundStudio.renderPrintPreview({ manifest, customAssets: props.document.customAssets, pageIndex })
        .then((result) => {
          if (disposed) return
          objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.png).buffer as ArrayBuffer], { type: 'image/png' }))
          setPreview({ ...result, url: objectUrl })
          if (pageIndex !== result.pageIndex) setPageIndex(result.pageIndex)
        })
        .catch((reason) => { if (!disposed) setPreviewError(formatError(reason)) })
        .finally(() => { if (!disposed) setPreviewBusy(false) })
    }, 180)
    return () => { disposed = true; window.clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [manifest, pageIndex, props.document.customAssets])

  function updateBleed(bleedMm: number): void {
    const normalized = Math.min(2, Math.max(0, Math.round(bleedMm * 10) / 10))
    setPageIndex(0)
    props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, bleedMm: normalized } }))
  }

  return (
    <div className="panel">
      <div className="panel-heading"><div><div className="eyebrow">Step 5 · Printed proxies</div><h1>Set up printed proxies</h1><p>Preview your sheets, choose cutting guides, and export a PDF. Card trim is {gameProfile.cardWidthMm}×{gameProfile.cardHeightMm} mm; bleed sits outside the trim.</p></div><div className="status-pill good">{total} cards</div></div>
      {props.unresolved > 0 && <div className="message warning">Resolve {props.unresolved} remaining {props.unresolved === 1 ? 'entry' : 'entries'} across the project before exporting.</div>}
      <div className="review-layout">
        <div className="preview-column">
          <div className={`sheet-preview accurate ${previewBusy ? 'loading' : ''}`}>
            {preview?.url && <img src={preview.url} alt={`Print preview page ${preview.pageIndex + 1}`} />}
            {previewBusy && <div className="preview-loading">Rendering exact print page…</div>}
            {previewError && <div className="preview-error">{previewError}</div>}
          </div>
          <div className="page-nav">
            <button type="button" disabled={!preview || preview.pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>← Previous</button>
            <span>{preview ? `Page ${preview.pageIndex + 1} of ${preview.pageCount} · ${preview.side === 'front' ? 'Front' : 'Back'} sheet ${preview.sheetIndex + 1} · ${preview.columns}×${preview.rows}` : 'Preparing pages…'}</span>
            <button type="button" disabled={!preview || preview.pageIndex >= preview.pageCount - 1} onClick={() => setPageIndex((value) => value + 1)}>Next →</button>
          </div>
          {preview?.warnings.map((warning) => <div className="layout-warning" key={warning}>{warning}</div>)}
        </div>
        <fieldset className="settings-card" disabled={props.busy}>
          <h3>Print PDF</h3>
          <label>Page size<select value={manifest.printSettings.pageSize} onChange={(event) => { setPageIndex(0); props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, pageSize: event.target.value as 'letter' | 'a4' } })) }}><option value="letter">US Letter</option><option value="a4">A4</option></select></label>
          <label>Print mode<select value={manifest.printSettings.mode} onChange={(event) => { setPageIndex(0); props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, mode: event.target.value as 'fronts' | 'duplex' } })) }}><option value="fronts">Fronts only</option><option value="duplex">Duplex fronts + backs</option></select></label>
          <label>Bleed <span className="bleed-value"><strong>{manifest.printSettings.bleedMm.toFixed(1)} mm</strong><input aria-label="Bleed in millimeters" type="number" min="0" max="2" step="0.1" value={manifest.printSettings.bleedMm} onChange={(event) => updateBleed(Number(event.target.value))} /></span><input type="range" min="0" max="2" step="0.1" value={manifest.printSettings.bleedMm} onChange={(event) => updateBleed(Number(event.target.value))} /></label>
          <div className="bleed-presets">{[0, 1, 1.5, 2].map((value) => <button type="button" className={manifest.printSettings.bleedMm === value ? 'active' : ''} key={value} onClick={() => updateBleed(value)}>{value.toFixed(1)}</button>)}</div>
          <div className="settings-divider" />
          <h3>Sheet guides</h3>
          <label className="checkbox"><input type="checkbox" checked={manifest.printSettings.cornerGuides} onChange={(event) => props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, cornerGuides: event.target.checked } }))} />Colored corner guides</label>
          <label>Guide size <span className="guide-setting-value">{manifest.printSettings.cornerGuideSizeMm.toFixed(1)} mm</span><input aria-label="Corner guide size" type="range" min="1" max="8" step="0.5" disabled={!manifest.printSettings.cornerGuides} value={manifest.printSettings.cornerGuideSizeMm} onChange={(event) => props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, cornerGuideSizeMm: Number(event.target.value) } }))} /></label>
          <label className="guide-color-label">Guide color <span className="guide-color-control"><input aria-label="Corner guide color" type="color" disabled={!manifest.printSettings.cornerGuides} value={manifest.printSettings.cornerGuideColor} onChange={(event) => props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, cornerGuideColor: event.target.value } }))} /><code>{manifest.printSettings.cornerGuideColor.toUpperCase()}</code></span></label>
          <fieldset className="guide-placement" disabled={!manifest.printSettings.cornerGuides}><legend>Guide position</legend><label><input type="radio" name="guide-position" value="outside" checked={manifest.printSettings.cornerGuidePlacement === 'outside'} onChange={() => props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, cornerGuidePlacement: 'outside' } }))} />Outside trim</label><label><input type="radio" name="guide-position" value="inside" checked={manifest.printSettings.cornerGuidePlacement === 'inside'} onChange={() => props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, cornerGuidePlacement: 'inside' } }))} />Inside trim</label></fieldset>
          <label className="checkbox"><input type="checkbox" checked={manifest.printSettings.cropMarks} onChange={(event) => props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, cropMarks: event.target.checked } }))} />Black cut lines to page edge</label>
          <label className="checkbox"><input type="checkbox" checked={manifest.printSettings.blackGutters} onChange={(event) => props.onUpdateManifest((value) => ({ ...value, printSettings: { ...value.printSettings, blackGutters: event.target.checked } }))} />Black gutters between cards</label>
          <p className="print-guide-note">Outside guides stay off the card face; inside guides print on the card corners. Cut lines cross margins and gutters, never the artwork.</p>
          <div className="spec-list"><div><span>Card trim</span><b>{gameProfile.cardWidthMm} × {gameProfile.cardHeightMm} mm</b></div><div><span>PDF bleed</span><b>{manifest.printSettings.bleedMm.toFixed(1)} mm</b></div></div>
        </fieldset>
      </div>
      <div className="panel-actions output-actions"><button type="button" className="button ghost" disabled={props.busy} onClick={props.onChangeOutput}>← Change output</button><span>Duplex backs are mirrored by column for physical alignment.</span><button type="button" className="button primary large" disabled={props.busy || props.unresolved > 0 || total === 0} onClick={props.onPdf}>{props.busy ? 'Exporting PDF…' : 'Export print-ready PDF'}</button></div>
    </div>
  )
}

function MpcPanel(props: {
  document: ProjectDocument
  totalCards: number
  unresolved: number
  busy: boolean
  progress: MpcAutomationEvent | null
  onUpdateManifest: (update: (value: ProjectManifest) => ProjectManifest) => void
  onChangeOutput: () => void
  onMpc: () => void
  onCancel: () => void
}) {
  const pct = props.progress?.total ? Math.round((props.progress.completed / props.progress.total) * 100) : 0
  const manifest = props.document.manifest
  const gameProfile = GAME_PROFILES[manifest.game]
  return (
    <div className="panel narrow mpc-panel">
      <div className="eyebrow">Step 5 · MakePlayingCards</div><h1>MakePlayingCards setup</h1><p className="lede">Choose your card stock, then start a new MPC project. Proxy Studio handles the artwork sizing, bleed, and image placement automatically.</p>
      {props.unresolved > 0 && <div className="message warning">Resolve {props.unresolved} remaining {props.unresolved === 1 ? 'entry' : 'entries'} across the project before starting MPC.</div>}
      <div className="mpc-setup-layout">
        <div className="settings-card">
          <h3>MPC card stock</h3>
          <fieldset className="stock-picker" disabled={props.busy}>
            <legend>Choose physical card thickness</legend>
            {MPC_STOCK_OPTIONS.map((option) => (
              <label className={manifest.mpcSettings.stock === option.id ? 'selected' : ''} key={option.id}>
                <input type="radio" name="mpc-stock" value={option.id} checked={manifest.mpcSettings.stock === option.id} onChange={() => props.onUpdateManifest((value) => ({ ...value, mpcSettings: { ...value.mpcSettings, stock: option.id } }))} />
                <span><strong>{option.id} · {option.title}</strong><small>{option.detail}</small></span>
              </label>
            ))}
          </fieldset>
          <p className="stock-note">Stock changes the physical card, not artwork size. The existing MPC image and bleed treatment stays unchanged.</p>
        </div>
        <div className="mpc-project-details">
          <h3>Your MPC project</h3>
          <div className="spec-list"><div><span>Cards</span><b>{props.totalCards}</b></div><div><span>Decks combined</span><b>{manifest.decks.length}</b></div><div><span>Card size</span><b>{gameProfile.cardWidthMm} × {gameProfile.cardHeightMm} mm</b></div><div><span>Stock</span><b>{manifest.mpcSettings.stock} · non-foil</b></div><div><span>Card finish</span><b>{manifest.mpcSettings.finish}</b></div></div>
          <p>A separate Chrome window opens. Proxy Studio creates a new project, uploads the fronts and backs, and stops at MPC review for you to inspect.</p>
        </div>
      </div>
      <button type="button" className="output-card featured" disabled={props.busy || props.unresolved > 0 || props.totalCards === 0} onClick={props.onMpc}><span className="output-icon">↗</span><div><strong>{props.busy ? 'Preparing MPC project…' : 'Begin MPC flow'}</strong><small>{props.totalCards} cards · {manifest.mpcSettings.stock} · opens Chrome · stops at review</small></div><b>{props.busy ? 'Working…' : 'Start'}</b></button>
      {(props.busy || props.progress) && <div className={`progress-card ${props.progress?.stage ?? 'starting'}`} role="status"><div><strong>{props.progress?.stage.replaceAll('-', ' ') ?? 'Starting MPC'}</strong><span>{props.progress?.message ?? 'Preparing your artwork and browser session…'}</span></div><div className="progress-track"><i style={{ width: `${pct}%` }} /></div>{props.busy && <button type="button" onClick={props.onCancel}>Cancel automation</button>}</div>}
      <div className="checkout-note"><strong>Checkout is always manual.</strong> The app never enters payment details or confirms a purchase.</div>
      <div className="panel-actions"><button type="button" className="button ghost" disabled={props.busy} onClick={props.onChangeOutput}>← Change output</button></div>
    </div>
  )
}

function ArtworkPreview({ selection, assets }: { selection: ArtworkSelection | undefined; assets: Record<string, Uint8Array> }) {
  const [customUrl, setCustomUrl] = useState<string | null>(null)
  useEffect(() => {
    if (selection?.kind !== 'custom') { setCustomUrl(null); return }
    const bytes = assets[selection.assetId]
    if (!bytes) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
    setCustomUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selection, assets])
  const src = selection?.kind === 'official' ? selection.imageUrl : customUrl
  return src ? <img className="card-image" src={src} alt="Selected card artwork" /> : <div className="card-image placeholder">No art</div>
}

function officialSelection(card: CardRecord): ArtworkSelection {
  return { kind: 'official', cardId: card.id, imageUrl: card.imageUrl, face: 'front' }
}

function applyOfficialPrinting(allocation: ArtworkAllocation, card: CardRecord): ArtworkAllocation {
  const nextBack = card.backImageUrl
    ? { kind: 'official' as const, cardId: card.id, imageUrl: card.backImageUrl, face: 'back' as const }
    : allocation.back?.kind === 'official' && allocation.back.face === 'back'
      ? undefined
      : allocation.back
  const { back: _back, ...withoutBack } = allocation
  return { ...withoutBack, front: officialSelection(card), ...(nextBack ? { back: nextBack } : {}) }
}

function customSelection(value: { assetId: string; archivePath: string; displayName: string }): ArtworkSelection {
  return { kind: 'custom', assetId: value.assetId, archivePath: value.archivePath, displayName: value.displayName }
}

function artworkName(selection: ArtworkSelection | undefined, catalog: CardRecord[]): string {
  if (!selection) return 'No artwork selected'
  if (selection.kind === 'custom') return selection.displayName
  return catalog.find((card) => card.id === selection.cardId)?.name ?? 'Official artwork'
}

function artworkCandidates(catalog: CardRecord[], seed: CardRecord): CardRecord[] {
  const seedName = normalizeSearch(seed.name)
  const matches = catalog.filter((card) => card.game === seed.game && (
    (seed.identityId && card.identityId === seed.identityId) ||
    (seed.baseCode && card.baseCode === seed.baseCode) ||
    normalizeSearch(card.name) === seedName
  ))
  return [...new Map(matches.map((card) => [card.id, card])).values()].sort((left, right) => {
    const dateDifference = (right.releasedAt ?? '').localeCompare(left.releasedAt ?? '')
    if (dateDifference !== 0) return dateDifference
    return left.setName.localeCompare(right.setName) || left.collectorNumber.localeCompare(right.collectorNumber, undefined, { numeric: true })
  })
}

function formatPrintingCaption(card: CardRecord): string {
  return [
    card.releasedAt ? formatReleaseDate(card.releasedAt) : undefined,
    `#${card.collectorNumber}`,
    card.language?.toUpperCase(),
    card.treatments?.[0] ? formatTreatment(card.treatments[0]) : undefined
  ].filter(Boolean).join(' · ')
}

function formatReleaseDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatTreatment(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function rebalanceAllocations(allocations: ArtworkAllocation[], allocationId: string, requested: number): ArtworkAllocation[] {
  if (allocations.length < 2 || !Number.isFinite(requested)) return allocations
  const target = allocations.find((allocation) => allocation.id === allocationId)
  if (!target) return allocations
  const maximum = allocations.reduce((total, allocation) => total + allocation.quantity, 0) - (allocations.length - 1)
  const desired = Math.max(1, Math.min(maximum, Math.round(requested)))
  let difference = desired - target.quantity
  if (difference === 0) return allocations
  const next = allocations.map((allocation) => ({ ...allocation }))
  const nextTarget = next.find((allocation) => allocation.id === allocationId)!
  if (difference < 0) {
    const receiver = next.find((allocation) => allocation.id !== allocationId)!
    receiver.quantity += -difference
    nextTarget.quantity = desired
    return next
  }
  for (const donor of next) {
    if (donor.id === allocationId || difference === 0) continue
    const transferable = Math.min(difference, donor.quantity - 1)
    donor.quantity -= transferable
    difference -= transferable
  }
  nextTarget.quantity = desired - difference
  return next
}

function touch(document: ProjectDocument): ProjectDocument {
  return { ...document, manifest: { ...document.manifest, updatedAt: new Date().toISOString() } }
}

function unique<T>(values: T[]): T[] { return [...new Set(values)] }
function normalizeSearch(value: string): string { return value.normalize('NFKD').replace(/[’‘`]/g, "'").toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function formatError(value: unknown): string { return value instanceof Error ? value.message : String(value) }
function stepCaption(step: Step): string {
  return { Import: 'Deck source', Resolve: 'Match cards', Customize: 'Artwork & backs', Output: 'MPC or printed proxies', MPC: 'Stock & browser setup', 'Print setup': 'Sheets & PDF export' }[step]
}
