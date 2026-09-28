# Proxy Studio

A Windows desktop application for importing Riftbound or Magic: The Gathering deck lists, choosing artwork, saving portable projects, exporting print-ready PDFs, and preparing a new MakePlayingCards project in a visible Chrome session.

## Current prototype workflow

1. Choose Riftbound or Magic, then import one or more compatible deck lists into a project. Riftbound also supports Piltover Archive URLs and deck codes; Magic supports common Arena, MTGO, Moxfield, Archidekt, and Commander text formats.
2. Navigate each named deck and resolve ambiguous or missing cards against the development catalog.
3. Split repeated cards into artwork groups, then compare official printings in a large visual gallery, choose custom fronts, assign a shared proxy-marked back, or add per-group back overrides.
4. Configure Letter/A4, fronts-only/duplex, 0–2 mm bleed, and crop marks.
5. Save `.proxyproject` (or open an existing `.rbproxy`), export PDF, or start MPC automation.

MPC automation selects the live quantity bracket and the project's chosen S30, S33, or A35 stock from the page, uploads unique images, assigns slots, and stops at review. It never enters payment information or confirms an order.

## Download

Version 0.3.2 Windows installer and portable builds are available as a [GitHub prerelease](https://github.com/younim2837/riftbound-proxy-studio/releases/tag/v0.3.2). This build includes Magic support, the artwork gallery, and stock selection. The live MPC editor and final-review checks listed in [ROADMAP.md](ROADMAP.md) remain open before a stable 0.3 release.

## 0.3.2 selectable MPC card stock

- Review now offers S30 professional standard blue-core, S33 superior smooth black-core, and A35 thick standard card stock.
- A35 remains the default for existing and new projects, while the selected option is saved in `.proxyproject` files.
- The Export summary shows the chosen stock, and MPC automation selects that exact option from MPC's live card-stock menu before opening the editor.
- Card stock affects only the physical material; image dimensions, safe placement, and bleed geometry remain unchanged.

## 0.3.1 visual artwork browser

- Customize now opens official printings in a large, scrollable image gallery instead of a native text dropdown.
- Hover, focus, or click any thumbnail to inspect a much larger preview before committing the selection.
- Search by set, release date, artist, treatment, language, or collector number; the active printing is clearly marked.
- Selection remains scoped to the current artwork group, so split quantities continue to support mixes such as five base copies and one alternate-art copy.
- Scryfall release, artist, finish, promo, and frame-treatment metadata is retained in the local catalog cache to make visually similar Magic printings easier to distinguish.

## 0.3.0 Magic support and multi-game profiles

- New projects choose either Riftbound or Magic: The Gathering. A project remains single-game because the two MPC products have different physical dimensions.
- Magic imports resolve card identity and printings through Scryfall. The provider batches deck resolution, throttles live requests, caches metadata and images locally, supports catalog search, and lazily loads alternate printings.
- Scryfall PNGs are preferred. Transform and modal double-faced cards automatically assign the reverse Scryfall face as that artwork group's physical back, which can still be overridden.
- Magic uses MPC Traditional Poker geometry: 63.5×88.9 mm trim, 822×1122 px upload canvas, 750×1050 px cut rectangle at `(36,36)`, 36 px sacrificial bleed, and a further 36 px internal safe guide.
- The complete source is proportionally protected inside trim. An opaque reflected/softened edge underlay fills the remaining trim and bleed without cropping the source or producing transparent white corners.
- Project schema 3 stores the selected game. Schema 1 and 2 projects migrate automatically to Riftbound. New `.proxyproject` files and existing `.rbproxy` files are both supported.

## 0.2.0 combined projects and per-copy artwork

- A project can contain multiple named decks. Decks can be added, renamed, reordered, removed, and edited independently from the deck bar.
- Review, PDF export, and MPC automation combine every deck in displayed order and enforce MPC's 612-card limit across the whole project.
- Repeated cards can be split into artwork groups with independent quantities, official or custom fronts, and optional back overrides. Quantities are automatically rebalanced so no copy is lost or added.
- PDF and MPC use one deterministic shared copy-expansion path. MPC continues uploading each unique processed image only once, even when it appears across multiple decks or allocations.
- `.rbproxy` manifest schema 2 stores decks and artwork allocations. Schema 1 projects migrate automatically into one deck with one full-quantity artwork group per resolved entry.

## 0.1.4 Resolve corrections

- Rows needing attention are highlighted by severity: amber for multiple plausible printings and red when no automatic match exists.
- The attention count is clickable, and an attention-only filter hides already resolved entries until the remaining choices are handled.
- Champion-prefixed Legend names from deck sources are matched to the catalog's title-only identity. For example, `Jayce, Defender of Tomorrow` and `Jayce - Defender of Tomorrow` suggest the `Defender of Tomorrow` Legend printings.
- Legend alias matching is restricted to the Legend section so normal deck-card resolution remains exact.

## 0.1.3 maximum safe-fit correction

- MPC fronts and backs are generated on the official 816×1110 px canvas. Standard Riftbound artwork is proportionally scaled to 692×966 at `(62, 72)`, using the complete vertical span of MPC's safe rectangle.
- The full source is preserved. Its decorative border extends only 10 px past each horizontal safe guide and remains well inside the trim boundary; the bottom credits and side symbols stay inside the safe guide on verified Riot artwork.
- A softened, edge-derived opaque underlay fills the area around the original face, including the 744×1038 trim rectangle at `(36, 36)` and the outer 36 px sacrificial bleed.
- Every MPC image is rejected before upload unless it is exactly 816×1110, fully opaque, vertically inside the safe area, horizontally overscanned by no more than 12 px, and fully inside trim.
- PDF preview and export now consume the same page-layout model, including all pages, duplex column mirroring, partial sheets, selected 0–2 mm bleed, gutters, and vector crop marks outside the artwork.
- Resolve uses a searchable keyboard-accessible printing picker and shows a larger artwork preview on hover or focus. Selecting a plausible card identity is sufficient because artwork can still be changed in Customize.
- MPC automation saves editor and final-review proof screenshots and halts if it detects a placement or resolution warning. Checkout remains strictly manual.

## Development

Requirements: Windows 11, Node.js 24+, and Google Chrome for the MPC flow.

```powershell
npm install
npm run dev
npm test
npm run build
npm run pack
```

The Riftbound development provider remains intentionally replaceable. Magic uses live Scryfall metadata and downloads only artwork selected by the user. Run `npm run test:live:scryfall` to exercise a real high-resolution Scryfall PNG through the 822×1122 derivative pipeline.

## Project files

`.proxyproject` and legacy `.rbproxy` files are ZIP containers with a versioned `manifest.json` and user-provided artwork under `assets/`. Official artwork is referenced by catalog identity and downloaded into the application cache. Credentials, diagnostic logs, Scryfall/Riot images, and processed derivatives are never bundled. Schema 1 and 2 files remain readable and are upgraded in memory when opened.

## Legal notice

Proxy Studio isn't endorsed by Riot Games, Wizards of the Coast, or Scryfall. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Magic: The Gathering and its card images are property of Wizards of the Coast.

Magic mode is intended for personal playtesting, not sale or sanctioned play. No Wizards or Scryfall images are stored in this repository or bundled in releases. Public binary distribution of the Magic image-to-MPC workflow remains subject to a separate rights review; a disclaimer alone does not grant permission.

This repository contains a clean-room implementation. It does not copy source code or assets from MPC Autofill or TCG Proxy Builder.
