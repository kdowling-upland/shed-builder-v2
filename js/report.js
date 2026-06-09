// report.js — renders the engine output into the report overlay tabs.
import { money, ftIn } from './engine.js';

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function renderReport(r, tab) {
  if (!r.ok) {
    return `<div class="warnbox"><b>Cannot generate report.</b><br>${r.warnings.map(esc).join('<br>')}</div>`;
  }
  switch (tab) {
    case 'summary': return summary(r);
    case 'supply': return supply(r);
    case 'cost': return cost(r);
    case 'cuts': return cuts(r);
    case 'guide': return guide(r);
    case 'code': return codeCheck(r);
  }
}

function codeCheck(r) {
  const { region, findings } = r.code;
  const icon = { pass: '✔', warn: '⚠', fail: '✖', info: 'ℹ' };
  const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const f of findings) counts[f.level]++;
  let html = `<h1>Building Code Check — ${esc(region.name)}</h1>
  <p><span class="code-pass">${counts.pass} pass</span> ·
     <span class="code-warn">${counts.warn} caution</span> ·
     <span class="code-fail">${counts.fail} needs change</span> ·
     <span class="code-info">${counts.info} info</span></p>
  <div class="warnbox">This comparison uses IRC/NEC/IPC model-code rules with typical
  regional amendments. It is planning guidance only — your city or county
  (the AHJ) has the final say. Verify permit thresholds, setbacks and any
  electrical/plumbing permits before building.</div>
  <table>
    <tr><th></th><th>Check</th><th>Code ref</th><th>Finding</th></tr>
    ${findings.map(f => `<tr>
      <td class="code-${f.level}">${icon[f.level]}</td>
      <td><b>${esc(f.title)}</b></td>
      <td>${esc(f.code)}</td>
      <td>${esc(f.text)}</td></tr>`).join('')}
  </table>
  <h2>Region profile used</h2>
  <table>
    <tr><th>Parameter</th><th class="num">Value</th></tr>
    <tr><td>Typical permit-exempt shed size</td><td class="num">${region.permitMaxSqft} sq ft</td></tr>
    <tr><td>Typical accessory height limit</td><td class="num">${region.maxHeight}′</td></tr>
    <tr><td>Ground snow load</td><td class="num">${region.snow} psf</td></tr>
    <tr><td>Design wind speed</td><td class="num">${region.wind} mph</td></tr>
    <tr><td>Frost depth</td><td class="num">${region.frost}″</td></tr>
    <tr><td>Typical side/rear setback</td><td class="num">${region.setback}′</td></tr>
  </table>`;
  return html;
}

function warnings(r) {
  if (!r.warnings.length) return '';
  return `<div class="warnbox"><b>⚠ Design warnings</b><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
}

function summary(r) {
  const s = r.stats;
  const hours = (r.minutes / 60).toFixed(1);
  return `
  <h1>Shed Build Report</h1>
  <p class="muted">Generated ${new Date().toLocaleDateString()} · ${s.bboxW}′ × ${s.bboxD}′ footprint · all prices are typical retail estimates</p>
  ${warnings(r)}
  <div class="summary-cards">
    <div class="card"><div class="cv">${s.area} ft²</div><div class="cl">floor area</div></div>
    <div class="card"><div class="cv">${money(r.cost.total)}</div><div class="cl">total materials</div></div>
    <div class="card"><div class="cv">${money(r.cost.perSqft)}</div><div class="cl">per sq ft</div></div>
    <div class="card"><div class="cv">≈ ${hours} h</div><div class="cl">build time (2 people)</div></div>
    <div class="card"><div class="cv">${s.nailGrand.toLocaleString()}</div><div class="cl">nails, counted</div></div>
    <div class="card"><div class="cv">${r.phases.reduce((n, p) => n + p.steps.length, 0)}</div><div class="cl">build steps</div></div>
  </div>
  <h2>What's in this report</h2>
  <ul>
    <li><b>Supply List</b> — every board, sheet, bundle and box to buy, with prices.</li>
    <li><b>Cost Breakdown</b> — itemized by build phase with subtotal, tax and total.</li>
    <li><b>Cut List</b> — every cut, optimized onto stock lengths (first-fit-decreasing) to minimize waste.</li>
    <li><b>Step-by-Step Guide</b> — ${r.phases.length} phases in the most efficient order, with every cut and every nail counted per step.</li>
    <li><b>Code Check</b> — your design compared against ${esc(r.code.region.name)} building-code rules (${r.code.findings.length} checks).</li>
  </ul>
  <h2>Structure</h2>
  <table>
    <tr><th>Element</th><th class="num">Count</th></tr>
    <tr><td>Floor modules (4′×4′ on treated skids)</td><td class="num">${s.area / 16}</td></tr>
    <tr><td>Wall panels (2×4 @ 16″ o.c., 8′ tall)</td><td class="num">${s.wallPanels}</td></tr>
    <tr><td>Roof panels (45° / 12-12 pitch)</td><td class="num">${s.roofPanels}</td></tr>
    <tr><td>Corners</td><td class="num">${s.corners}</td></tr>
    <tr><td>Doors</td><td class="num">${s.doors}</td></tr>
    <tr><td>Windows</td><td class="num">${s.windows}</td></tr>
    <tr><td>Vents / skylights</td><td class="num">${s.vents} / ${s.skylights}</td></tr>
    <tr><td>Electrical devices</td><td class="num">${s.elecDevices}</td></tr>
    <tr><td>Plumbing fixtures</td><td class="num">${s.plumbFixtures}</td></tr>
    <tr><td>Peak height above grade</td><td class="num">${s.heightFt.toFixed(1)}′</td></tr>
    <tr><td>Shingled roof area</td><td class="num">${(s.roofSquares * 100).toFixed(0)} ft²</td></tr>
    ${s.epdmArea ? `<tr><td>EPDM flat-roof area</td><td class="num">${s.epdmArea} ft²</td></tr>` : ''}
  </table>`;
}

function supply(r) {
  let html = `<h1>Supply List</h1>${warnings(r)}`;
  for (const c of r.categories) {
    html += `<h2>${esc(c.name)}</h2><table>
      <tr><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Total</th></tr>`;
    for (const it of c.items) {
      html += `<tr><td>${esc(it.desc)}${it.note ? `<br><span class="muted">${esc(it.note)}</span>` : ''}</td>
        <td class="num">${it.qty}</td><td>${esc(it.unit)}</td>
        <td class="num">${money(it.price)}</td><td class="num">${money(it.total)}</td></tr>`;
    }
    html += `<tr class="total"><td colspan="4">${esc(c.name)} subtotal</td><td class="num">${money(c.total)}</td></tr></table>`;
  }
  html += `<h2>Nail schedule (exact counts)</h2><table>
    <tr><th>Nail</th><th class="num">Count used in guide</th></tr>
    ${r.nails.map(n => `<tr><td>${esc(n.desc)}</td><td class="num">${n.count.toLocaleString()}</td></tr>`).join('')}
    <tr class="total"><td>Total nails driven</td><td class="num">${r.stats.nailGrand.toLocaleString()}</td></tr>
  </table>
  <p class="muted">Purchase quantities above include spare percentage from your waste-factor setting.</p>`;
  return html;
}

function cost(r) {
  let html = `<h1>Cost Breakdown</h1>
  <table><tr><th>Phase / category</th><th class="num">Items</th><th class="num">Cost</th><th class="num">Share</th></tr>`;
  for (const c of r.categories) {
    html += `<tr><td>${esc(c.name)}</td><td class="num">${c.items.length}</td>
      <td class="num">${money(c.total)}</td>
      <td class="num">${(c.total / r.cost.subtotal * 100).toFixed(1)}%</td></tr>`;
  }
  html += `<tr class="total"><td colspan="2">Materials subtotal</td><td class="num">${money(r.cost.subtotal)}</td><td></td></tr>
    <tr><td colspan="2">Sales tax (${r.cost.taxRate.toFixed(1)}%)</td><td class="num">${money(r.cost.tax)}</td><td></td></tr>
    <tr class="total"><td colspan="2">Estimated total</td><td class="num">${money(r.cost.total)}</td><td></td></tr>
  </table>
  <p><b>${money(r.cost.perSqft)} per square foot</b> of floor area (${r.stats.area} ft²).</p>
  <h2>Detail by item</h2>`;
  for (const c of r.categories) {
    html += `<h3>${esc(c.name)} — ${money(c.total)}</h3><table>
      <tr><th>Item</th><th class="num">Qty × unit price</th><th class="num">Total</th></tr>
      ${c.items.map(it => `<tr><td>${esc(it.desc)}</td>
        <td class="num">${it.qty} × ${money(it.price)}</td>
        <td class="num">${money(it.total)}</td></tr>`).join('')}
    </table>`;
  }
  return html;
}

function cuts(r) {
  let html = `<h1>Cut List</h1>
  <p>Cuts are packed onto purchasable stock lengths with a first-fit-decreasing
  optimizer so you buy the fewest boards and waste the least wood. Each row below
  is <b>one physical board</b> and the exact pieces to cut from it.</p>`;
  for (const plan of r.cutPlans) {
    html += `<h2>${esc(plan.title)}</h2><table>
      <tr><th>#</th><th>Buy</th><th>Cut into</th><th class="num">Offcut</th></tr>`;
    plan.pack.bins.forEach((b, idx) => {
      html += `<tr><td>${idx + 1}</td><td>${b.stockLen}′ board</td>
        <td>${b.pieces.map(p => `${esc(p.label)} — <b>${ftIn(p.len)}</b>`).join('<br>')}</td>
        <td class="num">${b.waste > 0.05 ? ftIn(b.waste) : '—'}</td></tr>`;
    });
    html += `</table>`;
  }
  html += `<p class="muted">Wall studs are bought as 92-5/8″ precuts and need no cutting.
  Sheet goods cuts are listed inline in the build guide where they happen.</p>`;
  return html;
}

function guide(r) {
  let html = `<h1>Step-by-Step Build Guide</h1>
  <p>Steps are ordered for the most efficient build: batch all cuts per phase,
  frame walls flat on the deck, raise long walls first, sheath before standing
  where possible. Time assumes two people with basic tools.</p>${warnings(r)}`;
  let n = 0;
  for (const ph of r.phases) {
    if (!ph.steps.length) continue;
    html += `<h2 class="phase-h">${esc(ph.name)}</h2>`;
    for (const st of ph.steps) {
      n++;
      html += `<div class="step">
        <span class="stime">≈ ${st.minutes || '–'} min</span>
        <h4>Step ${n} — ${esc(st.title)}</h4>
        <ul>${(st.detail || []).map(d => `<li>${esc(d)}</li>`).join('')}</ul>`;
      if (st.cuts?.length) {
        html += `<div><span class="tag">CUTS</span>${st.cuts.map(esc).join(' · ')}</div>`;
      }
      if (st.nails?.length) {
        html += `<div><span class="tag">NAILS</span>${st.nails.map(esc).join(' · ')}</div>`;
      }
      if (st.tools?.length) {
        html += `<div><span class="tag">TOOLS</span><span class="muted">${st.tools.map(esc).join(', ')}</span></div>`;
      }
      html += `</div>`;
    }
  }
  html += `<h2>Totals</h2><p><b>${n} steps · ≈ ${(r.minutes / 60).toFixed(1)} hours · ${r.stats.nailGrand.toLocaleString()} nails · ${money(r.cost.total)} in materials.</b></p>`;
  return html;
}
