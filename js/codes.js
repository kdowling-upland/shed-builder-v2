// codes.js — regional building-code comparison. Profiles are IRC-based with
// regional amendments approximated; findings cite the model-code section.
// This is guidance, not a permit review — always verify with the local AHJ.

export const REGIONS = {
  irc:      { name: 'US — IRC default',        permitMaxSqft: 200, maxHeight: 15, snow: 20,  wind: 105, frost: 12, setback: 5,  aavOk: true },
  california:{ name: 'California',             permitMaxSqft: 120, maxHeight: 12, snow: 0,   wind: 100, frost: 0,  setback: 5,  aavOk: false, seismic: true },
  texas:    { name: 'Texas',                   permitMaxSqft: 200, maxHeight: 15, snow: 5,   wind: 115, frost: 6,  setback: 5,  aavOk: true },
  florida:  { name: 'Florida',                 permitMaxSqft: 150, maxHeight: 12, snow: 0,   wind: 150, frost: 0,  setback: 7.5, aavOk: true, hvhz: true },
  northeast:{ name: 'Northeast US',            permitMaxSqft: 200, maxHeight: 15, snow: 50,  wind: 110, frost: 48, setback: 10, aavOk: true },
  midwest:  { name: 'Midwest US',              permitMaxSqft: 200, maxHeight: 15, snow: 30,  wind: 115, frost: 36, setback: 5,  aavOk: true },
  mountain: { name: 'Mountain West',           permitMaxSqft: 200, maxHeight: 15, snow: 70,  wind: 115, frost: 36, setback: 10, aavOk: true },
  pnw:      { name: 'Pacific Northwest',       permitMaxSqft: 200, maxHeight: 15, snow: 25,  wind: 100, frost: 18, setback: 5,  aavOk: true, seismic: true },
};

// ctx comes from the engine: { area, heightFt, doors, windows, vents,
//   roofKinds:Set, hasFlat, skylights, elec:{any,panel,outlets}, plumb:{any,sinks} }
export function runCodeChecks(ctx, regionId = 'irc') {
  const R = REGIONS[regionId] || REGIONS.irc;
  const F = [];
  const add = (level, code, title, text) => F.push({ level, code, title, text });

  // permit threshold
  if (ctx.area <= R.permitMaxSqft) {
    add('pass', 'IRC R105.2', 'Permit exemption size',
      `${ctx.area} sq ft is at or under the ${R.permitMaxSqft} sq ft accessory-structure exemption common in this region — a building permit is often not required (electrical/plumbing work usually still needs its own permit).`);
  } else {
    add('warn', 'IRC R105.2', 'Permit likely required',
      `${ctx.area} sq ft exceeds the typical ${R.permitMaxSqft} sq ft exemption for this region — plan on a building permit and possibly stamped plans.`);
  }

  // height
  if (ctx.heightFt <= R.maxHeight) {
    add('pass', 'Zoning (typ.)', 'Structure height',
      `Peak height ≈ ${ctx.heightFt.toFixed(1)}′ is within the ~${R.maxHeight}′ accessory-building limit typical here.`);
  } else {
    add('fail', 'Zoning (typ.)', 'Structure height',
      `Peak height ≈ ${ctx.heightFt.toFixed(1)}′ exceeds the ~${R.maxHeight}′ limit typical for accessory buildings — lower the roof pitch or remove a roof tier.`);
  }

  // egress
  if (ctx.doors > 0) {
    add('pass', 'IRC R311', 'Door / egress', 'At least one 36″ door provides a compliant exit (32″ minimum clear width).');
  } else {
    add('fail', 'IRC R311', 'Door / egress', 'No door placed — every enclosed structure needs a way out.');
  }

  // snow load on the roof
  if (R.snow >= 40 && (ctx.roofKinds.has('r22') || ctx.roofKinds.has('r45'))) {
    add('warn', 'IRC R802 / Table R802.4.1', 'Snow load — rafters',
      `Ground snow load here is roughly ${R.snow} psf. The plan uses 2×6 rafters at 24″ o.c. — tighten to 16″ o.c. or upsize to 2×8 for spans over 8′. The steeper 45° panels shed snow best.`);
  } else if (R.snow >= 20) {
    add('pass', 'IRC R802', 'Snow load — rafters',
      `2×6 rafters at 24″ o.c. on short spans are generally adequate for ~${R.snow} psf ground snow; verify span tables for spans over 10′.`);
  } else {
    add('pass', 'IRC R802', 'Snow load — rafters', 'Minimal snow load in this region; the rafter plan is adequate.');
  }
  if (ctx.hasFlat && R.snow >= 30) {
    add('fail', 'IRC R905.12', 'Flat roof in snow country',
      `A flat/EPDM roof with ~${R.snow} psf ground snow needs an engineered joist design — swap to sloped panels or get the flat section engineered.`);
  }

  // wind
  if (R.wind >= 130) {
    add('pass', 'IRC R301.2.1', 'High-wind uplift',
      `Design wind speed ~${R.wind} mph${R.hvhz ? ' (HVHZ rules may apply)' : ''}: the plan already includes an H2.5A hurricane tie at every rafter seat. Use ring-shank sheathing nails and a 4″ edge nailing schedule.`);
  } else if (R.wind >= 115) {
    add('pass', 'IRC R301.2.1', 'Wind uplift',
      'Hurricane ties at every rafter (already in the plan) satisfy typical uplift requirements at this wind speed.');
  } else {
    add('pass', 'IRC R301.2.1', 'Wind uplift', 'Standard fastening is adequate for the design wind speed in this region.');
  }
  if (R.seismic) {
    add('warn', 'IRC R301.2.2', 'Seismic bracing',
      'This is a seismic design region — keep the wall sheathing fully nailed at 6″/12″ (it acts as shear bracing) and anchor the shed to its skids with framing angles.');
  }

  // foundation / frost
  add(R.frost >= 24 ? 'warn' : 'pass', 'IRC R403.1.4.1', 'Foundation & frost',
    R.frost >= 24
      ? `Frost depth here is ~${R.frost}″. A floating skid foundation is normally allowed for exempt sheds, but expect seasonal movement — set skids on a 4″ compacted gravel bed and re-level yearly.`
      : 'Skids on a compacted gravel bed are fine for this region’s frost depth.');

  // ventilation / moisture
  if (ctx.vents === 0 && ctx.windows === 0) {
    add('warn', 'IRC R806 (principle)', 'Ventilation',
      'No vents or operable windows — add at least one wall vent (or two for cross-flow) to control condensation.');
  } else {
    add('pass', 'IRC R806 (principle)', 'Ventilation', 'Vent/window openings provide airflow to control condensation.');
  }

  // skylight
  if (ctx.skylights > 0) {
    add('pass', 'IRC R308.6', 'Skylights',
      'Curb-mounted skylights with step flashing (included in the plan) meet typical glazing requirements; keep them 4″+ above the roof plane.');
  }

  // electrical
  if (ctx.elec.any) {
    if (ctx.elec.outlets > 0) {
      add('pass', 'NEC 210.8(A)', 'GFCI protection',
        'All shed receptacles require GFCI protection — the plan wires a GFCI as the first device in the circuit.');
    }
    add(ctx.elec.panel ? 'pass' : 'fail', 'NEC 225.31-33', 'Disconnect / sub-panel',
      ctx.elec.panel
        ? 'The sub-panel provides the required disconnecting means for a detached structure.'
        : 'Electrical devices need a disconnecting means at the structure — add the sub-panel.');
    add('warn', 'NEC 300.5', 'Underground feeder',
      'The feeder from the house must be buried 24″ deep (direct-burial UF-B) or 18″ in PVC conduit; call 811 before digging. Most jurisdictions require an electrical permit + inspection for this.');
  }

  // cover inspection before drywall
  if (ctx.hasDrywall && (ctx.elec.any || ctx.plumb.any)) {
    add('warn', 'IRC R109.1.2', 'Cover inspection',
      'Drywall covers wiring/plumbing — where permits apply, the rough-in must be inspected and approved before the walls are closed up.');
  }

  // plumbing
  if (ctx.plumb.any) {
    if (ctx.plumb.sinks > 0) {
      add(R.aavOk ? 'pass' : 'warn', 'IPC 917 / UPC', 'Drain venting',
        R.aavOk
          ? 'The air admittance valve (AAV) on the sink drain is an accepted vent method in this region.'
          : 'This region (UPC-based, e.g. much of California) restricts AAVs — plan a conventional vent through the roof or get specific approval.');
      add('warn', 'IPC 701 / local', 'Drain termination',
        'The sink drain must tie to an approved sewer, septic, or in some areas a permitted gray-water/dry-well system — never to grade. This almost always needs a plumbing permit.');
    }
    if (R.frost > 0) {
      add('warn', 'IPC 305.4', 'Pipe freeze protection',
        `Frost depth ~${R.frost}″: bury the supply line below frost depth and use a frost-free sillcock; add a drain-down valve if the shed is unheated.`);
    }
  }

  // setbacks — can't be measured from the model
  add('info', 'Zoning (typ.)', 'Property-line setback',
    `Accessory structures here typically need ~${R.setback}′ from side/rear property lines (more from the street). Measure before you set the skids.`);

  return { region: R, findings: F };
}
