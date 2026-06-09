// catalog.js — build palette pieces and the material price book.

export const PIECES = [
  { id: 'floor',  key: '1', icon: '▦', name: 'Floor 4×4',
    desc: 'Framed floor module on skids' },
  { id: 'wall',   key: '2', icon: '▮', name: 'Wall panel',
    desc: '4 ft stud wall, 8 ft tall' },
  { id: 'door',   key: '3', icon: '🚪', name: 'Door wall',
    desc: 'Wall with 36″ prehung door' },
  { id: 'window', key: '4', icon: '⊞', name: 'Window wall',
    desc: 'Wall with 36×36″ window' },
  { id: 'roof',   key: '5', icon: '◢', name: 'Roof panel 45°',
    desc: 'Sloped panel, R to rotate' },
  { id: 'erase',  key: '6', icon: '✖', name: 'Remove',
    desc: 'Delete pieces (or RMB)' },
];

// Approximate big-box retail prices (USD). The report labels them estimates.
export const PRICE = {
  stud2x4_925:   { desc: '2×4 × 92-5/8″ precut stud',        unit: 'ea',     price: 3.65 },
  lum2x4x8:      { desc: '2×4 × 8′ SPF',                     unit: 'ea',     price: 3.98 },
  lum2x4x12:     { desc: '2×4 × 12′ SPF',                    unit: 'ea',     price: 6.55 },
  lum2x4x16:     { desc: '2×4 × 16′ SPF',                    unit: 'ea',     price: 9.85 },
  lum2x6x8:      { desc: '2×6 × 8′ SPF',                     unit: 'ea',     price: 6.45 },
  lum2x6x12:     { desc: '2×6 × 12′ SPF',                    unit: 'ea',     price: 10.25 },
  lum2x6x16:     { desc: '2×6 × 16′ SPF',                    unit: 'ea',     price: 14.50 },
  lum2x8x12:     { desc: '2×8 × 12′ SPF (ridge)',            unit: 'ea',     price: 15.75 },
  skid4x6x12:    { desc: '4×6 × 12′ pressure-treated skid',  unit: 'ea',     price: 32.50 },
  skid4x6x16:    { desc: '4×6 × 16′ pressure-treated skid',  unit: 'ea',     price: 44.00 },
  osbFloor:      { desc: '23/32″ T&G OSB subfloor 4×8',      unit: 'sheet',  price: 38.45 },
  osbWall:       { desc: '7/16″ OSB wall sheathing 4×8',     unit: 'sheet',  price: 14.97 },
  osbRoof:       { desc: '15/32″ OSB roof sheathing 4×8',    unit: 'sheet',  price: 18.65 },
  felt:          { desc: '15# roofing felt (4 sq roll)',     unit: 'roll',   price: 32.98 },
  shingleBundle: { desc: 'Architectural shingles',           unit: 'bundle', price: 34.50 },
  ridgeCap:      { desc: 'Ridge cap shingles (33 lf box)',   unit: 'box',    price: 42.00 },
  dripEdge:      { desc: 'Aluminum drip edge 10′',           unit: 'ea',     price: 8.45 },
  doorPrehung:   { desc: '36″ prehung exterior door',        unit: 'ea',     price: 189.00 },
  windowUnit:    { desc: '36×36″ single-hung window',        unit: 'ea',     price: 145.00 },
  trim1x4x8:     { desc: '1×4 × 8′ pine trim',               unit: 'ea',     price: 7.25 },
  fascia1x6x12:  { desc: '1×6 × 12′ fascia board',           unit: 'ea',     price: 13.80 },
  paintGal:      { desc: 'Exterior paint',                   unit: 'gal',    price: 42.00 },
  caulk:         { desc: 'Exterior caulk',                   unit: 'tube',   price: 5.98 },
  adhesive:      { desc: 'Subfloor construction adhesive',   unit: 'tube',   price: 7.48 },
  hTie:          { desc: 'H2.5A hurricane tie',              unit: 'ea',     price: 0.78 },
};

// Nail types: count per pound and how they are sold.
export const NAILS = {
  n16d:    { desc: '16d common (3-1/2″) framing nail', perLb: 45,
             box: { lb: 30, price: 52.98 } },
  n8d:     { desc: '8d common (2-1/2″) sheathing nail', perLb: 95,
             box: { lb: 30, price: 51.98 } },
  n8dRing: { desc: '8d ring-shank deck nail', perLb: 95,
             box: { lb: 5, price: 12.98 } },
  roofing: { desc: '1-1/4″ galvanized roofing nail', perLb: 175,
             box: { lb: 30, price: 43.98 } },
  hanger:  { desc: '1-1/2″ tie/hanger nail', perLb: 190,
             box: { lb: 1, price: 6.98 } },
  finish:  { desc: '8d galvanized finish nail (trim)', perLb: 110,
             box: { lb: 1, price: 5.49 } },
};

// 2×4 / 2×6 stock options for the cut optimizer (longest first)
export const STOCK_2X4 = [
  { len: 16, sku: 'lum2x4x16' }, { len: 12, sku: 'lum2x4x12' }, { len: 8, sku: 'lum2x4x8' },
];
export const STOCK_2X6 = [
  { len: 16, sku: 'lum2x6x16' }, { len: 12, sku: 'lum2x6x12' }, { len: 8, sku: 'lum2x6x8' },
];
export const STOCK_SKID = [
  { len: 16, sku: 'skid4x6x16' }, { len: 12, sku: 'skid4x6x12' },
];
