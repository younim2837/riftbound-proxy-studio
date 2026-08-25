# Riftbound Proxy Studio

A private Windows desktop prototype for importing Riftbound deck lists, choosing artwork, saving portable projects, exporting print-ready PDFs, and preparing a new MakePlayingCards project in a visible Chrome session.

## Current prototype workflow

1. Import one or more text deck lists, Piltover Archive URLs, or Piltover deck codes into a project.
2. Navigate each named deck and resolve ambiguous or missing cards against the development catalog.
3. Split repeated cards into artwork groups, then choose official variants, custom fronts, a shared proxy-marked back, or per-group back overrides.
4. Configure Letter/A4, fronts-only/duplex, 0–2 mm bleed, and crop marks.
5. Save `.rbproxy`, export PDF, or start MPC automation.

MPC automation selects the live quantity bracket and required A35 stock from the page, uploads unique images, assigns slots, and stops at review. It never enters payment information or confirms an order.

## Download

Windows installer, portable executable, and portable ZIP builds are published on the private repository's [GitHub Releases page](https://github.com/younim2837/riftbound-proxy-studio/releases).

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

The development card provider is intentionally replaceable. Its default metadata fixture references Riot-hosted images and is for private prototype work only. Do not distribute the application until Riot product registration and approved Riftbound API access are in place.

## Project files

`.rbproxy` files are ZIP containers with a versioned `manifest.json` and user-provided artwork under `assets/`. Official artwork is referenced by catalog identity and downloaded into the application cache. Credentials, diagnostic logs, and processed images are never added to project files. Version 1 files remain readable and are upgraded in memory when opened.

## Legal notice

Riftbound Proxy Studio isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

This repository contains a clean-room implementation. It does not copy source code or assets from MPC Autofill or TCG Proxy Builder.
