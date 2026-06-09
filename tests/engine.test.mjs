// Run with: node tests/engine.test.mjs
import assert from 'node:assert';
import {
  emptyState, demoShed, placeFloor, placeWall, placeRoof, placeFixture,
  canPlaceFloor, canPlaceWall, canPlaceRoof, canPlaceFixture,
  edgeForSide, bestRoofTier, removeWall,
  perimeterEdges, gableTriangles, bounds,
  computeSupport, collapseUnsupported,
} from '../js/store.js';
import { buildReport, packCuts, inches, ftIn } from '../js/engine.js';
import { electricalDesign, plumbingDesign } from '../js/systems.js';
import { runCodeChecks, REGIONS } from '../js/codes.js';
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
  placeWall(s, edgeForSide(0, 0, 3));
  assert.ok(canPlaceRoof(s, 0, 0, 0, 1), 'slope up east, low edge on west wall');
  assert.ok(!canPlaceRoof(s, 0, 0, 0, 3), 'slope up west has no support');
});

test('roof stacks up the slope; kinds must match', () => {
  const s = emptyState();
  placeFloor(s, 0, 0); placeFloor(s, 1, 0);
  placeWall(s, edgeForSide(0, 0, 3));
  placeRoof(s, 0, 0, 0, 1, 'r45');
  assert.equal(bestRoofTier(s, 1, 0, 1, 'r45'), 1, 'next cell uphill is tier 1');
  assert.ok(canPlaceRoof(s, 1, 0, 1, 1, 'r45'));
  assert.ok(!canPlaceRoof(s, 1, 0, 1, 1, 'r22'), 'cannot stack a different pitch');
  assert.ok(!canPlaceRoof(s, 1, 0, 0, 1, 'r45'), 'tier 0 unsupported there');
});

test('flat roofs only at tier 0', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  placeWall(s, edgeForSide(0, 0, 3));
  assert.ok(canPlaceRoof(s, 0, 0, 0, 1, 'flat'));
  assert.ok(!canPlaceRoof(s, 0, 0, 1, 1, 'flat'));
});

test('fixtures: walls host devices, plain panels only', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  placeWall(s, edgeForSide(0, 0, 0), 'solid');
  placeWall(s, edgeForSide(0, 0, 2), 'door36');
  assert.ok(canPlaceFixture(s, { kind: 'outlet', o: 'H', i: 0, j: 0 }));
  assert.ok(!canPlaceFixture(s, { kind: 'outlet', o: 'H', i: 0, j: 1 }), 'no outlet on a door wall');
  assert.ok(canPlaceFixture(s, { kind: 'light', i: 0, j: 0 }));
  assert.ok(!canPlaceFixture(s, { kind: 'light', i: 3, j: 3 }), 'light needs a floor cell');
});

console.log('store.js — structural support physics');
test('roof collapses when its supporting wall is removed', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  placeWall(s, edgeForSide(0, 0, 3));
  placeRoof(s, 0, 0, 0, 1, 'r45');
  let sup = computeSupport(s);
  assert.ok(sup.roofs['0,0,0'] > 0.5, 'supported while wall stands');
  removeWall(s, edgeForSide(0, 0, 3));
  const dead = collapseUnsupported(s);
  assert.equal(dead.length, 1);
  assert.equal(dead[0].kind, 'roof');
  assert.equal(Object.keys(s.roofs).length, 0);
});

test('collapse cascades up a stacked slope', () => {
  const s = emptyState();
  for (let i = 0; i < 3; i++) placeFloor(s, i, 0);
  placeWall(s, edgeForSide(0, 0, 3));
  placeRoof(s, 0, 0, 0, 1, 'r45');
  placeRoof(s, 1, 0, 1, 1, 'r45');
  placeRoof(s, 2, 0, 2, 1, 'r45');
  removeWall(s, edgeForSide(0, 0, 3));
  const dead = collapseUnsupported(s);
  assert.equal(dead.filter(d => d.kind === 'roof').length, 3, 'whole chain falls');
});

test('demo shed is fully supported', () => {
  const s = demoShed();
  assert.equal(collapseUnsupported(s).length, 0);
  const b = bounds(s);
  assert.equal(b.w, 12); assert.equal(b.d, 8);
  assert.equal(perimeterEdges(s).length, 10);
  assert.equal(Object.keys(s.walls).length, 10);
  assert.equal(Object.keys(s.roofs).length, 6);
  assert.equal(gableTriangles(s).length, 4, 'two triangles per gable end');
});

console.log('systems.js — electrical & plumbing');
test('electrical design routes circuits from the panel', () => {
  const e = electricalDesign(demoShed());
  assert.ok(e.counts.devices >= 5);
  assert.ok(e.counts.len20 > 0 && e.counts.len15 > 0);
  assert.ok(e.items.some(i => i.sku === 'outletGfci'), 'first outlet is GFCI');
  assert.ok(e.items.some(i => i.sku === 'panel60'));
  assert.equal(e.steps.length, 3);
  assert.ok(e.routes.length >= 5, 'one route per device');
});

test('electrical without a panel warns instead of guessing', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  placeWall(s, edgeForSide(0, 0, 0), 'solid');
  placeFixture(s, { kind: 'outlet', o: 'H', i: 0, j: 0 });
  const e = electricalDesign(s);
  assert.ok(e.warnings.length === 1 && /panel/.test(e.warnings[0]));
});

test('plumbing design finds a supply entry and drains the sink', () => {
  const p = plumbingDesign(demoShed());
  assert.ok(p.counts.pexFt > 10);
  assert.ok(p.counts.pvcFt > 0, 'sink needs a drain run');
  assert.ok(p.items.some(i => i.sku === 'aav'), 'AAV vents the trap');
  assert.ok(p.entry, 'supply entry point chosen');
});

console.log('codes.js — regional code checks');
test('every region produces findings with levels', () => {
  const r = buildReport(demoShed(), {});
  for (const id of Object.keys(REGIONS)) {
    const ctx = { area: 96, heightFt: 13, doors: 1, windows: 2, vents: 1,
      roofKinds: new Set(['r45']), hasFlat: false, skylights: 1,
      elec: { any: true, panel: true, outlets: 2 }, plumb: { any: true, sinks: 1 } };
    const c = runCodeChecks(ctx, id);
    assert.ok(c.findings.length >= 8, `${id}: ${c.findings.length} findings`);
    assert.ok(c.findings.every(f => ['pass', 'warn', 'fail', 'info'].includes(f.level)));
  }
  assert.ok(r.code.findings.length >= 8, 'report embeds the code check');
});

test('snow country flags flat roofs and 24″ rafters', () => {
  const ctx = { area: 96, heightFt: 13, doors: 1, windows: 0, vents: 0,
    roofKinds: new Set(['flat']), hasFlat: true, skylights: 0,
    elec: { any: false, panel: false, outlets: 0 }, plumb: { any: false, sinks: 0 } };
  const c = runCodeChecks(ctx, 'mountain');
  assert.ok(c.findings.some(f => f.level === 'fail' && /flat/i.test(f.title)));
});

test('missing panel fails the disconnect check', () => {
  const ctx = { area: 96, heightFt: 13, doors: 1, windows: 0, vents: 1,
    roofKinds: new Set(['r45']), hasFlat: false, skylights: 0,
    elec: { any: true, panel: false, outlets: 2 }, plumb: { any: false, sinks: 0 } };
  const c = runCodeChecks(ctx, 'irc');
  assert.ok(c.findings.some(f => f.level === 'fail' && /panel|Disconnect/i.test(f.title)));
});

console.log('engine.js — cut packing & formatting');
test('FFD packer minimizes waste', () => {
  const { bins, buy } = packCuts(
    [{ len: 8, label: 'a' }, { len: 8, label: 'b' }, { len: 4, label: 'c' }, { len: 4, label: 'd' }],
    STOCK_2X4);
  const total = Object.values(buy).reduce((x, y) => x + y, 0);
  assert.ok(total <= 3, `expected ≤3 boards, got ${total}`);
  const waste = bins.reduce((s, b) => s + b.waste, 0);
  assert.ok(waste < 1e-6, `expected zero waste, got ${waste}`);
});

test('over-length runs are split across boards', () => {
  const { bins } = packCuts([{ len: 20, label: 'long plate' }], STOCK_2X4);
  const totalLen = bins.flatMap(b => b.pieces).reduce((s, p) => s + p.len, 0);
  assert.ok(Math.abs(totalLen - 20) < 1e-6);
});

test('inches & feet-inches formatting', () => {
  assert.equal(inches(92.625), '92-5/8″');
  assert.equal(ftIn(8), '8′');
  assert.equal(ftIn(7.75), '7′ 9″');
});

console.log('engine.js — full report');
test('demo shed report is consistent', () => {
  const r = buildReport(demoShed(), { taxRate: 8, wastePct: 10, region: 'midwest' });
  assert.ok(r.ok);
  assert.equal(r.warnings.length, 0, `expected no warnings, got: ${r.warnings}`);
  assert.equal(r.stats.area, 96);
  assert.equal(r.stats.doors, 1);
  assert.equal(r.stats.windows, 2);
  assert.equal(r.stats.vents, 1);
  assert.equal(r.stats.skylights, 1);
  assert.equal(r.stats.corners, 4);
  assert.ok(r.cost.subtotal > 2000 && r.cost.subtotal < 6000, `plausible cost, got ${r.cost.subtotal}`);
  assert.ok(Math.abs(r.cost.total - r.cost.subtotal * 1.08) < 0.01, 'tax applied');
  assert.ok(r.stats.nailGrand > 1000);
  const sum = r.supply.reduce((s, x) => s + x.total, 0);
  const catSum = r.categories.reduce((s, c) => s + c.total, 0);
  assert.ok(Math.abs(sum - catSum) < 0.01);
  assert.ok(Math.abs(catSum - r.cost.subtotal) < 0.01);
  const nailSum = r.nails.reduce((s, n) => s + n.count, 0);
  assert.equal(nailSum, r.stats.nailGrand);
  assert.ok(r.categories.some(c => c.name === 'Electrical'));
  assert.ok(r.categories.some(c => c.name === 'Plumbing'));
  const steps = r.phases.reduce((s, p) => s + p.steps.length, 0);
  assert.ok(steps >= 20, `expected ≥20 steps, got ${steps}`);
  assert.ok(r.minutes > 300);
});

test('flat-roof shed uses EPDM, not shingles', () => {
  const s = emptyState();
  placeFloor(s, 0, 0);
  for (const e of perimeterEdges(s)) placeWall(s, e, 'solid');
  placeRoof(s, 0, 0, 0, 1, 'flat');
  const r = buildReport(s, {});
  assert.ok(r.stats.epdmArea > 0);
  assert.ok(!r.supply.some(x => x.sku === 'shingleBundle'));
  assert.ok(r.supply.some(x => x.sku === 'epdm'));
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
