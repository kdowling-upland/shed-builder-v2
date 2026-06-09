// store.js — shed state, grid geometry and Valheim-style placement rules.
// Pure module (no DOM / three.js) so the report engine and tests can share it.

export const CELL = 4;      // ft — building grid module (like Valheim's 2 m pieces)
export const WALL_H = 8;    // ft — wall height
export const RISE = CELL;   // ft — rise per roof tier (45° panels)

// Directions: 0=N(-z) 1=E(+x) 2=S(+z) 3=W(-x)
export const DIRS = [
  { dx: 0, dz: -1 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 },
];
export const DIR_NAMES = ['north', 'east', 'south', 'west'];

export const WALL_TYPES = {
  solid:  { name: 'Wall panel' },
  door:   { name: 'Door wall' },
  window: { name: 'Window wall' },
};

export function emptyState() {
  return { floors: {}, walls: {}, roofs: {} };
}

export const floorKey = (i, j) => `${i},${j}`;
export const wallKey = (o, i, j) => `${o},${i},${j}`;
export const roofKey = (i, j, t) => `${i},${j},${t}`;

// Edge of cell (i,j) on side d.  'H' edges run along x at z=j*CELL,
// 'V' edges run along z at x=i*CELL.  Shared edges get one canonical key.
export function edgeForSide(i, j, d) {
  switch (d) {
    case 0: return { o: 'H', i, j };          // north edge
    case 2: return { o: 'H', i, j: j + 1 };   // south edge
    case 3: return { o: 'V', i, j };          // west edge
    case 1: return { o: 'V', i: i + 1, j };   // east edge
  }
}

// The two cells an edge separates: [negSide, posSide]
export function cellsOfEdge(e) {
  return e.o === 'H'
    ? [{ i: e.i, j: e.j - 1 }, { i: e.i, j: e.j }]   // north of edge, south of edge
    : [{ i: e.i - 1, j: e.j }, { i: e.i, j: e.j }];  // west of edge, east of edge
}

// Edge segment endpoints in plan feet: [x0,z0,x1,z1]
export function edgeSegment(e) {
  return e.o === 'H'
    ? [e.i * CELL, e.j * CELL, (e.i + 1) * CELL, e.j * CELL]
    : [e.i * CELL, e.j * CELL, e.i * CELL, (e.j + 1) * CELL];
}

export function lowEdgeOfRoof(r) {           // eave-side edge of a roof panel
  return edgeForSide(r.i, r.j, (r.dir + 2) % 4);
}
export function highEdgeOfRoof(r) {          // ridge-side edge
  return edgeForSide(r.i, r.j, r.dir);
}
export function roofHeights(r) {             // y at low and high edges
  const y0 = WALL_H + r.t * RISE;
  return [y0, y0 + RISE];
}

// ---------- placement validity (the "snapping rules") ----------

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

export function canPlaceRoof(state, i, j, t, dir) {
  if (state.roofs[roofKey(i, j, t)]) return false;
  if (t === 0) {
    const low = lowEdgeOfRoof({ i, j, dir });
    if (state.walls[wallKey(low.o, low.i, low.j)]) return true;
  } else {
    // stacks up the slope: needs the panel one tier down, one cell downhill
    const d = DIRS[dir];
    const below = state.roofs[roofKey(i - d.dx, j - d.dz, t - 1)];
    if (below && below.dir === dir) return true;
  }
  // or extend sideways from a neighbouring panel at the same tier/slope
  const perp = [(dir + 1) % 4, (dir + 3) % 4];
  return perp.some(p => {
    const d = DIRS[p];
    const n = state.roofs[roofKey(i + d.dx, j + d.dz, t)];
    return n && n.dir === dir;
  });
}

// Find the lowest valid tier for a roof panel at this cell/dir (or -1)
export function bestRoofTier(state, i, j, dir, maxTier = 6) {
  for (let t = 0; t <= maxTier; t++) {
    if (!state.roofs[roofKey(i, j, t)] && canPlaceRoof(state, i, j, t, dir)) return t;
  }
  return -1;
}

// ---------- mutations (return true when state changed) ----------

export function placeFloor(state, i, j) {
  if (!canPlaceFloor(state, i, j)) return false;
  state.floors[floorKey(i, j)] = { i, j };
  return true;
}
export function placeWall(state, e, type = 'solid') {
  if (!canPlaceWall(state, e)) return false;
  state.walls[wallKey(e.o, e.i, e.j)] = { o: e.o, i: e.i, j: e.j, type };
  return true;
}
export function placeRoof(state, i, j, t, dir) {
  if (!canPlaceRoof(state, i, j, t, dir)) return false;
  state.roofs[roofKey(i, j, t)] = { i, j, t, dir };
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
  return true;
}
export function removeRoof(state, i, j, t) {
  const k = roofKey(i, j, t);
  if (!state.roofs[k]) return false;
  delete state.roofs[k];
  return true;
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

// Edges on the boundary of the floor footprint (where exterior walls belong)
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
// Returns one entry per exposed vertical triangular face.
export function gableTriangles(state) {
  const out = [];
  for (const r of Object.values(state.roofs)) {
    const [y0, y1] = roofHeights(r);
    for (const p of [(r.dir + 1) % 4, (r.dir + 3) % 4]) {
      const d = DIRS[p];
      const n = state.roofs[roofKey(r.i + d.dx, r.j + d.dz, r.t)];
      if (n && n.dir === r.dir) continue; // covered by a matching neighbour
      out.push({ roof: r, side: p, y0, y1, area: (CELL * RISE) / 2 });
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
    if (d && d.floors && d.walls && d.roofs) Object.assign(s, d);
  } catch { /* fall back to empty */ }
  return s;
}

// Demo: classic 8×12 gable shed (12 ft wide along x, 8 ft deep, door on south)
export function demoShed() {
  const s = emptyState();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) placeFloor(s, i, j);
  for (const e of perimeterEdges(s)) {
    let type = 'solid';
    if (e.o === 'H' && e.j === 2 && e.i === 1) type = 'door';     // south middle
    if (e.o === 'V' && e.i === 3 && e.j === 0) type = 'window';   // east
    placeWall(s, e, type);
  }
  for (let i = 0; i < 3; i++) {
    placeRoof(s, i, 0, 0, 2); // north row slopes up toward south
    placeRoof(s, i, 1, 0, 0); // south row slopes up toward north → ridge at z=4
  }
  return s;
}
