// store.js — shed state, grid geometry, placement rules and structural
// support model. Pure module (no DOM / three.js) so the report engine and
// tests can share it.

import { WALL_PIECES, ROOF_KINDS, FIXTURES } from './catalog.js';

export const CELL = 4;        // ft — building grid module
export const WALL_H = 8;      // ft — wall height
export const FLOOR_TOP = 1.0; // ft — top of deck above grade (skid + joist + deck)

// Directions: 0=N(-z) 1=E(+x) 2=S(+z) 3=W(-x)
export const DIRS = [
  { dx: 0, dz: -1 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 },
];
export const DIR_NAMES = ['north', 'east', 'south', 'west'];

export function emptyState() {
  return { floors: {}, walls: {}, roofs: {}, fixtures: {} };
}

export const floorKey = (i, j) => `${i},${j}`;
export const wallKey = (o, i, j) => `${o},${i},${j}`;
export const roofKey = (i, j, t) => `${i},${j},${t}`;
export const fixtureKey = (f) =>
  f.host === 'wall' ? `${f.kind}@w:${f.o},${f.i},${f.j}`
  : f.host === 'roof' ? `${f.kind}@r:${f.i},${f.j},${f.t}`
  : `${f.kind}@c:${f.i},${f.j}`;

export const riseOf = (kind) => ROOF_KINDS[kind]?.rise ?? 4;

// Edge of cell (i,j) on side d.  'H' edges run along x at z=j*CELL,
// 'V' edges run along z at x=i*CELL.  Shared edges get one canonical key.
export function edgeForSide(i, j, d) {
  switch (d) {
    case 0: return { o: 'H', i, j };
    case 2: return { o: 'H', i, j: j + 1 };
    case 3: return { o: 'V', i, j };
    case 1: return { o: 'V', i: i + 1, j };
  }
}

export function cellsOfEdge(e) {
  return e.o === 'H'
    ? [{ i: e.i, j: e.j - 1 }, { i: e.i, j: e.j }]
    : [{ i: e.i - 1, j: e.j }, { i: e.i, j: e.j }];
}

export function edgeSegment(e) {
  return e.o === 'H'
    ? [e.i * CELL, e.j * CELL, (e.i + 1) * CELL, e.j * CELL]
    : [e.i * CELL, e.j * CELL, e.i * CELL, (e.j + 1) * CELL];
}

export function lowEdgeOfRoof(r) {
  return edgeForSide(r.i, r.j, (r.dir + 2) % 4);
}
export function highEdgeOfRoof(r) {
  return edgeForSide(r.i, r.j, r.dir);
}
// y of low/high edges, relative to top of wall plates (add WALL_H for absolute)
export function roofHeights(r) {
  const rise = riseOf(r.kind);
  const y0 = WALL_H + r.t * rise;
  return [y0, y0 + rise];
}

// ---------- placement validity (snap rules) ----------

export function canPlaceFloor(state, i, j) {
  if (state.floors[floorKey(i, j)]) return false;
  const any = Object.keys(state.floors).length > 0;
  if (!any) return true;
  return DIRS.some(d => state.floors[floorKey(i + d.dx, j + d.dz)]);
}

export function canPlaceWall(state, e) {
  if (state.walls[wallKey(e.o, e.i, e.j)]) return false;
  return cellsOfEdge(e).some(c => state.floors[floorKey(c.i, c.j)]);
}

export function canPlaceRoof(state, i, j, t, dir, kind = 'r45') {
  if (state.roofs[roofKey(i, j, t)]) return false;
  if (kind === 'flat' && t > 0) return false;
  if (t === 0) {
    const low = lowEdgeOfRoof({ i, j, dir });
    if (state.walls[wallKey(low.o, low.i, low.j)]) return true;
  } else {
    const d = DIRS[dir];
    const below = state.roofs[roofKey(i - d.dx, j - d.dz, t - 1)];
    if (below && below.dir === dir && below.kind === kind) return true;
  }
  const perp = [(dir + 1) % 4, (dir + 3) % 4];
  return perp.some(p => {
    const d = DIRS[p];
    const n = state.roofs[roofKey(i + d.dx, j + d.dz, t)];
    return n && n.dir === dir && n.kind === kind;
  });
}

export function bestRoofTier(state, i, j, dir, kind = 'r45', maxTier = 6) {
  for (let t = 0; t <= maxTier; t++) {
    if (!state.roofs[roofKey(i, j, t)] && canPlaceRoof(state, i, j, t, dir, kind)) return t;
  }
  return -1;
}

export function canPlaceFixture(state, f) {
  const spec = FIXTURES[f.kind];
  if (!spec || state.fixtures[fixtureKey(f)]) return false;
  if (spec.host === 'wall') {
    const w = state.walls[wallKey(f.o, f.i, f.j)];
    return !!w && WALL_PIECES[w.type].cls === 'solid';
  }
  if (spec.host === 'cell') return !!state.floors[floorKey(f.i, f.j)];
  if (spec.host === 'roof') {
    const r = state.roofs[roofKey(f.i, f.j, f.t)];
    return !!r && r.kind !== 'flat';
  }
  return false;
}

// ---------- mutations ----------

export function placeFloor(state, i, j) {
  if (!canPlaceFloor(state, i, j)) return false;
  state.floors[floorKey(i, j)] = { i, j };
  return true;
}
export function placeWall(state, e, type = 'solid') {
  if (!canPlaceWall(state, e) || !WALL_PIECES[type]) return false;
  state.walls[wallKey(e.o, e.i, e.j)] = { o: e.o, i: e.i, j: e.j, type };
  return true;
}
export function placeRoof(state, i, j, t, dir, kind = 'r45') {
  if (!canPlaceRoof(state, i, j, t, dir, kind)) return false;
  state.roofs[roofKey(i, j, t)] = { i, j, t, dir, kind };
  return true;
}
export function placeFixture(state, f) {
  if (!canPlaceFixture(state, f)) return false;
  state.fixtures[fixtureKey(f)] = { ...f, host: FIXTURES[f.kind].host };
  return true;
}
export function removeFloor(state, i, j) {
  const k = floorKey(i, j);
  if (!state.floors[k]) return false;
  delete state.floors[k];
  return true;
}
export function removeWall(state, e) {
  const k = wallKey(e.o, e.i, e.j);
  if (!state.walls[k]) return false;
  delete state.walls[k];
  for (const [fk, f] of Object.entries(state.fixtures)) {
    if (f.host === 'wall' && f.o === e.o && f.i === e.i && f.j === e.j) delete state.fixtures[fk];
  }
  return true;
}
export function removeRoof(state, i, j, t) {
  const k = roofKey(i, j, t);
  if (!state.roofs[k]) return false;
  delete state.roofs[k];
  for (const [fk, f] of Object.entries(state.fixtures)) {
    if (f.host === 'roof' && f.i === i && f.j === j && f.t === t) delete state.fixtures[fk];
  }
  return true;
}
export function removeFixture(state, key) {
  if (!state.fixtures[key]) return false;
  delete state.fixtures[key];
  return true;
}

// ---------- structural support model ----------
// Each piece gets a support value 0..1. Floors on skids are grounded (1).
// Walls draw support from an adjacent floor. Roof panels draw support from
// the wall at their low edge, the panel downhill of them, or a side
// neighbour — losing strength the farther they hang from real support.
// Anything at or below COLLAPSE_AT has nothing holding it up.

export const COLLAPSE_AT = 0.05;

export function computeSupport(state) {
  const sup = { floors: {}, walls: {}, roofs: {} };
  for (const k of Object.keys(state.floors)) sup.floors[k] = 1;
  for (const [k, w] of Object.entries(state.walls)) {
    sup.walls[k] = cellsOfEdge(w).some(c => state.floors[floorKey(c.i, c.j)]) ? 0.95 : 0;
  }
  // seed roofs from supporting walls, then relax until stable
  for (const k of Object.keys(state.roofs)) sup.roofs[k] = 0;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    for (const [k, r] of Object.entries(state.roofs)) {
      let best = 0;
      if (r.t === 0) {
        const low = lowEdgeOfRoof(r);
        const ws = sup.walls[wallKey(low.o, low.i, low.j)] || 0;
        best = Math.max(best, ws * 0.92);
      } else {
        const d = DIRS[r.dir];
        const below = state.roofs[roofKey(r.i - d.dx, r.j - d.dz, r.t - 1)];
        if (below && below.dir === r.dir && below.kind === r.kind) {
          best = Math.max(best, (sup.roofs[roofKey(below.i, below.j, below.t)] || 0) * 0.8);
        }
      }
      for (const p of [(r.dir + 1) % 4, (r.dir + 3) % 4]) {
        const d = DIRS[p];
        const n = state.roofs[roofKey(r.i + d.dx, r.j + d.dz, r.t)];
        if (n && n.dir === r.dir && n.kind === r.kind) {
          best = Math.max(best, (sup.roofs[roofKey(n.i, n.j, n.t)] || 0) * 0.72);
        }
      }
      if (best > (sup.roofs[k] || 0) + 1e-9) { sup.roofs[k] = best; changed = true; }
    }
  }
  return sup;
}

// Remove every piece that lost its support; returns the removed pieces so
// the 3D view can animate them breaking off. Cascades automatically.
export function collapseUnsupported(state) {
  const dead = [];
  let again = true;
  while (again) {
    again = false;
    const sup = computeSupport(state);
    for (const [k, w] of Object.entries(state.walls)) {
      if ((sup.walls[k] || 0) <= COLLAPSE_AT) {
        dead.push({ kind: 'wall', ref: { ...w } });
        removeWall(state, w);
        again = true;
      }
    }
    for (const [k, r] of Object.entries(state.roofs)) {
      if ((sup.roofs[k] || 0) <= COLLAPSE_AT) {
        dead.push({ kind: 'roof', ref: { ...r } });
        removeRoof(state, r.i, r.j, r.t);
        again = true;
      }
    }
  }
  return dead;
}

// ---------- derived geometry ----------

export function bounds(state) {
  const cells = Object.values(state.floors);
  const roofs = Object.values(state.roofs);
  if (!cells.length && !roofs.length) return null;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const c of [...cells, ...roofs]) {
    i0 = Math.min(i0, c.i); i1 = Math.max(i1, c.i + 1);
    j0 = Math.min(j0, c.j); j1 = Math.max(j1, c.j + 1);
  }
  return { i0, i1, j0, j1, w: (i1 - i0) * CELL, d: (j1 - j0) * CELL };
}

export function perimeterEdges(state) {
  const out = [];
  for (const c of Object.values(state.floors)) {
    for (let d = 0; d < 4; d++) {
      const n = DIRS[d];
      if (!state.floors[floorKey(c.i + n.dx, c.j + n.dz)]) {
        out.push(edgeForSide(c.i, c.j, d));
      }
    }
  }
  return out;
}

// Exposed gable triangles created by roof panels (auto-framed by the engine).
export function gableTriangles(state) {
  const out = [];
  for (const r of Object.values(state.roofs)) {
    if (r.kind === 'flat') continue;
    const [y0, y1] = roofHeights(r);
    for (const p of [(r.dir + 1) % 4, (r.dir + 3) % 4]) {
      const d = DIRS[p];
      const n = state.roofs[roofKey(r.i + d.dx, r.j + d.dz, r.t)];
      if (n && n.dir === r.dir && n.kind === r.kind) continue;
      out.push({ roof: r, side: p, y0, y1, area: (CELL * riseOf(r.kind)) / 2 });
    }
  }
  return out;
}

// ---------- persistence ----------

export function serialize(state) { return JSON.stringify(state); }
export function deserialize(json) {
  const s = emptyState();
  try {
    const d = JSON.parse(json);
    if (d && d.floors && d.walls && d.roofs) {
      Object.assign(s, { fixtures: {} }, d);
      for (const r of Object.values(s.roofs)) if (!r.kind) r.kind = 'r45';
      // migrate v1 wall types; never let an unknown type into the state
      const rename = { door: 'door36', window: 'window36' };
      for (const w of Object.values(s.walls)) {
        if (rename[w.type]) w.type = rename[w.type];
        if (!WALL_PIECES[w.type]) w.type = 'solid';
      }
    }
  } catch { /* fall back to empty */ }
  return s;
}

// drywall is a per-wall interior finish flag, toggled by the drywall tool
export function toggleDrywall(state, e) {
  const w = state.walls[wallKey(e.o, e.i, e.j)];
  if (!w) return false;
  w.drywall = !w.drywall;
  return true;
}

// Demo: 8×12 gable shed with a door, windows, and wired/plumbed interior
export function demoShed() {
  const s = emptyState();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) placeFloor(s, i, j);
  for (const e of perimeterEdges(s)) {
    let type = 'solid';
    if (e.o === 'H' && e.j === 2 && e.i === 1) type = 'door36';
    if (e.o === 'V' && e.i === 3 && e.j === 0) type = 'window36';
    if (e.o === 'H' && e.j === 0 && e.i === 0) type = 'windowSld';
    if (e.o === 'V' && e.i === 0 && e.j === 1) type = 'ventWall';
    placeWall(s, e, type);
  }
  for (let i = 0; i < 3; i++) {
    placeRoof(s, i, 0, 0, 2, 'r45');
    placeRoof(s, i, 1, 0, 0, 'r45');
  }
  placeFixture(s, { kind: 'panel', o: 'H', i: 2, j: 0 });
  placeFixture(s, { kind: 'outlet', o: 'H', i: 1, j: 0 });
  placeFixture(s, { kind: 'outlet', o: 'V', i: 3, j: 1 });
  placeFixture(s, { kind: 'switch', o: 'H', i: 0, j: 2 });
  placeFixture(s, { kind: 'light', i: 1, j: 0 });
  placeFixture(s, { kind: 'light', i: 1, j: 1 });
  placeFixture(s, { kind: 'extLight', o: 'H', i: 2, j: 2 });
  placeFixture(s, { kind: 'sink', o: 'V', i: 0, j: 0 });
  placeFixture(s, { kind: 'hosebib', o: 'H', i: 0, j: 2 });
  placeFixture(s, { kind: 'skylight', i: 2, j: 1, t: 0 });
  toggleDrywall(s, { o: 'V', i: 0, j: 0 }); // show one finished interior wall
  return s;
}
