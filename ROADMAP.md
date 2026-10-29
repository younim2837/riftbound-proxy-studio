# Proxy Studio roadmap

## Completed in 0.4.2

- Add Radiance through Riot's live gallery metadata and refresh the offline bundle to 1,408 printings / six sets / 219 Radiance entries.
- Retain all previous bundled IDs, subtitles, variants/signatures, rune/starter identities, artists, and landscape orientation.
- Replace fixture-first loading with timestamp/version-aware live refresh, atomic cache saves, request coalescing, and explicit offline fallback/retry behavior.
- Add Refresh catalog, visible catalog coverage/sync time, and offline/error status without changing existing artwork choices.
- Add fixture-based parser/cache failure tests, browser refresh regressions, and live Radiance import/artwork verification tooling.
- Preserve MPC/PDF image-processing geometry and existing project-file compatibility.

## Completed in 0.4.1

- Fit the complete Riftbound face to 63×88 mm MPC trim instead of shrinking to the safety guide.
- Preserve bordered and borderless source faces with separate crisp edge-copied bleed, rather than a blurred/generated surround.
- Repair transparent corners using nearest source colors while preserving fully opaque pixels; reject invisible inputs and corrupt cached bleed.
- Scope cache invalidation to Riftbound MPC, retaining Magic and PDF processing/cache profiles.
- Add pixel regression coverage for original border width, borderless edges, transparency, orientation, illustrative shifted cuts, and cache rejection.
- Audit six real Riot images and populate a temporary MPC project through editor/final review, capturing screenshots without checkout.
- A physical Riftbound sampler has been ordered; inspection remains pending. Keep the current treatment unchanged until feedback arrives, with no claim of perfect manufacturing or all source-edge details inside the safe guide.

## Completed in 0.4.0

- Keep the shared Import → Resolve → Customize steps, then explicitly choose MPC or printed proxies.
- Dedicated MPC page with S30/S33/A35 stock, combined-project summary, browser launch/progress/cancel, and manual checkout.
- Dedicated print-setup page with sheet preview, print-only settings, and direct PDF export.
- Remove the MPC placement-proof UI without changing backend image processing, upload checks, or sampled MPC border/scale behavior.
- Preserve both settings groups when switching output paths and reopening existing projects; no schema migration.
- Offline browser regression coverage for both games, branch isolation, stocks, combined decks, save/reopen, cancellation, and unresolved cards.

## Completed in 0.3.7

- Always-visible artwork confirmation/cancel bar outside both scrolling panels.
- Window-height-aware gallery layout without the overflowing fixed minimum height.
- Separate transient hover previews from the printing selected for confirmation; retain the choice across search filters.
- Repeatable real-renderer Chrome regression checks for small windows, both games, mouse/keyboard, split-copy isolation, cancellation, and loading/error states.
- No changes to MPC/PDF derivative geometry or project files.

## Completed in 0.3.6

- Fit the complete Magic face to physical trim at original proportions, removing safe-guide-based shrinkage and the wide generated surround.
- Add black bleed outside trim and retain only minimal aspect-ratio padding for standard Scryfall images.
- Source face / After trim / Upload + guides comparisons and accurate distinction between nominal trim preservation and physical safe-area risk.
- Full-scale pixel regression tests, cache invalidation, and live MPC editor/review checks for four real printings.
- The project owner reported successful follow-up physical MPC samples on October 25, 2026: borders and scale looked similar to real Magic cards, with some remaining image softness. This validates the reported sample, not every manufacturing run or source image.

## Completed in 0.3.5 (superseded for Magic scaling)

- Replaced Magic MPC sampled-color surrounds with a solid black canvas behind the complete source face.
- Black-border/bleed pixel assertions before upload, proof metadata in Review, and automatic invalidation of old derivatives.
- Regression tests for full face preservation, transparent corners, shifted cuts, and rejection of corrupted cached images.
- Repeatable four-card Scryfall pixel verification and live MPC review/screenshot tooling.
- Physical sampler verification for the replacement remains pending; do not treat a browser preview as a physical print certification.

## Completed in 0.3.4

- Adjustable colored corner guides with 1–8 mm size and inside/outside trim placement.
- Black cutting lines through margins and gutters to page edges, clipped away from artwork.
- Optional black gutters, shared PDF/preview drawing instructions, and tight printer-margin warnings.
- Full-face PDF derivatives with edge-stretched bleed independent of MPC placement.
- Backward-compatible sheet settings for existing schema 3 projects.

## Completed in 0.3.3

- Crisp MPC edge extension across the cut rectangle and a 24 px guard, with blur restricted to outer bleed.
- After trim proof cropped from the exact processed upload, plus the full upload view with cut/safe-area guides.
- Pixel-level regression coverage for crisp cut edges and exact cut-preview placement.

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
- Exact Magic 822×1122 MPC derivatives with 36 px bleed, opaque edge treatment, protected full-source placement, and proof metadata.
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
