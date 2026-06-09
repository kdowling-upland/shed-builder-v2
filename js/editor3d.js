// editor3d.js — three.js scene: textured, detailed pieces, ghost-snap
// placement with drag-to-build, and collapse animation for unsupported pieces.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CELL, WALL_H, FLOOR_TOP, DIRS, riseOf,
  cellsOfEdge, floorKey, roofHeights, gableTriangles, roofKey,
} from './store.js';
import { WALL_PIECES, FIXTURES } from './catalog.js';
import { makeTextures } from './textures.js';
import { candidateAt, candidateSlot, eraseTargetAt } from './picker.js';

const Y0 = FLOOR_TOP;

export class Editor3D {
  constructor(canvas, app) {
    this.app = app;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87a8c4);
    this.scene.fog = new THREE.Fog(0x87a8c4, 140, 380);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 800);
    this.camera.position.set(26, 22, 30);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(6, 5, 4);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.setToolMode(false);

    const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    sun.position.set(40, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = 50;
    Object.assign(sun.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc });
    this.scene.add(sun, new THREE.AmbientLight(0x9fb4d0, 0.85));
    this.scene.add(new THREE.HemisphereLight(0xbcd3ee, 0x4a5d3a, 0.5));

    // textures & materials
    const T = this.T = makeTextures();
    const lam = (opt) => new THREE.MeshLambertMaterial(opt);
    this.M = {
      siding: lam({ map: T.siding }),
      shingle: lam({ map: T.shingle }),
      deck: lam({ map: T.deck }),
      lumber: lam({ map: T.lumber }),
      treated: lam({ map: T.treated }),
      door: lam({ map: T.door }),
      epdm: lam({ map: T.epdm }),
      glass: lam({ color: 0xbcd9ea, transparent: true, opacity: 0.45 }),
      drywall: lam({ color: 0xe9e4da }),
      trim: lam({ color: 0xf0ebdd }),
      white: lam({ color: 0xe8e8e8 }),
      metal: lam({ color: 0x8b9097 }),
      dark: lam({ color: 0x4c4c46 }),
      red: lam({ color: 0xb33a2e }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffe9b0 }),
    };

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      lam({ map: T.grass }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(160, 160 / CELL, 0x6d8a66, 0x5a7457);
    grid.position.y = 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.scene.add(grid);

    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pieceGroup = new THREE.Group();
    this.scene.add(this.pieceGroup);
    this.fallGroup = new THREE.Group();
    this.scene.add(this.fallGroup);

    this.ghostMat = new THREE.MeshLambertMaterial({
      color: 0x4ad66d, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.ghost = null;
    this.hover = null;
    this.mouse = new THREE.Vector2();
    this.painting = false;
    this.erasing = false;
    this.lastSlot = null;
    this.falling = [];
    this.clock = new THREE.Clock();

    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointerup', () => { this.painting = this.erasing = false; this.lastSlot = null; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.updateGhost(); });

    this.resize();
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.stepFalling(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  // camera buttons: with a tool active LMB paints, so orbit moves to MMB
  setToolMode(hasTool) {
    this.controls.mouseButtons = hasTool
      ? { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  // ---------- scene rebuild ----------
  rebuild(state, support) {
    this.pieceGroup.clear();
    const stress = this.app.stressView && support;
    const tint = (v) => {
      const c = new THREE.Color();
      c.setHSL(THREE.MathUtils.clamp(v, 0, 1) * 0.33, 0.85, 0.5);
      return new THREE.MeshLambertMaterial({ color: c });
    };

    for (const f of Object.values(state.floors)) {
      const g = stress ? this.boxPiece(f.i * CELL + 2, Y0 / 2, f.j * CELL + 2, CELL, Y0, CELL, tint(1))
        : this.floorMesh(f);
      g.userData = { kind: 'floor', ref: f };
      this.pieceGroup.add(g);
    }
    for (const [k, w] of Object.entries(state.walls)) {
      const g = stress
        ? this.simpleWall(w, tint(support.walls[k] ?? 0))
        : this.wallMesh(w, state);
      g.userData = { kind: 'wall', ref: w };
      this.pieceGroup.add(g);
    }
    if (!stress) this.addCornerBoards(state);
    for (const [k, r] of Object.entries(state.roofs)) {
      const g = stress
        ? this.roofSlab(r, tint(support.roofs[k] ?? 0))
        : this.roofMesh(r);
      g.userData = { kind: 'roof', ref: r };
      this.pieceGroup.add(g);
    }
    if (!stress) {
      for (const g of gableTriangles(state)) {
        const m = this.gableMesh(g);
        m.userData = { kind: 'gable' };
        this.pieceGroup.add(m);
      }
      for (const f of Object.values(state.fixtures)) {
        const m = this.fixtureMesh(f, state);
        if (m) { m.userData = { kind: 'fixture', ref: f }; this.pieceGroup.add(m); }
      }
    }
  }

  box(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  boxPiece(x, y, z, w, h, d, mat) {
    const m = this.box(w, h, d, mat);
    m.position.set(x, y, z);
    return m;
  }

  // floor module: treated skids + framed band with deck top
  floorMesh(f) {
    const g = new THREE.Group();
    const x = f.i * CELL, z = f.j * CELL;
    for (const lz of [0.7, 3.3]) {
      g.add(this.boxPiece(x + 2, 0.23, z + lz, CELL, 0.46, 0.45, this.M.treated));
    }
    const band = this.box(CELL, Y0 - 0.46, CELL,
      [this.M.lumber, this.M.lumber, this.M.deck, this.M.lumber, this.M.lumber, this.M.lumber]);
    band.position.set(x + 2, 0.46 + (Y0 - 0.46) / 2, z + 2);
    g.add(band);
    return g;
  }

  simpleWall(w, mat) {
    const horiz = w.o === 'H';
    return this.boxPiece(
      horiz ? w.i * CELL + 2 : w.i * CELL, Y0 + WALL_H / 2,
      horiz ? w.j * CELL : w.j * CELL + 2,
      horiz ? CELL : 0.4, WALL_H, horiz ? 0.4 : CELL, mat);
  }

  // a skin (siding/drywall) covering the wall face, with an optional
  // rectangular hole (door/window opening) cut out of it
  addSkin(g, z, th, mat, hole) {
    const put = (x0, x1, y0, y1) => {
      if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return;
      const m = this.box(x1 - x0, y1 - y0, th, mat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
      g.add(m);
    };
    const top = Y0 + WALL_H;
    if (!hole) { put(-2, 2, Y0, top); return; }
    put(-2, hole.x0, Y0, top);
    put(hole.x1, 2, Y0, top);
    put(hole.x0, hole.x1, hole.y1, top);
    put(hole.x0, hole.x1, Y0, hole.y0);
  }

  // real framed wall: plates, studs @16″ o.c., kings/jacks/header at
  // openings — visible from inside unless drywall is applied.
  wallMesh(w, state) {
    const spec = WALL_PIECES[w.type] || WALL_PIECES.solid;
    const g = new THREE.Group();
    const SD = 0.3, ST = 0.125;        // stud depth 3.5″, lumber 1.5″
    const top = Y0 + WALL_H;

    const cells = cellsOfEdge(w);
    const f1 = !!state.floors[floorKey(cells[1].i, cells[1].j)];
    const f0 = !!state.floors[floorKey(cells[0].i, cells[0].j)];
    const intS = f1 ? 1 : -1;          // interior is local +z when the floor is on cells[1]
    const partition = f0 && f1;

    // opening geometry in local coords
    let hole = null, yTop = 0, yBot = 0, hw = 0;
    if (spec.cls === 'door' || spec.cls === 'window') {
      hw = spec.ro[0] / 24;
      yTop = Y0 + 82.5 / 12;
      yBot = spec.cls === 'door' ? Y0 : yTop - spec.ro[1] / 12;
      hole = { x0: -hw, x1: hw, y0: yBot, y1: yTop };
    }

    // plates
    g.add(this.boxPiece(0, Y0 + ST / 2, 0, CELL, ST, SD, this.M.lumber));
    g.add(this.boxPiece(0, top - ST * 1.5, 0, CELL, ST, SD, this.M.lumber));
    g.add(this.boxPiece(0, top - ST / 2, 0, CELL, ST, SD, this.M.lumber));

    // studs @ 16″ o.c. (skip the ones inside an opening)
    const studH = WALL_H - 3 * ST;
    const studY = Y0 + ST + studH / 2;
    for (const sx of [-2 + ST / 2, -2 + 16 / 12, -2 + 32 / 12, 2 - ST / 2]) {
      if (hole && sx > -hw - 0.07 && sx < hw + 0.07) continue;
      g.add(this.boxPiece(sx, studY, 0, ST, studH, SD, this.M.lumber));
    }

    if (hole) {
      // jacks, header, cripples (and sill for windows)
      const jackH = yTop - (Y0 + ST);
      for (const s of [-1, 1]) {
        g.add(this.boxPiece(s * (hw + ST / 2), Y0 + ST + jackH / 2, 0, ST, jackH, SD, this.M.lumber));
        g.add(this.boxPiece(s * (hw + ST * 1.5), studY, 0, ST, studH, SD, this.M.lumber));
      }
      const hdrW = 2 * hw + 2 * ST;
      g.add(this.boxPiece(0, yTop + 0.23, 0, hdrW, 0.46, SD, this.M.lumber));
      const cripH = (top - 3 * ST) - (yTop + 0.46);
      if (cripH > 0.05) {
        for (const cx of [-0.6, 0.6]) {
          g.add(this.boxPiece(cx, yTop + 0.46 + cripH / 2, 0, ST, cripH, SD, this.M.lumber));
        }
      }
      if (spec.cls === 'window') {
        g.add(this.boxPiece(0, yBot - ST / 2, 0, 2 * hw, ST, SD, this.M.lumber));
        const scH = yBot - ST - (Y0 + ST);
        for (const cx of [-0.7, 0, 0.7]) {
          if (scH > 0.05) g.add(this.boxPiece(cx, Y0 + ST + scH / 2, 0, ST, scH, SD, this.M.lumber));
        }
      }
    }

    // exterior siding skin (perimeter walls only; partitions stay open)
    if (!partition) {
      this.addSkin(g, -intS * (SD / 2 + 0.05), 0.09, this.M.siding, hole);
    }
    // interior drywall if finished
    if (w.drywall) {
      this.addSkin(g, intS * (SD / 2 + 0.04), 0.06, this.M.drywall, hole);
    }

    // door / window / vent units
    if (spec.cls === 'door') {
      const dw = 2 * hw - 0.05, dh = yTop - yBot - 0.05;
      const frame = this.box(dw + 0.3, dh + 0.18, SD + 0.22, this.M.trim);
      frame.position.set(0, (yTop + yBot) / 2 + 0.04, 0);
      g.add(frame);
      if (w.type === 'doorBarn') {
        const zOut = -intS * (SD / 2 + 0.28);
        const slab = this.box(dw + 0.5, dh, 0.16, this.M.door);
        slab.position.set(0.3, (yTop + yBot) / 2, zOut);
        g.add(slab);
        const rail = this.box(dw + 1.6, 0.15, 0.1, this.M.metal);
        rail.position.set(0, yTop + 0.3, zOut);
        g.add(rail);
      } else if (w.type === 'doorDutch') {
        for (const [y0f, hf] of [[0, 0.48], [0.52, 0.48]]) {
          const slab = this.box(dw, dh * hf, 0.12, this.M.door);
          slab.position.set(0, yBot + dh * (y0f + hf / 2), 0);
          g.add(slab);
        }
        const knob = this.box(0.12, 0.12, 0.2, this.M.metal);
        knob.position.set(dw / 2 - 0.25, yBot + dh * 0.55, 0);
        g.add(knob);
      } else {
        const slab = this.box(dw, dh, 0.12, this.M.door);
        slab.position.set(0, yBot + dh / 2, 0);
        g.add(slab);
        const knob = this.box(0.12, 0.3, 0.2, this.M.metal);
        knob.position.set(dw / 2 - 0.3, yBot + dh * 0.45, 0);
        g.add(knob);
      }
    } else if (spec.cls === 'window') {
      const ww = 2 * hw - 0.05, wh = yTop - yBot - 0.05;
      const cy = (yTop + yBot) / 2;
      const frame = this.box(ww + 0.28, wh + 0.28, SD + 0.24, this.M.trim);
      frame.position.set(0, cy, 0);
      g.add(frame);
      const glass = this.box(ww, wh, SD + 0.26, this.M.glass);
      glass.position.set(0, cy, 0);
      g.add(glass);
      const mullV = this.box(0.07, wh, SD + 0.28, this.M.trim);
      mullV.position.set(0, cy, 0);
      g.add(mullV);
      const mullH = this.box(ww, 0.07, SD + 0.28, this.M.trim);
      mullH.position.set(0, cy, 0);
      g.add(mullH);
    } else if (spec.cls === 'vent') {
      const zOut = -intS * (SD / 2 + 0.12);
      const louver = this.box(spec.ro[0] / 12, spec.ro[1] / 12, 0.14, this.M.dark);
      louver.position.set(0, Y0 + 1.6, zOut);
      g.add(louver);
      for (let k = -1; k <= 1; k++) {
        const slat = this.box(spec.ro[0] / 12 + 0.06, 0.05, 0.18, this.M.trim);
        slat.position.set(0, Y0 + 1.6 + k * 0.16, zOut);
        g.add(slat);
      }
    }

    this.placeOnEdge(g, w);
    return g;
  }

  // vertical 1×4 corner boards where perimeter walls meet — hides the
  // panel seam and reads like real corner trim
  addCornerBoards(state) {
    const pts = { H: new Set(), V: new Set() };
    for (const w of Object.values(state.walls)) {
      if (w.o === 'H') { pts.H.add(`${w.i},${w.j}`); pts.H.add(`${w.i + 1},${w.j}`); }
      else { pts.V.add(`${w.i},${w.j}`); pts.V.add(`${w.i},${w.j + 1}`); }
    }
    for (const p of pts.H) {
      if (!pts.V.has(p)) continue;
      const [i, j] = p.split(',').map(Number);
      const post = this.box(0.36, WALL_H, 0.36, this.M.trim);
      post.position.set(i * CELL, Y0 + WALL_H / 2, j * CELL);
      post.userData = { kind: 'gable' }; // decorative: not erasable
      this.pieceGroup.add(post);
    }
  }

  placeOnEdge(group, e) {
    if (e.o === 'H') group.position.set(e.i * CELL + 2, 0, e.j * CELL);
    else {
      group.position.set(e.i * CELL, 0, e.j * CELL + 2);
      group.rotation.y = Math.PI / 2;
    }
  }

  roofTransform(r) {
    const rise = riseOf(r.kind);
    const [y0, y1] = roofHeights(r);
    const ang = Math.atan2(rise, CELL);
    const pos = new THREE.Vector3(r.i * CELL + 2, Y0 + (y0 + y1) / 2, r.j * CELL + 2);
    const rot = new THREE.Euler();
    if (r.dir === 1) rot.z = ang;
    else if (r.dir === 3) rot.z = -ang;
    else if (r.dir === 2) { rot.y = Math.PI / 2; rot.z = -ang; }
    else { rot.y = Math.PI / 2; rot.z = ang; }
    return { pos, rot, slopeLen: Math.hypot(CELL, rise) };
  }

  roofSlab(r, mat) {
    const { pos, rot, slopeLen } = this.roofTransform(r);
    const m = this.box(slopeLen, 0.3, CELL, mat);
    m.position.copy(pos);
    m.rotation.copy(rot);
    return m;
  }

  // roof panel: thin sheathing skinned with shingles/EPDM, carried on
  // visible 2×6 rafters underneath
  roofMesh(r) {
    const top = r.kind === 'flat' ? this.M.epdm : this.M.shingle;
    const mats = [this.M.trim, this.M.trim, top, this.M.lumber, this.M.trim, this.M.trim];
    const { pos, rot, slopeLen } = this.roofTransform(r);
    const g = new THREE.Group();
    const deck = this.box(slopeLen + 0.15, 0.18, CELL, mats);
    g.add(deck);
    for (const lz of [-CELL / 2 + 0.1, 0, CELL / 2 - 0.1]) {
      const raf = this.box(slopeLen, 0.46, 0.125, this.M.lumber);
      raf.position.set(0, -0.31, lz);
      g.add(raf);
    }
    g.position.copy(pos);
    g.rotation.copy(rot);
    return g;
  }

  gableMesh(g) {
    const r = g.roof;
    const x0 = r.i * CELL, z0 = r.j * CELL;
    const dir = r.dir;
    const fx = (dir === 1) ? [x0, x0 + CELL] : (dir === 3) ? [x0 + CELL, x0] : null;
    const fz = (dir === 2) ? [z0, z0 + CELL] : (dir === 0) ? [z0 + CELL, z0] : null;
    const planeX = g.side === 1 ? x0 + CELL : g.side === 3 ? x0 : null;
    const planeZ = g.side === 2 ? z0 + CELL : g.side === 0 ? z0 : null;
    const y0 = g.y0 + Y0, y1 = g.y1 + Y0;
    const verts = [];
    if (fx) verts.push(fx[0], y0, planeZ, fx[1], y0, planeZ, fx[1], y1, planeZ);
    else verts.push(planeX, y0, fz[0], planeX, y0, fz[1], planeX, y1, fz[1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1], 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.T.siding, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  // which way is "inside" for a wall-mounted fixture
  wallNormal(state, f) {
    const cells = cellsOfEdge(f);
    const hasNeg = !!state.floors[floorKey(cells[0].i, cells[0].j)];
    const inward = hasNeg ? -1 : 1; // interior on the negative side of the edge?
    return f.o === 'H' ? new THREE.Vector3(0, 0, inward) : new THREE.Vector3(inward, 0, 0);
  }

  fixtureMesh(f, state) {
    const spec = FIXTURES[f.kind];
    if (spec.host === 'wall') {
      const horiz = f.o === 'H';
      const mid = new THREE.Vector3(
        horiz ? f.i * CELL + 2 : f.i * CELL, 0,
        horiz ? f.j * CELL : f.j * CELL + 2);
      const n = this.wallNormal(state, f);
      const exterior = (f.kind === 'hosebib' || f.kind === 'extLight');
      const off = n.clone().multiplyScalar(exterior ? -0.45 : 0.45);
      const g = new THREE.Group();
      let m;
      switch (f.kind) {
        case 'panel': m = this.box(0.9, 1.3, 0.22, this.M.metal); m.position.y = Y0 + 4.6; break;
        case 'outlet': m = this.box(0.26, 0.42, 0.14, this.M.white); m.position.y = Y0 + 1.33; break;
        case 'switch': m = this.box(0.26, 0.42, 0.14, this.M.white); m.position.y = Y0 + 4; break;
        case 'sink': {
          m = this.box(1.9, 0.85, 1.5, this.M.white); m.position.y = Y0 + 2.6;
          const legs = this.box(1.6, 1.9, 1.2, this.M.metal); legs.position.y = Y0 + 1.1;
          const faucet = this.box(0.12, 0.5, 0.12, this.M.metal); faucet.position.y = Y0 + 3.2;
          g.add(legs, faucet);
          m.position.add(n.clone().multiplyScalar(0.6));
          legs.position.add(n.clone().multiplyScalar(0.6));
          faucet.position.add(n.clone().multiplyScalar(0.4));
          break;
        }
        case 'hosebib': m = this.box(0.18, 0.18, 0.35, this.M.red); m.position.y = Y0 + 1.5; break;
        case 'extLight': {
          m = this.box(0.3, 0.5, 0.3, this.M.dark); m.position.y = Y0 + 7;
          const glow = this.box(0.2, 0.25, 0.2, this.M.glow); glow.position.y = Y0 + 6.95;
          glow.position.add(off); g.add(glow);
          break;
        }
        default: return null;
      }
      m.position.add(off);
      g.add(m);
      g.position.copy(mid);
      return g;
    }
    if (spec.host === 'cell' && f.kind === 'light') {
      const g = new THREE.Group();
      const bar = this.box(3, 0.14, 0.6, this.M.white);
      bar.position.set(f.i * CELL + 2, Y0 + WALL_H - 0.35, f.j * CELL + 2);
      const lens = this.box(2.8, 0.06, 0.4, this.M.glow);
      lens.position.copy(bar.position).y -= 0.1;
      g.add(bar, lens);
      return g;
    }
    if (spec.host === 'roof') {
      const r = state.roofs[roofKey(f.i, f.j, f.t)];
      if (!r) return null;
      const { pos, rot } = this.roofTransform(r);
      const g = new THREE.Group();
      const curb = this.box(2.1, 0.5, 2.1, this.M.trim);
      const glass = this.box(1.9, 0.62, 1.9, this.M.glass);
      g.add(curb, glass);
      g.position.copy(pos);
      g.rotation.copy(rot);
      g.translateY(0.45);
      return g;
    }
    return null;
  }

  // ---------- collapse animation ----------
  collapse(deadPieces) {
    for (const d of deadPieces) {
      let mesh = null;
      if (d.kind === 'wall') mesh = this.wallMesh(d.ref, this.app.state);
      else if (d.kind === 'roof') mesh = this.roofMesh(d.ref);
      else if (d.kind === 'floor') mesh = this.floorMesh(d.ref);
      if (!mesh) continue;
      this.fallGroup.add(mesh);
      this.falling.push({
        mesh, t: 0,
        vy: 0.5 + Math.random(),
        wx: (Math.random() - 0.5) * 2.4,
        wz: (Math.random() - 0.5) * 2.4,
      });
    }
  }

  stepFalling(dt) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      f.vy += 22 * dt;
      f.mesh.position.y -= f.vy * dt;
      f.mesh.rotation.x += f.wx * dt;
      f.mesh.rotation.z += f.wz * dt;
      if (f.t > 1.4) {
        this.fallGroup.remove(f.mesh);
        this.falling.splice(i, 1);
      }
    }
  }

  // ---------- picking & input ----------
  planePoint(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.pieceGroup.children, true);
    if (hits.length) return { x: hits[0].point.x, z: hits[0].point.z };
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, pt)) return { x: pt.x, z: pt.z };
    return null;
  }

  candidate(e) {
    const p = this.planePoint(e);
    if (!p) return null;
    return candidateAt(this.app.state, this.app.tool, p.x, p.z, this.app.roofDir);
  }

  onDown(e) {
    if (e.button === 2) {
      this.erasing = true;
      const p = this.planePoint(e);
      if (p) {
        const t = eraseTargetAt(this.app.state, p.x, p.z);
        if (t) this.app.applyCandidate(t);
      }
      return;
    }
    if (e.button === 0 && this.app.tool) {
      this.painting = true;
      const c = this.candidate(e);
      if (c) { this.app.applyCandidate(c); this.lastSlot = candidateSlot(c); }
    }
  }

  onMove(e) {
    if (this.erasing) {
      const p = this.planePoint(e);
      if (p) {
        const t = eraseTargetAt(this.app.state, p.x, p.z);
        const slot = candidateSlot(t);
        if (t && slot !== this.lastSlot) { this.app.applyCandidate(t); this.lastSlot = slot; }
      }
      return;
    }
    if (!this.app.tool) { this.hover = null; this.updateGhost(); return; }
    this.hover = this.candidate(e);
    this.updateGhost();
    this.app.onHover(this.hover);
    if (this.painting && this.hover) {
      const slot = candidateSlot(this.hover);
      if (slot !== this.lastSlot && this.hover.ok !== false) {
        this.app.applyCandidate(this.hover);
        this.lastSlot = slot;
      }
    }
  }

  updateGhost() {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    const h = this.hover;
    if (!h || h.kind === 'erase') return;
    this.ghostMat.color.set(h.ok ? 0x4ad66d : 0xe05555);
    if (h.kind === 'floor') {
      this.ghost = this.boxPiece(h.i * CELL + 2, Y0 / 2, h.j * CELL + 2, CELL, Y0, CELL, this.ghostMat);
    } else if (h.kind === 'drywall') {
      this.ghost = this.simpleWall({ ...h.edge }, this.ghostMat);
      this.ghost.scale.set(1, 0.98, 0.6);
    } else if (h.kind === 'wall') {
      this.ghost = this.simpleWall({ ...h.edge }, this.ghostMat);
    } else if (h.kind === 'roof') {
      this.ghost = this.roofSlab({ i: h.i, j: h.j, t: h.t, dir: h.dir, kind: h.rk }, this.ghostMat);
    } else if (h.kind === 'fixture' && h.fixture) {
      const f = h.fixture;
      let x, y, z;
      if (f.host === 'wall') {
        x = f.o === 'H' ? f.i * CELL + 2 : f.i * CELL;
        z = f.o === 'H' ? f.j * CELL : f.j * CELL + 2;
        y = Y0 + 3;
      } else if (f.host === 'cell') {
        x = f.i * CELL + 2; z = f.j * CELL + 2; y = Y0 + WALL_H - 0.4;
      } else {
        const r = this.app.state.roofs[roofKey(f.i, f.j, f.t)];
        const pos = r ? this.roofTransform(r).pos : new THREE.Vector3(f.i * CELL + 2, Y0 + WALL_H, f.j * CELL + 2);
        x = pos.x; y = pos.y + 0.5; z = pos.z;
      }
      this.ghost = this.boxPiece(x, y, z, 1.2, 1.2, 1.2, this.ghostMat);
    }
    if (this.ghost) {
      this.ghost.traverse(o => { o.castShadow = false; if (o.material) o.material = this.ghostMat; });
      this.scene.add(this.ghost);
    }
  }
}
