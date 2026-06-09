// Run with: node tests/engine.test.mjs
import assert from 'node:assert';
import {
  emptyState, demoShed, placeFloor, placeWall, placeRoof,
  canPlaceFloor, canPlaceWall, canPlaceRoof, edgeForSide, bestRoofTier,
  perimeterEdges, gableTriangles, bounds,
} from '../js/store.js';
import { buildReport, packCuts, inches, ftIn } from '../js/engine.js';
import { STOCK_2X4 } from '../js/catalog.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (err) { console.error('  ✗', name, '\n   ', err.message); process.exitCode = 1; }
}

console.log('store.js — placement rules');
test('first floor goes anywhere, later floors must touch', () => {
  const s = emptyState();
  assert.ok(canPlaceFloor(s, 0, 0));
  placeFloor(s, 0, 0);
  assert.ok(canPlaceFloor(s, 1, 0));
  assert.ok(!canPlaceFloor(s, 5, 5));
  assert.ok(!canPlaceFloor(s, 0, 0), 'occupied');
});

test('walls need an adjacent floor', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  assert.ok(canPlaceWall(s, edgeForSide(0, 0, 0)));
  assert.ok(canPlaceWall(s, edgeForSide(1, 0, 3)), 'shared edge from the empty side');
  assert.ok(!canPlaceWall(s, edgeForSide(4, 4, 0)));
});

test('roof tier 0 needs a wall under its low edge', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  placeWall(s, edgeForSide(0, 0, 3)); // west wall
  assert.ok(canPlaceRoof(s, 0, 0, 0, 1), 'slope up east, low edge on west wall');
  assert.ok(!canPlaceRoof(s, 0, 0, 0, 3), 'slope up west has no support');
});

test('roof stacks up the slope', () => {
  const s = emptyState();
  placeFloor(s, 0, 0); placeFloor(s, 1, 0);
  placeWall(s, edgeForSide(0, 0, 3));
  placeRoof(s, 0, 0, 0, 1);
  assert.equal(bestRoofTier(s, 1, 0, 1), 1, 'next cell uphill is tier 1');
  assert.ok(canPlaceRoof(s, 1, 0, 1, 1));
  assert.ok(!canPlaceRoof(s, 1, 0, 0, 1), 'tier 0 unsupported there');
});

test('demo shed is a closed 8×12 with full coverage', () => {
  const s = demoShed();
  const b = bounds(s);
  assert.equal(b.w, 12); assert.equal(b.d, 8);
  assert.equal(perimeterEdges(s).length, 10);
  assert.equal(Object.keys(s.walls).length, 10);
  assert.equal(Object.keys(s.roofs).length, 6);
  assert.equal(gableTriangles(s).length, 4, 'two triangles per gable end');
});

console.log('engine.js — cut packing');
test('FFD packer minimizes boards', () => {
  const { bins, buy } = packCuts(
    [{ len: 8, label: 'a' }, { len: 8, label: 'b' }, { len: 4, label: 'c' }, { len: 4, label: 'd' }],
    STOCK_2X4);
  const total = Object.values(buy).reduce((x, y) => x + y, 0);
  assert.ok(total <= 3, `expected ≤3 boards, got ${total}`);
  const waste = bins.reduce((s, b) => s + b.waste, 0);
  assert.ok(waste < 1e-6, `expected zero waste, got ${waste}`);
  for (const b of bins) assert.ok(b.used <= b.stockLen + 1e-6);
});

test('over-length runs are split across boards', () => {
  const { bins } = packCuts([{ len: 20, label: 'long plate' }], STOCK_2X4);
  const totalLen = bins.flatMap(b => b.pieces).reduce((s, p) => s + p.len, 0);
  assert.ok(Math.abs(totalLen - 20) < 1e-6);
});

console.log('engine.js — formatting');
test('inches & feet-inches formatting', () => {
  assert.equal(inches(92.625), '92-5/8″');
  assert.equal(ftIn(8), '8′');
  assert.equal(ftIn(7.75), '7′ 9″');
});

console.log('engine.js — full report');
test('demo shed report is consistent', () => {
  const r = buildReport(demoShed(), { taxRate: 8, wastePct: 10 });
  assert.ok(r.ok);
  assert.equal(r.warnings.length, 0, 'demo shed should have no warnings');
  assert.equal(r.stats.area, 96);
  assert.equal(r.stats.doors, 1);
  assert.equal(r.stats.windows, 1);
  assert.equal(r.stats.corners, 4);
  assert.ok(r.cost.subtotal > 1000 && r.cost.subtotal < 5000, `plausible cost, got ${r.cost.subtotal}`);
  assert.ok(Math.abs(r.cost.total - r.cost.subtotal * 1.08) < 0.01, 'tax applied');
  assert.ok(r.stats.nailGrand > 1000, 'thousands of nails counted');
  // every supply line has a positive total and the categories add up
  const sum = r.supply.reduce((s, x) => s + x.total, 0);
  const catSum = r.categories.reduce((s, c) => s + c.total, 0);
  assert.ok(Math.abs(sum - catSum) < 0.01);
  assert.ok(Math.abs(catSum - r.cost.subtotal) < 0.01);
  // nail counts in schedule match per-step accumulation grand total
  const nailSum = r.nails.reduce((s, n) => s + n.count, 0);
  assert.equal(nailSum, r.stats.nailGrand);
  // guide exists and is substantial
  const steps = r.phases.reduce((s, p) => s + p.steps.length, 0);
  assert.ok(steps >= 15, `expected ≥15 steps, got ${steps}`);
  assert.ok(r.minutes > 300);
});

test('empty state refuses politely', () => {
  const r = buildReport(emptyState(), {});
  assert.ok(!r.ok);
  assert.ok(r.warnings.length);
});

test('open shed produces warnings', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  const r = buildReport(s, {});
  assert.ok(r.ok);
  assert.ok(r.warnings.some(w => w.includes('no wall')));
  assert.ok(r.warnings.some(w => w.toLowerCase().includes('door')));
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
