# Shed Forge — online shed builder

A browser-based shed design tool with a **CAD-style editor** (synced, textured
3D view + 2D plan view, piece palette, inspector) and snap-to-grid building:
pick a piece, a green/red preview snaps to the 4 ft framing grid and to
existing construction, click or **drag to place runs of pieces**, right-click
to remove.

The design is structural: every piece tracks what supports it. Remove a
bearing wall and the roof it carried **breaks off and falls** (with a
stress-color view to see weak spots before they fail).

When the design is done, the built-in **report engine** computes:

- **Supply list** — every board, sheet, bundle, box, device and fitting, with retail price estimates
- **Cost breakdown** — itemized by build phase, with subtotal, tax and $/sq ft
- **Cut list** — every cut packed onto purchasable stock lengths with a
  first-fit-decreasing optimizer (each row = one physical board)
- **Step-by-step build guide** — ordered for the most efficient build
  (batch cuts, frame walls flat on the deck, long walls raised first), with
  **every cut and every nail counted per step**, plus tools and time estimates
- **Building-code check** — the design compared against IRC/NEC/IPC-based
  rules for a selectable US region (permit thresholds, height, snow/wind
  loads, frost depth, GFCI, venting, setbacks…), each finding with its code reference

## Building pieces

| Piece | Snap rule |
|---|---|
| Floor 4×4 | grid; must touch an existing floor module |
| Wall panels — plain, entry/barn/dutch door, 3 window types, louver vent (pick variants with the ▾ arrow) | snap to floor edges, 8 ft tall; real stud framing shown inside until drywall is applied |
| Diagonal wall | chamfers a floor cell at 45° (non-90° corners) |
| Porch post / railing bays | open bays on 4×4 posts that carry roof panels — deck + posts + low-slope roof = porch |
| Roof panels — 45° gable, 22° low-slope, flat/EPDM | tier 0 bears on a wall or post bay; panels stack up the slope; opposing slopes form a ridge; gable triangles are framed automatically |
| Skylight | on a sloped roof panel |
| Electrical — sub-panel, outlets (GFCI-first), switches, interior/exterior lights | on walls / ceiling cells; circuits auto-route to the panel and render in both views |
| Plumbing — utility sink, hose bib | on walls; supply/drain runs auto-route to a stub-out |

## Controls

- **Click / drag** place · **right-click / drag** remove · **R** rotate roof slope
- **Middle-drag** orbit (left-drag orbits when no tool is selected) · **wheel** zoom
- **1–6** common pieces · **Esc** put the tool down · **Ctrl+Z** undo

The design autosaves to `localStorage`. *Example Shed* loads an 8×12 gable
shed with a door, windows, vent, skylight, wiring and plumbing.

## Architecture

Static site, no build step. The "backend" is a pure-JS calculation engine
that runs client-side (and under node for tests).

```
index.html          app shell (toolbar / palette / viewports / inspector / report overlay)
js/store.js         grid data model, snap rules, structural-support physics — pure
js/engine.js        report engine: takeoff, cut packing, nail schedule, pricing, guide — pure
js/systems.js       electrical & plumbing design: routing, takeoff, guide steps — pure
js/codes.js         regional building-code profiles and checks — pure
js/catalog.js       piece specs, fixtures and the price book
js/picker.js        tool → placement-candidate mapping shared by both viewports
js/editor3d.js      three.js scene: textures, detailed meshes, collapse animation
js/editor2d.js      2D plan canvas: structure/electrical/plumbing layers, plan symbols
js/textures.js      procedural canvas textures (no image assets)
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
> adjust tax/waste/region in the inspector. This is a planning tool —
> the code check is guidance, not a permit review. Always confirm with
> your local building department.
