# Proxy Studio

A Windows desktop application for importing Riftbound or Magic: The Gathering deck lists, choosing artwork, saving portable projects, exporting print-ready PDFs, and preparing a new MakePlayingCards project in a visible Chrome session.

## Current prototype workflow

1. Choose Riftbound or Magic, then import one or more compatible deck lists into a project. Riftbound also supports Piltover Archive URLs and deck codes; Magic supports common Arena, MTGO, Moxfield, Archidekt, and Commander text formats.
2. Navigate each named deck and resolve ambiguous or missing cards. Riftbound syncs metadata from Riot's live gallery, with saved/bundled catalogs available offline; Magic uses Scryfall lookup.
3. Split repeated cards into artwork groups, then compare official printings in a large visual gallery, choose custom fronts, assign a shared proxy-marked back, or add per-group back overrides.
4. Choose **MakePlayingCards** or **Printed proxies / PDF**. The first three steps are shared; the setup pages are separate.
5. For MPC, choose S30, S33, or A35 stock and begin browser automation directly. For printed proxies, configure Letter/A4, fronts-only/duplex, 0–2 mm bleed, colored corner guides, full-page cutting lines, and black gutters, then preview and export the PDF on the same page.
6. Save `.proxyproject` at any time using Save (or open an existing `.rbproxy`). Switch output paths without losing artwork, quantities, or either set of settings.

MPC automation selects the live quantity bracket and the project's chosen S30, S33, or A35 stock from the page, uploads unique images, assigns slots, and stops at review. It never enters payment information or confirms an order.

## Download

Version 0.4.2 Windows installer, portable executable, and portable ZIP are available as a [GitHub preview release](https://github.com/younim2837/riftbound-proxy-studio/releases/tag/v0.4.2). It includes the separate MPC/PDF workflows, full-scale Riftbound border treatment, Radiance catalog and refresh controls, and the previous artwork-gallery and Magic fixes. SHA-256 checksums are included with the release downloads.

On October 25, 2026, the project owner reported that the follow-up physical MPC sampler had good borders and card scale, similar to a real Magic card, with some remaining image softness. This is positive physical feedback for that sample, not a guarantee of identical results across every image, stock, finish, or manufacturing run. The 0.3.7 gallery fix does not alter the sampled image-processing geometry.

A sampler using the new Riftbound treatment has been ordered; physical inspection is pending. The current release remains a preview. Digital pixel checks and MPC editor/review screenshots verify intended image placement, but cannot guarantee a particular physical cut.

## 0.4.2 Radiance and catalog refresh

- The Riftbound development adapter now reads structured metadata directly from Riot's English card gallery instead of the stale third-party JSON. The refreshed bundle contains 1,408 printings across six sets, including 219 Radiance entries, as fetched October 25, 2026. No official image bytes are bundled.
- Live metadata retains stable Riot IDs, champion subtitles, rune/starter codes, signed/alternate-art distinctions, artist names, and landscape orientation. All 1,180 previous bundled IDs are retained in the refreshed gallery snapshot.
- Cached live data is reused for up to 24 hours based on its actual sync timestamp and catalog format version, not file modification time. A stale/legacy cache triggers an online check; the bundled fixture is only an offline fallback. Manual refresh bypasses cache freshness and offline retry backoff.
- A visible catalog bar shows printing/set counts, Radiance availability, the last sync or bundled-snapshot timestamp, and **Refresh catalog**. Offline/error fallback is explicit, and refreshing does not replace existing project artwork or quantities.
- Malformed/empty/changed gallery responses, unapproved hosts, and failed downloads cannot replace a good saved catalog. Successful snapshots are saved atomically; concurrent requests share one load.
- `npm run verify:catalog:riftbound` checks the live catalog, prior IDs, Radiance import/resolution, and five on-demand official artwork/MPC derivatives. Add `-- --update-fixture` to mechanically regenerate the metadata bundle after those checks pass. The snapshot remains a development-only adapter, not a substitute for Riot registration/API approval for distribution.
- `npm run test:ui:catalog` exercises forced refresh, newly available card resolution/artwork, offline/error preservation, and game-switch races using offline UI fixtures. MPC/PDF image-processing profiles are unchanged.

## 0.4.1 full-scale Riftbound MPC borders

- Riftbound's complete face now fits the 744×1038 px cut rectangle at `(36,36)` on MPC's 816×1110 px / 63×88 mm template. It is no longer reduced to the internal safety guide.
- Aspect-preserving fit keeps all source edges. Original black/decorative borders retain their scale; borderless artwork remains borderless. Only minimal aspect-ratio padding and the external 36 px bleed are edge-copied, with no blurred or newly painted surround.
- Transparent corners are filled using nearby source colors. Fully opaque face pixels are retained; no black/white corner matte is imposed on borderless art. Fully transparent images are rejected.
- The pre-upload check verifies dimensions, opacity, and that every generated padding/bleed pixel matches the clamped source edge. Unsafe cached bleed is blocked. Only Riftbound MPC cache keys changed; Magic and PDF profiles/keys remain unchanged.
- `npm run verify:mpc:riftbound` audits six real Riot CDN printings, compares every fully opaque normalized face pixel, and writes source/nominal-trim comparisons outside the repo. `-- --mpc` additionally populates a temporary MPC project through review and captures editor/review screenshots, without checkout.
- Six real Riftbound images passed the digital audit and MPC editor/review run. Physical Riftbound samples of this treatment have not been verified. Full-scale source footers outside MPC's safe-area guide remain vulnerable to a shifted physical cut; neither pixel tests nor browser previews guarantee manufacturing.

## 0.4.0 separate output workflows

- Import → Resolve → Customize now leads to an explicit choice between MPC and printed proxies.
- The MPC page contains card-stock selection, a combined project summary, launch/progress/cancel controls, and the manual-checkout reminder. No print-sheet setup or PDF preview is loaded on this path.
- The printed-proxy page contains only paper, layout, guides, bleed, duplex, page preview, and direct PDF export. MPC stock and placement-proof controls are absent.
- Removed the MPC placement-proof UI and automatic proof requests. Internal derivative validation, MPC upload checks, and the physically sampled image/bleed treatment remain unchanged.
- Existing project files remain compatible. Both settings groups stay saved when switching paths; the output choice itself is session navigation, not a project schema change.
- `npm run test:ui:output` checks both games, branch isolation, all stocks, combined decks, settings retention/save/reopen, cancellation, and unresolved-card output gates using offline fixtures and captured IPC calls, without visiting MPC.

## 0.3.7 artwork confirmation fix

- The artwork gallery now has an always-visible confirmation bar outside the scrolling images and details. Its height adapts to the available window, including shorter windows and display scaling.
- Click or keyboard-focus a printing to select it, then choose **Use this artwork**. Hovering only previews another image; it cannot change the printing waiting for confirmation. The bar names the selected printing and copy count.
- Search no longer silently replaces your selected printing. Cancel and Escape leave the artwork group unchanged.
- `npm run test:ui:artwork` exercises the actual renderer in installed headless Chrome using the offline development catalog: three window sizes, mouse/keyboard confirmation, hover/search stability, split-copy isolation, Cancel/Escape, and loading/error banners. MPC/PDF image processing remains unchanged from 0.3.6.

## 0.3.6 full-scale Magic faces

- Scryfall provides a finished card face, so Magic artwork now fits the 750×1050 px trim rectangle at its original proportions, rather than shrinking to the internal safety guide. The complete image is retained; nothing is cropped to create bleed.
- Standard 744/745×1040 px sources fill the entire trim width and need only 2–3 px of total vertical padding. Black bleed is added separately outside trim to form the 822×1122 px upload.
- Review has Source face, After trim, and Upload + guides views for direct comparison. Placement verification concerns the intended cut; MPC's physical cut may vary, and source footer details outside its safe guide remain at risk. The app does not claim that all source text is inside that guide.
- Old derivatives regenerate automatically, with no change to project files or artwork choices. Riftbound and PDF processing retain their existing geometry.
- `npm run verify:mpc:black-border` now checks full-scale cut pixels against a direct aspect-preserving fit of four real Scryfall printings, including Cormela SNC 177. Add `-- --mpc` to populate a new MPC project through review and capture screenshots without checkout.

## 0.3.5 solid black Magic MPC borders (superseded)

- Physical sampler feedback exposed an incorrect colored surround outside Magic's original black border. Magic MPC derivatives now composite the full preserved face onto an entirely black canvas; every generated trim and bleed pixel is RGB `(0,0,0)`.
- No artwork colors or blur are generated around Magic fronts or backs. This also gives alternate/borderless source art a black surround. Riftbound's edge extension and PDF sheets are unchanged.
- Cache keys changed so previous derivatives regenerate automatically. The pre-upload check rejects any non-black pixel outside the preserved Magic source rectangle.
- Review reports the black-border pixel check, alongside the exact After trim and Upload + guides views. Image checks do not guarantee physical manufacturing or inspect the text positions in unusual source frames.
- This removed the colored rim but retained an undersized source face inside a wide black surround. Version 0.3.6 corrects that scaling and replaces the surround-based cut-shift test with full-scale source/cut comparisons.

## 0.3.4 print-sheet guides

- Letter and A4 sheets can show adjustable colored corner guides. Choose their color, 1–8 mm arm length, and placement just inside or outside each card's trim line. Inside guides intentionally print on the card corners.
- Optional black cut lines run from trim positions to the page edges through margins and gutters, without crossing artwork. Ordinary printers may clip lines near a page edge; use a borderless-capable printer or adjust the sheet layout when warned.
- Optional black fill covers the occupied sheet grid behind cards, including the spaces between them. The PDF and on-screen page preview use the same layout and drawing order.
- PDF artwork now keeps the full card face at trim size and extends its edge pixels only into the selected 0–2 mm bleed. This is separate from MPC's fixed upload bleed and does not change MPC images.
- These options apply equally to Riftbound and Magic, and older project files receive safe defaults when opened.

## 0.3.3 MPC border and cut preview corrections

- A crisp edge-derived border fills the entire cut rectangle and extends 24 px into the sacrificial bleed. Soft blur remains outside that guard, preventing a blurred rim from appearing at the intended cut.
- Review offers an After trim view cropped from the exact processed upload and an Upload + guides view showing the cut and safe-area boundaries.
- The full source remains protected inside trim. Geometry verification checks dimensions, opacity, and source placement; unusual frames still need visual inspection of their text and symbols.

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
- For MPC uploads, Magic fits the complete source to the full trim rectangle with black bleed added outside it. Riftbound retains its protected source placement and opaque crisp edge extension with a 24 px cut guard and softened outermost bleed. PDF sheets use separate edge-extended derivatives.
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
- Edge-derived opaque artwork fills the area around the original face, including the 744×1038 trim rectangle at `(36, 36)` and the outer 36 px sacrificial bleed. Version 0.3.3 keeps the full cut area and a 24 px guard crisp.
- Every MPC image is rejected before upload unless it is exactly 816×1110, fully opaque, vertically inside the safe area, horizontally overscanned by no more than 12 px, and fully inside trim.
- PDF preview and export consume the same page-layout model, including all pages, duplex column mirroring, partial sheets, and selected 0–2 mm bleed. Version 0.3.4 adds configurable corner guides, page-edge cut lines, and black gutters.
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
