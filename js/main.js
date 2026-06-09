// main.js — application shell: tool state, undo, persistence, UI wiring.
import {
  emptyState, demoShed, serialize, deserialize, DIR_NAMES, bounds,
  placeFloor, placeWall, placeRoof, placeFixture, toggleDrywall, placeDiag,
  removeFloor, removeWall, removeRoof, removeFixture,
  collapseUnsupported, computeSupport,
} from './store.js';
import { PALETTE, WALL_PIECES, ROOF_KINDS, FIXTURES } from './catalog.js';
import { REGIONS } from './codes.js';
import { buildReport, money } from './engine.js';
import { electricalDesign, plumbingDesign } from './systems.js';
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
  // One button per piece; pieces with variants get a ▾ flyout to swap the
  // active type (e.g. Window ▾ → single-hung / slider / transom).
  buildPalette() {
    const list = $('palette-list');
    this.current = {};                       // item.id (base) → active variant tool id
    for (const p of PALETTE) {
      this.current[p.id] = p.id;
      const row = document.createElement('div');
      row.className = 'piece-row';
      const b = document.createElement('button');
      b.className = 'piece-btn';
      b.dataset.item = p.id;
      const variantName = () => {
        const v = p.variants?.find(v => v.id === this.current[p.id]);
        return v ? v.name : null;
      };
      const render = () => {
        b.innerHTML = `<span class="pi">${p.icon}</span><span><span class="pn">${p.name}</span><span class="pd">${variantName() || p.desc}</span></span>${p.key ? `<span class="pk">${p.key}</span>` : ''}`;
      };
      render();
      b.addEventListener('click', () => {
        const t = this.current[p.id];
        this.setTool(this.tool === t ? null : t);
      });
      row.appendChild(b);
      if (p.variants) {
        const arrow = document.createElement('button');
        arrow.className = 'variant-arrow';
        arrow.textContent = '▾';
        arrow.title = `Choose a ${p.name.toLowerCase()} type`;
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeVariantMenu();
          const menu = document.createElement('div');
          menu.className = 'variant-menu';
          for (const v of p.variants) {
            const vb = document.createElement('button');
            vb.className = 'variant-opt' + (this.current[p.id] === v.id ? ' active' : '');
            vb.innerHTML = `<b>${v.name}</b><span>${v.desc}</span>`;
            vb.addEventListener('click', () => {
              this.current[p.id] = v.id;
              render();
              this.closeVariantMenu();
              this.setTool(v.id);
            });
            menu.appendChild(vb);
          }
          row.appendChild(menu);
          this.variantMenu = menu;
        });
        row.appendChild(arrow);
      }
      list.appendChild(row);
    }
    document.addEventListener('pointerdown', (e) => {
      if (this.variantMenu && !e.target.closest('.variant-menu') && !e.target.closest('.variant-arrow')) {
        this.closeVariantMenu();
      }
    });
  }

  closeVariantMenu() {
    this.variantMenu?.remove();
    this.variantMenu = null;
  }

  toolName(t) {
    for (const p of PALETTE) {
      if (p.id === t) return p.name;
      const v = p.variants?.find(v => v.id === t);
      if (v) return v.name;
    }
    return t;
  }

  setTool(t) {
    this.tool = t;
    document.querySelectorAll('.piece-btn').forEach(b => {
      const base = b.dataset.item;
      b.classList.toggle('active', !!t && this.current[base] === t &&
        (base === t || PALETTE.find(p => p.id === base)?.variants?.some(v => v.id === t)));
    });
    const rotates = t && (t.startsWith('roof:') || t === 'wallDiag');
    $('status-tool').textContent = t
      ? `${this.toolName(t)} — click or drag to place, right-click removes${rotates ? `, R rotates (${t === 'wallDiag' ? 'corner' : 'slope up: ' + DIR_NAMES[this.roofDir]})` : ''}`
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
    else if (c.kind === 'diag') changed = placeDiag(this.state, c.i, c.j, c.k);
    else if (c.kind === 'drywall') changed = toggleDrywall(this.state, c.edge);
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
    if (!c) { el.textContent = ''; return; }
    if (c.kind === 'floor') el.textContent = c.ok ? '· valid spot' : '· must touch an existing floor';
    else if (c.kind === 'wall') el.textContent = c.ok ? `· ${WALL_PIECES[c.type].name} snaps here` : '· needs a floor beside it';
    else if (c.kind === 'roof') el.textContent = c.ok ? `· tier ${c.t}, sloping up ${DIR_NAMES[c.dir]}` : '· needs a wall below its low edge or an adjacent panel';
    else if (c.kind === 'fixture') el.textContent = c.ok ? `· ${FIXTURES[c.fixture.kind].name} fits here` : `· needs a ${FIXTURES[c.fixture.kind].host === 'wall' ? 'plain wall panel' : FIXTURES[c.fixture.kind].host === 'roof' ? 'sloped roof panel' : 'floor module'}`;
    else if (c.kind === 'diag') el.textContent = c.ok ? '· chamfers this corner (R rotates)' : '· needs a floor cell without a diagonal';
    else if (c.kind === 'drywall') el.textContent = c.ok ? (c.on ? '· click to remove drywall' : '· click to add drywall') : '· click a wall';
    else if (c.kind === 'erase') el.textContent = `· remove ${c.target.kind === 'fixture' ? FIXTURES[c.target.ref.kind].name : c.target.kind}`;
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
    // cache the system routing once per state change; both viewports read it
    this.designs = {
      elec: electricalDesign(this.state),
      plumb: plumbingDesign(this.state),
    };
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
    $('btn-demo').addEventListener('click', () => { this.pushUndo(); this.state = demoShed(); this.refresh(); this.ed2d.fit(); });
    $('btn-fit2d').addEventListener('click', () => this.ed2d.fit());
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
      $(id).addEventListener('change', e => {
        this.layers2d[key] = e.target.checked;
        this.ed2d.draw();
        this.ed3d.buildSystems3D(this.state); // wires/pipes share the layer toggles
      });
    }
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Escape') {
        if (!$('report-overlay').hidden) { $('report-overlay').hidden = true; return; }
        this.setTool(null);
      }
      if (e.key.toLowerCase() === 'r' && this.tool && (this.tool.startsWith('roof:') || this.tool === 'wallDiag')) {
        this.roofDir = (this.roofDir + 1) % 4;
        this.setTool(this.tool);
      }
      if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.undo(); }
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) this.ed2d.fit();
      const piece = PALETTE.find(p => p.key === e.key);
      if (piece) this.setTool(this.current[piece.id]);
    });
  }
}

window.__app = new App(); // console/debug handle
