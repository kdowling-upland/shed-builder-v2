# Shed Forge — online shed builder

A browser-based shed designer with a **game-engine style editor** (synced 3D
scene + 2D plan viewports, palette, inspector) and **Valheim-style building
mechanics**: pick a piece, a green/red ghost snaps to the 4 ft grid and to
existing pieces, left-click to place, right-click to remove.

When the design is done, the built-in **report engine** computes:

- **Supply list** — every board, sheet, bundle and box, with retail price estimates
- **Cost breakdown** — itemized by build phase, with subtotal, tax and $/sq ft
- **Cut list** — every cut packed onto purchasable stock lengths with a
  first-fit-decreasing optimizer (each row = one physical board)
- **Step-by-step build guide** — ordered for the most efficient build
  (batch cuts, frame walls flat on the deck, long walls raised first), with
  **every cut and every nail counted per step** plus tools and time estimates

## Building pieces

| Piece | Snap rule |
|---|---|
| Floor 4×4 | grid; must touch an existing floor module |
| Wall / Door wall / Window wall | snaps to floor edges, 8 ft tall |
| Roof panel (45°) | tier 0 needs a wall under its low edge; panels stack up the slope and extend sideways; opposing slopes form a ridge; gable triangles are framed automatically |

## Controls

- **LMB** place piece · **RMB** remove · **R** rotate roof slope
- **LMB drag** orbit · **MMB** pan · **wheel** zoom (both viewports)
- **1–6** select pieces · **Esc** deselect · **Ctrl+Z** undo

The design autosaves to `localStorage`. *Demo Shed* loads a classic 8×12
gable shed with a door and window.

## Architecture

Static site, no build step. The "backend" is a pure-JS calculation engine
that runs client-side (and under node for tests).

```
index.html          app shell (toolbar / palette / viewports / inspector / report overlay)
js/store.js         grid data model + placement (snap) rules — pure
js/engine.js        report engine: takeoff, cut packing, nail schedule, pricing, guide — pure
js/catalog.js       piece palette + price book
js/editor3d.js      three.js scene, ghost placement, raycasting
js/editor2d.js      2D plan canvas, same tools
js/report.js        report HTML rendering
js/main.js          app state, undo, persistence, UI wiring
vendor/             three.js (vendored, no CDN dependency)
tests/              engine test suite (node tests/engine.test.mjs)
```

## Develop & deploy

```sh
python3 -m http.server 8080   # serve locally
node tests/engine.test.mjs    # run tests
```

Pushes to the main branch run the test suite and deploy to **GitHub Pages**
via `.github/workflows/deploy-pages.yml`.

> Prices are typical US big-box estimates baked into `js/catalog.js`;
> adjust tax/waste in the inspector. This is a planning tool — check your
> local building code before building.
