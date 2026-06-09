// picker.js — maps a tool id + a plan-space point to a placement candidate.
// Shared by the 3D and 2D editors so both viewports behave identically.
// Tool ids: 'floor' | 'wall' | 'wt:<wallType>' | 'roof:<kind>' | 'fx:<kind>' | 'erase'

import {
  CELL, edgeForSide, wallKey, roofKey, floorKey, fixtureKey, diagKey,
  canPlaceFloor, canPlaceWall, bestRoofTier, canPlaceFixture, canPlaceDiag,
} from './store.js';
import { FIXTURES } from './catalog.js';

export function nearestEdge(x, z, i, j) {
  const lx = x - i * CELL, lz = z - j * CELL;
  const sides = [
    { d: lz, side: 0 }, { d: CELL - lx, side: 1 },
    { d: CELL - lz, side: 2 }, { d: lx, side: 3 },
  ].sort((a, b) => a.d - b.d);
  return { edge: edgeForSide(i, j, sides[0].side), dist: sides[0].d };
}

// key that identifies a candidate slot (used to avoid re-placing while dragging)
export function candidateSlot(c) {
  if (!c) return null;
  switch (c.kind) {
    case 'floor': return `f:${c.i},${c.j}`;
    case 'wall': return `w:${c.edge.o},${c.edge.i},${c.edge.j}`;
    case 'roof': return `r:${c.i},${c.j},${c.t}`;
    case 'diag': return `dg:${c.i},${c.j}`;
    case 'drywall': return `d:${c.edge.o},${c.edge.i},${c.edge.j}`;
    case 'fixture': return `x:${fixtureKey(c.fixture)}`;
    case 'erase': return `e:${c.target.kind}:${JSON.stringify(c.target.ref)}`;
    default: return null;
  }
}

export function candidateAt(state, tool, x, z, roofDir) {
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  if (!tool) return null;

  if (tool === 'floor') {
    return { kind: 'floor', i, j, ok: canPlaceFloor(state, i, j) };
  }
  if (tool === 'wall' || tool.startsWith('wt:')) {
    const type = tool === 'wall' ? 'solid' : tool.slice(3);
    const { edge } = nearestEdge(x, z, i, j);
    return { kind: 'wall', edge, type, ok: canPlaceWall(state, edge) };
  }
  if (tool.startsWith('roof:')) {
    const rk = tool.slice(5);
    const t = bestRoofTier(state, i, j, roofDir, rk);
    return { kind: 'roof', i, j, t: Math.max(t, 0), dir: roofDir, rk, ok: t >= 0 };
  }
  if (tool.startsWith('fx:')) {
    const fk = tool.slice(3);
    const spec = FIXTURES[fk];
    let fixture = null;
    if (spec.host === 'wall') {
      const { edge } = nearestEdge(x, z, i, j);
      fixture = { kind: fk, o: edge.o, i: edge.i, j: edge.j, host: 'wall' };
    } else if (spec.host === 'cell') {
      fixture = { kind: fk, i, j, host: 'cell' };
    } else if (spec.host === 'roof') {
      let top = -1;
      for (let t = 8; t >= 0; t--) if (state.roofs[roofKey(i, j, t)]) { top = t; break; }
      fixture = { kind: fk, i, j, t: Math.max(top, 0), host: 'roof' };
    }
    return { kind: 'fixture', fixture, ok: canPlaceFixture(state, fixture) };
  }
  if (tool === 'wallDiag') {
    return { kind: 'diag', i, j, k: roofDir, ok: canPlaceDiag(state, i, j) };
  }
  if (tool === 'drywall') {
    const { edge } = nearestEdge(x, z, i, j);
    const w = state.walls[wallKey(edge.o, edge.i, edge.j)];
    return { kind: 'drywall', edge, ok: !!w, on: !!(w && w.drywall) };
  }
  if (tool === 'erase') {
    return eraseTargetAt(state, x, z);
  }
  return null;
}

export function eraseTargetAt(state, x, z) {
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  const { edge, dist } = nearestEdge(x, z, i, j);
  // fixtures on the nearby wall first, then the wall itself
  if (dist < 0.8) {
    const wk = wallKey(edge.o, edge.i, edge.j);
    for (const [fk, f] of Object.entries(state.fixtures)) {
      if (f.host === 'wall' && wallKey(f.o, f.i, f.j) === wk) {
        return { kind: 'erase', target: { kind: 'fixture', ref: f, key: fk }, ok: true };
      }
    }
    if (state.walls[wk]) {
      return { kind: 'erase', target: { kind: 'wall', ref: state.walls[wk] }, ok: true };
    }
  }
  for (const [fk, f] of Object.entries(state.fixtures)) {
    if ((f.host === 'cell' || f.host === 'roof') && f.i === i && f.j === j) {
      return { kind: 'erase', target: { kind: 'fixture', ref: f, key: fk }, ok: true };
    }
  }
  if (state.walls[diagKey(i, j)]) {
    return { kind: 'erase', target: { kind: 'wall', ref: state.walls[diagKey(i, j)] }, ok: true };
  }
  for (let t = 8; t >= 0; t--) {
    if (state.roofs[roofKey(i, j, t)]) {
      return { kind: 'erase', target: { kind: 'roof', ref: state.roofs[roofKey(i, j, t)] }, ok: true };
    }
  }
  if (state.floors[floorKey(i, j)]) {
    return { kind: 'erase', target: { kind: 'floor', ref: state.floors[floorKey(i, j)] }, ok: true };
  }
  return null;
}
