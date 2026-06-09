// editor3d.js — three.js scene with Valheim-style ghost-piece placement.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CELL, WALL_H, RISE, DIRS,
  edgeForSide, edgeSegment, roofHeights, gableTriangles, bestRoofTier,
  canPlaceFloor, canPlaceWall,
} from './store.js';

const COL = {
  floor: 0x9a7b4f, wall: 0xcbb287, door: 0x7a5230, window: 0x9fc4d8,
  roof: 0x6e7b8c, gable: 0xbfa878, ghostOk: 0x4ad66d, ghostBad: 0xe05555,
};

export class Editor3D {
  constructor(canvas, app) {
    this.app = app;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x232830);
    this.scene.fog = new THREE.Fog(0x232830, 120, 320);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 800);
    this.camera.position.set(26, 22, 30);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(6, 4, 4);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null,
    };

    // lights
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(40, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = 50;
    Object.assign(sun.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc });
    this.scene.add(sun, new THREE.AmbientLight(0x8aa0c0, 0.9));

    // ground + grid
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshLambertMaterial({ color: 0x39513a }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    const grid = new THREE.GridHelper(160, 160 / CELL, 0x5a7a5b, 0x46604a);
    grid.position.y = 0.01;
    this.scene.add(grid);

    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pieceGroup = new THREE.Group();
    this.scene.add(this.pieceGroup);

    // ghost
    this.ghostMat = new THREE.MeshLambertMaterial({
      color: COL.ghostOk, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.ghost = null;
    this.hover = null;       // {kind, ...} candidate placement
    this.mouse = new THREE.Vector2();
    this.downPos = null;

    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerdown', e => { this.downPos = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.updateGhost(); });

    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  // ---------- scene rebuild from state ----------
  rebuild(state) {
    this.pieceGroup.clear();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

    for (const f of Object.values(state.floors)) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.6, CELL), mat(COL.floor));
      m.position.set(f.i * CELL + CELL / 2, -0.3, f.j * CELL + CELL / 2);
      m.castShadow = m.receiveShadow = true;
      m.userData = { kind: 'floor', ref: f };
      this.pieceGroup.add(m);
    }
    for (const w of Object.values(state.walls)) {
      const g = this.wallMesh(w, mat);
      g.userData = { kind: 'wall', ref: w };
      this.pieceGroup.add(g);
    }
    for (const r of Object.values(state.roofs)) {
      const m = this.roofMesh(r, mat(COL.roof));
      m.userData = { kind: 'roof', ref: r };
      this.pieceGroup.add(m);
    }
    for (const g of gableTriangles(state)) {
      const m = this.gableMesh(g);
      m.userData = { kind: 'gable' };
      this.pieceGroup.add(m);
    }
  }

  wallMesh(w, mat) {
    const group = new THREE.Group();
    const horiz = w.o === 'H';
    const cx = horiz ? w.i * CELL + CELL / 2 : w.i * CELL;
    const cz = horiz ? w.j * CELL : w.j * CELL + CELL / 2;
    const len = CELL, th = 0.35;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(horiz ? len : th, WALL_H, horiz ? th : len),
      mat(COL.wall));
    body.position.set(cx, WALL_H / 2, cz);
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    if (w.type === 'door') {
      const d = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? 3 : th + 0.1, 6.7, horiz ? th + 0.1 : 3),
        mat(COL.door));
      d.position.set(cx, 3.35, cz);
      group.add(d);
    } else if (w.type === 'window') {
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? 3 : th + 0.1, 3, horiz ? th + 0.1 : 3),
        new THREE.MeshLambertMaterial({ color: COL.window, transparent: true, opacity: 0.8 }));
      win.position.set(cx, 5.2, cz);
      group.add(win);
    }
    return group;
  }

  roofMesh(r, material) {
    const [y0, y1] = roofHeights(r);
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.SQRT2 * CELL, 0.3, CELL), material);
    const cx = r.i * CELL + CELL / 2, cz = r.j * CELL + CELL / 2;
    m.position.set(cx, (y0 + y1) / 2, cz);
    // rotate so the slab rises toward dir
    const ang = Math.PI / 4;
    if (r.dir === 1) m.rotation.z = ang;            // up toward +x
    else if (r.dir === 3) m.rotation.z = -ang;      // up toward -x
    else if (r.dir === 2) { m.rotation.y = Math.PI / 2; m.rotation.z = -ang; }
    else { m.rotation.y = Math.PI / 2; m.rotation.z = ang; }
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  gableMesh(g) {
    const r = g.roof;
    const d = DIRS[g.side];
    // plane offset: the exposed face sits on the cell boundary on side g.side
    const x0 = r.i * CELL, z0 = r.j * CELL;
    let px, pz; // two plan endpoints of the low edge, low→high along slope
    const dir = r.dir;
    const fx = (dir === 1) ? [x0, x0 + CELL] : (dir === 3) ? [x0 + CELL, x0] : null;
    const fz = (dir === 2) ? [z0, z0 + CELL] : (dir === 0) ? [z0 + CELL, z0] : null;
    const planeX = g.side === 1 ? x0 + CELL : g.side === 3 ? x0 : null;
    const planeZ = g.side === 2 ? z0 + CELL : g.side === 0 ? z0 : null;
    const verts = [];
    if (fx) { // slope along x, face at z = planeZ
      verts.push(fx[0], g.y0, planeZ, fx[1], g.y0, planeZ, fx[1], g.y1, planeZ);
    } else {  // slope along z, face at x = planeX
      verts.push(planeX, g.y0, fz[0], planeX, g.y0, fz[1], planeX, g.y1, fz[1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COL.gable, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  // ---------- picking & ghost ----------
  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
  }

  // candidate placement under the cursor for the active tool
  candidate(e) {
    this.pick(e);
    const tool = this.app.tool;
    const state = this.app.state;
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, pt)) return null;
    const i = Math.floor(pt.x / CELL), j = Math.floor(pt.z / CELL);

    if (tool === 'floor') {
      return { kind: 'floor', i, j, ok: canPlaceFloor(state, i, j) };
    }
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      // nearest edge of the hovered cell
      const lx = pt.x - i * CELL, lz = pt.z - j * CELL;
      const cands = [
        { d: lz, side: 0 }, { d: CELL - lx, side: 1 },
        { d: CELL - lz, side: 2 }, { d: lx, side: 3 },
      ].sort((a, b) => a.d - b.d);
      const edge = edgeForSide(i, j, cands[0].side);
      return {
        kind: 'wall', edge, type: tool === 'wall' ? 'solid' : tool,
        ok: canPlaceWall(state, edge),
      };
    }
    if (tool === 'roof') {
      const dir = this.app.roofDir;
      const t = bestRoofTier(state, i, j, dir);
      return { kind: 'roof', i, j, t: Math.max(t, 0), dir, ok: t >= 0 };
    }
    if (tool === 'erase') {
      const hits = this.raycaster.intersectObjects(this.pieceGroup.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData?.kind) o = o.parent;
        if (o && o.userData.kind !== 'gable') return { kind: 'erase', target: o.userData, ok: true };
      }
      return null;
    }
    return null;
  }

  onMove(e) {
    if (!this.app.tool) { this.hover = null; this.updateGhost(); return; }
    this.hover = this.candidate(e);
    this.updateGhost();
    this.app.onHover(this.hover);
  }

  onUp(e) {
    if (!this.downPos) return;
    const dist = Math.hypot(e.clientX - this.downPos[0], e.clientY - this.downPos[1]);
    this.downPos = null;
    if (dist > 5) return;                       // it was a camera drag
    if (e.button === 2) { this.pick(e); this.app.eraseAt(this.raycaster, this.pieceGroup); return; }
    if (e.button !== 0 || !this.app.tool) return;
    const c = this.candidate(e);
    if (c) this.app.applyCandidate(c);
  }

  updateGhost() {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    const h = this.hover;
    if (!h || h.kind === 'erase') return;
    this.ghostMat.color.set(h.ok ? COL.ghostOk : COL.ghostBad);
    const mat = () => this.ghostMat;
    if (h.kind === 'floor') {
      this.ghost = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.6, CELL), this.ghostMat);
      this.ghost.position.set(h.i * CELL + CELL / 2, -0.3, h.j * CELL + CELL / 2);
    } else if (h.kind === 'wall') {
      this.ghost = this.wallMesh({ ...h.edge, type: h.type }, mat);
    } else if (h.kind === 'roof') {
      this.ghost = this.roofMesh({ i: h.i, j: h.j, t: h.t, dir: h.dir }, this.ghostMat);
    }
    if (this.ghost) {
      this.ghost.traverse(o => { o.castShadow = false; if (o.material) o.material = this.ghostMat; });
      this.scene.add(this.ghost);
    }
  }
}
