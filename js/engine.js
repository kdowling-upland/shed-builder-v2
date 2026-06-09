// engine.js — the calculation backend. Takes the placed-piece state and
// produces a full bill of materials, an itemized cost estimate, a cut list,
// a nail schedule, a code check and an optimized step-by-step build guide.
// Pure JS (no DOM) so it runs in the browser and under node for tests.

import {
  CELL, WALL_H, FLOOR_TOP, DIRS, DIR_NAMES, riseOf,
  floorKey, roofKey, wallKey,
  lowEdgeOfRoof, highEdgeOfRoof, roofHeights, bounds, perimeterEdges,
  gableTriangles,
} from './store.js';
import {
  PRICE, NAILS, STOCK_2X4, STOCK_2X6, STOCK_SKID, WALL_PIECES, ROOF_KINDS, FIXTURES,
} from './catalog.js';
import { electricalDesign, plumbingDesign } from './systems.js';
import { runCodeChecks } from './codes.js';

const STUD_SPACING = 16;                  // inches o.c.
const RAFTER_SPACING = 24;                // inches o.c.
const slopeFactor = (kind) => Math.hypot(CELL, riseOf(kind)) / CELL;

// ---------- formatting helpers ----------

export function money(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function inches(v) {
  const whole = Math.floor(v + 1e-9);
  const frac = Math.round((v - whole) * 8);
  if (frac === 0) return `${whole}″`;
  if (frac === 8) return `${whole + 1}″`;
  const div = gcd(frac, 8);
  return `${whole}-${frac / div}/${8 / div}″`;
}
function gcd(a, b) { return b ? gcd(b, a % b) : a; }

export function ftIn(ft) {
  const totalIn = ft * 12;
  const f = Math.floor(totalIn / 12);
  const i = totalIn - f * 12;
  if (i < 1 / 16) return `${f}′`;
  return `${f}′ ${inches(i)}`;
}

// ---------- cut packing (first-fit-decreasing onto stock lengths) ----------
// kerf is 0 because dimensional lumber runs slightly over nominal length,
// so exact-fit cuts (two 8s from a 16) are standard practice.
export function packCuts(cuts, stocks, kerf = 0) {
  const sorted = [...cuts].sort((a, b) => b.len - a.len);
  const maxLen = stocks[0].len;
  const bins = [];
  for (const cut of sorted) {
    if (cut.len > maxLen + 1e-9) {
      let rest = cut.len, idx = 1;
      const parts = [];
      while (rest > 1e-9) {
        const piece = Math.min(rest, maxLen);
        parts.push({ len: piece, label: `${cut.label} (part ${idx++})` });
        rest -= piece;
      }
      const sub = packCuts(parts, stocks, kerf);
      bins.push(...sub.bins);
      continue;
    }
    let placed = false;
    for (const b of bins) {
      if (b.used + cut.len + kerf <= b.stockLen + 1e-9) {
        b.pieces.push(cut); b.used += cut.len + kerf; placed = true; break;
      }
    }
    if (!placed) {
      const opt = [...stocks].reverse().find(s => s.len >= cut.len - 1e-9) || stocks[0];
      bins.push({ sku: opt.sku, stockLen: opt.len, used: cut.len + kerf, pieces: [cut] });
    }
  }
  for (const b of bins) {
    const opt = [...stocks].reverse().find(s => s.len >= b.used - kerf - 1e-9);
    if (opt) { b.sku = opt.sku; b.stockLen = opt.len; }
    b.waste = b.stockLen - (b.used - kerf);
  }
  const buy = {};
  for (const b of bins) buy[b.sku] = (buy[b.sku] || 0) + 1;
  return { bins, buy };
}

// ---------- geometry analysis ----------

function wallRuns(state) {
  const walls = Object.values(state.walls);
  const runs = [];
  for (const o of ['H', 'V']) {
    const groups = {};
    for (const w of walls.filter(w => w.o === o)) {
      const line = o === 'H' ? w.j : w.i;
      (groups[line] = groups[line] || []).push(w);
    }
    for (const line of Object.keys(groups)) {
      const ws = groups[line].sort((a, b) => (o === 'H' ? a.i - b.i : a.j - b.j));
      let run = null;
      for (const w of ws) {
        const pos = o === 'H' ? w.i : w.j;
        if (run && pos === run.start + run.walls.length) run.walls.push(w);
        else { run = { o, line: +line, start: pos, walls: [w] }; runs.push(run); }
      }
    }
  }
  for (const r of runs) {
    r.lenFt = r.walls.length * CELL;
    r.openings = r.walls
      .map((w, idx) => ({ type: w.type, module: idx, spec: WALL_PIECES[w.type] }))
      .filter(x => x.spec.cls !== 'solid');
  }
  return runs;
}

function labelRuns(runs, state) {
  const b = bounds(state);
  const counters = {};
  for (const r of runs) {
    let side;
    if (r.o === 'H') side = b && r.line * CELL <= (b.j0 * CELL + b.d / 2) ? 'North' : 'South';
    else side = b && r.line * CELL <= (b.i0 * CELL + b.w / 2) ? 'West' : 'East';
    counters[side] = (counters[side] || 0) + 1;
    r.label = counters[side] > 1 ? `${side} wall ${counters[side]}` : `${side} wall`;
  }
  runs.sort((a, b) => b.lenFt - a.lenFt);
}

function countCorners(runs) {
  const pts = { H: new Set(), V: new Set() };
  for (const r of runs) {
    const a = r.o === 'H' ? [r.start, r.line] : [r.line, r.start];
    const bpt = r.o === 'H' ? [r.start + r.walls.length, r.line] : [r.line, r.start + r.walls.length];
    pts[r.o].add(a.join(',')); pts[r.o].add(bpt.join(','));
  }
  let n = 0;
  for (const p of pts.H) if (pts.V.has(p)) n++;
  return n;
}

function floorRects(state) {
  const cells = new Set(Object.keys(state.floors));
  const rects = [];
  const taken = new Set();
  const list = Object.values(state.floors).sort((a, b) => a.j - b.j || a.i - b.i);
  for (const c of list) {
    if (taken.has(floorKey(c.i, c.j))) continue;
    let w = 1;
    while (cells.has(floorKey(c.i + w, c.j)) && !taken.has(floorKey(c.i + w, c.j))) w++;
    let h = 1;
    outer: while (true) {
      for (let x = 0; x < w; x++) {
        const k = floorKey(c.i + x, c.j + h);
        if (!cells.has(k) || taken.has(k)) break outer;
      }
      h++;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) taken.add(floorKey(c.i + x, c.j + y));
    rects.push({ i: c.i, j: c.j, w, h, L: w * CELL, D: h * CELL });
  }
  return rects;
}

function roofFaces(state) {
  const panels = Object.values(state.roofs);
  const seen = new Set();
  const faces = [];
  for (const p of panels) {
    const k0 = roofKey(p.i, p.j, p.t);
    if (seen.has(k0)) continue;
    const face = { dir: p.dir, kind: p.kind, panels: [] };
    const queue = [p];
    seen.add(k0);
    while (queue.length) {
      const cur = queue.pop();
      face.panels.push(cur);
      const d = DIRS[cur.dir];
      const nbrs = [
        { i: cur.i + d.dx, j: cur.j + d.dz, t: cur.t + 1 },
        { i: cur.i - d.dx, j: cur.j - d.dz, t: cur.t - 1 },
        { i: cur.i + DIRS[(cur.dir + 1) % 4].dx, j: cur.j + DIRS[(cur.dir + 1) % 4].dz, t: cur.t },
        { i: cur.i + DIRS[(cur.dir + 3) % 4].dx, j: cur.j + DIRS[(cur.dir + 3) % 4].dz, t: cur.t },
      ];
      for (const n of nbrs) {
        const k = roofKey(n.i, n.j, n.t);
        const rp = state.roofs[k];
        if (rp && rp.dir === cur.dir && rp.kind === cur.kind && !seen.has(k)) {
          seen.add(k); queue.push(rp);
        }
      }
    }
    const cols = {};
    for (const pp of face.panels) {
      const cross = (face.dir === 1 || face.dir === 3) ? pp.j : pp.i;
      (cols[cross] = cols[cross] || []).push(pp);
    }
    const sf = slopeFactor(face.kind);
    face.columns = Object.values(cols).map(col => ({
      panels: col.sort((a, b) => a.t - b.t),
      chainLen: col.length,
      slopeFt: col.length * CELL * sf,
    }));
    face.areaSlope = face.panels.length * CELL * CELL * sf;
    faces.push(face);
  }
  return faces;
}

function ridges(state) {
  const tops = {};
  for (const p of Object.values(state.roofs)) {
    if (!ROOF_KINDS[p.kind].shingled) continue;
    const e = highEdgeOfRoof(p);
    const k = `${e.o},${e.i},${e.j}`;
    (tops[k] = tops[k] || []).push(p);
  }
  const segs = [];
  for (const [k, ps] of Object.entries(tops)) {
    if (ps.length === 2 && (ps[0].dir + 2) % 4 === ps[1].dir
        && ps[0].t === ps[1].t && ps[0].kind === ps[1].kind) {
      segs.push({ key: k, y: roofHeights(ps[0])[1] });
    }
  }
  return segs;
}

// per-opening framing parts, derived from the rough opening spec
function openingParts(spec) {
  const [roW, roH] = spec.ro;
  if (spec.cls === 'vent') {
    return { kings: 0, jacks: 0, removed: 0, blocks: 2, blockLen: roW, nails: 8 };
  }
  const removed = [16, 32].filter(x => x > 24 - roW / 2 && x < 24 + roW / 2).length;
  const jackLen = spec.cls === 'door' ? roH - 1.5 : 81;
  const headerLen = roW + 3;
  const headCrip = 92.625 - (81 + 5.5);
  const parts = {
    kings: 2, jacks: 2, removed, jackLen, headerLen, headCrip, headCrips: 2, nails: 30,
  };
  if (spec.cls === 'window') {
    parts.sillLen = roW;
    parts.sillCrips = 3;
    parts.sillCripLen = 82.5 - roH - 3;
  }
  return parts;
}

// ---------- main entry ----------

export function buildReport(state, opts = {}) {
  const taxRate = (opts.taxRate ?? 0) / 100;
  const waste = 1 + (opts.wastePct ?? 10) / 100;
  const regionId = opts.region || 'irc';

  const floors = Object.values(state.floors);
  if (!floors.length) {
    return { ok: false, warnings: ['Place at least one floor module to generate a report.'] };
  }

  const warnings = [];
  const b = bounds(state);
  const area = floors.length * CELL * CELL;
  const runs = wallRuns(state);
  labelRuns(runs, state);
  const corners = countCorners(runs);
  const rects = floorRects(state);
  const faces = roofFaces(state);
  const ridgeSegs = ridges(state);
  const gables = gableTriangles(state);
  const wallsByCls = (cls) => Object.values(state.walls).filter(w => WALL_PIECES[w.type].cls === cls);
  const doors = wallsByCls('door');
  const windows = wallsByCls('window');
  const vents = wallsByCls('vent');
  const fixtures = Object.values(state.fixtures || {});
  const skylights = fixtures.filter(f => f.kind === 'skylight');

  const missingWalls = perimeterEdges(state)
    .filter(e => !state.walls[wallKey(e.o, e.i, e.j)]).length;
  if (missingWalls) warnings.push(`${missingWalls} perimeter edge(s) have no wall — the shed is not fully enclosed.`);
  const roofCover = new Set(Object.values(state.roofs).map(r => floorKey(r.i, r.j)));
  const uncovered = floors.filter(c => !roofCover.has(floorKey(c.i, c.j))).length;
  if (uncovered) warnings.push(`${uncovered} floor module(s) have no roof panel above them.`);
  if (!doors.length) warnings.push('No door placed — you may want a way in!');
  if (!faces.length) warnings.push('No roof panels placed.');

  // ============================================================
  // Quantity takeoff. Nail counts are accumulated per build step
  // so the totals always match the guide.
  // ============================================================
  const nailTotals = {};
  const addNails = (type, count) => { nailTotals[type] = (nailTotals[type] || 0) + Math.ceil(count); };
  const supply = [];
  const addItem = (sku, qty, category, descOverride) => {
    if (qty <= 0) return;
    const p = PRICE[sku];
    supply.push({ sku, desc: descOverride || p.desc, qty, unit: p.unit, price: p.price, total: qty * p.price, category });
  };
  const cutPlans = [];
  const phases = [];
  const phase = (name) => { const p = { name, steps: [] }; phases.push(p); return p; };

  // ---------------- PHASE 1 — layout ----------------
  {
    const ph = phase('Site preparation & layout');
    ph.steps.push({
      title: 'Prepare a level base',
      minutes: 90,
      detail: [
        `The shed footprint is ${b.w}′ × ${b.d}′ (${area} sq ft). Clear and level an area at least 2′ larger on every side.`,
        'Spread and compact a 4″ bed of ¾″ crushed gravel (optional but recommended for drainage).',
      ],
      tools: ['shovel', 'rake', 'hand tamper', '4′ level'],
    });
    ph.steps.push({
      title: 'Lay out the foundation',
      minutes: 30,
      detail: [
        `Stake the four corners of the ${b.w}′ × ${b.d}′ footprint with mason line.`,
        'Square the layout with the 3-4-5 method, then verify both diagonals match within ¼″.',
      ],
      tools: ['tape measure', 'mason line', 'stakes'],
    });
  }

  // ---------------- PHASE 2 — floor ----------------
  let deckSheets = 0;
  {
    const ph = phase('Foundation & floor framing');
    const skidCuts = [], joistCuts = [], rimCuts = [];

    for (const [ri, r] of rects.entries()) {
      const tag = rects.length > 1 ? ` (section ${ri + 1}: ${r.L}′×${r.D}′)` : '';
      const nSkids = Math.floor(r.D / CELL) + 1;
      const nJoists = Math.floor((r.L * 12) / STUD_SPACING) + 1;
      const joistLenIn = r.D * 12 - 3;
      for (let k = 0; k < nSkids; k++) skidCuts.push({ len: r.L, label: `skid${tag}` });
      for (let k = 0; k < 2; k++) rimCuts.push({ len: r.L, label: `rim joist${tag}` });
      for (let k = 0; k < nJoists; k++) joistCuts.push({ len: joistLenIn / 12, label: `floor joist ${inches(joistLenIn)}${tag}` });

      ph.steps.push({
        title: `Set the skids${tag}`,
        minutes: 25,
        detail: [
          `Place ${nSkids} pressure-treated 4×6 skids, each ${r.L}′ long, running the ${r.L}′ direction, spaced ${(r.D / (nSkids - 1)).toFixed(1)}′ apart on center.`,
          'Level each skid along its length and across to the others; shim with treated lumber offcuts, never bare ground contact.',
        ],
        cuts: [`4×6 skid → ${ftIn(r.L)} × ${nSkids} (square cut)`],
        tools: ['4′ level', 'circular saw'],
      });

      const endNails = nJoists * 2 * 3;
      const toeNails = nJoists * nSkids * 2;
      addNails('n16d', endNails);
      addNails('n8d', toeNails);
      ph.steps.push({
        title: `Frame the floor deck${tag}`,
        minutes: 60,
        detail: [
          `Cut ${nJoists} floor joists from 2×6 to ${inches(joistLenIn)} each.`,
          `Mark both ${r.L}′ rim joists at ${STUD_SPACING}″ on center (${nJoists} layout marks).`,
          `End-nail each joist through the rim with 3 × 16d nails per end — ${nJoists} joists × 2 ends × 3 = ${endNails} × 16d nails.`,
          `Square the frame (equal diagonals), then toenail every joist to every skid with 2 × 8d nails per crossing — ${nJoists} × ${nSkids} × 2 = ${toeNails} × 8d nails.`,
        ],
        cuts: [
          `2×6 rim joist → ${ftIn(r.L)} × 2 (square cut)`,
          `2×6 floor joist → ${inches(joistLenIn)} × ${nJoists} (square cut both ends)`,
        ],
        nails: [`${endNails} × 16d common`, `${toeNails} × 8d common (toenails)`],
        tools: ['circular saw', 'framing hammer', 'speed square', 'tape measure'],
      });
    }

    const skidPack = packCuts(skidCuts, STOCK_SKID);
    const framePack = packCuts([...rimCuts, ...joistCuts], STOCK_2X6);
    cutPlans.push({ title: 'Floor framing — 4×6 treated skids', pack: skidPack });
    cutPlans.push({ title: 'Floor framing — 2×6 joists & rims', pack: framePack });
    for (const [sku, q] of Object.entries(skidPack.buy)) addItem(sku, q, 'Foundation & floor');
    for (const [sku, q] of Object.entries(framePack.buy)) addItem(sku, q, 'Foundation & floor');

    deckSheets = Math.ceil(area / 32);
    const deckNails = deckSheets * 64;
    const glueTubes = Math.ceil(deckSheets / 4);
    addNails('n8dRing', deckNails);
    addItem('osbFloor', deckSheets, 'Foundation & floor');
    addItem('adhesive', glueTubes, 'Foundation & floor');
    ph.steps.push({
      title: 'Install the subfloor deck',
      minutes: 45,
      detail: [
        `Run a bead of construction adhesive on every joist (${glueTubes} tube${glueTubes > 1 ? 's' : ''}).`,
        `Lay ${deckSheets} sheet${deckSheets > 1 ? 's' : ''} of 23/32″ T&G OSB perpendicular to the joists, staggering end joints by 4′.`,
        `Nail with 8d ring-shank: every 6″ along sheet edges, every 12″ in the field — about 64 nails per sheet, ${deckNails} total.`,
        area % 32 ? 'Rip the final sheet to 4′ × 4′ for the odd module (1 rip cut).' : 'Sheets land exactly on the 4′ grid — no rips needed.',
      ],
      cuts: area % 32 ? ['23/32″ OSB → rip one sheet to 48″ × 48″'] : [],
      nails: [`${deckNails} × 8d ring-shank`],
      tools: ['caulk gun', 'chalk line', 'framing hammer'],
    });
  }

  // ---------------- PHASE 3 — walls ----------------
  const studCutPool = [];
  const plateCuts = [];
  const headerCuts = [];
  let precutStuds = 0;
  let wallSheets = 0;
  {
    const ph = phase('Wall framing');
    if (runs.length) {
      const perRun = runs.map(r => {
        let removed = 0, kings = 0;
        for (const o of r.openings) {
          const p = openingParts(o.spec);
          removed += p.removed; kings += p.kings;
        }
        const grid = Math.floor((r.lenFt * 12) / STUD_SPACING) + 1;
        return { run: r, grid, studs: grid - removed + kings };
      });
      const totStuds = perRun.reduce((s, x) => s + x.studs, 0) + corners * 2;
      precutStuds = totStuds;

      // batch-cut all opening parts
      const allOpenings = runs.flatMap(r => r.openings);
      const batchCuts = [];
      for (const o of allOpenings) {
        const p = openingParts(o.spec);
        if (o.spec.cls === 'vent') {
          for (let k = 0; k < p.blocks; k++) studCutPool.push({ len: p.blockLen / 12, label: `vent block ${inches(p.blockLen)}` });
          batchCuts.push(`2×4 vent block → ${inches(p.blockLen)} × ${p.blocks}`);
          continue;
        }
        for (let k = 0; k < p.jacks; k++) studCutPool.push({ len: p.jackLen / 12, label: `jack stud ${inches(p.jackLen)}` });
        for (let k = 0; k < 2; k++) headerCuts.push({ len: p.headerLen / 12, label: `header ply ${inches(p.headerLen)} (2×6)` });
        for (let k = 0; k < p.headCrips; k++) studCutPool.push({ len: p.headCrip / 12, label: `header cripple ${inches(p.headCrip)}` });
        if (p.sillLen) {
          studCutPool.push({ len: p.sillLen / 12, label: `window sill ${inches(p.sillLen)}` });
          for (let k = 0; k < p.sillCrips; k++) studCutPool.push({ len: p.sillCripLen / 12, label: `sill cripple ${inches(p.sillCripLen)}` });
        }
        batchCuts.push(`${o.spec.name}: 2 jacks @ ${inches(p.jackLen)}, 2 header plies @ ${inches(p.headerLen)} (2×6), 2 cripples @ ${inches(p.headCrip)}${p.sillLen ? `, sill @ ${inches(p.sillLen)} + ${p.sillCrips} sill cripples @ ${inches(p.sillCripLen)}` : ''}`);
      }

      ph.steps.push({
        title: 'Batch-cut all wall parts',
        minutes: 40,
        detail: [
          `Wall studs are precut 92-5/8″ — no cutting needed for ${totStuds} studs.`,
          'Cut all plates now (bottom + double top for every wall) — see the cut list for the exact pieces from each board.',
          allOpenings.length
            ? 'Cut every opening part in one session — one saw setup is the single biggest time saver in the build:'
            : 'No openings to cut parts for.',
        ],
        cuts: batchCuts,
        tools: ['miter saw or circular saw', 'speed square', 'pencil'],
      });

      for (const pr of perRun) {
        const r = pr.run;
        for (const part of ['bottom plate', 'top plate', 'cap plate']) {
          plateCuts.push({ len: r.lenFt, label: `${part} — ${r.label}` });
        }
        const plateNails = pr.studs * 2 * 2;
        const capNails = Math.ceil(r.lenFt * 12 / 16);
        const soleNails = Math.ceil(r.lenFt * 12 / 16);
        const openNails = r.openings.reduce((s, o) => s + openingParts(o.spec).nails, 0);
        addNails('n16d', plateNails + capNails + soleNails + openNails);
        const openTxt = r.openings.map(o =>
          `${o.spec.name} rough opening (${inches(o.spec.ro[0])} × ${inches(o.spec.ro[1])}) centered ${o.module * 4 + 2}′ from the ${r.o === 'H' ? 'west' : 'north'} end`).join('; ');
        ph.steps.push({
          title: `Frame & raise the ${r.label} (${r.lenFt}′)`,
          minutes: 35 + r.openings.length * 20,
          detail: [
            `Lay the ${r.lenFt}′ bottom plate and first top plate side by side on the deck; mark stud layout at ${STUD_SPACING}″ o.c. (${pr.grid} positions).`,
            `Crown all studs the same way, then nail through the plates into each stud end with 2 × 16d — ${pr.studs} studs × 4 nails = ${plateNails} × 16d.`,
            ...(r.openings.length ? [
              `Openings: ${openTxt}.`,
              `Door/window openings get king studs both sides, jack studs under a double 2×6 header (4 × 16d per end per ply), and cripples above; vents get two flat 2×4 blocks toenailed between studs — ${openNails} × 16d for this wall's openings.`,
            ] : []),
            'Square the wall on the deck (diagonals equal), tack a temporary diagonal brace.',
            `Raise the wall, brace it plumb, then nail the bottom plate to the deck through the rim with 16d at 16″ o.c. — ${soleNails} × 16d.${r.openings.some(o => o.spec.cls === 'door') ? ' Leave the plate continuous across door openings for now.' : ''}`,
            `Add the cap (second top) plate, overlapping corner joints, 16d at 16″ o.c. staggered — ${capNails} × 16d.`,
          ],
          cuts: [`2×4 plates → ${ftIn(r.lenFt)} × 3 (bottom, top, cap)`],
          nails: [`${plateNails + soleNails + capNails + openNails} × 16d common`],
          tools: ['framing hammer', 'chalk line', '4′ level', '2 helpers or wall jacks'],
        });
      }

      if (corners) {
        const cornerNails = corners * 12;
        addNails('n16d', cornerNails);
        ph.steps.push({
          title: 'Tie the corners together',
          minutes: 15,
          detail: [
            `At each of the ${corners} corner${corners > 1 ? 's' : ''}, nail the end studs of meeting walls together with 16d at 12″ o.c. — 12 nails per corner, ${cornerNails} total.`,
            'Check every corner for plumb in both directions before sheathing.',
          ],
          nails: [`${cornerNails} × 16d common`],
          tools: ['framing hammer', '4′ level'],
        });
      }

      const runSheets = runs.reduce((s, r) => s + Math.ceil(r.lenFt / 4), 0);
      const gableArea = gables.reduce((s, g) => s + g.area, 0);
      const gableSheets = Math.ceil((gableArea / 32) * waste);
      wallSheets = runSheets + gableSheets;
      const shNails = (runSheets + gableSheets) * 60;
      addNails('n8d', shNails);
      addItem('osbWall', wallSheets, 'Sheathing');
      const nOpenings = doors.length + windows.length + vents.length;
      ph.steps.push({
        title: 'Sheath the walls',
        minutes: 20 * runSheets / 4 + 30,
        detail: [
          `Hang ${runSheets} sheets of 7/16″ OSB vertically, flush with the bottom plate, edges landing on stud centers.`,
          `Nail 8d at 6″ o.c. on edges and 12″ in the field — about 60 nails per sheet, ${shNails} total (includes gable sheets).`,
          ...(nOpenings ? [`Sheath right over the ${nOpenings} opening(s), then cut them out from inside with a reciprocating saw — faster, and the cut lands exactly on the framing.`] : []),
        ],
        cuts: nOpenings ? [`7/16″ OSB → cut out ${nOpenings} rough opening(s) in place`] : [],
        nails: [`${shNails} × 8d common`],
        tools: ['framing hammer or nail gun', 'chalk line', 'reciprocating saw'],
      });
    }
    const platePack = packCuts(plateCuts, STOCK_2X4);
    const openPack = packCuts(studCutPool, STOCK_2X4);
    const headerPack = packCuts(headerCuts, STOCK_2X6);
    if (precutStuds) addItem('stud2x4_925', precutStuds, 'Wall framing');
    for (const [sku, q] of Object.entries(platePack.buy)) addItem(sku, q, 'Wall framing');
    for (const [sku, q] of Object.entries(openPack.buy)) addItem(sku, q, 'Wall framing');
    for (const [sku, q] of Object.entries(headerPack.buy)) addItem(sku, q, 'Wall framing');
    if (plateCuts.length) cutPlans.push({ title: 'Wall plates — 2×4', pack: platePack });
    if (studCutPool.length) cutPlans.push({ title: 'Opening parts — 2×4', pack: openPack });
    if (headerCuts.length) cutPlans.push({ title: 'Headers — 2×6', pack: headerPack });
  }

  // ---------------- PHASE 4 — roof ----------------
  let roofSheets = 0, bundles = 0, squares = 0, epdmArea = 0;
  {
    if (faces.length) {
      const ph = phase('Roof framing & roofing');
      const rafterCuts = [];
      let ties = 0;

      const ridgeLF = ridgeSegs.length * CELL;
      if (ridgeLF) {
        const ridgePack = packCuts([{ len: ridgeLF, label: 'ridge board' }], [{ len: 12, sku: 'lum2x8x12' }]);
        for (const [sku, q] of Object.entries(ridgePack.buy)) addItem(sku, q, 'Roofing');
        cutPlans.push({ title: 'Ridge board — 2×8', pack: ridgePack });
        addNails('n16d', Math.ceil(ridgeLF / 4) * 4);
        ph.steps.push({
          title: `Set the ridge board (${ridgeLF}′)`,
          minutes: 30,
          detail: [
            `Cut the 2×8 ridge to ${ftIn(ridgeLF)} and mark rafter layout at ${RAFTER_SPACING}″ o.c. on both sides.`,
            `Brace it temporarily at ridge height ${ftIn(ridgeSegs[0].y + FLOOR_TOP)} above grade with 2×4 legs to the top plates.`,
          ],
          cuts: [`2×8 ridge → ${ftIn(ridgeLF)}`],
          tools: ['circular saw', 'clamps', '2 temporary 2×4 legs'],
        });
      }

      for (const [fi, f] of faces.entries()) {
        const crossCells = f.columns.length;
        const nRaft = crossCells * 2 + 1;
        const slopeFt = Math.max(...f.columns.map(c => c.slopeFt));
        const flat = f.kind === 'flat';
        for (let k = 0; k < nRaft; k++) {
          rafterCuts.push({ len: slopeFt + 0.2, label: `${flat ? 'ceiling joist' : 'rafter'} — ${DIR_NAMES[f.dir]} face` });
        }
        ties += nRaft;
        const toe = nRaft * 3, tieNails = nRaft * 10, topNails = nRaft * 3;
        addNails('n16d', toe + topNails);
        addNails('hanger', tieNails);
        const kindName = ROOF_KINDS[f.kind].name;
        ph.steps.push({
          title: flat
            ? `Set the flat-roof joists ${faces.length > 1 ? `(face ${fi + 1} of ${faces.length})` : ''}`
            : `Cut & set rafters — ${DIR_NAMES[f.dir]}-sloping face ${faces.length > 1 ? `(${fi + 1} of ${faces.length})` : ''}`,
          minutes: 20 + nRaft * 10,
          detail: [
            flat
              ? `This ${crossCells * CELL}′-wide section gets level 2×6 joists with a slight 1″-per-bay slope toward the ${DIR_NAMES[f.dir]} for drainage (${kindName}).`
              : `This face slopes up toward the ${DIR_NAMES[f.dir]} (${kindName}) and is ${crossCells * CELL}′ wide.`,
            flat
              ? `Cut ${nRaft} joists to ${ftIn(slopeFt + 0.2)} and set them at ${RAFTER_SPACING}″ o.c. across the walls.`
              : `Cut one pattern rafter from 2×6: overall ${ftIn(slopeFt + 0.2)}; plumb cut at the top to match the pitch; birdsmouth with a 3-1/2″ seat cut at ${ftIn(slopeFt - 0.3)} down the rafter; test-fit, then trace ${nRaft - 1} more.`,
            `Install ${nRaft} ${flat ? 'joists' : 'rafters'} at ${RAFTER_SPACING}″ o.c.: 3 × 16d at the top (into ridge or facing member) = ${topNails}, toenail the seat to the top plate with 3 × 16d = ${toe}.`,
            `Add an H2.5A hurricane tie at every seat — ${nRaft} ties × 10 hanger nails = ${tieNails} nails.`,
          ],
          cuts: [flat
            ? `2×6 joist → ${ftIn(slopeFt + 0.2)} × ${nRaft} (square cuts)`
            : `2×6 rafter → ${ftIn(slopeFt + 0.2)} with plumb cut + birdsmouth (3-1/2″ seat) × ${nRaft}`],
          nails: [`${toe + topNails} × 16d common`, `${tieNails} × 1-1/2″ tie nails`],
          tools: ['circular saw', 'speed square', 'framing hammer'],
        });
      }
      const rafterPack = packCuts(rafterCuts, STOCK_2X6);
      for (const [sku, q] of Object.entries(rafterPack.buy)) addItem(sku, q, 'Roofing');
      cutPlans.push({ title: 'Rafters & roof joists — 2×6', pack: rafterPack });
      addItem('hTie', ties, 'Fasteners & hardware');

      // gable framing
      const gableArea = gables.reduce((s, g) => s + g.area, 0);
      if (gableArea) {
        const gableStuds = Math.ceil(gableArea / 4);
        const gableCuts = [];
        for (let k = 0; k < gableStuds; k++) gableCuts.push({ len: 2.5, label: 'gable stud (angle-cut)' });
        const gablePack = packCuts(gableCuts, STOCK_2X4);
        for (const [sku, q] of Object.entries(gablePack.buy)) addItem(sku, q, 'Wall framing');
        cutPlans.push({ title: 'Gable studs — 2×4', pack: gablePack });
        addNails('n16d', gableStuds * 4);
        ph.steps.push({
          title: 'Frame & sheath the gable ends',
          minutes: 45,
          detail: [
            `Fill the ${gables.length} triangular gable area(s) (${gableArea} sq ft total) with 2×4 studs at 16″ o.c., each top end angle-cut to match the roof line — about ${gableStuds} studs, average 30″ long.`,
            `Toenail each gable stud with 4 × 16d (${gableStuds * 4} nails); sheathing was included in the wall-sheathing step.`,
          ],
          cuts: [`2×4 gable stud → ~30″ with one angled end × ${gableStuds}`],
          nails: [`${gableStuds * 4} × 16d common`],
          tools: ['circular saw', 'speed square'],
        });
      }

      // skylights (framed before decking)
      if (skylights.length) {
        addItem('skylight', skylights.length, 'Roofing');
        const skNails = skylights.length * 24;
        addNails('n16d', skNails);
        addNails('roofing', skylights.length * 30);
        ph.steps.push({
          title: `Frame & curb ${skylights.length} skylight${skylights.length > 1 ? 's' : ''}`,
          minutes: 60 * skylights.length,
          detail: [
            'Head off the opening between rafters with doubled 2×6 headers above and below (4 pieces @ 22-1/2″ per skylight, 6 × 16d per end).',
            'Build a 2×6 curb (4 pieces @ 27″) and set the curb-mount unit on it after the underlayment goes down; step-flash all four sides (30 roofing nails per unit).',
          ],
          cuts: [`2×6 header/curb → 22-1/2″ × ${skylights.length * 4} and 27″ × ${skylights.length * 4}`],
          nails: [`${skNails} × 16d common`, `${skylights.length * 30} × 1-1/4″ roofing nails`],
          tools: ['circular saw', 'flashing kit', 'caulk gun'],
        });
      }

      // roof deck + covering
      const shingledFaces = faces.filter(f => ROOF_KINDS[f.kind].shingled);
      const flatFaces = faces.filter(f => !ROOF_KINDS[f.kind].shingled);
      const slopeArea = faces.reduce((s, f) => s + f.areaSlope, 0);
      const shingleArea = shingledFaces.reduce((s, f) => s + f.areaSlope, 0);
      epdmArea = Math.ceil(flatFaces.reduce((s, f) => s + f.areaSlope, 0));
      roofSheets = Math.ceil((slopeArea / 32) * waste);
      squares = shingleArea / 100;
      bundles = Math.ceil(squares * 3 * waste);
      const feltRolls = shingleArea ? Math.max(1, Math.ceil((squares * waste) / 4)) : 0;
      const eaveLF = Object.values(state.roofs)
        .filter(r => r.t === 0 && state.walls[wallKey(lowEdgeOfRoof(r).o, lowEdgeOfRoof(r).i, lowEdgeOfRoof(r).j)])
        .length * CELL;
      const rakeLF = Math.ceil(gables.reduce((s, g) => s + CELL * slopeFactor(g.roof.kind), 0));
      const dripPieces = Math.ceil((eaveLF + rakeLF) / 10);
      const capBoxes = ridgeSegs.length ? Math.ceil((ridgeSegs.length * CELL) / 33) : 0;
      const deckN = roofSheets * 60;
      const feltN = Math.ceil(squares * 20);
      const shingleN = Math.ceil(squares * 312);
      const capN = ridgeSegs.length * CELL * 2;
      const dripN = dripPieces * 10;
      addNails('n8d', deckN);
      addItem('osbRoof', roofSheets, 'Roofing');
      if (dripPieces) addItem('dripEdge', dripPieces, 'Roofing');
      ph.steps.push({
        title: 'Deck the roof',
        minutes: 15 * roofSheets,
        detail: [
          `Lay ${roofSheets} sheets of 15/32″ OSB horizontally (long edge across the rafters), starting at an eave and working up; stagger joints one rafter bay.`,
          `Nail 8d at 6″ o.c. edges / 12″ field — about 60 per sheet, ${deckN} total.`,
          'Snap a chalk line over every rafter before nailing each course so no nail misses framing.',
        ],
        nails: [`${deckN} × 8d common`],
        tools: ['chalk line', 'framing hammer or nail gun'],
      });
      if (shingleArea) {
        addNails('roofing', feltN + shingleN + capN + dripN);
        addItem('felt', feltRolls, 'Roofing');
        addItem('shingleBundle', bundles, 'Roofing');
        if (capBoxes) addItem('ridgeCap', capBoxes, 'Roofing');
        ph.steps.push({
          title: 'Felt, drip edge & shingles',
          minutes: Math.ceil(squares * 90) + 40,
          detail: [
            `Install drip edge along the ${eaveLF}′ of eaves first (under felt), nailing every 12″ — ${dripPieces} ten-foot pieces.`,
            `Roll out 15# felt (${feltRolls} roll${feltRolls > 1 ? 's' : ''}) horizontally from the eaves up, 2″ overlaps, cap-nail about 20 nails per square (${feltN}).`,
            `Drip edge on the ${rakeLF}′ of rakes goes over the felt.`,
            `Starter course at the eave, then shingle up with 5-5/8″ exposure. 4 roofing nails per shingle ≈ 312 per square: ${shingleN} nails for ${squares.toFixed(1)} square${squares >= 2 ? 's' : ''} (${bundles} bundles incl. waste).`,
            ...(capBoxes ? [`Finish the ridge with cap shingles (${capBoxes} box${capBoxes > 1 ? 'es' : ''}), 2 nails per cap — ${capN} nails.`] : []),
          ],
          cuts: ['Shingles → trim flush at rakes with a hook-blade utility knife'],
          nails: [`${feltN + shingleN + capN + dripN} × 1-1/4″ roofing nails`],
          tools: ['utility knife (hook blade)', 'chalk line', 'roofing hammer'],
        });
      }
      if (epdmArea) {
        const epdmGal = Math.max(1, Math.ceil(epdmArea / 150));
        addItem('epdm', Math.ceil(epdmArea * 1.15), 'Roofing');
        addItem('epdmAdhesive', epdmGal, 'Roofing');
        ph.steps.push({
          title: 'EPDM membrane on the flat section',
          minutes: 20 + Math.ceil(epdmArea / 30) * 10,
          detail: [
            `Sweep the ${epdmArea} sq ft flat deck clean, dry-fit the membrane with 6″ of overhang all around, then fold back half and roll on bonding adhesive (${epdmGal} gal).`,
            'Lay the membrane into the wet adhesive, sweep out from the center, repeat for the other half; terminate the edges under the drip edge with lap sealant.',
          ],
          tools: ['paint roller', 'push broom', 'lap sealant gun'],
        });
      }
    }
  }

  // ---------------- PHASE 5/6 — systems ----------------
  const elec = electricalDesign(state);
  const plumb = plumbingDesign(state);
  warnings.push(...elec.warnings, ...plumb.warnings);
  if (elec.steps.length) {
    const ph = phase('Electrical rough-in & finish');
    ph.steps.push(...elec.steps);
    for (const it of elec.items) addItem(it.sku, it.qty, 'Electrical');
  }
  if (plumb.steps.length) {
    const ph = phase('Plumbing');
    ph.steps.push(...plumb.steps);
    for (const it of plumb.items) addItem(it.sku, it.qty, 'Plumbing');
  }

  // ---------------- PHASE 7 — doors, windows, trim ----------------
  {
    const ph = phase('Doors, windows & finishing');
    for (const d of doors) addItem(WALL_PIECES[d.type].unitSku, 1, 'Doors & windows');
    for (const w of windows) addItem(WALL_PIECES[w.type].unitSku, 1, 'Doors & windows');
    for (const v of vents) addItem(WALL_PIECES[v.type].unitSku, 1, 'Doors & windows');
    if (doors.length) {
      addNails('finish', doors.length * 12);
      const hasBarn = doors.some(d => d.type === 'doorBarn');
      ph.steps.push({
        title: `Install ${doors.length} door${doors.length > 1 ? 's' : ''}`,
        minutes: 45 * doors.length,
        detail: [
          'Cut the bottom plate out of each door opening flush with the jack studs (2 cuts with a reciprocating saw).',
          'Prehung/dutch units: set in the opening, shim at hinges and latch until plumb with an even reveal, fasten through the jamb and shims with 12 × 8d finish nails (or 3″ screws through the hinges).',
          ...(hasBarn ? ['Barn door: lag the rail into the header through the sheathing (level it!), hang the door on its trolleys, then set the floor guide and end stops.'] : []),
        ],
        cuts: [`2×4 bottom plate → remove the opening width at each door (${doors.length * 2} saw cuts)`],
        nails: [`${doors.length * 12} × 8d finish`],
        tools: ['reciprocating saw', 'shims', '4′ level', ...(hasBarn ? ['socket wrench for lags'] : [])],
      });
    }
    if (windows.length) {
      addNails('roofing', windows.length * 16);
      ph.steps.push({
        title: `Install ${windows.length} window${windows.length > 1 ? 's' : ''}`,
        minutes: 30 * windows.length,
        detail: [
          'Dry-fit each unit, then run a bead of caulk around the opening flange area.',
          'Set, square (equal diagonals), and fasten the nailing flange with 1-1/4″ roofing nails every 8″ — about 16 per window.',
        ],
        nails: [`${windows.length * 16} × 1-1/4″ roofing nails (flanges)`],
        tools: ['caulk gun', '4′ level'],
      });
    }
    if (vents.length) {
      addNails('finish', vents.length * 6);
      ph.steps.push({
        title: `Install ${vents.length} wall vent${vents.length > 1 ? 's' : ''}`,
        minutes: 15 * vents.length,
        detail: [
          'Set each louver in its blocked opening, bed the flange in caulk, and fasten with 6 finish nails; screen side in.',
        ],
        nails: [`${vents.length * 6} × 8d finish`],
        tools: ['caulk gun', 'hammer'],
      });
    }
    const cornerTrim = corners * 2;
    const eaveLF2 = Object.values(state.roofs).filter(r => r.t === 0).length * CELL;
    const rakeLF2 = Math.ceil(gables.reduce((s, g) => s + CELL * slopeFactor(g.roof.kind), 0));
    const fasciaPieces = Math.ceil((eaveLF2 + rakeLF2) / 12);
    const paintArea = (wallSheets * 32) * 2;
    const paintGal = Math.max(1, Math.ceil(paintArea / 300));
    if (cornerTrim) addItem('trim1x4x8', cornerTrim, 'Trim & finish');
    if (fasciaPieces) addItem('fascia1x6x12', fasciaPieces, 'Trim & finish');
    addItem('paintGal', paintGal, 'Trim & finish');
    addItem('caulk', Math.max(1, Math.ceil((doors.length + windows.length + corners) / 2)), 'Trim & finish');
    const trimNails = cornerTrim * 8 + fasciaPieces * 10;
    if (trimNails) addNails('finish', trimNails);
    ph.steps.push({
      title: 'Trim, caulk & paint',
      minutes: 120,
      detail: [
        ...(cornerTrim ? [`Nail 1×4 corner boards (${cornerTrim} pieces, 8 finish nails each).`] : []),
        ...(fasciaPieces ? [`Fasten 1×6 fascia to the rafter tails and rakes — about ${eaveLF2 + rakeLF2}′ (${fasciaPieces} boards, 10 finish nails each).`] : []),
        'Caulk every trim joint, sheathing seam, and around the doors/windows.',
        `Prime-and-paint with 2 coats — about ${paintGal} gallon${paintGal > 1 ? 's' : ''} for ${wallSheets * 32} sq ft of wall.`,
      ],
      nails: trimNails ? [`${trimNails} × 8d finish`] : [],
      tools: ['miter saw', 'caulk gun', 'brushes/roller'],
    });
  }

  // ---------------- fasteners → purchase units ----------------
  for (const [type, count] of Object.entries(nailTotals)) {
    const spec = NAILS[type];
    const lbs = (count * waste) / spec.perLb;
    const boxes = Math.max(1, Math.ceil(lbs / spec.box.lb));
    supply.push({
      sku: type, desc: spec.desc, qty: boxes, unit: `${spec.box.lb} lb box`,
      price: spec.box.price, total: boxes * spec.box.price,
      category: 'Fasteners & hardware',
      note: `${count.toLocaleString()} nails (+${Math.round((waste - 1) * 100)}% spare ≈ ${Math.ceil(lbs)} lb)`,
    });
  }

  // merge duplicate rows (same sku in same category)
  for (let i = supply.length - 1; i > 0; i--) {
    const dup = supply.findIndex((s, k) => k < i && s.sku === supply[i].sku && s.category === supply[i].category);
    if (dup >= 0) {
      supply[dup].qty += supply[i].qty;
      supply[dup].total += supply[i].total;
      supply.splice(i, 1);
    }
  }

  // ---------------- cost rollup ----------------
  const catOrder = ['Foundation & floor', 'Wall framing', 'Sheathing', 'Roofing',
    'Doors & windows', 'Electrical', 'Plumbing', 'Fasteners & hardware', 'Trim & finish'];
  const categories = catOrder
    .map(name => {
      const items = supply.filter(s => s.category === name);
      return { name, items, total: items.reduce((s, x) => s + x.total, 0) };
    })
    .filter(c => c.items.length);
  const subtotal = categories.reduce((s, c) => s + c.total, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  const minutes = phases.reduce((s, p) => s + p.steps.reduce((q, st) => q + (st.minutes || 0), 0), 0);
  const nailGrand = Object.values(nailTotals).reduce((a, b) => a + b, 0);

  // ---------------- code check ----------------
  const peak = Object.values(state.roofs).reduce((m, r) => Math.max(m, roofHeights(r)[1]), WALL_H);
  const codeCtx = {
    area,
    heightFt: peak + FLOOR_TOP,
    doors: doors.length,
    windows: windows.length,
    vents: vents.length,
    roofKinds: new Set(Object.values(state.roofs).map(r => r.kind)),
    hasFlat: Object.values(state.roofs).some(r => r.kind === 'flat'),
    skylights: skylights.length,
    elec: {
      any: fixtures.some(f => FIXTURES[f.kind].sys === 'elec'),
      panel: fixtures.some(f => f.kind === 'panel'),
      outlets: fixtures.filter(f => f.kind === 'outlet').length,
    },
    plumb: {
      any: fixtures.some(f => FIXTURES[f.kind].sys === 'plumb'),
      sinks: fixtures.filter(f => f.kind === 'sink').length,
    },
  };
  const code = runCodeChecks(codeCtx, regionId);

  return {
    ok: true,
    warnings,
    stats: {
      area, bboxW: b.w, bboxD: b.d,
      wallPanels: Object.keys(state.walls).length,
      roofPanels: Object.keys(state.roofs).length,
      doors: doors.length, windows: windows.length, vents: vents.length,
      corners, skylights: skylights.length,
      elecDevices: elec.counts.devices || 0,
      plumbFixtures: plumb.counts.fixtures || 0,
      roofSquares: squares, epdmArea, nailGrand,
      heightFt: codeCtx.heightFt,
    },
    phases,
    supply,
    categories,
    cutPlans,
    nails: Object.entries(nailTotals).map(([t, c]) => ({ type: t, desc: NAILS[t].desc, count: c })),
    cost: { subtotal, tax, taxRate: taxRate * 100, total, perSqft: total / area },
    minutes,
    code,
    systems: { elec: elec.counts, plumb: plumb.counts },
  };
}
