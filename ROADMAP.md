# Riftbound Proxy Studio roadmap

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

## Output cleanup policy

Keep only the current Windows installer, portable executable, and portable ZIP in `outputs`. Treat screenshots, reports, rendered proofs, source archives, PDFs, old versions, and temporary browser/build data as disposable unless explicitly requested.
