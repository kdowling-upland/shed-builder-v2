// editor2d.js — top-down plan view on a 2D canvas, fully interactive
// (same placement tools as the 3D view, kept in sync).
import {
  CELL, DIRS, edgeForSide, edgeSegment, wallKey, roofKey, floorKey,
  canPlaceFloor, canPlaceWall, bestRoofTier,
} from './store.js';

export class Editor2D {
  constructor(canvas, app) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 16;                  // px per ft
    this.origin = { x: 0, y: 0 };     // canvas px of world (0,0) — set on resize
    this.hover = null;
    this.mouse = null;
    this.panning = null;
    this.centered = false;

    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 1) { this.panning = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
    });
    window.addEventListener('pointerup', () => { this.panning = null; });
    canvas.addEventListener('click', e => this.onClick(e, false));
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.onClick(e, true); });
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
    if (!this.centered) {
      this.origin = { x: r.width / 2 - 6 * this.scale, y: r.height / 2 - 4 * this.scale };
      this.centered = true;
    }
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
    const { app } = this;
    const state = app.state;
    const i = Math.floor(w.x / CELL), j = Math.floor(w.z / CELL);
    const tool = app.tool;
    if (!tool) return null;
    if (tool === 'floor') return { kind: 'floor', i, j, ok: canPlaceFloor(state, i, j) };
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      const lx = w.x - i * CELL, lz = w.z - j * CELL;
      const sides = [
        { d: lz, side: 0 }, { d: CELL - lx, side: 1 },
        { d: CELL - lz, side: 2 }, { d: lx, side: 3 },
      ].sort((a, b) => a.d - b.d);
      const edge = edgeForSide(i, j, sides[0].side);
      return { kind: 'wall', edge, type: tool === 'wall' ? 'solid' : tool, ok: canPlaceWall(state, edge) };
    }
    if (tool === 'roof') {
      const t = bestRoofTier(state, i, j, app.roofDir);
      return { kind: 'roof', i, j, t: Math.max(t, 0), dir: app.roofDir, ok: t >= 0 };
    }
    if (tool === 'erase') return this.eraseTarget(w, i, j);
    return null;
  }

  eraseTarget(w, i, j) {
    const state = this.app.state;
    // wall near an edge?
    const lx = w.x - i * CELL, lz = w.z - j * CELL;
    const sides = [
      { d: lz, side: 0 }, { d: CELL - lx, side: 1 },
      { d: CELL - lz, side: 2 }, { d: lx, side: 3 },
    ].sort((a, b) => a.d - b.d);
    if (sides[0].d < 0.8) {
      const e = edgeForSide(i, j, sides[0].side);
      if (state.walls[wallKey(e.o, e.i, e.j)]) {
        return { kind: 'erase', target: { kind: 'wall', ref: state.walls[wallKey(e.o, e.i, e.j)] }, ok: true };
      }
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

  onMove(e) {
    if (this.panning) {
      this.origin.x += e.clientX - this.panning.x;
      this.origin.y += e.clientY - this.panning.y;
      this.panning = { x: e.clientX, y: e.clientY };
      this.draw();
      return;
    }
    this.mouse = this.toWorld(e);
    this.hover = this.app.tool ? this.candidate(this.mouse) : null;
    this.app.onHover(this.hover);
    this.draw();
  }

  onClick(e, rmb) {
    const w = this.toWorld(e);
    if (rmb) {
      const i = Math.floor(w.x / CELL), j = Math.floor(w.z / CELL);
      const t = this.eraseTarget(w, i, j);
      if (t) this.app.applyCandidate(t);
      return;
    }
    if (!this.app.tool) return;
    const c = this.candidate(w);
    if (c) this.app.applyCandidate(c);
  }

  // ---------- drawing ----------
  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#20242b';
    ctx.fillRect(0, 0, W, H);

    // grid
    const s = this.scale * CELL;
    const x0 = ((this.origin.x % s) + s) % s, y0 = ((this.origin.y % s) + s) % s;
    ctx.strokeStyle = '#2e3540';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = y0; y < H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // axes through world origin
    ctx.strokeStyle = '#3c4656';
    ctx.beginPath();
    ctx.moveTo(this.origin.x, 0); ctx.lineTo(this.origin.x, H);
    ctx.moveTo(0, this.origin.y); ctx.lineTo(W, this.origin.y);
    ctx.stroke();

    const state = this.app.state;
    // floors
    for (const f of Object.values(state.floors)) {
      const [px, py] = this.px(f.i * CELL, f.j * CELL);
      ctx.fillStyle = '#6e5a3d';
      ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    }
    // roofs (over floors, translucent with slope arrow)
    for (const r of Object.values(state.roofs)) {
      const [px, py] = this.px(r.i * CELL, r.j * CELL);
      ctx.fillStyle = 'rgba(120,135,155,0.55)';
      ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
      this.arrow(px + s / 2, py + s / 2, r.dir, s * 0.3);
      ctx.fillStyle = '#dfe6ef';
      ctx.font = '10px sans-serif';
      ctx.fillText(`t${r.t}`, px + 4, py + 12);
    }
    // walls
    for (const w of Object.values(state.walls)) {
      this.wallLine(w, w.type === 'door' ? '#c98a3d' : w.type === 'window' ? '#79c4e0' : '#e8dcc0', 5);
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
      } else if (h.kind === 'wall') {
        this.wallLine({ ...h.edge }, col, 6);
      }
    } else if (h && h.kind === 'erase' && h.target.ref) {
      const ref = h.target.ref;
      if (h.target.kind === 'wall') this.wallLine(ref, 'rgba(224,85,85,0.9)', 7);
      else {
        const [px, py] = this.px(ref.i * CELL, ref.j * CELL);
        ctx.strokeStyle = 'rgba(224,85,85,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 2, py + 2, s - 4, s - 4);
      }
    }

    // compass + scale
    ctx.fillStyle = '#9fb0c8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('N ↑', 12, H - 14);
    ctx.fillText(`${CELL}′ grid`, 48, H - 14);
  }

  wallLine(w, color, width) {
    const [ax, az, bx, bz] = edgeSegment(w);
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
    // arrowhead
    const hx = cx + d.dx * len, hy = cy + d.dz * len;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - d.dx * 6 - d.dz * 4, hy - d.dz * 6 - d.dx * 4);
    ctx.lineTo(hx - d.dx * 6 + d.dz * 4, hy - d.dz * 6 + d.dx * 4);
    ctx.closePath();
    ctx.fill();
  }
}
