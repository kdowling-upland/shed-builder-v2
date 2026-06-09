// catalog.js — build palette pieces, opening specs and the material price book.

// ---- wall piece types (data-driven: engine + editors read these specs) ----
// ro = rough opening [width", height"], class drives framing math.
export const WALL_PIECES = {
  solid:      { name: 'Wall panel',        cls: 'solid' },
  door36:     { name: 'Entry door 36″',    cls: 'door',   ro: [38, 82.5], unitSku: 'doorPrehung' },
  doorBarn:   { name: 'Barn door 42″',     cls: 'door',   ro: [44, 84],   unitSku: 'doorBarn' },
  doorDutch:  { name: 'Dutch door 36″',    cls: 'door',   ro: [38, 82.5], unitSku: 'doorDutch' },
  window36:   { name: 'Window 36×36″',     cls: 'window', ro: [38, 38],   unitSku: 'windowUnit' },
  windowSld:  { name: 'Slider 36×24″',     cls: 'window', ro: [38, 26],   unitSku: 'windowSlider' },
  transom:    { name: 'Transom 36×12″',    cls: 'window', ro: [38, 14],   unitSku: 'windowTransom' },
  ventWall:   { name: 'Wall vent 14×6″',   cls: 'vent',   ro: [14.5, 6.5], unitSku: 'ventLouver' },
  post:       { name: 'Porch post bay',    cls: 'porch' },
  railing:    { name: 'Porch railing bay', cls: 'porch' },
};

// ---- roof / ceiling kinds ----
export const ROOF_KINDS = {
  r45:  { name: 'Gable 45° (12/12)',     rise: 4,    shingled: true },
  r22:  { name: 'Low-slope 22° (6/12)',  rise: 2,    shingled: true },
  flat: { name: 'Flat / EPDM ceiling',   rise: 0.35, shingled: false },
};

// ---- system fixtures (electrical & plumbing) ----
export const FIXTURES = {
  panel:    { name: 'Sub-panel 60A',     sys: 'elec',  host: 'wall', sku: 'panel60',    sym: 'P' },
  outlet:   { name: 'Outlet (duplex)',   sys: 'elec',  host: 'wall', sku: 'outlet',     sym: '⏚' },
  switch:   { name: 'Switch',            sys: 'elec',  host: 'wall', sku: 'switch',     sym: 'S' },
  light:    { name: 'Ceiling light',     sys: 'elec',  host: 'cell', sku: 'lightLed',   sym: 'L' },
  extLight: { name: 'Exterior light',    sys: 'elec',  host: 'wall', sku: 'lightExt',   sym: 'E' },
  sink:     { name: 'Utility sink',      sys: 'plumb', host: 'wall', sku: 'sinkUtility', sym: 'SK' },
  hosebib:  { name: 'Hose bib',          sys: 'plumb', host: 'wall', sku: 'hoseBib',    sym: 'HB' },
  skylight: { name: 'Skylight 2×2′',     sys: 'roof',  host: 'roof', sku: 'skylight',   sym: '◍' },
};

// ---- palette: flat list of pieces; ▾ variants swap the active type ----
export const PALETTE = [
  { id: 'floor', key: '1', icon: '▦', name: 'Floor 4×4', desc: 'Framed floor module on skids' },
  { id: 'wall', key: '2', icon: '▮', name: 'Wall', desc: '4 ft framed wall, 8 ft tall' },
  { id: 'wallDiag', key: '', icon: '◣', name: 'Diagonal wall', desc: '45° chamfer wall — R rotates the corner' },
  { id: 'roof:r45', key: '3', icon: '◢', name: 'Roof', desc: 'R rotates the slope', variants: [
    { id: 'roof:r45', name: 'Gable 45°', desc: 'Steep 12/12 panel' },
    { id: 'roof:r22', name: 'Low-slope 22°', desc: '6/12 panel — porch roofs' },
    { id: 'roof:flat', name: 'Flat / EPDM', desc: 'Membrane ceiling panel' },
  ]},
  { id: 'wt:door36', key: '4', icon: '🚪', name: 'Door', desc: 'Door in a framed wall', variants: [
    { id: 'wt:door36', name: 'Entry door 36″', desc: 'Prehung exterior door' },
    { id: 'wt:doorBarn', name: 'Barn door 42″', desc: 'Sliding barn door kit' },
    { id: 'wt:doorDutch', name: 'Dutch door 36″', desc: 'Split top/bottom door' },
  ]},
  { id: 'wt:window36', key: '5', icon: '⊞', name: 'Window', desc: 'Window in a framed wall', variants: [
    { id: 'wt:window36', name: 'Single-hung 36×36″', desc: 'Standard shed window' },
    { id: 'wt:windowSld', name: 'Slider 36×24″', desc: 'High-mount slider' },
    { id: 'wt:transom', name: 'Transom 36×12″', desc: 'Light strip up top' },
  ]},
  { id: 'wt:ventWall', key: '', icon: '𝄜', name: 'Wall vent', desc: '14×6″ louver, fits a stud bay' },
  { id: 'fx:skylight', key: '', icon: '◍', name: 'Skylight', desc: '2×2′ curb unit on a sloped roof' },
  { id: 'wt:post', key: '', icon: '𝅙', name: 'Porch', desc: 'Open bay on posts — carries a roof', variants: [
    { id: 'wt:post', name: 'Post bay (open)', desc: '4×4 posts, open between' },
    { id: 'wt:railing', name: 'Railing bay', desc: 'Posts + rails + balusters' },
  ]},
  { id: 'fx:outlet', key: '', icon: '⚡', name: 'Electrical', desc: 'Wired devices, auto-routed', variants: [
    { id: 'fx:panel', name: 'Sub-panel 60A', desc: 'Place this first' },
    { id: 'fx:outlet', name: 'Outlet (duplex)', desc: 'GFCI first in circuit' },
    { id: 'fx:switch', name: 'Switch', desc: 'Single-pole' },
    { id: 'fx:light', name: 'Ceiling light', desc: 'LED shop light on a cell' },
    { id: 'fx:extLight', name: 'Exterior light', desc: 'Wall lantern outside' },
  ]},
  { id: 'fx:sink', key: '', icon: '🚰', name: 'Plumbing', desc: 'Supply + drain, auto-routed', variants: [
    { id: 'fx:sink', name: 'Utility sink', desc: 'Cold supply, drain + AAV' },
    { id: 'fx:hosebib', name: 'Hose bib', desc: 'Exterior spigot' },
  ]},
  { id: 'drywall', key: '', icon: '⬜', name: 'Drywall', desc: 'Click a wall to finish/unfinish inside' },
  { id: 'erase', key: '6', icon: '✖', name: 'Remove', desc: 'Delete pieces (or RMB)' },
];

// ---- price book (approximate big-box retail, USD) ----
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
  epdm:          { desc: 'EPDM membrane', unit: 'sq ft', price: 1.45 },
  epdmAdhesive:  { desc: 'EPDM bonding adhesive', unit: 'gal', price: 64.00 },
  doorPrehung:   { desc: '36″ prehung exterior door',        unit: 'ea',     price: 189.00 },
  doorBarn:      { desc: '42″ sliding barn door kit',        unit: 'ea',     price: 249.00 },
  doorDutch:     { desc: '36″ dutch exterior door',          unit: 'ea',     price: 329.00 },
  windowUnit:    { desc: '36×36″ single-hung window',        unit: 'ea',     price: 145.00 },
  windowSlider:  { desc: '36×24″ slider window',             unit: 'ea',     price: 119.00 },
  windowTransom: { desc: '36×12″ transom window',            unit: 'ea',     price: 89.00 },
  ventLouver:    { desc: '14×6″ louvered wall vent',         unit: 'ea',     price: 24.00 },
  skylight:      { desc: '2×2′ curb-mount skylight + flashing', unit: 'ea',  price: 215.00 },
  trim1x4x8:     { desc: '1×4 × 8′ pine trim',               unit: 'ea',     price: 7.25 },
  fascia1x6x12:  { desc: '1×6 × 12′ fascia board',           unit: 'ea',     price: 13.80 },
  paintGal:      { desc: 'Exterior paint',                   unit: 'gal',    price: 42.00 },
  caulk:         { desc: 'Exterior caulk',                   unit: 'tube',   price: 5.98 },
  adhesive:      { desc: 'Subfloor construction adhesive',   unit: 'tube',   price: 7.48 },
  hTie:          { desc: 'H2.5A hurricane tie',              unit: 'ea',     price: 0.78 },
  // --- porch ---
  post4x4:       { desc: '4×4 × 8′ pressure-treated post',   unit: 'ea',     price: 19.98 },
  postBase:      { desc: 'Post base bracket + anchors',      unit: 'ea',     price: 10.98 },
  baluster:      { desc: '2×2 × 42″ baluster',               unit: 'ea',     price: 2.10 },
  // --- interior finish ---
  drywallSheet:  { desc: '1/2″ drywall 4×8',                 unit: 'sheet',  price: 14.98 },
  dwScrews:      { desc: 'Drywall screws 1-1/4″ (1 lb)',     unit: 'box',    price: 9.48 },
  jointCompound: { desc: 'Joint compound (3.5 gal)',         unit: 'pail',   price: 16.98 },
  dwTape:        { desc: 'Paper joint tape 250′',            unit: 'roll',   price: 5.98 },
  // --- electrical ---
  panel60:       { desc: '60A sub-panel (8 space)',          unit: 'ea',     price: 86.00 },
  breaker20:     { desc: '20A single-pole breaker',          unit: 'ea',     price: 12.50 },
  breaker15:     { desc: '15A single-pole breaker',          unit: 'ea',     price: 11.00 },
  wire122:       { desc: '12/2 NM-B wire, 100′ roll',        unit: 'roll',   price: 78.00 },
  wire142:       { desc: '14/2 NM-B wire, 100′ roll',        unit: 'roll',   price: 58.00 },
  feederUF:      { desc: '10/2 UF-B feeder (per ft, assumes 50′ trench to house)', unit: 'ft', price: 2.85 },
  outlet:        { desc: 'Duplex receptacle',                unit: 'ea',     price: 3.50 },
  outletGfci:    { desc: 'GFCI receptacle (first in circuit)', unit: 'ea',   price: 22.00 },
  switch:        { desc: 'Single-pole switch',               unit: 'ea',     price: 4.00 },
  lightLed:      { desc: '4′ LED shop light',                unit: 'ea',     price: 35.00 },
  lightExt:      { desc: 'Exterior wall lantern',            unit: 'ea',     price: 28.00 },
  elecBox:       { desc: 'Single-gang nail-on box',          unit: 'ea',     price: 2.50 },
  wireStaples:   { desc: 'NM cable staples (box of 100)',    unit: 'box',    price: 5.50 },
  // --- plumbing ---
  sinkUtility:   { desc: 'Utility sink + faucet kit',        unit: 'ea',     price: 95.00 },
  hoseBib:       { desc: 'Frost-free hose bib (sillcock)',   unit: 'ea',     price: 19.00 },
  pex12:         { desc: '1/2″ PEX-B supply (per ft)',       unit: 'ft',     price: 0.65 },
  pexFittings:   { desc: 'PEX fitting & crimp ring pack',    unit: 'pack',   price: 18.00 },
  shutoff:       { desc: '1/2″ quarter-turn shutoff valve',  unit: 'ea',     price: 8.50 },
  pvc112:        { desc: '1-1/2″ PVC drain pipe (per ft)',   unit: 'ft',     price: 1.20 },
  pvcFittings:   { desc: 'PVC trap, elbows & cement kit',    unit: 'kit',    price: 24.00 },
  aav:           { desc: 'Air admittance valve (AAV)',       unit: 'ea',     price: 16.00 },
  pipeStraps:    { desc: 'Pipe support straps (bag)',        unit: 'bag',    price: 6.00 },
};

// ---- nails ----
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

export const STOCK_2X4 = [
  { len: 16, sku: 'lum2x4x16' }, { len: 12, sku: 'lum2x4x12' }, { len: 8, sku: 'lum2x4x8' },
];
export const STOCK_2X6 = [
  { len: 16, sku: 'lum2x6x16' }, { len: 12, sku: 'lum2x6x12' }, { len: 8, sku: 'lum2x6x8' },
];
export const STOCK_SKID = [
  { len: 16, sku: 'skid4x6x16' }, { len: 12, sku: 'skid4x6x12' },
];
