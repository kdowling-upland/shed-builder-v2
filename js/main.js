// main.js — application shell: tool state, undo, persistence, UI wiring.
import {
  emptyState, demoShed, serialize, deserialize, DIR_NAMES, bounds,
  placeFloor, placeWall, placeRoof, placeFixture,
  removeFloor, removeWall, removeRoof, removeFixture,
  collapseUnsupported, computeSupport,
} from './store.js';
import { PALETTE, WALL_PIECES, ROOF_KINDS, FIXTURES } from './catalog.js';
import { REGIONS } from './codes.js';
import { buildReport, money } from './engine.js';
import { renderReport } from './report.js';
import { Editor3D } from './editor3d.js';
import { Editor2D } from './editor2d.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.state = deserialize(localStorage.getItem('shedforge') || '');
    if (!Object.keys(this.state.floors).length) this.state = demoShed();
    this.tool = null;
    this.roofDir = 0;
    this.stressView = false;
    this.layers2d = { structure: true, elec: true, plumb: true };
    this.undoStack = [];
    this.report = null;

    this.ed3d = new Editor3D($('vp3d'), this);
    this.ed2d = new Editor2D($('vp2d'), this);

    this.buildPalette();
    this.buildRegionSelect();
    this.wireUI();
    this.refresh();

    window.addEventListener('resize', () => { this.ed3d.resize(); this.ed2d.resize(); });
    this.ed2d.resize();
  }

  // ---------- palette & tools ----------
  buildPalette() {
    const list = $('palette-list');
    for (const grp of PALETTE) {
      const h = document.createElement('div');
      h.className = 'palette-group';
      h.textContent = grp.group;
      list.appendChild(h);
      for (const p of grp.items) {
        const b = document.createElement('button');
        b.className = 'piece-btn';
        b.dataset.tool = p.id;
        b.innerHTML = `<span class="pi">${p.icon}</span><span><span class="pn">${p.name}</span><span class="pd">${p.desc}</span></span>${p.key ? `<span class="pk">${p.key}</span>` : ''}`;
        b.addEventListener('click', () => this.setTool(this.tool === p.id ? null : p.id));
        list.appendChild(b);
      }
    }
  }

  toolName(t) {
    for (const grp of PALETTE) {
      const p = grp.items.find(x => x.id === t);
      if (p) return p.name;
    }
    return t;
  }

  setTool(t) {
    this.tool = t;
    document.querySelectorAll('.piece-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === t));
    const isRoof = t && t.startsWith('roof:');
    $('status-tool').textContent = t
      ? `${this.toolName(t)} — click or drag to place, right-click removes${isRoof ? `, R rotates (slope up: ${DIR_NAMES[this.roofDir]})` : ''}`
      : 'No piece selected — drag to orbit';
    $('hint3d').textContent = t ? `placing: ${this.toolName(t)}` : 'drag to orbit · wheel zooms';
    this.ed3d.setToolMode(!!t);
    if (!t) { this.ed3d.hover = null; this.ed3d.updateGhost(); this.ed2d.hover = null; this.ed2d.draw(); }
  }

  // ---------- placement from either editor ----------
  applyCandidate(c) {
    if (!c || (!c.ok && c.kind !== 'erase')) return;
    this.pushUndo();
    let changed = false;
    if (c.kind === 'floor') changed = placeFloor(this.state, c.i, c.j);
    else if (c.kind === 'wall') changed = placeWall(this.state, c.edge, c.type);
    else if (c.kind === 'roof') changed = placeRoof(this.state, c.i, c.j, c.t, c.dir, c.rk);
    else if (c.kind === 'fixture') changed = placeFixture(this.state, c.fixture);
    else if (c.kind === 'erase') changed = this.removeRef(c.target);
    if (!changed) { this.undoStack.pop(); return; }
    // structural check: anything that lost its support breaks off and falls
    const dead = collapseUnsupported(this.state);
    if (dead.length) this.ed3d.collapse(dead);
    this.refresh();
  }

  removeRef(target) {
    const r = target.ref;
    if (target.kind === 'floor') return removeFloor(this.state, r.i, r.j);
    if (target.kind === 'wall') return removeWall(this.state, r);
    if (target.kind === 'roof') return removeRoof(this.state, r.i, r.j, r.t);
    if (target.kind === 'fixture') return removeFixture(this.state, target.key);
    return false;
  }

  onHover(c) {
    const el = $('sel-info');
    if (!c) {
      el.textContent = this.tool ? 'Hover a viewport to preview placement.' : 'Pick a piece from the palette, then hover a viewport.';
      return;
    }
    if (c.kind === 'floor') el.textContent = `Floor module at cell (${c.i}, ${c.j}) — ${c.ok ? 'valid: snaps to the grid beside existing floor' : 'invalid: must touch an existing floor'}`;
    else if (c.kind === 'wall') el.textContent = `${WALL_PIECES[c.type].name} on ${c.edge.o === 'H' ? 'east–west' : 'north–south'} edge (${c.edge.i}, ${c.edge.j}) — ${c.ok ? 'valid: snaps to floor edge' : 'invalid: needs a floor beside it'}`;
    else if (c.kind === 'roof') el.textContent = `${ROOF_KINDS[c.rk].name} at (${c.i}, ${c.j}), tier ${c.t}, sloping up ${DIR_NAMES[c.dir]} — ${c.ok ? 'valid: supported' : 'invalid: needs a wall below its low edge or an adjacent panel'}`;
    else if (c.kind === 'fixture') el.textContent = `${FIXTURES[c.fixture.kind].name} — ${c.ok ? 'valid spot' : 'invalid: needs a ' + (FIXTURES[c.fixture.kind].host === 'wall' ? 'plain wall panel here' : FIXTURES[c.fixture.kind].host === 'roof' ? 'sloped roof panel here' : 'floor module here')}`;
    else if (c.kind === 'erase') el.textContent = `Remove ${c.target.kind === 'fixture' ? FIXTURES[c.target.ref.kind].name : c.target.kind}`;
    $('status-pos').textContent = c.i !== undefined ? `cell ${c.i}, ${c.j}` : '';
  }

  // ---------- undo / persistence ----------
  pushUndo() {
    this.undoStack.push(serialize(this.state));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }
  undo() {
    const s = this.undoStack.pop();
    if (s) { this.state = deserialize(s); this.refresh(); }
  }

  refresh() {
    localStorage.setItem('shedforge', serialize(this.state));
    $('save-state').textContent = 'saved';
    this.ed3d.rebuild(this.state, this.stressView ? computeSupport(this.state) : null);
    this.ed2d.draw();
    this.updateStats();
  }

  opts() {
    return {
      taxRate: parseFloat($('opt-tax').value) || 0,
      wastePct: parseFloat($('opt-waste').value) || 0,
      region: $('opt-region').value || 'irc',
    };
  }

  updateStats() {
    const r = buildReport(this.state, this.opts());
    const b = bounds(this.state);
    $('st-area').textContent = r.ok ? `${r.stats.area} ft²` : '—';
    $('st-bbox').textContent = b && r.ok ? `${b.w}′ × ${b.d}′ · ${r.stats.heightFt.toFixed(0)}′ peak` : '—';
    $('st-walls').textContent = r.ok ? r.stats.wallPanels : '—';
    $('st-roof').textContent = r.ok ? r.stats.roofPanels : '—';
    $('st-open').textContent = r.ok ? `${r.stats.doors} / ${r.stats.windows}` : '—';
    $('st-sys').textContent = r.ok ? `${r.stats.elecDevices} dev / ${r.stats.plumbFixtures} fix` : '—';
    $('st-cost').textContent = r.ok ? money(r.cost.total) : '—';
    $('st-time').textContent = r.ok ? `≈ ${(r.minutes / 60).toFixed(1)} h` : '—';
    const wb = $('warn-box'), wl = $('warn-list');
    const warns = r.warnings || [];
    wb.hidden = !warns.length;
    wl.innerHTML = warns.map(w => `<li>${w}</li>`).join('');
  }

  // ---------- report ----------
  openReport() {
    this.report = buildReport(this.state, this.opts());
    $('report-overlay').hidden = false;
    this.showTab('summary');
  }
  showTab(tab) {
    document.querySelectorAll('.rtab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('report-body').innerHTML = renderReport(this.report, tab);
    $('report-body').scrollTop = 0;
  }

  buildRegionSelect() {
    const sel = $('opt-region');
    for (const [id, r] of Object.entries(REGIONS)) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = r.name;
      sel.appendChild(o);
    }
  }

  // ---------- UI wiring ----------
  wireUI() {
    $('btn-new').addEventListener('click', () => {
      if (!confirm('Clear the whole build?')) return;
      this.pushUndo();
      this.state = emptyState();
      this.refresh();
    });
    $('btn-demo').addEventListener('click', () => { this.pushUndo(); this.state = demoShed(); this.refresh(); });
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-report').addEventListener('click', () => this.openReport());
    $('btn-close-report').addEventListener('click', () => { $('report-overlay').hidden = true; });
    $('btn-print').addEventListener('click', () => window.print());
    $('report-overlay').addEventListener('click', e => {
      if (e.target.id === 'report-overlay') $('report-overlay').hidden = true;
    });
    document.querySelectorAll('.rtab').forEach(b =>
      b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    for (const id of ['opt-tax', 'opt-waste', 'opt-region']) {
      $(id).addEventListener('change', () => this.updateStats());
    }
    $('opt-stress').addEventListener('change', e => {
      this.stressView = e.target.checked;
      this.refresh();
    });
    for (const [id, key] of [['layer-structure', 'structure'], ['layer-elec', 'elec'], ['layer-plumb', 'plumb']]) {
      $(id).addEventListener('change', e => { this.layers2d[key] = e.target.checked; this.ed2d.draw(); });
    }
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Escape') {
        if (!$('report-overlay').hidden) { $('report-overlay').hidden = true; return; }
        this.setTool(null);
      }
      if (e.key.toLowerCase() === 'r' && this.tool && this.tool.startsWith('roof:')) {
        this.roofDir = (this.roofDir + 1) % 4;
        this.setTool(this.tool);
      }
      if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.undo(); }
      for (const grp of PALETTE) {
        const piece = grp.items.find(p => p.key === e.key);
        if (piece) this.setTool(piece.id);
      }
    });
  }
}

new App();
