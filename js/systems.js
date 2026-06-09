// systems.js — electrical and plumbing design: auto-routed runs, takeoff,
// and build-guide steps. Pure JS (shared by the engine and the 2D plan view).

import { edgeSegment, perimeterEdges, CELL } from './store.js';
import { FIXTURES } from './catalog.js';

// plan position of a fixture (ft)
export function fixturePos(f) {
  if (f.host === 'cell' || f.host === 'roof') {
    return { x: f.i * CELL + CELL / 2, z: f.j * CELL + CELL / 2 };
  }
  const [ax, az, bx, bz] = edgeSegment(f);
  return { x: (ax + bx) / 2, z: (az + bz) / 2 };
}

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const lPath = (a, b) => [[a.x, a.z], [a.x, b.z], [b.x, b.z]];

export function electricalDesign(state) {
  const fx = Object.values(state.fixtures).filter(f => FIXTURES[f.kind].sys === 'elec');
  const out = { items: [], steps: [], warnings: [], routes: [], counts: {} };
  if (!fx.length) return out;

  const panel = fx.find(f => f.kind === 'panel');
  const outlets = fx.filter(f => f.kind === 'outlet');
  const switches = fx.filter(f => f.kind === 'switch');
  const lights = fx.filter(f => f.kind === 'light' || f.kind === 'extLight');
  const devices = fx.filter(f => f.kind !== 'panel');

  if (!panel) {
    out.warnings.push('Electrical fixtures placed but no sub-panel — add a panel so circuits can be routed.');
    return out;
  }

  const pPos = fixturePos(panel);
  let len20 = 0, len15 = 0;
  for (const f of devices) {
    const pos = fixturePos(f);
    const run = manhattan(pPos, pos) + 8;           // drops + makeup slack
    if (f.kind === 'outlet') len20 += run; else len15 += run;
    out.routes.push({ sys: 'elec', kind: f.kind, path: lPath(pPos, pos) });
  }
  len20 = Math.ceil(len20 * 1.15);
  len15 = Math.ceil(len15 * 1.15);

  const rolls12 = Math.ceil(len20 / 100), rolls14 = Math.ceil(len15 / 100);
  const recepCircuits = outlets.length ? Math.ceil(outlets.length / 8) : 0;
  const lightCircuits = (lights.length + switches.length) ? 1 : 0;
  const boxes = outlets.length + switches.length + lights.filter(f => f.kind === 'extLight').length;
  const staples = Math.ceil((len20 + len15) / 4);
  const ceilLights = lights.filter(f => f.kind === 'light').length;
  const extLights = lights.length - ceilLights;

  const add = (sku, qty) => qty > 0 && out.items.push({ sku, qty, cat: 'Electrical' });
  add('panel60', 1);
  add('feederUF', 50);
  add('breaker20', recepCircuits);
  add('breaker15', lightCircuits);
  add('wire122', rolls12);
  add('wire142', rolls14);
  if (outlets.length) { add('outletGfci', 1); add('outlet', outlets.length - 1); }
  add('switch', switches.length);
  add('lightLed', ceilLights);
  add('lightExt', extLights);
  add('elecBox', boxes);
  add('wireStaples', Math.max(1, Math.ceil(staples / 100)));

  out.counts = { len20, len15, circuits: recepCircuits + lightCircuits, devices: devices.length };

  out.steps.push({
    title: 'Mount the sub-panel & set boxes',
    minutes: 40 + boxes * 6,
    detail: [
      'Mount the 60A sub-panel to the studs with 4 lag screws at eye height; feed it with 10/2 UF-B from the house panel (50′ assumed — adjust for your trench; bury 24″ deep, or 18″ in conduit).',
      `Nail on ${boxes} single-gang box${boxes === 1 ? '' : 'es'}: outlets at 16″ to box center, switches at 48″ — box edge flush with future wall finish.`,
      ...(ceilLights ? [`Mark ${ceilLights} ceiling light location${ceilLights > 1 ? 's' : ''} on the rafters/collar framing.`] : []),
    ],
    tools: ['drill/driver', 'hammer', 'tape measure', 'torpedo level'],
  });
  out.steps.push({
    title: 'Drill & pull the circuits',
    minutes: 25 + Math.ceil((len20 + len15) / 20) * 10,
    detail: [
      'Drill 7/8″ holes through the stud centers (keep 1-1/4″ from the edge or add nail plates).',
      `Pull 12/2 NM-B for the receptacle circuit${recepCircuits > 1 ? 's' : ''} (~${len20}′) and 14/2 for the lighting circuit (~${len15}′), panel to farthest device first.`,
      `Staple within 8″ of every box and every 4′ on runs — about ${staples} staples.`,
      'Leave 12″ of free conductor at every box and 3′ at the panel.',
    ],
    tools: ['drill + 7/8″ auger bit', 'wire strippers', 'staple-on hammer'],
  });
  out.steps.push({
    title: 'Devices, breakers & test',
    minutes: 15 * devices.length + 30,
    detail: [
      `Wire the GFCI receptacle first in line (protects the ${outlets.length - 1} downstream outlet${outlets.length - 1 === 1 ? '' : 's'}), then standard receptacles, switches and lights.`,
      `Land the circuits on ${recepCircuits} × 20A and ${lightCircuits} × 15A breaker${recepCircuits + lightCircuits === 1 ? '' : 's'}; torque lugs to spec and label the panel directory.`,
      'Test every device with a plug-in tester; press TEST on the GFCI.',
    ],
    tools: ['screwdrivers', 'voltage tester', 'plug-in receptacle tester'],
  });
  return out;
}

export function plumbingDesign(state) {
  const fx = Object.values(state.fixtures).filter(f => FIXTURES[f.kind].sys === 'plumb');
  const out = { items: [], steps: [], warnings: [], routes: [], counts: {} };
  if (!fx.length) return out;

  // supply enters at the exterior wall point nearest the first fixture
  const anchor = fixturePos(fx[0]);
  let entry = anchor, best = Infinity;
  for (const e of perimeterEdges(state)) {
    const [ax, az, bx, bz] = edgeSegment(e);
    const mid = { x: (ax + bx) / 2, z: (az + bz) / 2 };
    const d = manhattan(anchor, mid);
    if (d < best) { best = d; entry = mid; }
  }
  out.entry = entry;

  let pexFt = 6; // entry stub + main shutoff makeup
  for (const f of fx) {
    const pos = fixturePos(f);
    pexFt += manhattan(entry, pos) + 4;
    out.routes.push({ sys: 'plumb', kind: f.kind, path: lPath(entry, pos) });
  }
  pexFt = Math.ceil(pexFt * 1.1);

  const sinks = fx.filter(f => f.kind === 'sink');
  let pvcFt = 0;
  for (const s of sinks) {
    const pos = fixturePos(s);
    let dd = Infinity;
    for (const e of perimeterEdges(state)) {
      const [ax, az, bx, bz] = edgeSegment(e);
      dd = Math.min(dd, manhattan(pos, { x: (ax + bx) / 2, z: (az + bz) / 2 }));
    }
    pvcFt += Math.ceil(dd + 4);
  }

  const add = (sku, qty) => qty > 0 && out.items.push({ sku, qty, cat: 'Plumbing' });
  add('pex12', pexFt);
  add('pexFittings', 1);
  add('shutoff', fx.length + 1);
  for (const f of fx) add(FIXTURES[f.kind].sku, 1);
  if (sinks.length) {
    add('pvc112', pvcFt);
    add('pvcFittings', sinks.length);
    add('aav', sinks.length);
  }
  add('pipeStraps', 1);
  out.counts = { pexFt, pvcFt, fixtures: fx.length };

  out.steps.push({
    title: 'Rough in the water supply',
    minutes: 30 + Math.ceil(pexFt / 10) * 8,
    detail: [
      `Bring the 1/2″ supply through the wall at the stub-out point (${entry.x.toFixed(0)}′, ${entry.z.toFixed(0)}′ on the plan) and set the main shutoff right inside.`,
      `Run ~${pexFt}′ of 1/2″ PEX through 3/4″ holes drilled mid-stud to each fixture; support every 32″ with straps.`,
      `Stub out and fit a quarter-turn shutoff at each of the ${fx.length} fixture${fx.length > 1 ? 's' : ''}.`,
      'If you get freezing winters, slope the runs back to a drain-down valve at the entry.',
    ],
    tools: ['drill + 3/4″ bit', 'PEX cutter', 'crimp tool', 'go/no-go gauge'],
  });
  if (sinks.length) {
    out.steps.push({
      title: 'Drain, trap & vent the sink',
      minutes: 45 * sinks.length,
      detail: [
        `Run ~${pvcFt}′ of 1-1/2″ PVC from the sink P-trap to the exterior stub, sloped 1/4″ per foot — check with a torpedo level on every section.`,
        'Glue joints with primer + cement; support the run every 4′.',
        'Install the air admittance valve (AAV) at least 4″ above the trap arm — it must stay accessible.',
        'Tie the stub to your septic/sewer/dry-well per local rules (see the code check tab).',
      ],
      tools: ['PVC saw', 'primer & cement', 'torpedo level'],
    });
  }
  out.steps.push({
    title: 'Set fixtures & pressure test',
    minutes: 30 * fx.length,
    detail: [
      ...(sinks.length ? ['Mount the utility sink to the wall studs, connect the faucet, trap and supply.'] : []),
      ...(fx.some(f => f.kind === 'hosebib') ? ['Mount the frost-free hose bib through the wall with a slight outward pitch; seal the penetration.'] : []),
      'Pressurize the supply and hold for 30 minutes — no drips allowed; fill the trap and check the drain with a bucket of water.',
    ],
    tools: ['adjustable wrench', 'caulk gun'],
  });
  return out;
}
