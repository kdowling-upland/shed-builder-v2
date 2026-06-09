// editor2d.js — top-down plan view: structure, electrical and plumbing
// layers with standard plan symbols. Fully interactive (same tools as 3D).
import { CELL, DIRS, edgeSegment, wallKey, bounds, diagSegment } from './store.js';
import { WALL_PIECES, FIXTURES } from './catalog.js';
import { candidateAt, candidateSlot, eraseTargetAt } from './picker.js';
import { electricalDesign, plumbingDesign, fixturePos } from './systems.js';

export class Editor2D {
  constructor(canvas, app) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 16;
    this.origin = { x: 0, y: 0 };
    this.hover = null;
    this.panning = null;
    this.painting = false;
    this.erasing = false;
    this.lastSlot = null;
    this.centered = false;

    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointerup', () => {
      this.panning = null; this.painting = this.erasing = false; this.lastSlot = null;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      this.origin.x = mx - (mx - this.origin.x) * k;
      this.origin.y = my - (my - this.origin.y) * k;
      this.scale *= k;
      this.draw();
    }, { passive: false });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    if (!this.centered) { this.fit(); return; }
    this.draw();
  }

  // center & zoom the view on the structure (or origin if empty)
  fit() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const b = bounds(this.app.state);
    if (!b) {
      this.scale = 16;
      this.origin = { x: r.width / 2, y: r.height / 2 };
    } else {
      const pad = 60;
      this.scale = Math.min(
        (r.width - pad) / Math.max(b.w, CELL),
        (r.height - pad) / Math.max(b.d, CELL), 40);
      this.scale = Math.max(this.scale, 3);
      const cx = (b.i0 * CELL + b.w / 2), cz = (b.j0 * CELL + b.d / 2);
      this.origin = { x: r.width / 2 - cx * this.scale, y: r.height / 2 - cz * this.scale };
    }
    this.centered = true;
    this.draw();
  }

  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.origin.x) / this.scale,
      z: (e.clientY - r.top - this.origin.y) / this.scale,
    };
  }
  px(x, z) { return [this.origin.x + x * this.scale, this.origin.y + z * this.scale]; }

  candidate(w) {
    return candidateAt(this.app.state, this.app.tool, w.x, w.z, this.app.roofDir);
  }

  onDown(e) {
    if (e.button === 1) { this.panning = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
    const w = this.toWorld(e);
    if (e.button === 2) {
      this.erasing = true;
      const t = eraseTargetAt(this.app.state, w.x, w.z);
      if (t) { this.app.applyCandidate(t); this.lastSlot = candidateSlot(t); }
      return;
    }
    if (e.button === 0 && this.app.tool) {
      if (this.app.tool === 'erase') {
        this.erasing = true;
        const t = eraseTargetAt(this.app.state, w.x, w.z);
        if (t) { this.app.applyCandidate(t); this.lastSlot = candidateSlot(t); }
        return;
      }
      this.painting = true;
      const c = this.candidate(w);
      if (c) { this.app.applyCandidate(c); this.lastSlot = candidateSlot(c); }
    }
  }

  // coalesce hover/pan redraws to one per animation frame
  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
  }

  onMove(e) {
    if (this.panning) {
      this.origin.x += e.clientX - this.panning.x;
      this.origin.y += e.clientY - this.panning.y;
      this.panning = { x: e.clientX, y: e.clientY };
      this.requestDraw();
      return;
    }
    const w = this.toWorld(e);
    if (this.erasing) {
      const t = eraseTargetAt(this.app.state, w.x, w.z);
      const slot = candidateSlot(t);
      if (t && slot !== this.lastSlot) { this.app.applyCandidate(t); this.lastSlot = slot; }
      return;
    }
    this.hover = this.app.tool ? this.candidate(w) : null;
    this.app.onHover(this.hover);
    if (this.painting && this.hover && this.hover.ok) {
      const slot = candidateSlot(this.hover);
      if (slot !== this.lastSlot) { this.app.applyCandidate(this.hover); this.lastSlot = slot; }
    }
    this.requestDraw();
  }

  // ---------- drawing ----------
  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#20242b';
    ctx.fillRect(0, 0, W, H);

    const s = this.scale * CELL;
    const x0 = ((this.origin.x % s) + s) % s, y0 = ((this.origin.y % s) + s) % s;
    ctx.strokeStyle = '#2e3540';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = y0; y < H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = '#3c4656';
    ctx.beginPath();
    ctx.moveTo(this.origin.x, 0); ctx.lineTo(this.origin.x, H);
    ctx.moveTo(0, this.origin.y); ctx.lineTo(W, this.origin.y);
    ctx.stroke();

    const state = this.app.state;
    const layers = this.app.layers2d;

    if (layers.structure) {
      for (const f of Object.values(state.floors)) {
        const [px, py] = this.px(f.i * CELL, f.j * CELL);
        ctx.fillStyle = '#6e5a3d';
        ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
      }
      for (const r of Object.values(state.roofs)) {
        const [px, py] = this.px(r.i * CELL, r.j * CELL);
        ctx.fillStyle = r.kind === 'flat' ? 'rgba(70,72,80,0.6)' : 'rgba(120,135,155,0.55)';
        ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
        if (r.kind !== 'flat') this.arrow(px + s / 2, py + s / 2, r.dir, s * 0.3);
        ctx.fillStyle = '#dfe6ef';
        ctx.font = '10px sans-serif';
        ctx.fillText(`t${r.t}${r.kind === 'r22' ? '·22°' : r.kind === 'flat' ? '·flat' : ''}`, px + 4, py + 12);
      }
      for (const w of Object.values(state.walls)) {
        if (w.o === 'D') {
          this.lineSeg(diagSegment(w), '#e8dcc0', 5);
          if (w.drywall) this.lineSeg(diagSegment(w), '#fdfaf2', 1.5);
          continue;
        }
        const cls = (WALL_PIECES[w.type] || WALL_PIECES.solid).cls;
        if (cls === 'porch') {
          const ctx2 = this.ctx;
          ctx2.setLineDash([5, 4]);
          this.wallLine(w, '#caa86f', w.type === 'railing' ? 4 : 2.5);
          ctx2.setLineDash([]);
          // post squares at the bay ends
          const [ax, az, bx, bz] = edgeSegment(w);
          for (const [px2, pz2] of [[ax, az], [bx, bz]]) {
            const [cx2, cy2] = this.px(px2, pz2);
            ctx2.fillStyle = '#caa86f';
            ctx2.fillRect(cx2 - 3, cy2 - 3, 6, 6);
          }
          continue;
        }
        const col = cls === 'door' ? '#c98a3d' : cls === 'window' ? '#79c4e0'
          : cls === 'vent' ? '#9b86c9' : '#e8dcc0';
        this.wallLine(w, col, 5);
        if (w.drywall) this.wallLine(w, '#fdfaf2', 1.5);
      }
    }

    // routing is cached per state change in the app (recomputing it on
    // every hover redraw was the main CPU cost of the plan view)
    if (layers.elec) this.drawSystem(this.app.designs?.elec || electricalDesign(state), '#ffd34d', '#ffb04d');
    if (layers.plumb) this.drawSystem(this.app.designs?.plumb || plumbingDesign(state), '#5db4ff', '#6fe0c8');

    // fixtures symbols
    for (const f of Object.values(state.fixtures)) {
      const spec = FIXTURES[f.kind];
      if (spec.sys === 'elec' && !layers.elec) continue;
      if (spec.sys === 'plumb' && !layers.plumb) continue;
      if (spec.sys === 'roof' && !layers.structure) continue;
      const pos = fixturePos(f);
      const [px, py] = this.px(pos.x, pos.z);
      const col = spec.sys === 'elec' ? '#ffd34d' : spec.sys === 'plumb' ? '#5db4ff' : '#dfe6ef';
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spec.sym, px, py + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // hover ghost
    const h = this.hover;
    if (h && h.kind !== 'erase') {
      const col = h.ok ? 'rgba(74,214,109,0.8)' : 'rgba(224,85,85,0.8)';
      if (h.kind === 'floor' || h.kind === 'roof') {
        const [px, py] = this.px(h.i * CELL, h.j * CELL);
        ctx.fillStyle = col.replace('0.8', '0.35');
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, s, s);
        if (h.kind === 'roof') this.arrow(px + s / 2, py + s / 2, h.dir, s * 0.3, col);
      } else if (h.kind === 'wall' || h.kind === 'drywall') {
        this.wallLine({ ...h.edge }, col, 6);
      } else if (h.kind === 'diag') {
        this.lineSeg(diagSegment({ i: h.i, j: h.j, k: h.k }), col, 6);
      } else if (h.kind === 'fixture' && h.fixture) {
        const pos = fixturePos(h.fixture);
        const [px, py] = this.px(pos.x, pos.z);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (h && h.kind === 'erase' && h.target.ref) {
      const ref = h.target.ref;
      if (h.target.kind === 'wall' && ref.o === 'D') this.lineSeg(diagSegment(ref), 'rgba(224,85,85,0.9)', 7);
      else if (h.target.kind === 'wall') this.wallLine(ref, 'rgba(224,85,85,0.9)', 7);
      else if (h.target.kind === 'fixture') {
        const pos = fixturePos(ref);
        const [px, py] = this.px(pos.x, pos.z);
        ctx.strokeStyle = 'rgba(224,85,85,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.stroke();
      } else {
        const [px, py] = this.px(ref.i * CELL, ref.j * CELL);
        ctx.strokeStyle = 'rgba(224,85,85,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 2, py + 2, s - 4, s - 4);
      }
    }

    ctx.fillStyle = '#9fb0c8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('N ↑', 12, H - 14);
    ctx.fillText(`${CELL}′ grid`, 48, H - 14);
  }

  drawSystem(design, colA, colB) {
    const { ctx } = this;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    for (const r of design.routes) {
      ctx.strokeStyle = r.kind === 'outlet' || r.kind === 'sink' ? colA : colB;
      ctx.beginPath();
      r.path.forEach(([x, z], i) => {
        const [px, py] = this.px(x, z);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (design.entry) {
      const [px, py] = this.px(design.entry.x, design.entry.z);
      ctx.fillStyle = colB;
      ctx.beginPath();
      ctx.moveTo(px, py - 7); ctx.lineTo(px + 6, py + 5); ctx.lineTo(px - 6, py + 5);
      ctx.closePath(); ctx.fill();
      ctx.font = '9px sans-serif';
      ctx.fillText('supply in', px + 8, py + 4);
    }
  }

  wallLine(w, color, width) {
    this.lineSeg(edgeSegment(w), color, width);
  }

  lineSeg([ax, az, bx, bz], color, width) {
    const [x1, y1] = this.px(ax, az), [x2, y2] = this.px(bx, bz);
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  arrow(cx, cy, dir, len, color = '#dfe6ef') {
    const d = DIRS[dir];
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - d.dx * len, cy - d.dz * len);
    ctx.lineTo(cx + d.dx * len, cy + d.dz * len);
    ctx.stroke();
    const hx = cx + d.dx * len, hy = cy + d.dz * len;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - d.dx * 6 - d.dz * 4, hy - d.dz * 6 - d.dx * 4);
    ctx.lineTo(hx - d.dx * 6 + d.dz * 4, hy - d.dz * 6 + d.dx * 4);
    ctx.closePath();
    ctx.fill();
  }
}
