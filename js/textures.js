// textures.js — procedural canvas textures so the app needs no image assets.
import * as THREE from 'three';

function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(seed) { // deterministic look between reloads
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function makeTextures() {
  const T = {};

  // lap siding — horizontal boards with shadow lines and grain
  T.siding = canvasTex(256, 256, (g, w, h) => {
    const rnd = rand(7);
    g.fillStyle = '#b9a275'; g.fillRect(0, 0, w, h);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const y = r * h / rows;
      const tone = 165 + rnd() * 25;
      g.fillStyle = `rgb(${tone + 20},${tone - 5},${tone - 60})`;
      g.fillRect(0, y, w, h / rows - 2);
      g.fillStyle = 'rgba(60,40,20,0.45)';
      g.fillRect(0, y + h / rows - 3, w, 3);
      g.strokeStyle = 'rgba(90,65,35,0.25)';
      for (let k = 0; k < 6; k++) {
        const gy = y + 3 + rnd() * (h / rows - 8);
        g.beginPath(); g.moveTo(0, gy);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, gy + (rnd() - 0.5) * 2);
        g.stroke();
      }
    }
  }, 1, 2);

  // architectural shingles — staggered tabs
  T.shingle = canvasTex(256, 256, (g, w, h) => {
    const rnd = rand(13);
    g.fillStyle = '#4a4f58'; g.fillRect(0, 0, w, h);
    const rows = 8, tab = 32;
    for (let r = 0; r < rows; r++) {
      const y = r * h / rows;
      const off = (r % 2) * tab / 2;
      for (let x = -tab; x < w + tab; x += tab) {
        const tone = 62 + rnd() * 30;
        g.fillStyle = `rgb(${tone},${tone + 4},${tone + 10})`;
        g.fillRect(x + off + 1, y, tab - 2, h / rows - 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, y + h / rows - 3, w, 3);
    }
  }, 1.4, 2);

  // OSB / plywood deck
  T.deck = canvasTex(256, 256, (g, w, h) => {
    const rnd = rand(29);
    g.fillStyle = '#c2a368'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) {
      const tone = 140 + rnd() * 75;
      g.fillStyle = `rgba(${tone},${tone * 0.82},${tone * 0.5},0.5)`;
      g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 9, 1.5 + rnd() * 3);
    }
    g.strokeStyle = 'rgba(80,60,30,0.6)';
    g.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, 1, 1);

  // rough sawn lumber (skids, trim)
  T.lumber = canvasTex(128, 128, (g, w, h) => {
    const rnd = rand(41);
    g.fillStyle = '#8a7044'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(60,45,20,0.5)';
    for (let k = 0; k < 14; k++) {
      const y = rnd() * h;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 12) g.lineTo(x, y + (rnd() - 0.5) * 4);
      g.stroke();
    }
  }, 2, 1);

  // treated lumber (greener)
  T.treated = canvasTex(128, 128, (g, w, h) => {
    const rnd = rand(53);
    g.fillStyle = '#7b7a52'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(50,55,25,0.55)';
    for (let k = 0; k < 14; k++) {
      const y = rnd() * h;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 12) g.lineTo(x, y + (rnd() - 0.5) * 4);
      g.stroke();
    }
  }, 2, 1);

  // painted door panel
  T.door = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#5e3a22'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    for (const [x, y, pw, ph] of [[18, 20, w - 36, h * 0.32], [18, h * 0.45, w - 36, h * 0.45]]) {
      g.strokeRect(x, y, pw, ph);
      g.strokeRect(x + 8, y + 8, pw - 16, ph - 16);
    }
  });

  // EPDM rubber membrane
  T.epdm = canvasTex(128, 128, (g, w, h) => {
    const rnd = rand(67);
    g.fillStyle = '#2e2e33'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 500; k++) {
      const tone = 40 + rnd() * 25;
      g.fillStyle = `rgba(${tone},${tone},${tone + 5},0.6)`;
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
  }, 2, 2);

  // grass
  T.grass = canvasTex(256, 256, (g, w, h) => {
    const rnd = rand(83);
    g.fillStyle = '#46603f'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 1800; k++) {
      const tone = 70 + rnd() * 60;
      g.fillStyle = `rgba(${tone * 0.65},${tone},${tone * 0.5},0.5)`;
      g.fillRect(rnd() * w, rnd() * h, 2, 3 + rnd() * 4);
    }
  }, 60, 60);

  return T;
}
