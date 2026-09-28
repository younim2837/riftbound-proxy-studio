# Proxy Studio roadmap

## Completed in 0.3.2

- Project-level MPC card-stock choice with S30, S33, and A35 options in Review.
- Backward-compatible persistence with A35 retained as the default.
- Selected-stock confirmation in Export and dynamic live-option selection during MPC automation.
- Stock-independent image processing so changing physical thickness cannot alter bleed or card-face placement.

## Completed in 0.3.1

- Full-screen visual artwork browser for official printings, replacing the cramped Customize dropdown.
- Large comparison thumbnails plus a dedicated enlarged preview with selected-state feedback.
- Search and descriptive metadata for set, release date, artist, collector number, language, finish, promo, and frame treatments.
- Explicit per-artwork-group confirmation so browsing never changes unrelated split copies.

## Completed in 0.3.0

- Game-profile architecture for Riftbound 63×88 mm and Magic Traditional Poker 63.5×88.9 mm projects.
- Scryfall-backed Magic import, batched resolution, cached search, lazy printing selection, and high-resolution PNG artwork.
- Arena/MTGO/common-text parsing with Commander, Companion, Sideboard, Maybeboard, Tokens, set codes, and collector numbers.
- Automatic transform/MDFC reverse-face back assignments with per-artwork overrides.
- Exact Magic 822×1122 MPC derivatives with 36 px bleed, opaque softened edge treatment, protected full-source placement, and proof metadata.
- Game-aware PDF trim sizes, MPC product navigation, default proxy backs, project branding, and schema 3 migration from schema 1/2.
- Development-only browser preview harness plus automated and live-gated Scryfall image tests.

## Completed in 0.2.0

- Multiple named decks in one `.rbproxy` project, with add, rename, reorder, remove, and per-deck editing controls.
- Combined PDF preview/export and MPC assignment in deterministic deck order.
- Per-copy artwork allocation through quantity-preserving artwork groups.
- Independent official/custom fronts and optional back overrides for every artwork group.
- Project-wide 612-card validation and unresolved-card output gates.
- Manifest schema 2 plus automatic migration from schema 1 single-deck projects.
- One shared copy-expansion function for totals, PDF, MPC, duplex backs, and proof selection.

## Possible follow-ups

- Duplicate or replace an existing deck without re-importing it manually.
- Optional per-deck default backs in the editor (the schema and output fallback already support them).
- PDF choice between continuous packing and beginning each deck on a new sheet.
- More compact artwork-group controls for decks with many high-quantity entries.
- A project-level title editor separate from individual deck names.
- Optional Moxfield and Archidekt URL import in addition to their pasted text exports.
- Downloadable Scryfall bulk-index mode for fully offline catalog-wide browsing.
- Additional edge-safety presets for unusual borderless/showcase frame geometry.
- Support for oversized Magic products such as Planechase, Scheme, and Vanguard cards.
- Complete live MPC editor/final-review screenshot certification for the Traditional Poker profile before marking a 0.3 binary release stable.

## Output cleanup policy

Keep only the current Windows installer, portable executable, and portable ZIP in `outputs`. Treat screenshots, reports, rendered proofs, source archives, PDFs, old versions, and temporary browser/build data as disposable unless explicitly requested.
