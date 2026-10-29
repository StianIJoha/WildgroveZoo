/* Wildgrove Zoo v2 — engine */
(function () {
'use strict';
const G = GAME;
const { BIOMES, SPECIES, FOODS, SHOPS, BUILDINGS, DECOR, EXPANSIONS, UPGRADES, HELPERS, SAFARI, WHEEL, WHEEL_WEIGHTS, COLLECTIONS, QUESTS, TUTORIAL } = G;

// ---------- constants ----------
const N = 30;
const TW = 64, TH = 32;
const SAVE_KEY = 'wildgrove.save.v2';
const OFFLINE_CAP = 6 * 3600;
const GATE = { x: N - 1, y: N - 6 };
const NEEDS = ['food', 'water', 'pet', 'play'];
const VNAME = (sp, v) => (ART.variantNames && ART.variantNames[sp] && ART.variantNames[sp][v]) || (v ? `${SPECIES[sp].name} (${['', '2nd', '3rd', '4th', '5th'][v]} degree)` : SPECIES[sp].name);
const DEGREE = ['', '2nd degree', '3rd degree', '4th degree', '5th degree'];

let S = null, uid = 1;
const rnd = Math.random;
const pick = a => a[Math.floor(rnd() * a.length)];
function seeded(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
const xpFor = l => Math.round(50 * Math.pow(l, 1.55));
const capOf = e => 4 + e.level;

// ---------- new game ----------
function newGame() {
  const s = {
    v: 2, coins: 1200, gems: 10, paws: 0, xp: 0, level: 1, clock: 0,
    owned: 0, objects: [], paths: [], litter: [],
    storage: { animals: [], items: [] },
    food: { hay: 10, seeds: 0, fruit: 0, insects: 0, fish: 20, bamboo: 0, meat: 0 }, medicine: 2,
    helpers: { food: 0, water: 0, pet: 0, clean: 0 },
    claimed: [], cards: {}, collectionsDone: [],
    stats: { paths: 0, care: 0, litter: 0, shopCollects: 0, babies: 0, peakMeter: 0, collections: 0, safaris: 0, peakVisitors: 0, labUp: 0, expansions: 0, earned: 0 },
    tut: 0, escaped: [], wheelNext: 0, savedAt: Date.now(), cam: null,
  };
  for (const b of Object.keys(COLLECTIONS)) s.cards[b] = [0, 0, 0, 0, 0];
  s.objects.push({ id: 'gate', kind: 'gate', type: 'gate', gx: GATE.x, gy: GATE.y, w: 1, h: 1, fixed: true });
  for (let x = GATE.x - 1; x >= GATE.x - 4; x--) s.paths.push(x + ',' + GATE.y);
  s.objects.push({ id: 'crate', kind: 'deco', type: 'crate', gx: GATE.x - 3, gy: GATE.y - 2, w: 1, h: 1 });
  for (let i = 0; i < 3; i++) s.escaped.push({ id: 'esc' + i, sex: i === 0 ? 'm' : 'f', x: GATE.x - 4 + i * 1.3, y: GATE.y - 3.5 + (i % 2), tx: null, ty: null, wait: rnd() * 2, flip: false, moving: false, phase: rnd() * 9 });
  scatterWild(s, 0);
  return s;
}
function ownedRect(idx) { const e = EXPANSIONS[idx]; return { x0: N - e.ox, y0: N - e.oy }; }
function scatterWild(s, idx) {
  const r0 = ownedRect(idx), prev = idx > 0 ? ownedRect(idx - 1) : null;
  const r = seeded(17 + idx * 101);
  let placed = 0;
  for (let t = 0; t < 600 && placed < (idx === 0 ? 14 : 10); t++) {
    const x = r0.x0 + Math.floor(r() * (N - r0.x0)), y = r0.y0 + Math.floor(r() * (N - r0.y0));
    if (prev && x >= prev.x0 && y >= prev.y0) continue;           // only in the newly added strip
    if (Math.abs(y - GATE.y) <= 3 && x >= GATE.x - 7) continue;     // keep the entrance clear
    if (s.objects.some(o => x >= o.gx - 1 && x < o.gx + o.w + 1 && y >= o.gy - 1 && y < o.gy + o.h + 1)) continue;
    if (s.paths.includes(x + ',' + y)) continue;
    const k = r();
    s.objects.push({ id: 'w' + idx + '_' + placed, kind: 'wild', type: k < 0.45 ? 'oak' : k < 0.75 ? 'pine' : k < 0.88 ? 'rock' : 'bush', gx: x, gy: y, w: 1, h: 1 });
    placed++;
  }
}

// ---------- save / load ----------
function load() { try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 2) return s; } } catch (e) {} return null; }
function save() {
  if (!S) return;
  S.savedAt = Date.now(); S.cam = { x: cam.x, y: cam.y, z: cam.z };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S, (k, v) => k.startsWith('_') ? undefined : v)); } catch (e) {}
}

// ---------- grid ----------
let occ = [], pathSet = new Set(), reach = new Set(), OR = { x0: 0, y0: 0 };
const inGrid = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const owned = (x, y) => inGrid(x, y) && x >= OR.x0 && y >= OR.y0;
const isPath = (x, y) => pathSet.has(x + ',' + y);
const walkable = (x, y) => isPath(x, y) || (x === GATE.x && y === GATE.y);
function rebuild() {
  OR = ownedRect(S.owned);
  occ = Array.from({ length: N }, () => Array(N).fill(null));
  for (const o of S.objects) for (let x = o.gx; x < o.gx + o.w; x++) for (let y = o.gy; y < o.gy + o.h; y++) if (inGrid(x, y)) occ[x][y] = o;
  pathSet = new Set(S.paths);
  computeReach();
  groundDirty = true; forestDirty = true;
}
function computeReach() {
  reach = new Set(); const q = [[GATE.x, GATE.y]]; reach.add(GATE.x + ',' + GATE.y);
  while (q.length) { const [x, y] = q.pop(); for (const [a, b] of nb4(x, y)) { const k = a + ',' + b; if (!reach.has(k) && isPath(a, b)) { reach.add(k); q.push([a, b]); } } }
  for (const o of S.objects) o._conn = touchesReach(o);
}
function nb4(x, y) { return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => inGrid(a, b)); }
function touchesReach(o) {
  for (let x = o.gx - 1; x <= o.gx + o.w; x++) for (let y = o.gy - 1; y <= o.gy + o.h; y++) {
    const edge = x === o.gx - 1 || x === o.gx + o.w || y === o.gy - 1 || y === o.gy + o.h;
    const corner = (x === o.gx - 1 || x === o.gx + o.w) && (y === o.gy - 1 || y === o.gy + o.h);
    if (edge && !corner && reach.has(x + ',' + y) && isPath(x, y)) return true;
  }
  return false;
}

// ---------- economy ----------
function addCoins(n, earned) { S.coins += n; if (earned && n > 0) S.stats.earned += n; }
function addXp(n) {
  S.xp += n;
  while (S.xp >= xpFor(S.level)) {
    S.xp -= xpFor(S.level); S.level++; S.gems += 3;
    const unl = [...Object.values(SPECIES), ...Object.values(SHOPS), ...Object.values(BUILDINGS), ...Object.values(BIOMES)].filter(x => x.lvl === S.level).map(x => x.name);
    const exp = EXPANSIONS.find(e => e.lvl === S.level);
    toast(`Level ${S.level}! +3 gems` + (unl.length ? ` · New: ${unl.join(', ')}` : '') + (exp ? ' · Land expansion available' : ''), 'level');
    sfx('level');
  }
}
function grant(p, at) {
  const parts = [];
  if (p.coins) { addCoins(p.coins, true); parts.push(`${fmt(p.coins)} coins`); }
  if (p.gems) { S.gems += p.gems; parts.push(`${p.gems} gem${p.gems > 1 ? 's' : ''}`); }
  if (p.paws) { S.paws += p.paws; parts.push(`${p.paws} paw${p.paws > 1 ? 's' : ''}`); }
  if (p.xp) { addXp(p.xp); parts.push(`${p.xp} XP`); }
  if (p.medicine) { S.medicine += p.medicine; parts.push(`${p.medicine} medicine`); }
  if (p.food) { const f = pick(usefulFoods()); S.food[f] += p.food; parts.push(`${p.food} ${FOODS[f].name.toLowerCase()}`); }
  if (p.card) { const c = dropCard(true); if (c) parts.push(c); }
  if (p.rare) { const sp = pick(Object.keys(SPECIES).filter(k => SPECIES[k].lvl <= Math.max(2, S.level))); const v = rnd() < 0.2 ? 2 : 1; S.storage.animals.push(storeRec(sp, v, rnd() < 0.5 ? 'm' : 'f', false)); parts.push(`a ${VNAME(sp, v)} (in storage)`); }
  if (p.item) { S.storage.items.push({ kind: 'deco', type: p.item }); parts.push(`a ${DECOR[p.item].name.toLowerCase()} (in storage)`); }
  if (at) floaters.push({ wx: at.x, wy: at.y, text: parts[0] ? '+' + parts[0] : '', t: 0, color: '#f2b632' });
  return parts;
}
function usefulFoods() {
  const kept = new Set([...S.objects.flatMap(o => (o.animals || []).map(a => SPECIES[a.species].food)), ...S.storage.animals.map(a => SPECIES[a.species].food)]);
  return kept.size ? [...kept] : unlockedFoods();
}
function unlockedFoods() { const f = new Set(Object.values(SPECIES).filter(s => s.lvl <= S.level).map(s => s.food)); return [...f]; }
const fmt = n => Math.floor(n).toLocaleString('en-US');
const compact = n => n >= 10000 ? (n / 1000).toFixed(0) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.floor(n));
function careReward(at) {
  S.stats.care++; addXp(2);
  if (rnd() < 0.18) { S.paws++; if (at) floaters.push({ wx: at.x, wy: at.y - 10, text: '+1 paw', t: 0, color: '#c6a0ee' }); }
  if (rnd() < 0.03) dropCard(false);
}
function dropCard(force) {
  const biomes = Object.keys(COLLECTIONS).filter(b => BIOMES[b].lvl <= S.level);
  if (!biomes.length) return null;
  const b = pick(biomes), i = Math.floor(rnd() * 5);
  const had = S.cards[b][i] > 0; S.cards[b][i]++;
  if (had) { S.paws++; if (!force) return null; return `a duplicate ${BIOMES[b].name.toLowerCase()} card (+1 paw)`; }
  toast(`New collection card: ${COLLECTIONS[b].name} ${'ABCDE'[i]}`, 'card'); sfx('gem');
  return `${COLLECTIONS[b].name} card ${'ABCDE'[i]}`;
}

// ---------- animals & needs ----------
function needInterval(sp, n) { return G.NEED_BASE[n] * SPECIES[sp].care; }
function initNeeds(a, fresh) { a.due = {}; for (const n of NEEDS) a.due[n] = S.clock + needInterval(a.species, n) * (fresh ? 0.15 + rnd() * 0.25 : 0.5 + rnd() * 0.6); }
function storeRec(species, variant, sex, baby) { return { id: uid++, species, variant, sex, baby: !!baby, grow: baby ? 0 : 1, name: pick(G.NAMES) }; }
function placeRec(enc, rec) {
  const a = Object.assign({}, rec, { lx: 0.6 + rnd() * (enc.w - 1.2), ly: 0.6 + rnd() * (enc.h - 1.2), tx: null, ty: null, wait: rnd() * 2, flip: rnd() < 0.5, moving: false, phase: rnd() * 10, sick: false });
  initNeeds(a, true);
  if (S.tut >= 0) { a.due.food = S.clock; a.due.water = S.clock + 2; a.due.pet = S.clock + 4; }
  if (!enc.species) { enc.species = rec.species; enc.variant = rec.variant; }
  enc.animals.push(a);
  return a;
}
function toRec(a) { return { id: a.id, species: a.species, variant: a.variant, sex: a.sex, baby: a.baby, grow: a.grow, name: a.name }; }
const needActive = (a, n) => S.clock >= a.due[n];
const activeNeeds = a => NEEDS.filter(n => needActive(a, n));
function mood(e, a) {
  let m = 1 - 0.2 * activeNeeds(a).length - (a.sick ? 0.4 : 0) - 0.15 * (e.dung.length / 6);
  if (SPECIES[a.species].biome === e.biome) m += 0.1;
  return Math.max(0, Math.min(1, m));
}
function encMood(e) { if (!e.animals.length) return 1; let s = 0; for (const a of e.animals) s += mood(e, a); return s / e.animals.length; }
const fitsBiome = (e, species) => SPECIES[species].biome === e.biome;
function canHold(e, species, variant) { return !e.build && fitsBiome(e, species) && e.animals.length < capOf(e) && (!e.species || (e.species === species && e.variant === variant)); }
function fulfill(e, a, n, quiet) {
  if (n === 'food') { const f = SPECIES[a.species].food; if (S.food[f] < 1) { if (!quiet) outOfFood(f); return false; } S.food[f]--; }
  a.due[n] = S.clock + needInterval(a.species, n) * (0.85 + rnd() * 0.3);
  return true;
}
function outOfFood(f) { toast(`Out of ${FOODS[f].name.toLowerCase()}. Buy more in Build → Supplies.`, 'warn'); sfx('no'); }
function careAll(e, n) {
  let done = 0, missing = false;
  for (const a of e.animals) if (needActive(a, n)) { if (fulfill(e, a, n, true)) { done++; careReward(iso(e.gx + a.lx, e.gy + a.ly)); } else missing = true; }
  if (missing) outOfFood(SPECIES[e.species].food);
  if (done) { sfx(n); dirty(); }
  return done;
}
function careOne(e, a) {
  if (a.sick) return heal(e, a);
  const n = activeNeeds(a)[0];
  if (!n) { sfx('pet'); a.heart = 1.2; return; }
  if (fulfill(e, a, n)) { careReward(iso(e.gx + a.lx, e.gy + a.ly)); sfx(n); dirty(); }
}
function heal(e, a) {
  if (S.medicine < 1) { toast('No medicine left. Buy some in Build → Supplies.', 'warn'); sfx('no'); return false; }
  S.medicine--; a.sick = false; careReward(iso(e.gx + a.lx, e.gy + a.ly)); addXp(3); sfx('clean'); dirty(); return true;
}
function healAll(e) { for (const a of e.animals) if (a.sick && !heal(e, a)) break; }
function cleanEnc(e) { const n = e.dung.length; if (!n) return; e.dung = []; for (let i = 0; i < n; i++) careReward(); sfx('clean'); dirty(); }

function tickEnc(e, dt, offline, rep) {
  if (e.build) return;
  const sp = e.species && SPECIES[e.species];
  // dung
  if (e.animals.length) {
    e.dungAcc = (e.dungAcc || 0) + dt * e.animals.length / 400;
    while (e.dungAcc >= 1) { e.dungAcc -= 1; if (e.dung.length < 6) e.dung.push({ lx: 0.4 + rnd() * (e.w - 0.8), ly: 0.4 + rnd() * (e.h - 0.8) }); }
  }
  // sickness
  e.sickT = (e.sickT || 0) + dt;
  if (e.sickT >= 10) {
    e.sickT = 0;
    if (!offline) for (const a of e.animals) if (!a.sick && NEEDS.some(n => S.clock - a.due[n] > needInterval(a.species, n)) && rnd() < 0.03) { a.sick = true; toast(`${a.name} the ${SPECIES[a.species].name.toLowerCase()} is sick. Give medicine.`, 'warn'); }
  }
  if (!sp) return;
  // breeding
  const adults = e.animals.filter(a => !a.baby);
  const ok = adults.some(a => a.sex === 'm') && adults.some(a => a.sex === 'f') && e.animals.length < capOf(e) && adults.every(a => !a.sick && mood(e, a) >= 0.7);
  if (ok) {
    e.breed = (e.breed || 0) + dt / sp.breed;
    if (e.breed >= 1) {
      e.breed = 0;
      const b = placeRec(e, storeRec(e.species, e.variant, rnd() < 0.5 ? 'm' : 'f', true));
      S.stats.babies++; addXp(20);
      if (rep) rep.babies++; else { toast(`A baby ${sp.name.toLowerCase()} was born! Meet ${b.name}.`, 'baby'); sfx('baby'); }
    }
  }
  for (const a of e.animals) if (a.baby) { a.grow += dt / sp.grow; if (a.grow >= 1) { a.baby = false; a.grow = 1; } }
}
function stepAnimal(e, a, dt) {
  const sp = SPECIES[a.species];
  if (a.tx == null) { a.wait -= dt; a.moving = false; if (a.wait <= 0) { a.tx = 0.5 + rnd() * (e.w - 1); a.ty = 0.5 + rnd() * (e.h - 1); } return; }
  const dx = a.tx - a.lx, dy = a.ty - a.ly, d = Math.hypot(dx, dy);
  const spd = sp.speed * (a.baby ? 1.2 : 1) * (a.sick ? 0.4 : 1);
  if (d < 0.05) { a.tx = null; a.wait = 1.5 + rnd() * 5; a.moving = false; return; }
  const s = Math.min(d, spd * dt); a.lx += dx / d * s; a.ly += dy / d * s; a.moving = true;
  const sdx = dx - dy; if (Math.abs(sdx) > 0.02) a.flip = sdx < 0;
}

// ---------- zoo meter / attraction ----------
let M = { meter: 50, attraction: 0, target: 0, parts: {} }, meterT = 0;
function computeMeter() {
  const encs = S.objects.filter(o => o.kind === 'enc' && !o.build);
  let moodSum = 0, n = 0, att = 0, babies = 0, encClean = 0, encN = 0;
  const kinds = new Set();
  for (const e of encs) {
    if (e.animals.length) { encN++; encClean += 1 - e.dung.length / 6; }
    for (const a of e.animals) {
      const m = mood(e, a); moodSum += m; n++;
      if (a.baby) babies++;
      kinds.add(a.species + ':' + a.variant);
      att += SPECIES[a.species].appeal * (1 + 0.5 * a.variant) * (a.baby ? 1.5 : 1) * (SPECIES[a.species].biome === e.biome ? 1.1 : 1) * (0.5 + 0.5 * m);
    }
  }
  let decor = 0;
  for (const o of S.objects) if (o.kind === 'deco' && DECOR[o.type]) decor += DECOR[o.type].appeal; else if (o.kind === 'shop' && !o.build) decor += 1;
  att += decor + S.paths.length * 0.2;
  const pathClean = 1 - Math.min(1, S.litter.length / (5 + S.paths.length * 0.12));
  const parts = {
    mood: n ? moodSum / n : 0.5,
    clean: encN ? 0.5 * (encClean / encN) + 0.5 * pathClean : pathClean,
    variety: Math.min(1, kinds.size / 8),
    decor: Math.min(1, decor / (8 + 3 * encs.length)),
    babies: Math.min(1, babies / 3),
  };
  const meter = Math.round(100 * (0.4 * parts.mood + 0.25 * parts.clean + 0.15 * parts.variety + 0.1 * parts.decor + 0.1 * parts.babies));
  const gateOpen = [...reach].length > 1;
  M = { meter, attraction: Math.round(att), parts, target: gateOpen ? Math.min(80, Math.floor(att / 3 * (0.4 + 0.6 * meter / 100))) : 0 };
  if (meter > S.stats.peakMeter && n) S.stats.peakMeter = meter;
}
const ticketPrice = () => 1 + Math.floor(S.level / 3);

// ---------- shops & buildings ----------
function shopRate(o, vis) { const D = SHOPS[o.type]; if (!o._conn) return 0; return (1 / D.period) * (0.5 + M.meter / 100) * (0.25 + 0.75 * Math.min(1, vis / 12)); }
function tickShop(o, dt, vis) { if (o.build || o.prog >= 1) return; o.prog = Math.min(1, o.prog + shopRate(o, vis) * dt); }
function collectShop(o) {
  if (o.prog < 1) return;
  const D = SHOPS[o.type]; o.prog = 0; S.stats.shopCollects++;
  const p = iso(o.gx + 0.5, o.gy + 0.5);
  addCoins(D.pay, true); addXp(Math.max(2, Math.round(D.pay / 12)));
  floaters.push({ wx: p.x, wy: p.y - 80, text: '+' + D.pay, t: 0, color: '#f2b632' });
  sfx('coin'); dirty();
}
function finishBuildCost(o) { return Math.max(1, Math.ceil((o.build - S.clock) / 120)); }
function rushBuild(o) { const c = finishBuildCost(o); if (S.gems < c) { toast(`You need ${c} gem${c > 1 ? 's' : ''}`, 'warn'); return; } S.gems -= c; o.build = S.clock; sfx('gem'); }
function tickBuild(o) { if (o.build && S.clock >= o.build) { o.build = null; if (o.kind === 'enc' || o.kind === 'shop' || o.kind === 'bld') { toast(`${objName(o)} is ready!`); sfx('build'); addXp(10); groundDirty = true; } } }
function tickBld(o, dt) {
  if (o.build) return;
  if (o.type === 'nursery') for (const s of o.slots) { if (s.rec.baby) { s.rec.grow += dt * 3 / SPECIES[s.rec.species].grow; if (s.rec.grow >= 1) { s.rec.grow = 1; s.rec.baby = false; } } }
  if ((o.type === 'lab' || o.type === 'safari') && o.job && !o.job.done && S.clock >= o.job.end) { o.job.done = true; toast(o.type === 'lab' ? 'The breeding lab has a new baby ready!' : 'Your safari expedition is back!'); sfx('baby'); }
}
function objName(o) { if (o.kind === 'enc') return o.species ? encLabel(o) : `${BIOMES[o.biome].name} enclosure`; if (o.kind === 'shop') return SHOPS[o.type].name; if (o.kind === 'bld') return BUILDINGS[o.type].name; if (o.kind === 'deco') return (DECOR[o.type] || { name: 'Crate' }).name; return 'Object'; }
function encLabel(e) {
  if (!e.species) return `${BIOMES[e.biome].name} enclosure`;
  const same = S.objects.filter(o => o.kind === 'enc' && o.species === e.species);
  return `${SPECIES[e.species].name} enclosure${same.length > 1 ? ' #' + (same.indexOf(e) + 1) : ''}`;
}

// ---------- helpers (staff) ----------
let helperT = 0;
function tickHelpers(dt) {
  helperT += dt; if (helperT < 2) return; helperT = 0;
  const H = S.helpers, on = k => H[k] > S.clock;
  if (!on('food') && !on('water') && !on('pet') && !on('clean')) return;
  for (const e of S.objects) if (e.kind === 'enc' && !e.build) {
    for (const a of e.animals) {
      if (on('food') && needActive(a, 'food')) fulfill(e, a, 'food', true);
      if (on('water') && needActive(a, 'water')) fulfill(e, a, 'water', true);
      if (on('pet')) { if (needActive(a, 'pet')) fulfill(e, a, 'pet', true); if (needActive(a, 'play')) fulfill(e, a, 'play', true); }
    }
    if (on('clean')) e.dung = [];
  }
  if (on('clean')) S.litter = [];
}

// ---------- visitors & litter ----------
let visitors = [], spawnT = 0, floaters = [], litterT = 0;
function spawnVisitor() {
  if (!nb4(GATE.x, GATE.y).some(([x, y]) => isPath(x, y))) return;
  visitors.push({ gx: GATE.x + 0.5, gy: GATE.y + 0.5, cx: GATE.x, cy: GATE.y, px: -1, py: -1, tx: GATE.x, ty: GATE.y,
    life: 40 + rnd() * 50, age: 0, shirt: pick(G.VISITOR_SHIRTS), skin: pick(G.VISITOR_SKINS), hair: pick(G.VISITOR_HAIRS), pause: 0, flip: false, speed: 0.9 + rnd() * 0.5, heart: 0 });
  const tp = ticketPrice(); addCoins(tp, true);
  const p = iso(GATE.x + 0.5, GATE.y + 0.5); floaters.push({ wx: p.x, wy: p.y - 70, text: '+' + tp, t: 0, color: '#f2b632' });
}
function stepVisitor(v, dt) {
  v.age += dt;
  if (v.pause > 0) { v.pause -= dt; v.moving = false; return; }
  const tx = v.tx + 0.5, ty = v.ty + 0.5, dx = tx - v.gx, dy = ty - v.gy, d = Math.hypot(dx, dy);
  if (d < 0.03) {
    v.px = v.cx; v.py = v.cy; v.cx = v.tx; v.cy = v.ty;
    let opts = nb4(v.cx, v.cy).filter(([x, y]) => walkable(x, y));
    const fwd = opts.filter(([x, y]) => !(x === v.px && y === v.py)); if (fwd.length) opts = fwd;
    if (!opts.length) { v.pause = 1; return; }
    const [nx, ny] = pick(opts); v.tx = nx; v.ty = ny;
    if (rnd() < 0.3) for (const e of S.objects) if (e.kind === 'enc' && e.animals.length && v.cx >= e.gx - 1 && v.cx <= e.gx + e.w && v.cy >= e.gy - 1 && v.cy <= e.gy + e.h) { v.pause = 1.5 + rnd() * 2; if (encMood(e) > 0.7) v.heart = 1.6; break; }
  } else {
    const s = Math.min(d, v.speed * dt); v.gx += dx / d * s; v.gy += dy / d * s;
    const sdx = dx - dy; if (Math.abs(sdx) > 0.01) v.flip = sdx < 0; v.moving = true;
  }
}
function binNear(x, y) { for (const o of S.objects) if (o.type === 'trashbin' && Math.abs(o.gx - x) <= 3 && Math.abs(o.gy - y) <= 3) return true; return false; }
function tickLitter(dt) {
  litterT += dt; if (litterT < 1) return; litterT = 0;
  if (S.litter.length >= 40) return;
  for (const v of visitors) {
    if (!isPath(v.cx, v.cy) || !v.moving) continue;
    const chance = 0.006 * (binNear(v.cx, v.cy) ? 0.25 : 1);
    if (rnd() < chance && !S.litter.some(l => l.x === v.cx && l.y === v.cy)) S.litter.push({ x: v.cx, y: v.cy, ox: (rnd() - 0.5) * 0.5, oy: (rnd() - 0.5) * 0.5, k: Math.floor(rnd() * 3) });
  }
}
function pickLitter(l) { S.litter = S.litter.filter(x => x !== l); S.stats.litter++; addXp(1); if (rnd() < 0.12) S.paws++; if (rnd() < 0.05) dropCard(false); sfx('clean'); dirty(); }

// ---------- escaped penguins (tutorial) ----------
function stepEscaped(p, dt) {
  if (p.tx == null) { p.wait -= dt; p.moving = false; if (p.wait <= 0) { p.tx = Math.max(OR.x0 + 0.5, Math.min(N - 1.5, p.x + (rnd() - 0.5) * 3)); p.ty = Math.max(OR.y0 + 0.5, Math.min(N - 1.5, p.y + (rnd() - 0.5) * 3)); } return; }
  const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
  if (d < 0.05) { p.tx = null; p.wait = 1 + rnd() * 3; return; }
  const s = Math.min(d, 0.5 * dt); p.x += dx / d * s; p.y += dy / d * s; p.moving = true; const sdx = dx - dy; if (Math.abs(sdx) > 0.02) p.flip = sdx < 0;
}
function catchEscaped(p) {
  S.escaped = S.escaped.filter(x => x !== p);
  S.storage.animals.push(storeRec('penguin', 0, p.sex, false));
  addXp(5); sfx('adopt');
  const q = iso(p.x, p.y); floaters.push({ wx: q.x, wy: q.y - 40, text: 'Caught!', t: 0, color: '#ffffff' });
  dirty();
}

// ---------- camera ----------
const cv = document.getElementById('world');
const mainCtx = cv.getContext('2d'); let ctx = mainCtx;
let W = 0, H = 0, DPR = 1, quality = 1;
const cam = { x: 0, y: 0, z: 1 };
function resize() { DPR = Math.max(0.75, Math.min(2, window.devicePixelRatio || 1) * quality); W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); }
const iso = (gx, gy) => ({ x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 });
function toWorld(sx, sy) { return { x: (sx - W / 2) / cam.z + cam.x, y: (sy - H / 2) / cam.z + cam.y }; }
function toGrid(sx, sy) { const w = toWorld(sx, sy); const a = w.x / (TW / 2), b = w.y / (TH / 2); return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) }; }
function clampCam() {
  cam.z = Math.max(0.4, Math.min(2.2, cam.z));
  const a = iso(OR.x0, N), b = iso(N, OR.y0), t = iso(OR.x0, OR.y0), bt = iso(N, N);
  const mx = Math.max(0, W / 2 / cam.z - 160), my = Math.max(0, H / 2 / cam.z - 140);
  const x0 = a.x + mx, x1 = b.x - mx, y0 = t.y + my - 60, y1 = bt.y - my + 60;
  const cx = (a.x + b.x) / 2, cy = (t.y + bt.y) / 2;
  cam.x = x0 > x1 ? cx : Math.max(x0, Math.min(x1, cam.x));
  cam.y = y0 > y1 ? cy : Math.max(y0, Math.min(y1, cam.y));
}
function centerCam() { const c = iso(N - EXPANSIONS[S.owned].ox / 2, N - EXPANSIONS[S.owned].oy / 2); cam.x = c.x; cam.y = c.y; cam.z = Math.max(0.72, Math.min(1.15, Math.min(W / 950, H / 640))); clampCam(); }

// ---------- tools ----------
let tool = null, hover = null, selected = null;
function footprint(t) {
  if (t.kind === 'move' || t.kind === 'place') return { w: t.w, h: t.h };
  if (t.kind === 'enc') return { w: 3, h: 3 };
  if (t.kind === 'bld') return { w: 2, h: 2 };
  return { w: 1, h: 1 };
}
const toolOffset = t => (t && footprint(t).w > 1 ? Math.floor(footprint(t).w / 2) : 0);
function canPlace(t, gx, gy) {
  const f = footprint(t);
  for (let x = gx; x < gx + f.w; x++) for (let y = gy; y < gy + f.h; y++) {
    if (!owned(x, y) || isPath(x, y)) return false;
    if (occ[x][y] && !(t.kind === 'move' && occ[x][y] === t.obj)) return false;
    if (S.litter.some(l => l.x === x && l.y === y)) return false;
  }
  return true;
}
function toolCost(t) { if (t.kind === 'enc') return BIOMES[t.biome].cost; if (t.kind === 'shop') return SHOPS[t.type].cost; if (t.kind === 'bld') return BUILDINGS[t.type].cost; if (t.kind === 'deco') return DECOR[t.type].cost; if (t.kind === 'path') return 3; return 0; }
function place(gx, gy) {
  if (!tool) return;
  if (tool.kind === 'path') return paintPath(gx, gy);
  if (tool.kind === 'bulldoze') return bulldoze(gx, gy, false);
  if (!canPlace(tool, gx, gy)) { sfx('no'); return; }
  if (tool.kind === 'move') { const o = tool.obj; o.gx = gx; o.gy = gy; delete o._props; rebuild(); setTool(null); select(o); sfx('build'); dirty(); return; }
  if (tool.kind === 'place') { // from storage
    const it = tool.item; S.storage.items = S.storage.items.filter(x => x !== it);
    const o = Object.assign({}, it.obj || {}, { id: 'o' + uid++, kind: it.kind, type: it.type, gx, gy, w: tool.w, h: tool.h });
    if (it.kind === 'enc') Object.assign(o, { biome: it.biome, animals: [], dung: [], species: null, variant: 0, level: it.level || 0, breed: 0, build: null });
    if (it.kind === 'shop') Object.assign(o, { prog: 0, build: null });
    if (it.kind === 'bld') Object.assign(o, { build: null, slots: o.slots || [], job: o.job || null });
    S.objects.push(o); rebuild(); setTool(null); select(o); sfx('build'); dirty(); return;
  }
  const cost = toolCost(tool);
  if (S.coins < cost) { toast('Not enough coins', 'warn'); sfx('no'); return; }
  S.coins -= cost;
  let o;
  if (tool.kind === 'enc') o = { id: 'e' + uid++, kind: 'enc', biome: tool.biome, gx, gy, w: 3, h: 3, level: 0, species: null, variant: 0, animals: [], dung: [], breed: 0, build: S.clock + (S.tut >= 0 && S.tut <= 2 ? 8 : 40) };
  else if (tool.kind === 'shop') o = { id: 's' + uid++, kind: 'shop', type: tool.type, gx, gy, w: 1, h: 1, prog: 0, build: S.clock + (S.tut >= 0 && tool.type === 'feeder' ? 5 : SHOPS[tool.type].build) };
  else if (tool.kind === 'bld') o = { id: 'b' + uid++, kind: 'bld', type: tool.type, gx, gy, w: 2, h: 2, build: S.clock + BUILDINGS[tool.type].build, slots: [], job: null };
  else o = { id: 'd' + uid++, kind: 'deco', type: tool.type, gx, gy, w: 1, h: 1 };
  S.objects.push(o); addXp(o.kind === 'deco' ? 1 : 8); rebuild(); sfx('build');
  if (o.kind !== 'deco') { setTool(null); select(o); }
  dirty();
}
function paintPath(gx, gy) {
  if (!owned(gx, gy) || occ[gx][gy] || isPath(gx, gy)) return;
  if (S.coins < 3) { toast('Not enough coins', 'warn'); return; }
  S.coins -= 3; S.paths.push(gx + ',' + gy); pathSet.add(gx + ',' + gy); S.stats.paths++; computeReach(); groundDirty = true; sfx('path'); dirty();
}
function bulldoze(gx, gy, fromDrag) {
  if (!inGrid(gx, gy)) return;
  const lit = S.litter.find(l => l.x === gx && l.y === gy); if (lit) { pickLitter(lit); return; }
  if (isPath(gx, gy)) { S.paths = S.paths.filter(p => p !== gx + ',' + gy); pathSet.delete(gx + ',' + gy); computeReach(); groundDirty = true; addCoins(1); sfx('path'); dirty(); return; }
  const o = occ[gx][gy]; if (!o || o.fixed) return;
  if (o.kind === 'wild') { if (S.coins < 15) { toast('Clearing costs 15 coins', 'warn'); return; } S.coins -= 15; S.objects = S.objects.filter(x => x !== o); addXp(3); rebuild(); sfx('build'); dirty(); return; }
  if (o.kind === 'deco' && !fromDrag) { removeObj(o); return; }
  if (!fromDrag) select(o);
}
function sellValue(o) { if (o.kind === 'deco') return DECOR[o.type] ? Math.floor(DECOR[o.type].cost / 2) : 0; if (o.kind === 'shop') return Math.floor(SHOPS[o.type].cost / 3); if (o.kind === 'bld') return Math.floor(BUILDINGS[o.type].cost / 3); if (o.kind === 'enc') { let c = BIOMES[o.biome].cost; for (let l = 1; l <= o.level; l++) c += UPGRADES[l].coins; return Math.floor(c / 2); } return 0; }
function removeObj(o) { if (o.kind === 'enc') { let p = 0; for (let l = 1; l <= o.level; l++) p += UPGRADES[l].paws; S.paws += Math.floor(p / 2); } addCoins(sellValue(o)); S.objects = S.objects.filter(x => x !== o); rebuild(); select(null); sfx('path'); dirty(); }
function storeObj(o) {
  if (o.kind === 'enc' && o.animals.length) { toast('Move the animals out first', 'warn'); return; }
  if (o.build) { toast('Wait until it is finished', 'warn'); return; }
  const it = { kind: o.kind, type: o.type, w: o.w, h: o.h };
  if (o.kind === 'enc') Object.assign(it, { biome: o.biome, level: o.level, type: 'enc' });
  if (o.kind === 'bld') it.obj = { slots: o.slots, job: o.job };
  S.storage.items.push(it); S.objects = S.objects.filter(x => x !== o); rebuild(); select(null); toast(`${objName(o)} put in storage`); dirty();
}

// ---------- loop ----------
let last = performance.now(), T = 0, saveT = 0, uiT = 0, frameErr = false, rEma = 8, qT = 0, slowT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; T += dt;
  requestAnimationFrame(frame);
  try {
    tick(dt);
    const r0 = performance.now(); render(); const rt = performance.now() - r0;
    rEma = rEma * 0.95 + rt * 0.05; qT += dt;
    if (qT > 2.5) { qT = 0;
      if (rEma > 18 && quality > 0.5) { quality = Math.max(0.5, quality - 0.25); resize(); spriteCache.clear(); groundDirty = forestDirty = true; }
      else if (quality < 1 && rEma * Math.pow((quality + 0.25) / quality, 2) < 12) { quality = Math.min(1, quality + 0.25); resize(); spriteCache.clear(); groundDirty = forestDirty = true; } }
    uiT += dt; if (uiT > 0.3) { uiT = 0; updateHUD(); if (selected) renderPanel(); tutorialCheck(); if (!$('#storage').hidden) renderStorage(); if (!$('#hub').hidden) renderHub(); }
    saveT += dt; if (saveT > 8) { saveT = 0; save(); }
  } catch (e) { if (!frameErr) { frameErr = true; console.error(e); } }
}
function tick(dt) {
  S.clock += dt;
  meterT -= dt; if (meterT <= 0) { meterT = 0.5; computeMeter(); }
  for (const o of S.objects) {
    tickBuild(o);
    if (o.kind === 'enc') { tickEnc(o, dt, false); if (!o.build) for (const a of o.animals) stepAnimal(o, a, dt); }
    else if (o.kind === 'shop') tickShop(o, dt, visitors.length);
    else if (o.kind === 'bld') tickBld(o, dt);
  }
  tickHelpers(dt);
  for (const p of S.escaped) stepEscaped(p, dt);
  spawnT -= dt;
  if (visitors.length < M.target && spawnT <= 0) { spawnVisitor(); const base = Math.min(1.7, 60 / Math.max(1, M.target)); spawnT = base * (0.7 + rnd() * 0.6) * (visitors.length < M.target * 0.7 ? 0.5 : 1); }
  for (const v of visitors) stepVisitor(v, dt);
  visitors = visitors.filter(v => v.age < v.life + 1);
  if (visitors.length > S.stats.peakVisitors) S.stats.peakVisitors = visitors.length;
  tickLitter(dt);
  floaters.forEach(f => f.t += dt); floaters = floaters.filter(f => f.t < 1.4);
}

// ---------- offline ----------
function offlineProgress() {
  const el = Math.min(OFFLINE_CAP, Math.max(0, (Date.now() - (S.savedAt || Date.now())) / 1000));
  if (el < 30) return;
  computeMeter();
  const rep = { babies: 0 };
  const coins0 = S.coins, vis = M.target;
  const step = 10;
  for (let t = 0; t < el; t += step) {
    const d = Math.min(step, el - t); S.clock += d;
    for (const o of S.objects) { tickBuild(o); if (o.kind === 'enc') tickEnc(o, d, true, rep); else if (o.kind === 'shop') tickShop(o, d, vis); else if (o.kind === 'bld') tickBld(o, d); }
    tickHelpers(d + 2);
  }
  const tickets = Math.round(vis * 0.9 * ticketPrice() * (el / 60) * 0.5);
  if (tickets) addCoins(tickets, true);
  const ready = S.objects.filter(o => o.kind === 'shop' && o.prog >= 1).length;
  let needy = 0; for (const e of S.objects) if (e.kind === 'enc') for (const a of e.animals) if (activeNeeds(a).length) needy++;
  showWelcome(el, tickets, ready, rep.babies, needy);
  void coins0;
}

// ---------- rendering ----------
function diamond(c, x, y, hw, hh) { c.beginPath(); c.moveTo(x, y - hh); c.lineTo(x + hw, y); c.lineTo(x, y + hh); c.lineTo(x - hw, y); c.closePath(); }
function tileHash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
let bubbles = [];

let groundDirty = true, forestDirty = true, groundCache = null, frontCache = null;
const GB = { x0: -(N + 6) * TW / 2, y0: N * TH / 2 - (N + 6) * TH / 2 - 110, w: (N + 6) * TW, h: (N + 6) * TH + 130 };
const scaleBucket = () => { const sc = DPR * cam.z; for (const b of [0.5, 0.75, 1, 1.5, 2, 3, 4.5]) if (b >= sc * 0.92) return b; return 4.5; };
let forest = [];
function makeForest() {
  forest = []; const r = seeded(99);
  for (let i = -3; i < N + 3; i++) for (let j = -3; j < N + 3; j++) {
    const rv = r(), rt = r(), rs = r();
    if (owned(i, j)) continue;
    if (i >= N && Math.abs(j - GATE.y) <= 1) continue;
    const inside = inGrid(i, j);
    const dist = inside ? Math.min(OR.x0 - i, OR.y0 - j) : 3;
    const dens = inside ? (dist <= 0 ? 0.35 : 0.45 + Math.min(dist, 4) * 0.08) : 0.7;
    if (rv < dens) forest.push({ x: i, y: j, type: rt < 0.5 ? 'pine' : (rt < 0.82 ? 'oak' : 'bush'), s: 0.85 + rs * 0.3, front: i >= N || j >= N });
  }
}
function newCanvasFor(sc) { const c = document.createElement('canvas'); c.width = Math.ceil(GB.w * sc); c.height = Math.ceil(GB.h * sc); const g = c.getContext('2d'); g.setTransform(sc, 0, 0, sc, -GB.x0 * sc, -GB.y0 * sc); return [c, g]; }
function drawGround() {
  const sc = Math.min(2, scaleBucket());
  if (forestDirty) { makeForest(); }
  if (groundDirty || forestDirty || !groundCache || groundCache.sc !== sc) {
    const [c, g] = groundCache && groundCache.sc === sc ? [groundCache.c, groundCache.c.getContext('2d')] : newCanvasFor(sc);
    g.setTransform(sc, 0, 0, sc, -GB.x0 * sc, -GB.y0 * sc); g.clearRect(GB.x0, GB.y0, GB.w, GB.h);
    const trees = forest.slice().sort((a, b) => a.x + a.y - b.x - b.y);
    ctx = g; try { drawGroundStatic(); for (const b of trees) if (!b.front) { const p = iso(b.x + 0.5, b.y + 0.5); drawDecorSprite(b.type, p.x, p.y, 1, b.s); } } finally { ctx = mainCtx; }
    if (forestDirty || !frontCache || frontCache.sc !== sc) {
      const [f, fx] = newCanvasFor(sc);
      ctx = fx; try { for (const b of trees) if (b.front) { const p = iso(b.x + 0.5, b.y + 0.5); drawDecorSprite(b.type, p.x, p.y, 1, b.s); } } finally { ctx = mainCtx; }
      frontCache = { c: f, sc };
    }
    groundCache = { c, sc }; groundDirty = false; forestDirty = false;
  }
  ctx.drawImage(groundCache.c, GB.x0, GB.y0, GB.w, GB.h);
  for (const e of S.objects) if (e.kind === 'enc') drawEncGround(e);
}
function drawGroundStatic() {
  const c = iso(N / 2, N / 2);
  ctx.fillStyle = '#5f9b52'; diamond(ctx, c.x, c.y, (N + 6) * TW / 2, (N + 6) * TH / 2); ctx.fill();
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    const p = iso(x + 0.5, y + 0.5), o = occ[x][y], own = owned(x, y);
    let col;
    if (o && o.kind === 'enc' && !o.build) { const b = BIOMES[o.biome]; col = ((x + y) % 2) ? b.g1 : b.g2; }
    else if (o && o.kind === 'enc') col = '#b9a27a';
    else if (!own) { const h = tileHash(x, y); col = h < 0.5 ? '#6aa75a' : '#66a256'; }
    else { const h = tileHash(x, y); col = h < 0.5 ? '#8cc56b' : h < 0.85 ? '#86bf65' : '#93ca72'; }
    ctx.fillStyle = col; diamond(ctx, p.x, p.y, TW / 2 + 0.6, TH / 2 + 0.6); ctx.fill();
    if (own && !o && tileHash(y, x) > 0.82) {
      ctx.strokeStyle = 'rgba(60,110,50,0.45)'; ctx.lineWidth = 1.2; ctx.beginPath();
      const ox = p.x + (tileHash(x * 3, y) - 0.5) * 30, oy = p.y + (tileHash(x, y * 3) - 0.5) * 12;
      ctx.moveTo(ox - 3, oy); ctx.lineTo(ox - 4, oy - 5); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - 6); ctx.moveTo(ox + 3, oy); ctx.lineTo(ox + 4, oy - 5); ctx.stroke();
    }
  }
  // owned boundary
  const a = iso(OR.x0, OR.y0), b = iso(N, OR.y0), cc = iso(N, N), d = iso(OR.x0, N);
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  void cc;
  for (const key of pathSet) {
    const [x, y] = key.split(',').map(Number); const p = iso(x + 0.5, y + 0.5);
    ctx.fillStyle = '#d9c29a'; diamond(ctx, p.x, p.y, TW / 2 + 0.6, TH / 2 + 0.6); ctx.fill();
    ctx.fillStyle = '#cdb489';
    for (let k = 0; k < 4; k++) { const u = tileHash(x * 7 + k, y * 5), w = tileHash(x * 5, y * 7 + k); ctx.beginPath(); ctx.ellipse(p.x + (u - 0.5) * 36, p.y + (w - 0.5) * 14, 3, 1.6, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(150,120,80,0.45)'; ctx.lineWidth = 1.5;
    const edges = [
      { n: [x, y - 1], a: [p.x, p.y - TH / 2], b: [p.x + TW / 2, p.y] }, { n: [x + 1, y], a: [p.x + TW / 2, p.y], b: [p.x, p.y + TH / 2] },
      { n: [x, y + 1], a: [p.x, p.y + TH / 2], b: [p.x - TW / 2, p.y] }, { n: [x - 1, y], a: [p.x - TW / 2, p.y], b: [p.x, p.y - TH / 2] }];
    for (const e of edges) if (!walkable(e.n[0], e.n[1])) { ctx.beginPath(); ctx.moveTo(e.a[0], e.a[1]); ctx.lineTo(e.b[0], e.b[1]); ctx.stroke(); }
    if (!reach.has(key)) { ctx.fillStyle = 'rgba(200,80,60,0.18)'; diamond(ctx, p.x, p.y, TW / 2, TH / 2); ctx.fill(); }
  }
}
function drawEncGround(e) {
  if (e.build) return;
  const b = BIOMES[e.biome];
  if (b.pool) {
    const pc = iso(e.gx + e.w * 0.62, e.gy + e.h * 0.38);
    ctx.fillStyle = e.biome === 'ice' ? '#7cc4e4' : '#76bfd6'; ctx.beginPath(); ctx.ellipse(pc.x, pc.y, 34, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.2; const w = Math.sin(T * 2) * 3;
    ctx.beginPath(); ctx.ellipse(pc.x - 6 + w, pc.y - 2, 10, 3, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }
  // food trough + water trough
  const tp = iso(e.gx + 0.55, e.gy + e.h - 0.55), wp = iso(e.gx + 1.3, e.gy + e.h - 0.45);
  const hungry = e.animals.some(a => needActive(a, 'food')), thirsty = e.animals.some(a => needActive(a, 'water'));
  ctx.fillStyle = '#8a5a3a'; ctx.beginPath(); ctx.ellipse(tp.x, tp.y, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b4329'; ctx.beginPath(); ctx.ellipse(tp.x, tp.y - 1, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (!hungry && e.animals.length) { ctx.fillStyle = '#9ccc4a'; ctx.beginPath(); ctx.ellipse(tp.x, tp.y - 1.5, 8, 3, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#8f9aa3'; ctx.beginPath(); ctx.ellipse(wp.x, wp.y, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = thirsty || !e.animals.length ? '#6d757c' : '#5fb6e0'; ctx.beginPath(); ctx.ellipse(wp.x, wp.y - 1, 8, 3.3, 0, 0, Math.PI * 2); ctx.fill();
  for (const d of e.dung) { const p = iso(e.gx + d.lx, e.gy + d.ly); if (ART.icons.poop) { ctx.save(); ctx.translate(p.x, p.y - 4); ART.icons.poop(ctx, 13); ctx.restore(); } }
  if (selected === e) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -T * 12;
    const a = iso(e.gx, e.gy), r = iso(e.gx + e.w, e.gy), bt = iso(e.gx + e.w, e.gy + e.h), l = iso(e.gx, e.gy + e.h);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(r.x, r.y); ctx.lineTo(bt.x, bt.y); ctx.lineTo(l.x, l.y); ctx.closePath(); ctx.stroke(); ctx.restore();
  }
}

const LIVE_DECOR = new Set(['fountain', 'lamp', 'balloon']);
const spriteCache = new Map();
const BOX1 = { ox: 64, oy: 112, w: 128, h: 136 }, BOX2 = { ox: 100, oy: 150, w: 200, h: 190 }, BOX3 = { ox: 120, oy: 120, w: 240, h: 180 };
const boxFor = type => (type === 'nursery' || type === 'lab' || type === 'safari' || type === 'construction2') ? BOX2 : type === 'construction3' ? BOX3 : BOX1;
function cachedSprite(type) {
  const sc = scaleBucket(), key = type + '|' + sc; let c = spriteCache.get(key);
  if (!c) {
    const B = boxFor(type); c = document.createElement('canvas'); c.width = Math.ceil(B.w * sc); c.height = Math.ceil(B.h * sc);
    const x = c.getContext('2d'); x.setTransform(sc, 0, 0, sc, B.ox * sc, B.oy * sc);
    try { ART.decor[type](x, 0); } catch (e) {}
    spriteCache.set(key, c); if (spriteCache.size > 160) spriteCache.delete(spriteCache.keys().next().value);
  }
  return c;
}
function drawDecorSprite(type, x, y, alpha, scale) {
  ctx.save(); ctx.translate(x, y); if (scale) ctx.scale(scale, scale); ctx.globalAlpha = alpha;
  const fn = ART.decor && ART.decor[type];
  if (fn && !LIVE_DECOR.has(type)) { const B = boxFor(type); ctx.drawImage(cachedSprite(type), -B.ox, -B.oy, B.w, B.h); }
  else if (fn) { try { fn(ctx, T + x * 0.01); } catch (e) {} }
  else { ctx.fillStyle = '#c98e64'; ctx.fillRect(-18, -30, 36, 30); ctx.fillStyle = '#fff'; ctx.font = '700 9px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(type, 0, -12); }
  ctx.restore();
}
function drawIcon(id, x, y, size) { ctx.save(); ctx.translate(x, y); const f = ART.icons && ART.icons[id]; if (f) { try { f(ctx, size); } catch (e) {} } else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, size / 2.5, 0, 7); ctx.fill(); ctx.fillStyle = '#2e3a2a'; ctx.font = `800 ${size * 0.4}px Nunito`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(id.slice(0, 2), 0, 0); } ctx.restore(); }

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#5a9550'); g.addColorStop(1, '#47803f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
  drawGround();
  const vw = toWorld(0, 0), vw2 = toWorld(W, H);
  const vx0 = vw.x - 130, vx1 = vw2.x + 130, vy0 = vw.y - 40, vy1 = vw2.y + 150;
  const on = (x, y, m) => x > vx0 - (m || 0) && x < vx1 + (m || 0) && y > vy0 - (m || 0) && y < vy1 + (m || 0);
  const items = []; bubbles = [];
  for (const o of S.objects) {
    if (o.kind === 'enc') { const c = iso(o.gx + 1.5, o.gy + 1.5); if (on(c.x, c.y, 140)) pushEnc(items, o); continue; }
    const c = iso(o.gx + o.w / 2, o.gy + o.h / 2); if (!on(c.x, c.y, 60)) continue;
    items.push({ d: o.gx + o.gy + o.w, f: () => drawObj(o, c) });
  }
  for (const l of S.litter) { const p = iso(l.x + 0.5 + l.ox, l.y + 0.5 + l.oy); if (on(p.x, p.y)) items.push({ d: l.x + l.y + 0.6, f: () => { ctx.save(); ctx.translate(p.x, p.y); if (ART.decor.litter) ART.decor.litter(ctx, T, l.k); else { ctx.fillStyle = '#eee'; ctx.fillRect(-4, -4, 8, 5); } ctx.restore(); } }); }
  for (const v of visitors) { const p = iso(v.gx, v.gy); if (on(p.x, p.y)) items.push({ d: v.gx + v.gy, f: () => drawVisitor(v, p) }); }
  for (const p of S.escaped) items.push({ d: p.x + p.y, f: () => { const q = iso(p.x, p.y); ctx.save(); ctx.translate(q.x, q.y); ART.animals.penguin(ctx, T + p.phase, { flip: p.flip, moving: p.moving, sex: p.sex }); ctx.restore(); bubbles.push({ wx: q.x, wy: q.y - 48, icon: 'pet', escaped: p }); } });
  if (tool && hover && !['path', 'bulldoze'].includes(tool.kind)) { const f = footprint(tool); items.push({ d: hover.x + hover.y + f.w + f.h, f: () => drawGhost(hover.x, hover.y) }); }
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.f();
  if (frontCache) ctx.drawImage(frontCache.c, GB.x0, GB.y0, GB.w, GB.h);
  if (tool && hover && (tool.kind === 'path' || tool.kind === 'bulldoze') && inGrid(hover.x, hover.y)) {
    const p = iso(hover.x + 0.5, hover.y + 0.5);
    ctx.fillStyle = tool.kind === 'path' ? (owned(hover.x, hover.y) ? 'rgba(255,255,255,0.35)' : 'rgba(230,90,80,0.35)') : 'rgba(217,83,79,0.4)';
    diamond(ctx, p.x, p.y, TW / 2, TH / 2); ctx.fill();
  }
  drawBubbles();
  for (const f of floaters) {
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - f.t / 1.4); ctx.font = '800 15px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(46,58,42,0.8)'; ctx.strokeText(f.text, f.wx, f.wy - f.t * 28); ctx.fillStyle = f.color; ctx.fillText(f.text, f.wx, f.wy - f.t * 28); ctx.restore();
  }
  ctx.restore();
}
const isMoving = o => tool && tool.kind === 'move' && tool.obj === o;
function drawObj(o, c) {
  const a = isMoving(o) ? 0.35 : 1;
  const base = o.w === 2 ? iso(o.gx + 1, o.gy + 1) : iso(o.gx + 0.5, o.gy + 0.5);
  if (o.build) {
    drawDecorSprite(o.w === 2 ? 'construction2' : 'construction', base.x, base.y, a);
    bubbles.push({ wx: base.x, wy: base.y - (o.w === 2 ? 100 : 76), icon: 'hourglass', text: fmtTime(o.build - S.clock), obj: o, act: 'select' });
    return;
  }
  drawDecorSprite(o.type, base.x, base.y, a);
  if (o.kind === 'shop') {
    if (o.prog >= 1) bubbles.push({ wx: base.x, wy: base.y - 84, icon: 'silvercoin', obj: o, act: 'collect', ready: true });
    else if (!o._conn) bubbles.push({ wx: base.x, wy: base.y - 84, icon: 'lock', text: 'No path', obj: o, act: 'select', warn: true });
  }
  if (o.kind === 'bld') {
    if (o.type === 'nursery' && o.slots.some(s => !s.rec.baby)) bubbles.push({ wx: base.x, wy: base.y - 110, icon: 'nurseryicon', text: 'Grown', obj: o, act: 'select', ready: true });
    if ((o.type === 'lab' || o.type === 'safari') && o.job) bubbles.push({ wx: base.x, wy: base.y - 110, icon: o.job.done ? (o.type === 'lab' ? 'baby' : 'safariicon') : 'hourglass', text: o.job.done ? 'Ready' : fmtTime(o.job.end - S.clock), obj: o, act: o.job.done ? 'claim' : 'select', ready: o.job.done });
  }
  if (selected === o) { ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; diamond(ctx, c.x, c.y, o.w * TW / 2 - 2, o.h * TH / 2 - 1); ctx.stroke(); ctx.restore(); }
}
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm'; if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's'; return s + 's'; };
function pushEnc(items, e) {
  const b = BIOMES[e.biome];
  if (e.build) {
    const c = iso(e.gx + 1.5, e.gy + 1.5);
    items.push({ d: e.gx + e.gy + 3, f: () => { drawDecorSprite('construction3', c.x, c.y, isMoving(e) ? 0.35 : 1); bubbles.push({ wx: c.x, wy: c.y - 70, icon: 'hourglass', text: fmtTime(e.build - S.clock), obj: e, act: 'select' }); } });
    return;
  }
  const segs = [];
  for (let x = e.gx; x < e.gx + e.w; x++) { segs.push([x, e.gy, x + 1, e.gy]); segs.push([x, e.gy + e.h, x + 1, e.gy + e.h]); }
  for (let y = e.gy; y < e.gy + e.h; y++) { segs.push([e.gx, y, e.gx, y + 1]); segs.push([e.gx + e.w, y, e.gx + e.w, y + 1]); }
  for (const s of segs) items.push({ d: (s[0] + s[2]) / 2 + (s[1] + s[3]) / 2 + 0.01, f: () => drawFence(s, b, e) });
  for (const pr of encProps(e)) items.push({ d: e.gx + pr.lx + e.gy + pr.ly, f: () => { const p = iso(e.gx + pr.lx, e.gy + pr.ly); drawProp(pr.t, p.x, p.y); } });
  if (!isMoving(e)) for (const a of e.animals) items.push({ d: e.gx + a.lx + e.gy + a.ly, f: () => drawAnimal(e, a) });
  items.push({ d: e.gx + e.gy + e.w + e.h + 0.5, f: () => {
    const p = iso(e.gx + 1.5, e.gy + 1.5);
    const list = [];
    if (!e.animals.length) list.push({ icon: 'heart', text: 'Add', act: 'select' });
    const counts = {}; let sick = 0;
    for (const a of e.animals) { if (a.sick) sick++; for (const n of activeNeeds(a)) counts[n] = (counts[n] || 0) + 1; }
    if (sick) list.push({ icon: 'medicine', act: 'heal', n: sick, warn: true });
    for (const n of NEEDS) if (counts[n]) list.push({ icon: n === 'food' ? SPECIES[e.species].food : n, act: 'care', need: n, n: counts[n] });
    if (e.dung.length >= 2) list.push({ icon: 'broom', act: 'clean' });
    list.forEach((it, i) => bubbles.push({ wx: p.x + (i - (list.length - 1) / 2) * 40, wy: p.y - 88, obj: e, ...it }));
  } });
}
function encProps(e) {
  if (e._props) return e._props;
  const r = seeded(e.gx * 31 + e.gy * 17 + 3);
  const kinds = { meadow: ['flowers', 'bush'], ice: ['ice', 'ice'], lagoon: ['reed', 'reed'], desert: ['cactus', 'rockS'], bamboo: ['bamboo', 'bamboo'], savanna: ['acacia', 'grassT'] }[e.biome];
  e._props = [{ t: kinds[0], lx: 0.35 + r() * 0.3, ly: 0.35 + r() * 0.3 }, { t: kinds[1], lx: e.w - 0.4 - r() * 0.3, ly: e.h - 1.2 - r() * 0.2 }, { t: kinds[1], lx: 0.4 + r() * 0.3, ly: e.h * 0.45 + r() * 0.3 }];
  return e._props;
}
function drawProp(t, x, y) {
  ctx.save(); ctx.translate(x, y);
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke(); };
  if (t === 'flowers' || t === 'bush') { if (ART.decor[t]) { ctx.scale(0.7, 0.7); ART.decor[t](ctx, T); } }
  else if (t === 'ice') { ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#a9cfe2'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-8, -10); ctx.lineTo(2, -14); ctx.lineTo(11, -6); ctx.lineTo(12, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#dbeef7'; ctx.beginPath(); ctx.moveTo(2, -14); ctx.lineTo(11, -6); ctx.lineTo(12, 0); ctx.lineTo(3, 0); ctx.closePath(); ctx.fill(); }
  else if (t === 'reed') { ctx.strokeStyle = '#5f9a3c'; ctx.lineWidth = 2; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 3, 0); ctx.quadraticCurveTo(i * 4 + Math.sin(T + i) * 2, -10, i * 5 + Math.sin(T * 1.3 + i) * 2, -20 + Math.abs(i) * 2); ctx.stroke(); } ctx.fillStyle = '#7a4f2a'; ctx.beginPath(); ctx.ellipse(5 + Math.sin(T * 1.3) * 2, -19, 2, 5, 0.3, 0, Math.PI * 2); ctx.fill(); }
  else if (t === 'cactus') { ctx.fillStyle = '#6aa84f'; ctx.strokeStyle = '#4c7f37'; ctx.lineWidth = 1.2; rr(-4, -24, 8, 24, 4); rr(-12, -16, 6, 10, 3); rr(6, -19, 6, 9, 3); }
  else if (t === 'rockS') { if (ART.decor.rock) { ctx.scale(0.7, 0.7); ART.decor.rock(ctx, T); } }
  else if (t === 'bamboo') { for (let i = -1; i <= 1; i++) { const hh = 34 + i * 6; ctx.fillStyle = '#9cc75a'; ctx.strokeStyle = '#6f9a3c'; ctx.lineWidth = 1; ctx.fillRect(i * 6 - 2, -hh, 4, hh); ctx.strokeRect(i * 6 - 2, -hh, 4, hh); for (let k = 8; k < hh; k += 9) { ctx.beginPath(); ctx.moveTo(i * 6 - 2.5, -k); ctx.lineTo(i * 6 + 2.5, -k); ctx.stroke(); } ctx.fillStyle = '#7fb84a'; ctx.beginPath(); ctx.ellipse(i * 6 + 5, -hh + 3, 6, 2, -0.5 + Math.sin(T + i) * 0.1, 0, Math.PI * 2); ctx.fill(); } }
  else if (t === 'acacia') { ctx.strokeStyle = '#7a5434'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22); ctx.lineTo(-7, -32); ctx.moveTo(0, -22); ctx.lineTo(8, -31); ctx.stroke(); ctx.fillStyle = '#7ea64a'; ctx.beginPath(); ctx.ellipse(0, -34, 22, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#93ba5a'; ctx.beginPath(); ctx.ellipse(-3, -36, 15, 4, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (t === 'grassT') { ctx.strokeStyle = '#b59a4a'; ctx.lineWidth = 1.5; for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 2, 0); ctx.lineTo(i * 3 + Math.sin(T + i) * 1.5, -9 - (3 - Math.abs(i))); ctx.stroke(); } }
  ctx.restore();
}
function drawFence(s, b, e) {
  const a = iso(s[0], s[1]), c = iso(s[2], s[3]), sel = selected === e;
  ctx.save(); if (isMoving(e)) ctx.globalAlpha = 0.35; ctx.lineCap = 'round';
  for (const hgt of [6, 13]) {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(a.x, a.y - hgt + 1.5); ctx.lineTo(c.x, c.y - hgt + 1.5); ctx.stroke();
    ctx.strokeStyle = b.rail; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(a.x, a.y - hgt); ctx.lineTo(c.x, c.y - hgt); ctx.stroke();
  }
  for (const p of [a, c]) { ctx.fillStyle = b.fence; ctx.fillRect(p.x - 2, p.y - 17, 4, 17); ctx.fillStyle = sel ? '#fff' : b.rail; ctx.beginPath(); ctx.ellipse(p.x, p.y - 17, 2.4, 1.4, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function drawAnimal(e, a) {
  const p = iso(e.gx + a.lx, e.gy + a.ly), fn = ART.animals[a.species];
  ctx.save(); ctx.translate(p.x, p.y);
  if (fn) { try { fn(ctx, T + a.phase, { baby: a.baby, flip: a.flip, moving: a.moving, sex: a.sex, variant: a.variant }); } catch (er) {} }
  const top = -((SPECIES[a.species] && a.species === 'giraffe') ? 66 : a.species === 'crocodile' ? 22 : 42) * (a.baby ? 0.65 : 1);
  if (a.sick) { const bob = Math.sin(T * 3 + a.phase) * 2; drawIcon('sick', 0, top - 6 + bob, 15); }
  else { const n = activeNeeds(a); if (n.length) { const bob = Math.sin(T * 3 + a.phase) * 2; drawIcon(n[0] === 'food' ? SPECIES[a.species].food : n[0], 0, top - 6 + bob, 13); } }
  if (a.heart > 0) { a.heart -= 1 / 60; ctx.globalAlpha = Math.min(1, a.heart); drawIcon('heart', 8, top - 10 - (1.2 - a.heart) * 12, 12); }
  ctx.restore();
}
function drawVisitor(v, p) {
  const fade = Math.max(0, Math.min(1, v.life + 1 - v.age, v.age * 2));
  ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x, p.y);
  if (ART.person) { try { ART.person(ctx, T + v.life, { shirt: v.shirt, skin: v.skin, hair: v.hair, moving: v.moving, flip: v.flip }); } catch (e) {} }
  if (v.heart > 0) { v.heart -= 1 / 60; ctx.translate(0, -34 - (1.6 - v.heart) * 10); ctx.globalAlpha = fade * Math.min(1, v.heart); if (ART.icons.heart) ART.icons.heart(ctx, 12); }
  ctx.restore();
}
function drawGhost(gx, gy) {
  const ok = canPlace(tool, gx, gy) && S.coins >= toolCost(tool), f = footprint(tool);
  ctx.save();
  for (let x = gx; x < gx + f.w; x++) for (let y = gy; y < gy + f.h; y++) { const p = iso(x + 0.5, y + 0.5); ctx.fillStyle = ok ? 'rgba(120,230,140,0.45)' : 'rgba(230,90,80,0.45)'; diamond(ctx, p.x, p.y, TW / 2 - 1, TH / 2 - 0.5); ctx.fill(); }
  const c = iso(gx + f.w / 2, gy + f.h / 2);
  const t = tool.kind === 'move' ? (tool.obj.kind === 'enc' ? null : tool.obj.type) : tool.kind === 'place' ? (tool.item.kind === 'enc' ? null : tool.item.type) : tool.kind === 'enc' ? null : tool.type;
  if (t) drawDecorSprite(t, c.x, c.y, 0.65);
  else if (tool.kind === 'move' && tool.obj.kind === 'enc') { const h = tool.obj; ctx.globalAlpha = 0.75; for (const a of h.animals) { const p = iso(gx + a.lx, gy + a.ly), fn = ART.animals[a.species]; if (fn) { ctx.save(); ctx.translate(p.x, p.y); fn(ctx, T + a.phase, { baby: a.baby, flip: a.flip, sex: a.sex, variant: a.variant }); ctx.restore(); } } }
  else drawDecorSprite('construction3', c.x, c.y, 0.5);
  ctx.restore();
}
function drawBubbles() {
  for (const b of bubbles) {
    const bob = Math.sin(T * 3 + b.wx * 0.05) * 2.5, y = b.wy + bob;
    const wide = b.n != null || b.text, w = wide ? (b.text && b.text.length > 3 ? 70 : 50) : 30, h = 30;
    const ready = b.ready, warn = b.warn;
    ctx.save();
    ctx.fillStyle = ready ? '#fff6d6' : warn ? '#ffe3e0' : '#ffffff';
    ctx.strokeStyle = ready ? '#e39b2d' : warn ? '#d9534f' : '#3f8f4e'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(b.wx - w / 2, y - h / 2, w, h, 15) : ctx.rect(b.wx - w / 2, y - h / 2, w, h); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.wx - 5, y + h / 2 - 1); ctx.lineTo(b.wx, y + h / 2 + 6); ctx.lineTo(b.wx + 5, y + h / 2 - 1); ctx.fill();
    ctx.restore();
    const ix = wide ? b.wx - w / 2 + 16 : b.wx;
    drawIcon(b.icon, ix, y, 18);
    if (wide) { ctx.save(); ctx.font = '800 11.5px Nunito, system-ui, sans-serif'; ctx.fillStyle = '#2e3a2a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(b.text || ('×' + b.n), ix + 11, y + 0.5); ctx.restore(); }
    b.hit = { x: b.wx - w / 2, y: y - h / 2, w, h: h + 6 };
  }
}

// ---------- input ----------
const pointers = new Map(); let drag = null, pinch = null, spaceDown = false;
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); audioUnlock();
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, camx: cam.x, camy: cam.y }; drag = null; return; }
  const pan = e.button === 1 || e.button === 2 || spaceDown;
  drag = { sx: e.offsetX, sy: e.offsetY, camx: cam.x, camy: cam.y, moved: false, pan, paint: !pan && tool && (tool.kind === 'path' || tool.kind === 'bulldoze') };
  if (drag.paint) { const g = toGrid(e.offsetX, e.offsetY); place(g.x, g.y); drag.lastG = g.x + ',' + g.y; }
});
cv.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  const g = toGrid(e.offsetX, e.offsetY); const off = toolOffset(tool); hover = { x: g.x - off, y: g.y - off };
  if (pinch && pointers.size >= 2) { const [a, b] = [...pointers.values()]; cam.z = pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d; cam.x = pinch.camx - ((a.x + b.x) / 2 - pinch.cx) / cam.z; cam.y = pinch.camy - ((a.y + b.y) / 2 - pinch.cy) / cam.z; clampCam(); return; }
  if (!drag) { cv.style.cursor = tool ? 'crosshair' : ''; return; }
  const dx = e.offsetX - drag.sx, dy = e.offsetY - drag.sy; if (Math.hypot(dx, dy) > 6) drag.moved = true;
  if (drag.paint) { if (!tool) { drag = null; return; } const k = g.x + ',' + g.y; if (k !== drag.lastG) { drag.lastG = k; if (tool.kind === 'path') paintPath(g.x, g.y); else bulldoze(g.x, g.y, true); } return; }
  if (drag.moved) { cam.x = drag.camx - dx / cam.z; cam.y = drag.camy - dy / cam.z; clampCam(); cv.style.cursor = 'grabbing'; }
});
function endPointer(e) { pointers.delete(e.pointerId); if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; } if (drag && !drag.moved && !drag.paint && !drag.pan) tap(e.offsetX, e.offsetY); drag = null; cv.style.cursor = ''; }
cv.addEventListener('pointerup', endPointer); cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { if (!drag) hover = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); const b = toWorld(e.offsetX, e.offsetY); cam.z *= Math.exp(-e.deltaY * 0.0015); clampCam(); const a = toWorld(e.offsetX, e.offsetY); cam.x += b.x - a.x; cam.y += b.y - a.y; clampCam(); }, { passive: false });
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') spaceDown = true;
  if (e.key === 'Escape') { setTool(null); select(null); closeSheets(); }
  const st = 40 / cam.z;
  if (e.key === 'ArrowLeft') cam.x -= st; if (e.key === 'ArrowRight') cam.x += st; if (e.key === 'ArrowUp') cam.y -= st; if (e.key === 'ArrowDown') cam.y += st; clampCam();
});
window.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
function bubbleAt(sx, sy) { const w = toWorld(sx, sy); for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; if (b.hit && w.x >= b.hit.x && w.x <= b.hit.x + b.hit.w && w.y >= b.hit.y && w.y <= b.hit.y + b.hit.h) return b; } return null; }
function tap(sx, sy) {
  const w = toWorld(sx, sy);
  if (!tool) {
    const b = bubbleAt(sx, sy);
    if (b) {
      if (b.escaped) return catchEscaped(b.escaped);
      const o = b.obj;
      if (b.act === 'collect') return collectShop(o);
      if (b.act === 'care') { careAll(o, b.need); return; }
      if (b.act === 'heal') return healAll(o);
      if (b.act === 'clean') return cleanEnc(o);
      if (b.act === 'claim') { select(o); return; }
      return select(o);
    }
    for (const p of S.escaped) { const q = iso(p.x, p.y); if (Math.hypot(w.x - q.x, w.y - (q.y - 14)) < 22) return catchEscaped(p); }
    // animals
    let best = null, bd = 18;
    for (const e of S.objects) if (e.kind === 'enc' && !e.build) for (const a of e.animals) { const p = iso(e.gx + a.lx, e.gy + a.ly); const d = Math.hypot(w.x - p.x, w.y - (p.y - 14 * (a.baby ? 0.6 : 1))); if (d < bd) { bd = d; best = [e, a]; } }
    if (best) { careOne(best[0], best[1]); return; }
    for (const e of S.objects) if (e.kind === 'enc') for (const d of e.dung) { const p = iso(e.gx + d.lx, e.gy + d.ly); if (Math.hypot(w.x - p.x, w.y - p.y + 4) < 11) { e.dung = e.dung.filter(x => x !== d); careReward(); sfx('clean'); dirty(); return; } }
    for (const l of S.litter) { const p = iso(l.x + 0.5 + l.ox, l.y + 0.5 + l.oy); if (Math.hypot(w.x - p.x, w.y - p.y) < 13) return pickLitter(l); }
  }
  const g = toGrid(sx, sy);
  if (tool) { const off = toolOffset(tool); return place(g.x - off, g.y - off); }
  if (!inGrid(g.x, g.y)) return select(null);
  if (!owned(g.x, g.y)) { select({ kind: 'land' }); return; }
  select(occ[g.x][g.y] || null);
}

// ---------- UI helpers ----------
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
function iconCanvas(id, size, kind, opts) {
  const c = document.createElement('canvas'); const d = Math.min(2, window.devicePixelRatio || 1);
  c.width = size * d; c.height = size * d; c.style.width = size + 'px'; c.style.height = size + 'px';
  const x = c.getContext('2d'); x.scale(d, d);
  try {
    if (kind === 'icon' && ART.icons[id]) { x.translate(size / 2, size / 2); ART.icons[id](x, size * 0.9); }
    else if (kind === 'animal' && ART.animals[id]) { const tall = id === 'giraffe' ? 82 : id === 'crocodile' ? 54 : 66; x.translate(size / 2, size * 0.9); const s = size / tall; x.scale(s, s); ART.animals[id](x, 0.5, Object.assign({ sex: 'm' }, opts || {})); }
    else if (kind === 'decor' && ART.decor[id]) { const big = boxFor(id) === BOX2; x.translate(size / 2, size * (big ? 0.78 : 0.86)); const s = size / (big ? 150 : 90); x.scale(s, s); ART.decor[id](x, 0.5); }
    else if (kind === 'enc') { x.translate(size / 2, size / 2 + 6); const b = BIOMES[id]; const s = size / 80; x.scale(s, s); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const p = { x: (i - j) * 13, y: (i + j - 2) * 6.5 }; x.fillStyle = (i + j) % 2 ? b.g1 : b.g2; diamond(x, p.x, p.y, 13.5, 6.8); x.fill(); } x.strokeStyle = b.rail; x.lineWidth = 3; x.beginPath(); x.moveTo(-39, -6.5); x.lineTo(0, -26); x.lineTo(39, -6.5); x.stroke(); x.beginPath(); x.moveTo(-39, -6.5); x.lineTo(0, 13); x.lineTo(39, -6.5); x.stroke(); }
  } catch (e) {}
  return c;
}
const ic = (id, size) => { const s = el('span', 'ic'); s.appendChild(iconCanvas(id, size || 16, 'icon')); return s.outerHTML; };
function priceTag(c) { const parts = []; if (c.coins) parts.push(`<span class="pt ${S.coins < c.coins ? 'no' : ''}">${ic('coin', 14)}${fmt(c.coins)}</span>`); if (c.gems) parts.push(`<span class="pt ${S.gems < c.gems ? 'no' : ''}">${ic('gem', 14)}${c.gems}</span>`); if (c.paws) parts.push(`<span class="pt ${S.paws < c.paws ? 'no' : ''}">${ic('paw', 14)}${c.paws}</span>`); return parts.join(''); }
function canPay(c) { return S.coins >= (c.coins || 0) && S.gems >= (c.gems || 0) && S.paws >= (c.paws || 0); }
function pay(c) { if (!canPay(c)) { toast('Not enough ' + (S.coins < (c.coins || 0) ? 'coins' : S.gems < (c.gems || 0) ? 'gems' : 'paws'), 'warn'); sfx('no'); return false; } S.coins -= c.coins || 0; S.gems -= c.gems || 0; S.paws -= c.paws || 0; return true; }
function closeSheets() { for (const id of ['#shop', '#storage', '#quests', '#hub']) $(id).hidden = true; document.body.classList.remove('sheet-open'); }
function openSheet(id) { const was = !$(id).hidden; closeSheets(); select(null); if (!was) { $(id).hidden = false; document.body.classList.add('sheet-open'); } return !was; }

function updateHUD() {
  $('#coins').textContent = fmt(S.coins); $('#gems').textContent = S.gems; $('#paws').textContent = S.paws;
  $('#lvl').textContent = S.level; $('#xpfill').style.width = Math.min(100, S.xp / xpFor(S.level) * 100) + '%'; $('#xptext').textContent = `${Math.floor(S.xp)} / ${xpFor(S.level)} XP`;
  $('#meterfill').style.width = M.meter + '%'; $('#meterfill').className = M.meter < 40 ? 'low' : M.meter < 70 ? 'mid' : ''; $('#metertext').textContent = M.meter + '%';
  $('#visitors').textContent = visitors.length; $('#stars').textContent = M.attraction;
  const q = S.tut < 0 ? activeQuests().filter(x => x.done).length : 0; $('#questBadge').hidden = !q; $('#questBadge').textContent = q;
  const hubN = S.tut >= 0 ? 0 : (Date.now() >= S.wheelNext ? 1 : 0) + Object.keys(COLLECTIONS).filter(b => collComplete(b) && !S.collectionsDone.includes(b)).length;
  $('#hubBadge').hidden = !hubN; $('#hubBadge').textContent = hubN;
  const storeN = S.storage.animals.length + S.storage.items.length; $('#storeBadge').hidden = !storeN; $('#storeBadge').textContent = storeN;
  if (!$('#quests').hidden) renderQuests();
}

function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', !!t && b.dataset.tool === t.kind));
  const hint = $('#toolHint');
  if (!t) { hint.hidden = true; return; }
  hint.hidden = false;
  const txt = {
    enc: () => `Tap a free 3×3 spot for ${/^[aeiou]/i.test(BIOMES[t.biome].name) ? 'an' : 'a'} ${BIOMES[t.biome].name.toLowerCase()} enclosure · ${BIOMES[t.biome].cost} coins`,
    shop: () => `Tap a spot next to a path for the ${SHOPS[t.type].name.toLowerCase()} · ${fmt(SHOPS[t.type].cost)} coins`,
    bld: () => `Tap a free 2×2 spot for the ${BUILDINGS[t.type].name.toLowerCase()} · ${fmt(BUILDINGS[t.type].cost)} coins`,
    deco: () => `Tap to place: ${DECOR[t.type].name} · ${DECOR[t.type].cost} coins`,
    path: () => 'Drag to lay path · 3 coins per tile. Visitors walk from the gate along paths.',
    bulldoze: () => 'Tap or drag to remove paths and decor, or pick up litter. Clearing wild land costs 15.',
    move: () => 'Tap a free spot to move it. Animals come along.',
    place: () => 'Tap a free spot to place it from storage.',
  }[t.kind]();
  $('#toolHintText').textContent = txt; select(null);
}

// ---------- selection panel ----------
let animalMove = null, panelSig = '', confirmRemove = null, adoptOpen = false;
function select(o) { if (o !== selected) { animalMove = null; confirmRemove = null; adoptOpen = false; } selected = o; if (o) closeSheets(); renderPanel(true); }
function sigOf(o) {
  if (o.kind === 'enc') return [o.id, o.build ? 'b' : '', o.level, o.species, o.animals.map(a => a.id + (a.baby ? 'b' : '') + (a.sick ? 's' : '')).join(), animalMove, confirmRemove === o, adoptOpen, S.storage.animals.length, Math.floor(S.coins / 50)].join('|');
  if (o.kind === 'bld') return [o.id, o.build ? 'b' : '', JSON.stringify(o.slots.map(s => s.rec.baby)), o.job && o.job.done, !!o.job, S.storage.animals.length, labPick.join()].join('|');
  return [o.kind, o.id, o.build ? 'b' : '', o.prog >= 1].join('|');
}
function renderPanel(force) {
  const P = $('#panel'); const o = selected;
  document.body.classList.toggle('panel-open', !!o);
  if (!o) { P.hidden = true; return; }
  P.hidden = false;
  const sig = sigOf(o);
  if (!force && sig === panelSig) { livePanel(o); return; }
  panelSig = sig; P.innerHTML = '';
  const close = el('button', 'x', '×'); close.setAttribute('aria-label', 'Close'); close.onclick = () => select(null); P.appendChild(close);
  if (o.kind === 'land') return landPanel(P);
  if (o.build) return buildingPanel(P, o);
  if (o.kind === 'enc') return encPanel(P, o);
  if (o.kind === 'shop') return shopPanel(P, o);
  if (o.kind === 'bld') return ({ nursery: nurseryPanel, lab: labPanel, safari: safariPanel })[o.type](P, o);
  if (o.kind === 'wild') { P.appendChild(el('div', 'phead', `<div><div class="eyebrow">Wild land</div><h2>${o.type === 'rock' ? 'Boulder' : o.type === 'bush' ? 'Wild bush' : 'Wild tree'}</h2><div class="sub">Clear it to make room.</div></div>`)); const r = el('div', 'row'); const b = btn('btn', `Clear ${priceTag({ coins: 15 })}`, () => { bulldoze(o.gx, o.gy, false); select(null); }); r.appendChild(b); P.appendChild(r); return; }
  if (o.kind === 'gate') { P.appendChild(el('div', 'phead', `<div><div class="eyebrow">Entrance</div><h2>Main gate</h2><div class="sub">Each visitor pays ${ticketPrice()} coin${ticketPrice() > 1 ? 's' : ''} to enter. Visitors only walk on paths connected to this gate. The Zoo meter and your attraction stars decide how many come (now ${M.target}).</div></div>`)); return; }
  // deco
  const D = DECOR[o.type] || { name: 'Delivery crate', appeal: 0 };
  const head = el('div', 'phead'); head.appendChild(iconCanvas(o.type, 56, 'decor'));
  head.appendChild(el('div', '', `<div class="eyebrow">Decoration · +${D.appeal} stars</div><h2>${D.name}</h2><div class="sub">${D.bin ? 'Visitors near a bin drop far less litter.' : o.type === 'crate' ? 'The penguins\' old crate. You can clear it away.' : 'Decor raises the Zoo meter and attraction.'}</div>`));
  P.appendChild(head);
  const r = el('div', 'row wrap');
  if (D.cost) { r.appendChild(btn('mini', 'Move', () => setTool({ kind: 'move', obj: o, w: o.w, h: o.h }))); r.appendChild(btn('mini', 'Store', () => storeObj(o))); }
  r.appendChild(btn('mini ghost', `Remove${sellValue(o) ? ' (+' + sellValue(o) + ')' : ''}`, () => removeObj(o)));
  P.appendChild(r);
}
function btn(cls, html, fn, disabled) { const b = el('button', cls, html); b.onclick = e => { e.stopPropagation(); fn(); renderPanel(true); updateHUD(); }; if (disabled) b.disabled = true; return b; }
function buildingPanel(P, o) {
  P.appendChild(el('div', 'phead', `<div><div class="eyebrow">Under construction</div><h2>${objName(o)}</h2><div class="sub">Ready in <b data-live="bt">${fmtTime(o.build - S.clock)}</b></div></div>`));
  const r = el('div', 'row'); r.appendChild(btn('btn gem', `Finish now ${priceTag({ gems: finishBuildCost(o) })}`, () => rushBuild(o))); P.appendChild(r);
}
function livePanel(o) {
  const P = $('#panel'); const set = (k, f) => { const e = P.querySelector(`[data-live="${k}"]`); if (e) f(e); };
  if (o.build) { set('bt', e => e.textContent = fmtTime(o.build - S.clock)); return; }
  if (o.kind === 'enc') {
    const m = encMood(o);
    set('mood', e => { e.style.width = m * 100 + '%'; e.className = 'mood' + (m < 0.55 ? ' low' : ''); });
    set('moodt', e => e.textContent = m >= 0.85 ? 'Thrilled' : m >= 0.65 ? 'Content' : m >= 0.4 ? 'Grumpy' : 'Miserable');
    set('clean', e => { const c = 1 - o.dung.length / 6; e.style.width = c * 100 + '%'; e.className = c < 0.5 ? 'low' : ''; });
    set('cleant', e => e.textContent = o.dung.length ? `${o.dung.length} pile${o.dung.length > 1 ? 's' : ''}` : 'Spotless');
    for (const n of NEEDS) set('need-' + n, e => { const c = o.animals.filter(a => needActive(a, n)).length; e.disabled = !c; e.querySelector('b').textContent = c ? '×' + c : ''; });
    set('stock', e => { if (o.species) { const f = SPECIES[o.species].food; e.innerHTML = `${ic(f, 14)} ${S.food[f]} ${FOODS[f].name.toLowerCase()} in stock`; } });
    set('breed', e => {
      const ad = o.animals.filter(a => !a.baby);
      if (!o.species) e.textContent = '';
      else if (!(ad.some(a => a.sex === 'm') && ad.some(a => a.sex === 'f'))) e.textContent = 'Needs an adult ♂ and ♀ to breed';
      else if (o.animals.length >= capOf(o)) e.textContent = 'Full: upgrade for babies';
      else if (!ad.every(a => !a.sick && mood(o, a) >= 0.7)) e.textContent = 'Parents must be happy and healthy to breed';
      else e.textContent = `Baby on the way · ${Math.round((o.breed || 0) * 100)}%`;
    });
    o.animals.forEach(a => set('an-' + a.id, e => { const n = activeNeeds(a); e.innerHTML = (a.sick ? ic('sick', 14) : '') + n.map(x => ic(x === 'food' ? SPECIES[a.species].food : x, 14)).join('') + (a.baby ? `<small class="grow">${Math.round(a.grow * 100)}%</small>` : ''); }));
  }
  if (o.kind === 'shop') { set('prog', e => e.style.width = o.prog * 100 + '%'); set('progt', e => e.textContent = o.prog >= 1 ? 'Ready to collect' : !o._conn ? 'Waiting for a path' : `Ready in about ${fmtTime((1 - o.prog) / Math.max(1e-6, shopRate(o, visitors.length)))}`); }
  if (o.kind === 'bld') { P.querySelectorAll('[data-slot]').forEach(e => { const s = o.slots[+e.dataset.slot]; if (s) e.style.width = Math.round(s.rec.grow * 100) + '%'; }); set('job', e => { if (o.job) e.textContent = o.job.done ? 'Done!' : fmtTime(o.job.end - S.clock); }); }
}
function encPanel(P, o) {
  const B = BIOMES[o.biome], sp = o.species && SPECIES[o.species];
  const head = el('div', 'phead');
  head.appendChild(o.species ? iconCanvas(o.species, 56, 'animal', { variant: o.variant }) : iconCanvas(o.biome, 56, 'enc'));
  head.appendChild(el('div', '', `<div class="eyebrow">${B.name} · Level ${o.level + 1}</div><h2>${encLabel(o)}</h2><div class="sub">${o.animals.length} / ${capOf(o)} animals${o.species && o.variant ? ' · ' + VNAME(o.species, o.variant) + ' <span class="deg">' + DEGREE[o.variant] + '</span>' : ''}</div></div>`));
  P.appendChild(head);
  if (o.animals.length) {
    const bars = el('div', 'bars');
    bars.innerHTML = `<div class="bar"><span>Mood</span><i><b data-live="mood"></b></i><small data-live="moodt"></small></div><div class="bar"><span>Clean</span><i><b data-live="clean"></b></i><small data-live="cleant"></small></div>`;
    P.appendChild(bars);
    const care = el('div', 'care');
    for (const n of NEEDS) { const b = btn('carebtn', `${ic(n === 'food' ? sp.food : n, 20)}<span>${G.NEED_LABEL[n]}</span><b></b>`, () => careAll(o, n)); b.dataset.live = 'need-' + n; care.appendChild(b); }
    const cb = btn('carebtn', `${ic('broom', 20)}<span>Clean</span><b></b>`, () => cleanEnc(o)); care.appendChild(cb);
    if (o.animals.some(a => a.sick)) care.appendChild(btn('carebtn warn', `${ic('medicine', 20)}<span>Heal</span><b>${S.medicine}</b>`, () => healAll(o)));
    P.appendChild(care);
    P.appendChild(el('div', 'hint', `<span data-live="stock"></span> · <span data-live="breed"></span>`));
  }
  const list = el('div', 'animals');
  for (const a of o.animals) {
    const r = el('div', 'animal');
    r.innerHTML = `<span class="sex ${a.sex}">${a.sex === 'm' ? '♂' : '♀'}</span><span class="nm">${a.name}${a.baby ? ' <small>baby</small>' : ''}</span><span class="needs" data-live="an-${a.id}"></span>`;
    const others = S.objects.filter(x => x.kind === 'enc' && x !== o && canHold(x, a.species, a.variant));
    const nurs = S.objects.find(x => x.type === 'nursery' && !x.build);
    if (a.baby && nurs) r.appendChild(btn('mini', 'Nursery', () => { if (nurs.slots.length >= 3) { toast('The nursery is full (3 babies)', 'warn'); return; } o.animals = o.animals.filter(x => x !== a); if (!o.animals.length) o.species = null; nurs.slots.push({ rec: toRec(a) }); toast(`${a.name} went to the nursery`); dirty(); }));
    const mv = btn('mini' + (animalMove === a.id ? ' on' : ''), 'Move', () => { animalMove = animalMove === a.id ? null : a.id; }); mv.disabled = !others.length; if (!others.length) mv.title = 'No other enclosure with room for this animal';
    r.appendChild(mv);
    r.appendChild(btn('mini ghost', 'Store', () => { o.animals = o.animals.filter(x => x !== a); if (!o.animals.length) o.species = null; S.storage.animals.push(toRec(a)); dirty(); }));
    list.appendChild(r);
    if (animalMove === a.id) {
      const pk = el('div', 'movepick', `<span>Move ${a.name} to</span>`);
      for (const t of others) pk.appendChild(btn('mini', `${encLabel(t).replace(' enclosure', '')} · ${t.animals.length}/${capOf(t)}`, () => { o.animals = o.animals.filter(x => x !== a); if (!o.animals.length) o.species = null; placeRec(t, toRec(a)); animalMove = null; toast(`${a.name} moved to ${encLabel(t)}`); dirty(); }));
      list.appendChild(pk);
    }
  }
  if (!o.animals.length) list.appendChild(el('p', 'empty', `This enclosure is empty. Adopt a male and a female so they can have babies, or add animals from storage. ${BIOMES[o.biome].name} animals: ${Object.values(SPECIES).filter(s => s.biome === o.biome).map(s => s.name.toLowerCase()).join(', ')}.`));
  P.appendChild(list);
  // add animals
  const room = o.animals.length < capOf(o);
  const stored = S.storage.animals.filter(r => canHold(o, r.species, r.variant));
  const add = el('div', 'row wrap');
  if (room && stored.length) add.appendChild(btn('btn', `Add from storage <em class="cnt">${stored.length}</em>`, () => { adoptOpen = adoptOpen === 'store' ? false : 'store'; }));
  if (room && (!o.species || o.variant === 0)) add.appendChild(btn('btn ghost', o.species ? `Adopt ${SPECIES[o.species].name.toLowerCase()}` : 'Adopt animals', () => { adoptOpen = adoptOpen === 'adopt' ? false : 'adopt'; }));
  P.appendChild(add);
  if (adoptOpen === 'store' && room) {
    const g = el('div', 'picklist');
    for (const r of stored) g.appendChild(btn('pick', `<span class="sex ${r.sex}">${r.sex === 'm' ? '♂' : '♀'}</span><span>${r.name} · ${VNAME(r.species, r.variant)}${r.baby ? ' (baby)' : ''}</span><em>Add</em>`, () => { S.storage.animals = S.storage.animals.filter(x => x !== r); placeRec(o, r); if (o.animals.length >= capOf(o)) adoptOpen = false; sfx('adopt'); dirty(); }));
    P.appendChild(g);
  }
  if (adoptOpen === 'adopt' && room) {
    const g = el('div', 'picklist');
    const list2 = o.species ? [o.species] : Object.keys(SPECIES).filter(k => fitsBiome(o, k));
    for (const k of list2) {
      const s = SPECIES[k], locked = S.level < s.lvl;
      const row = el('div', 'pick' + (locked ? ' locked' : ''));
      row.appendChild(iconCanvas(k, 30, 'animal'));
      row.appendChild(el('span', 'pn', `${s.name}<br><small>${locked ? 'Level ' + s.lvl : ic(s.food, 12) + ' ' + FOODS[s.food].name + ' · ' + s.appeal + ' ★'}</small>`));
      if (!locked) {
        row.appendChild(btn('mini', `♂ ${priceTag({ coins: s.cost })}`, () => adopt(o, k, 'm', 0)));
        row.appendChild(btn('mini', `♀ ${priceTag({ coins: s.cost })}`, () => adopt(o, k, 'f', 0)));
        if (!o.species) { const rb = btn('mini gem', `Rare ${priceTag({ gems: rareGemPrice(k) })}`, () => adopt(o, k, rnd() < 0.5 ? 'm' : 'f', 1)); rb.title = `Adopt a ${VNAME(k, 1)} (2nd-degree subspecies, random sex)`; row.appendChild(rb); }
      }
      g.appendChild(row);
    }
    P.appendChild(g);
  }
  // footer
  const foot = el('div', 'row foot');
  if (o.level < 4) { const U = UPGRADES[o.level + 1]; foot.appendChild(btn('mini', `Upgrade → ${capOf(o) + 1} spots ${priceTag(U)}`, () => { if (pay(U)) { o.level++; addXp(20 * o.level); sfx('build'); toast(`Enclosure upgraded: room for ${capOf(o)} animals`); dirty(); } })); }
  foot.appendChild(btn('mini', 'Move', () => setTool({ kind: 'move', obj: o, w: 3, h: 3 })));
  if (!o.animals.length) foot.appendChild(btn('mini', 'Store', () => storeObj(o)));
  if (confirmRemove === o) { foot.appendChild(el('span', 'warn', `Remove it? Animals go to storage. You get back ${fmt(sellValue(o))} coins${o.level ? ' (half of the enclosure and its upgrades). Store keeps the upgrades instead' : ''}.`)); foot.appendChild(btn('mini danger', 'Yes, remove', () => { for (const a of o.animals) S.storage.animals.push(toRec(a)); removeObj(o); })); foot.appendChild(btn('mini ghost', 'Keep', () => { confirmRemove = null; })); }
  else foot.appendChild(btn('mini ghost', 'Remove', () => { confirmRemove = o; }));
  P.appendChild(foot);
  livePanel(o);
}
const rareGemPrice = k => 4 + Math.floor(SPECIES[k].lvl / 2);
function adopt(o, k, sex, variant) {
  if (!canHold(o, k, variant)) { toast(!fitsBiome(o, k) ? `${SPECIES[k].name}s need a ${BIOMES[SPECIES[k].biome].name.toLowerCase()} enclosure` : o.species && o.species !== k ? 'This enclosure already has another species' : 'No room', 'warn'); return; }
  const c = variant ? { gems: rareGemPrice(k) } : { coins: SPECIES[k].cost };
  if (!pay(c)) return;
  const a = placeRec(o, storeRec(k, variant, sex, false)); addXp(5); sfx('adopt');
  toast(`${a.name} the ${VNAME(k, variant).toLowerCase()} moved in!`); if (variant) adoptOpen = false; dirty();
}
function shopPanel(P, o) {
  const D = SHOPS[o.type];
  const head = el('div', 'phead'); head.appendChild(iconCanvas(o.type, 56, 'decor'));
  head.appendChild(el('div', '', `<div class="eyebrow">Shop · pays ${fmt(D.pay)} coins</div><h2>${D.name}</h2><div class="sub">Base period ${fmtTime(D.period)}. More visitors and a higher Zoo meter fill it faster.</div>`));
  P.appendChild(head);
  if (!o._conn) P.appendChild(el('p', 'empty warnbox', 'No visitors can reach this shop. Put it right next to a path that connects to the gate.'));
  const bars = el('div', 'bars'); bars.innerHTML = `<div class="bar"><span>Stock</span><i><b data-live="prog"></b></i></div><div class="hint" data-live="progt"></div>`; P.appendChild(bars);
  const r = el('div', 'row wrap');
  r.appendChild(btn('btn gold', `Collect ${D.pay}`, () => collectShop(o), o.prog < 1));
  r.appendChild(btn('mini', 'Move', () => setTool({ kind: 'move', obj: o, w: 1, h: 1 })));
  r.appendChild(btn('mini', 'Store', () => storeObj(o)));
  r.appendChild(btn('mini ghost', `Sell (+${sellValue(o)})`, () => removeObj(o)));
  P.appendChild(r); livePanel(o);
}
function nurseryPanel(P, o) {
  P.appendChild(el('div', 'phead', `<div><div class="eyebrow">Building</div><h2>Animal nursery</h2><div class="sub">${BUILDINGS.nursery.desc} Send babies here from their enclosure. Grown animals go to storage.</div></div>`));
  const list = el('div', 'animals');
  for (let i = 0; i < 3; i++) {
    const s = o.slots[i];
    if (!s) { list.appendChild(el('div', 'animal empty-slot', '<span class="nm">Empty crib</span>')); continue; }
    const r = el('div', 'animal'); r.innerHTML = `<span class="sex ${s.rec.sex}">${s.rec.sex === 'm' ? '♂' : '♀'}</span><span class="nm">${s.rec.name} · ${VNAME(s.rec.species, s.rec.variant)}<i class="minibar"><b data-slot="${i}"></b></i></span>`;
    if (!s.rec.baby) r.appendChild(btn('mini gold', 'Collect', () => { o.slots.splice(i, 1); S.storage.animals.push(s.rec); S.paws += 3; addXp(15); toast(`${s.rec.name} is all grown up. +3 paws, now in storage`); sfx('adopt'); }));
    else r.appendChild(btn('mini gem', `Grow now ${priceTag({ gems: 1 })}`, () => { if (pay({ gems: 1 })) { s.rec.baby = false; s.rec.grow = 1; } }));
    list.appendChild(r);
  }
  P.appendChild(list);
  objFoot(P, o); livePanel(o);
}
let labPick = [];
function labPanel(P, o) {
  P.appendChild(el('div', 'phead', `<div><div class="eyebrow">Building</div><h2>Breeding lab</h2><div class="sub">Pick a male and a female of the same subspecies from storage. Both parents are used up. The baby is the same degree or one higher (5th degree is the top).</div></div>`));
  if (o.job) {
    const v = o.job.done ? o.job.variant : null;
    P.appendChild(el('div', 'labjob', o.job.done ? `<b>It's a baby ${VNAME(o.job.species, v)}!</b> ${v > o.job.from ? '<span class="deg">Rarer!</span>' : ''}` : `<span>Breeding ${SPECIES[o.job.species].name} · ${DEGREE[o.job.from] || 'base'}</span> <b data-live="job"></b>`));
    const r = el('div', 'row');
    if (o.job.done) r.appendChild(btn('btn gold', 'Take baby to storage', () => { const j = o.job; S.storage.animals.push(storeRec(j.species, j.variant, rnd() < 0.5 ? 'm' : 'f', true)); if (j.variant > j.from) S.stats.labUp++; o.job = null; addXp(40); sfx('baby'); dirty(); }));
    else r.appendChild(btn('btn gem', `Finish now ${priceTag({ gems: Math.max(1, Math.ceil((o.job.end - S.clock) / 120)) })}`, () => { const c = Math.max(1, Math.ceil((o.job.end - S.clock) / 120)); if (pay({ gems: c })) o.job.end = S.clock; }));
    P.appendChild(r);
  } else {
    const adults = S.storage.animals.filter(r => !r.baby && r.variant < 4);
    if (!adults.length) P.appendChild(el('p', 'empty', 'Store some adult animals first (from an enclosure, tap Store next to an animal). Rare animals from the wheel and safari work great here.'));
    const g = el('div', 'picklist');
    for (const r of adults) { const on = labPick.includes(r.id); g.appendChild(btn('pick' + (on ? ' on' : ''), `<span class="sex ${r.sex}">${r.sex === 'm' ? '♂' : '♀'}</span><span>${r.name} · ${VNAME(r.species, r.variant)}</span><em>${on ? 'Picked' : 'Pick'}</em>`, () => { labPick = on ? labPick.filter(x => x !== r.id) : [...labPick.slice(-1), r.id]; })); }
    P.appendChild(g);
    const [a, b] = labPick.map(id => S.storage.animals.find(x => x.id === id));
    const valid = a && b && a.species === b.species && a.variant === b.variant && a.sex !== b.sex;
    const cost = a ? { coins: 300 * (a.variant + 1) * Math.max(1, SPECIES[a.species].lvl), paws: 4 * (a.variant + 1) } : { coins: 0 };
    const r = el('div', 'row wrap');
    if (labPick.length === 2 && !valid) r.appendChild(el('span', 'warn', 'Pick a ♂ and a ♀ of the same species and degree.'));
    r.appendChild(btn('btn', `Start breeding ${valid ? priceTag(cost) : ''}`, () => {
      if (!valid || !pay(cost)) return;
      S.storage.animals = S.storage.animals.filter(x => x !== a && x !== b);
      const up = rnd() < 0.45 ? 1 : 0;
      o.job = { species: a.species, from: a.variant, variant: Math.min(4, a.variant + up), end: S.clock + 240 * (a.variant + 1), done: false }; labPick = []; sfx('build'); dirty();
    }, !valid));
    P.appendChild(r);
  }
  objFoot(P, o); livePanel(o);
}
function safariPanel(P, o) {
  P.appendChild(el('div', 'phead', `<div><div class="eyebrow">Building</div><h2>Safari station</h2><div class="sub">${BUILDINGS.safari.desc}</div></div>`));
  if (o.job) {
    P.appendChild(el('div', 'labjob', o.job.done ? '<b>The jeep is back!</b>' : `<span>${SAFARI.find(s => s.id === o.job.tier).name} in progress</span> <b data-live="job"></b>`));
    const r = el('div', 'row');
    if (o.job.done) r.appendChild(btn('btn gold', 'Unpack the finds', () => { const parts = safariLoot(o.job.tier); o.job = null; S.stats.safaris++; addXp(30); showReward('Safari finds', parts); }));
    else r.appendChild(btn('btn gem', `Finish now ${priceTag({ gems: Math.max(1, Math.ceil((o.job.end - S.clock) / 120)) })}`, () => { const c = Math.max(1, Math.ceil((o.job.end - S.clock) / 120)); if (pay({ gems: c })) o.job.end = S.clock; }));
    P.appendChild(r);
  } else {
    const g = el('div', 'picklist');
    for (const t of SAFARI) { const row = el('div', 'pick'); row.appendChild(el('span', 'pn', `<b>${t.name}</b> · ${fmtTime(t.time)}<br><small>${t.desc}</small>`)); row.appendChild(btn('mini', `Go ${priceTag(t.cost)}`, () => { if (pay(t.cost)) { o.job = { tier: t.id, end: S.clock + t.time, done: false }; sfx('build'); dirty(); } })); g.appendChild(row); }
    P.appendChild(g);
  }
  objFoot(P, o); livePanel(o);
}
function safariLoot(tier) {
  const p = {}; const parts = [];
  const sps = Object.keys(SPECIES).filter(k => SPECIES[k].lvl <= S.level);
  const animal = v => { const k = pick(sps); S.storage.animals.push(storeRec(k, v, rnd() < 0.5 ? 'm' : 'f', false)); parts.push(`${VNAME(k, v)} (to storage)`); };
  if (tier === 'short') { p.coins = 150 + Math.floor(rnd() * 250); p.food = 15; if (rnd() < 0.4) p.card = 1; if (rnd() < 0.15) animal(0); }
  if (tier === 'mid') { p.coins = 300 + Math.floor(rnd() * 400); p.food = 25; p.paws = 2; if (rnd() < 0.6) p.card = 1; if (rnd() < 0.7) animal(rnd() < 0.25 ? 1 : 0); }
  if (tier === 'long') { p.coins = 800 + Math.floor(rnd() * 900); p.food = 40; p.paws = 5; p.card = 1; animal(rnd() < 0.2 ? 2 : 1); if (rnd() < 0.3) p.gems = 1; }
  return [...grant(p), ...parts];
}
function objFoot(P, o) {
  const f = el('div', 'row foot');
  f.appendChild(btn('mini', 'Move', () => setTool({ kind: 'move', obj: o, w: o.w, h: o.h })));
  if (confirmRemove === o) { f.appendChild(el('span', 'warn', `Sell it for ${sellValue(o)} coins?`)); f.appendChild(btn('mini danger', 'Sell', () => removeObj(o))); f.appendChild(btn('mini ghost', 'Keep', () => { confirmRemove = null; })); }
  else f.appendChild(btn('mini ghost', 'Sell', () => { confirmRemove = o; }));
  P.appendChild(f);
}
function landPanel(P) {
  const nx = EXPANSIONS[S.owned + 1];
  P.appendChild(el('div', 'phead', `<div><div class="eyebrow">Wild forest</div><h2>Not your land yet</h2><div class="sub">${nx ? `The next plot opens at level ${nx.lvl}. You can open it early with gems in the Zoo office.` : 'You own all the land there is.'}</div></div>`));
  if (nx) { const r = el('div', 'row'); r.appendChild(btn('btn', 'Open Zoo office', () => { select(null); openHub('office'); })); P.appendChild(r); }
}

// ---------- build shop ----------
const SHOP_TABS = [['enc', 'Enclosures'], ['shop', 'Shops'], ['bld', 'Buildings'], ['deco', 'Decor'], ['supplies', 'Supplies']];
let shopTab = 'enc';
function renderShop() {
  const tabs = $('#shopTabs'); tabs.innerHTML = '';
  for (const [k, l] of SHOP_TABS) { const b = el('button', 'tab' + (k === shopTab ? ' on' : ''), l); b.onclick = () => { shopTab = k; renderShop(); }; tabs.appendChild(b); }
  const grid = $('#shopGrid'); grid.innerHTML = ''; grid.className = 'grid' + (shopTab === 'supplies' ? ' supplies' : '');
  if (shopTab === 'supplies') return renderSupplies(grid);
  const entries = shopTab === 'enc' ? Object.entries(BIOMES).map(([id, b]) => ({ id, kind: 'enc', name: b.name + ' enclosure', lvl: b.lvl, cost: b.cost, note: 'Home of ' + Object.values(SPECIES).filter(s => s.biome === id).map(s => s.name.toLowerCase()).slice(0, 3).join(', '), t: { kind: 'enc', biome: id } }))
    : shopTab === 'shop' ? Object.entries(SHOPS).map(([id, d]) => ({ id, kind: 'decor', name: d.name, lvl: d.lvl, cost: d.cost, note: `${fmt(d.pay)} coins · about ${fmtTime(d.period / ((0.5 + M.meter / 100) * (0.25 + 0.75 * Math.min(1, visitors.length / 12))))} now`, t: { kind: 'shop', type: id } }))
    : shopTab === 'bld' ? Object.entries(BUILDINGS).map(([id, d]) => ({ id, kind: 'decor', name: d.name, lvl: d.lvl, cost: d.cost, note: d.desc, t: { kind: 'bld', type: id }, unique: true }))
    : Object.entries(DECOR).map(([id, d]) => ({ id, kind: 'decor', name: d.name, lvl: d.lvl, cost: d.cost, note: d.bin ? 'Less litter nearby' : `+${d.appeal} stars`, t: { kind: 'deco', type: id } }));
  for (const e of entries) {
    const have = e.unique && S.objects.some(o => o.type === e.id);
    const locked = S.level < e.lvl;
    const card = el('button', 'card' + (locked || have ? ' locked' : '') + (S.coins < e.cost ? ' poor' : ''));
    card.appendChild(iconCanvas(e.id, 64, e.kind));
    card.appendChild(el('div', 'cname', e.name));
    card.appendChild(el('div', 'cnote', locked ? `Unlocks at level ${e.lvl}` : have ? 'Already built' : e.note));
    card.appendChild(el('div', 'cprice', locked ? ic('lock', 16) : priceTag({ coins: e.cost })));
    card.onclick = () => { if (locked || have) { sfx('no'); return; } setTool(e.t); closeSheets(); };
    grid.appendChild(card);
  }
}
function renderSupplies(grid) {
  const foods = Object.keys(FOODS).map(k => ({ k, used: Object.values(SPECIES).some(s => s.food === k && s.lvl <= S.level) }));
  for (const { k, used } of foods) {
    const F = FOODS[k];
    const row = el('div', 'supply' + (used ? '' : ' dim'));
    row.appendChild(iconCanvas(k, 34, 'icon'));
    row.appendChild(el('div', 'sname', `<b>${F.name}</b><small>${S.food[k]} in stock · eaten by ${Object.values(SPECIES).filter(s => s.food === k).map(s => s.name.toLowerCase()).join(', ')}</small>`));
    row.appendChild(btn('mini', `+10 ${priceTag({ coins: F.price * 10 })}`, () => buyFood(k, 10)));
    row.appendChild(btn('mini', `+50 ${priceTag({ coins: Math.round(F.price * 50 * 0.9) })}`, () => buyFood(k, 50)));
    grid.appendChild(row);
  }
  const row = el('div', 'supply');
  row.appendChild(iconCanvas('medicine', 34, 'icon'));
  row.appendChild(el('div', 'sname', `<b>Medicine</b><small>${S.medicine} in stock · cures a sick animal</small>`));
  row.appendChild(btn('mini', `+1 ${priceTag({ coins: G.MEDICINE_PRICE })}`, () => { if (pay({ coins: G.MEDICINE_PRICE })) { S.medicine++; renderShop(); } }));
  row.appendChild(btn('mini', `+5 ${priceTag({ coins: G.MEDICINE_PRICE * 5 })}`, () => { if (pay({ coins: G.MEDICINE_PRICE * 5 })) { S.medicine += 5; renderShop(); } }));
  grid.appendChild(row);
}
function buyFood(k, n) { const c = n === 50 ? Math.round(FOODS[k].price * 50 * 0.9) : FOODS[k].price * n; if (pay({ coins: c })) { S.food[k] += n; sfx('coin'); renderShop(); dirty(); } }

// ---------- storage ----------
let storageTab = 'animals', placeFor = null;
function renderStorage() {
  const box = $('#storageBody'); const sig = [storageTab, placeFor, S.storage.animals.map(a => a.id).join(), S.storage.items.length, JSON.stringify(S.food), S.medicine].join('|');
  if (box.dataset.sig === sig) return; box.dataset.sig = sig; box.innerHTML = '';
  const tabs = $('#storageTabs'); tabs.innerHTML = '';
  for (const [k, l] of [['animals', `Animals (${S.storage.animals.length})`], ['items', `Items (${S.storage.items.length})`], ['stock', 'Food & medicine']]) { const b = el('button', 'tab' + (k === storageTab ? ' on' : ''), l); b.onclick = () => { storageTab = k; placeFor = null; renderStorage(); }; tabs.appendChild(b); }
  if (storageTab === 'animals') {
    if (!S.storage.animals.length) box.appendChild(el('p', 'empty', 'No animals in storage. Animals from the wheel, the safari, the nursery and the lab arrive here.'));
    for (const r of S.storage.animals) {
      const row = el('div', 'pick');
      row.appendChild(iconCanvas(r.species, 30, 'animal', { variant: r.variant, baby: r.baby }));
      row.appendChild(el('span', 'pn', `<span class="sex ${r.sex}">${r.sex === 'm' ? '♂' : '♀'}</span> ${r.name}${r.baby ? ' <small>baby</small>' : ''}<br><small>${VNAME(r.species, r.variant)}${r.variant ? ' · ' + DEGREE[r.variant] : ''}</small>`));
      row.appendChild(sbtn('mini', 'Place', () => { placeFor = placeFor === r.id ? null : r.id; }));
      row.appendChild(sbtn('mini ghost', `Sell +${Math.round(SPECIES[r.species].cost * 0.5 * (1 + r.variant))}`, () => { S.storage.animals = S.storage.animals.filter(x => x !== r); addCoins(Math.round(SPECIES[r.species].cost * 0.5 * (1 + r.variant))); }));
      box.appendChild(row);
      if (placeFor === r.id) {
        const t = S.objects.filter(o => o.kind === 'enc' && canHold(o, r.species, r.variant));
        const pk = el('div', 'movepick', t.length ? '<span>Place in</span>' : `<span>No ${BIOMES[SPECIES[r.species].biome].name.toLowerCase()} enclosure with room for it. Build one first.</span>`);
        for (const e of t) pk.appendChild(sbtn('mini', `${encLabel(e)} · ${e.animals.length}/${capOf(e)}`, () => { S.storage.animals = S.storage.animals.filter(x => x !== r); placeRec(e, r); placeFor = null; sfx('adopt'); toast(`${r.name} moved into ${encLabel(e)}`); }));
        box.appendChild(pk);
      }
    }
  } else if (storageTab === 'items') {
    if (!S.storage.items.length) box.appendChild(el('p', 'empty', 'No stored items. Use Store on decor, shops or empty enclosures to keep them here.'));
    for (const it of S.storage.items) {
      const row = el('div', 'pick');
      row.appendChild(it.kind === 'enc' ? iconCanvas(it.biome, 30, 'enc') : iconCanvas(it.type, 30, 'decor'));
      row.appendChild(el('span', 'pn', it.kind === 'enc' ? `${BIOMES[it.biome].name} enclosure (level ${(it.level || 0) + 1})` : it.kind === 'shop' ? SHOPS[it.type].name : it.kind === 'bld' ? BUILDINGS[it.type].name : DECOR[it.type].name));
      row.appendChild(sbtn('mini', 'Place', () => { closeSheets(); setTool({ kind: 'place', item: it, w: it.kind === 'enc' ? 3 : it.kind === 'bld' ? 2 : 1, h: it.kind === 'enc' ? 3 : it.kind === 'bld' ? 2 : 1 }); }));
      box.appendChild(row);
    }
  } else {
    for (const k of Object.keys(FOODS)) { if (!S.food[k] && !Object.values(SPECIES).some(s => s.food === k && s.lvl <= S.level)) continue; const row = el('div', 'pick'); row.appendChild(iconCanvas(k, 26, 'icon')); row.appendChild(el('span', 'pn', `<b>${S.food[k]}</b> ${FOODS[k].name.toLowerCase()}`)); row.appendChild(sbtn('mini', `+10 ${priceTag({ coins: FOODS[k].price * 10 })}`, () => buyFood(k, 10))); box.appendChild(row); }
    const row = el('div', 'pick'); row.appendChild(iconCanvas('medicine', 26, 'icon')); row.appendChild(el('span', 'pn', `<b>${S.medicine}</b> medicine`)); box.appendChild(row);
  }
}
function sbtn(cls, html, fn) { const b = el('button', cls, html); b.onclick = () => { fn(); $('#storageBody').dataset.sig = ''; renderStorage(); updateHUD(); dirty(); }; return b; }

// ---------- goals ----------
const Z = {
  pairCount: sp => { let m = 0, f = 0; for (const e of S.objects) if (e.kind === 'enc') for (const a of e.animals) if (a.species === sp && !a.baby) { if (a.sex === 'm') m = 1; else f = 1; } return m + f; },
  speciesCount: () => new Set(S.objects.filter(o => o.kind === 'enc').flatMap(o => o.animals.map(a => a.species))).size,
  maxVariant: () => Math.max(0, ...S.objects.filter(o => o.kind === 'enc').flatMap(o => o.animals.map(a => a.variant)), ...S.storage.animals.map(a => a.variant)),
};
function activeQuests() { const out = []; for (const q of QUESTS) { if (S.claimed.includes(q.id)) continue; let p = 0; try { p = q.prog(S, Z); } catch (e) {} out.push({ q, p: Math.min(p, q.goal), done: p >= q.goal }); if (out.length >= 4) break; } return out; }
let questSig = '';
function renderQuests(force) {
  const box = $('#questList'); const list = activeQuests(); const sig = list.map(x => x.q.id + x.p + x.done).join();
  if (!force && sig === questSig) return; questSig = sig; box.innerHTML = '';
  if (S.tut >= 0) { box.appendChild(el('p', 'empty', 'Finish Tilda\'s tutorial first. Goals unlock afterwards.')); return; }
  if (!list.length) box.appendChild(el('p', 'empty', 'Every goal is complete. Wildgrove is legendary.'));
  for (const { q, p, done } of list) {
    const r = el('div', 'quest' + (done ? ' done' : ''));
    r.innerHTML = `<div class="qt">${q.text}</div><div class="qp"><i><b style="width:${p / q.goal * 100}%"></b></i><span>${compact(p)} / ${compact(q.goal)}</span></div><div class="qr">${priceTag(q.reward)}${q.reward.xp ? ` <span class="pt">${q.reward.xp} XP</span>` : ''}</div>`;
    if (done) { const b = el('button', 'btn gold', 'Claim'); b.onclick = () => { if (S.claimed.includes(q.id)) return; S.claimed.push(q.id); grant(q.reward); sfx('level'); renderQuests(true); updateHUD(); dirty(); }; r.appendChild(b); }
    box.appendChild(r);
  }
}

// ---------- hub: wheel / collections / office ----------
let hubTab = 'wheel', hubSig = '';
function openHub(tab) { hubTab = tab || hubTab; closeSheets(); select(null); $('#hub').hidden = false; document.body.classList.add('sheet-open'); hubSig = ''; renderHub(); }
function collComplete(b) { return S.cards[b].every(c => c > 0); }
function renderHub() {
  const sig = [hubTab, Date.now() >= S.wheelNext, Math.floor((S.wheelNext - Date.now()) / 60000), JSON.stringify(S.cards), S.collectionsDone.length, S.gems, S.owned, JSON.stringify(S.helpers.food > S.clock), Math.floor(S.clock / 30), spinning].join('|');
  if (sig === hubSig) return; hubSig = sig;
  const tabs = $('#hubTabs'); tabs.innerHTML = '';
  for (const [k, l] of [['wheel', 'Wheel'], ['coll', 'Collections'], ['office', 'Zoo office']]) { const b = el('button', 'tab' + (k === hubTab ? ' on' : ''), l); b.onclick = () => { hubTab = k; renderHub(); }; tabs.appendChild(b); }
  const box = $('#hubBody'); box.innerHTML = '';
  if (hubTab === 'wheel') {
    const free = Date.now() >= S.wheelNext;
    const wrap = el('div', 'wheelwrap'); const c = document.createElement('canvas'); c.id = 'wheelCanvas'; const d = Math.min(2, devicePixelRatio || 1); c.width = 260 * d; c.height = 260 * d; c.style.width = '260px'; c.style.height = '260px'; wrap.appendChild(c); box.appendChild(wrap);
    drawWheel();
    const r = el('div', 'row center');
    const b = el('button', 'btn gold big', free ? 'Spin for free' : `Spin ${priceTag({ gems: 2 })}`); b.disabled = spinning; b.onclick = () => spin(free); r.appendChild(b);
    box.appendChild(r);
    box.appendChild(el('p', 'hint center', free ? 'A free spin every 4 hours.' : `Next free spin in ${fmtTime((S.wheelNext - Date.now()) / 1000)}`));
  } else if (hubTab === 'coll') {
    for (const b of Object.keys(COLLECTIONS)) {
      const C = COLLECTIONS[b], locked = S.level < BIOMES[b].lvl;
      const card = el('div', 'coll' + (locked ? ' locked' : ''));
      card.appendChild(el('div', 'chead', `<b>${C.name}</b><span>${S.cards[b].filter(x => x).length} / 5</span>`));
      const row = el('div', 'cards');
      C.cards.forEach((txt, i) => { const has = S.cards[b][i] > 0; const k = el('button', 'fact' + (has ? ' has' : ''), has ? `<b>${'ABCDE'[i]}</b>` : '?'); k.title = has ? txt : 'Not found yet'; k.onclick = () => { if (has) toast(txt); }; row.appendChild(k); });
      card.appendChild(row);
      if (S.collectionsDone.includes(b)) card.appendChild(el('div', 'hint', 'Completed ✓'));
      else if (collComplete(b)) { const cb = el('button', 'btn gold', `Claim ${priceTag(C.reward)}`); cb.onclick = () => { S.collectionsDone.push(b); S.stats.collections++; const parts = grant(C.reward); showReward(C.name + ' complete!', parts); hubSig = ''; renderHub(); }; card.appendChild(cb); }
      else card.appendChild(el('div', 'hint', locked ? `Unlocks at level ${BIOMES[b].lvl}` : `Reward: ${priceTag(C.reward)}`));
      box.appendChild(card);
    }
    box.appendChild(el('p', 'hint', 'Cards turn up while you care for animals, pick up litter, spin the wheel and go on safari. Tap a card to read its fact.'));
  } else {
    // expansion
    const nx = EXPANSIONS[S.owned + 1];
    const ex = el('div', 'office');
    ex.appendChild(el('h3', '', 'Land'));
    if (nx) {
      const cur = EXPANSIONS[S.owned];
      ex.appendChild(el('p', '', `Your zoo is ${cur.ox} × ${cur.oy} tiles. The next plot makes it ${nx.ox} × ${nx.oy}.`));
      const r = el('div', 'row wrap');
      const lvOk = S.level >= nx.lvl;
      r.appendChild(hbtn('btn', `Expand ${priceTag({ coins: nx.cost })}${lvOk ? '' : ` <small>(level ${nx.lvl})</small>`}`, () => { if (!lvOk) { toast(`Reach level ${nx.lvl} first, or expand with gems`, 'warn'); return; } if (pay({ coins: nx.cost })) expand(); }, !lvOk));
      if (!lvOk) r.appendChild(hbtn('btn gem', `Expand now ${priceTag({ gems: nx.gems })}`, () => { if (pay({ gems: nx.gems })) expand(); }));
      ex.appendChild(r);
    } else ex.appendChild(el('p', '', 'You own all the land.'));
    ex.appendChild(el('h3', '', 'Staff'));
    for (const [k, Hd] of Object.entries(HELPERS)) {
      const left = S.helpers[k] - S.clock;
      const row = el('div', 'pick');
      row.appendChild(iconCanvas(k === 'food' ? 'hay' : k === 'clean' ? 'broom' : k, 26, 'icon'));
      row.appendChild(el('span', 'pn', `<b>${Hd.name}</b><br><small>${left > 0 ? 'Working · ' + fmtTime(left) + ' left' : Hd.desc}</small>`));
      row.appendChild(hbtn('mini gem', `${left > 0 ? '+' : 'Hire '}${Hd.hours}h ${priceTag({ gems: Hd.gems })}`, () => { if (pay({ gems: Hd.gems })) { S.helpers[k] = Math.max(S.clock, S.helpers[k]) + Hd.hours * 3600; toast(`${Hd.name} hired`); } }));
      ex.appendChild(row);
    }
    ex.appendChild(el('h3', '', 'Zoo meter'));
    const P = M.parts || {};
    ex.appendChild(el('div', 'meterparts', [['Animal mood', P.mood, 40], ['Tidiness', P.clean, 25], ['Variety', P.variety, 15], ['Decor', P.decor, 10], ['Babies', P.babies, 10]].map(([l, v, w]) => `<div class="bar"><span>${l}</span><i><b style="width:${Math.round((v || 0) * 100)}%"></b></i><small>${w}%</small></div>`).join('')));
    ex.appendChild(el('p', 'hint', `${M.attraction} attraction stars · up to ${M.target} visitors · tickets ${ticketPrice()} coins each`));
    ex.appendChild(el('h3', '', 'Settings'));
    const rr = el('div', 'row wrap'); rr.appendChild(hbtn('mini ghost', 'Start a new zoo', () => { $('#resetConfirm').hidden = false; })); ex.appendChild(rr);
    box.appendChild(ex);
  }
}
let hubLock = 0;
function hbtn(cls, html, fn, dis) { const b = el('button', cls, html); b.onclick = () => { if (performance.now() < hubLock) return; hubLock = performance.now() + 700; fn(); hubSig = ''; renderHub(); updateHUD(); dirty(); }; if (dis) b.disabled = true; return b; }
function expand() { S.owned++; S.stats.expansions++; scatterWild(S, S.owned); rebuild(); addXp(100); sfx('level'); toast('New land! Clear the wild trees to build on it.', 'level'); }

let spinning = false, wheelAngle = 0;
function drawWheel() {
  const c = document.getElementById('wheelCanvas'); if (!c) return; const x = c.getContext('2d'); const d = c.width / 260;
  x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, 260, 260); x.save(); x.translate(130, 134);
  if (ART.wheel) ART.wheel(x, 112, wheelAngle, WHEEL.map(w => ({ color: w.color, label: w.label, icon: w.icon })));
  else { const n = WHEEL.length; for (let i = 0; i < n; i++) { x.fillStyle = WHEEL[i].color; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 110, wheelAngle + i * 2 * Math.PI / n, wheelAngle + (i + 1) * 2 * Math.PI / n); x.fill(); } }
  x.restore();
  // pointer
  x.fillStyle = '#2e3a2a'; x.beginPath(); x.moveTo(130, 30); x.lineTo(120, 8); x.lineTo(140, 8); x.closePath(); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(130, 26); x.lineTo(124, 12); x.lineTo(136, 12); x.closePath(); x.fill();
}
function spin(free) {
  if (spinning) return;
  if (!free && !pay({ gems: 2 })) return;
  if (free) S.wheelNext = Date.now() + G.WHEEL_FREE_EVERY;
  let r = rnd() * WHEEL_WEIGHTS.reduce((a, b) => a + b, 0), idx = 0; for (; idx < WHEEL.length; idx++) { r -= WHEEL_WEIGHTS[idx]; if (r <= 0) break; } idx = Math.min(idx, WHEEL.length - 1);
  const n = WHEEL.length, seg = 2 * Math.PI / n;
  // art draws segment 0 centred at 12 o'clock for angle 0; pointer is at the top
  const target = -idx * seg;
  const start = wheelAngle, end = target - 2 * Math.PI * (5 + Math.ceil((start - target) / (2 * Math.PI)));
  spinning = true; hubSig = ''; renderHub(); sfx('path');
  const t0 = performance.now(), dur = 3800;
  const step = now => { const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3); wheelAngle = start + (end - start) * e; drawWheel(); if (k < 1) requestAnimationFrame(step); else { spinning = false; wheelAngle = ((end % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); const parts = grant(WHEEL[idx].prize); showReward('You won!', parts); sfx('level'); hubSig = ''; renderHub(); dirty(); } };
  requestAnimationFrame(step);
}

// ---------- tutorial ----------
function tutorialCheck() {
  const box = $('#tutorial');
  if (S.tut < 0) { box.hidden = true; return; }
  const step = TUTORIAL[S.tut]; if (!step) { finishTutorial(); return; }
  const done = {
    caught: () => !S.escaped.length,
    iceBuilt: () => S.objects.some(o => o.kind === 'enc' && o.biome === 'ice'),
    iceReady: () => S.objects.some(o => o.kind === 'enc' && o.biome === 'ice' && !o.build),
    penguinsIn: () => S.objects.some(o => o.kind === 'enc' && o.animals.some(a => a.species === 'penguin')),
    cared: () => S.stats.care >= 3,
    connected: () => S.objects.some(o => o.kind === 'enc' && o._conn),
    feederBuilt: () => S.objects.some(o => o.type === 'feeder' && !o.build),
    shopCollected: () => S.stats.shopCollects >= 1,
    ok: () => false,
  }[step.until]();
  if (done) { S.tut++; sfx('level'); if (S.tut >= TUTORIAL.length) { finishTutorial(); return; } }
  const cur = TUTORIAL[S.tut];
  box.hidden = false;
  if (box.dataset.step !== String(S.tut)) {
    box.dataset.step = S.tut;
    const pc = $('#guidePortrait'); pc.innerHTML = '';
    const c = document.createElement('canvas'); const d = Math.min(2, devicePixelRatio || 1); c.width = 72 * d; c.height = 72 * d; c.style.width = '72px'; c.style.height = '72px'; const x = c.getContext('2d'); x.scale(d, d); x.translate(36, 36);
    try { if (ART.guide) ART.guide(x, 72, 0, cur.mood); } catch (e) {}
    pc.appendChild(c);
    $('#tutText').textContent = cur.text;
    $('#tutStep').textContent = `${S.tut + 1} / ${TUTORIAL.length}`;
    $('#tutOk').hidden = cur.until !== 'ok';
  }
}
function finishTutorial() {
  if (S.tut === -1) return;
  S.tut = -1; grant({ coins: 300, gems: 3 }); toast('Tutorial complete! +300 coins, +3 gems. Goals are unlocked.', 'level');
  $('#tutorial').hidden = true; renderQuests(true); updateHUD(); dirty();
}
function skipTutorial() {
  for (const p of S.escaped.splice(0)) S.storage.animals.push(storeRec('penguin', 0, p.sex, false));
  S.tut = -1; $('#tutorial').hidden = true; toast('Tutorial skipped. The penguins are in storage.'); renderQuests(true); dirty();
}

// ---------- toast / modals ----------
let toastTimer;
function toast(msg, kind) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + (kind || ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast', 3400); }
function showReward(title, parts) { const d = $('#reward'); d.querySelector('h2').textContent = title; d.querySelector('.wbody').innerHTML = parts.length ? `<ul>${parts.map(p => `<li>${p}</li>`).join('')}</ul>` : '<p>Nothing this time.</p>'; d.hidden = false; }
function showWelcome(sec, tickets, ready, babies, needy) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  const d = $('#welcome');
  d.querySelector('.wbody').innerHTML = `<p>You were away for <b>${h ? h + ' h ' + m + ' min' : m + ' min'}</b>.</p><ul>
    <li><b>${fmt(tickets)}</b> coins from ticket sales</li>
    <li><b>${ready}</b> shop${ready === 1 ? ' is' : 's are'} ready to collect</li>
    ${babies ? `<li><b>${babies}</b> new baby animal${babies > 1 ? 's' : ''}</li>` : ''}
    ${needy ? `<li><b>${needy}</b> animal${needy > 1 ? 's' : ''} need${needy === 1 ? 's' : ''} care</li>` : ''}</ul>
    <p class="hint">Hire staff in the Zoo office to keep animals cared for while you're away.</p>`;
  d.hidden = false;
}
let dirtyT = null; function dirty() { clearTimeout(dirtyT); dirtyT = setTimeout(save, 600); updateHUD(); }

// ---------- sound & music ----------
let AC = null, muted = false, musicOn = true, musicT = null, master = null;
function audioUnlock() { if (AC || muted) return; try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 1; master.connect(AC.destination); startMusic(); } catch (e) {} }
function tone(f, t0, len, vol, type) { const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len); o.connect(g).connect(master); o.start(t0); o.stop(t0 + len + 0.02); }
function sfx(kind) {
  if (!AC || muted) return;
  const notes = { coin: [988, 1319], build: [330, 440], path: [520], food: [440, 554], water: [660, 784], pet: [523, 784], play: [587, 880], clean: [660, 880], adopt: [523, 659, 784], baby: [784, 988, 1175], level: [523, 659, 784, 1047], gem: [1175, 1568], no: [220, 180] }[kind] || [440];
  const t0 = AC.currentTime; notes.forEach((f, i) => tone(f, t0 + i * 0.07, 0.18, kind === 'path' ? 0.03 : 0.06, kind === 'no' ? 'square' : 'triangle'));
}
// gentle marimba-style loop: I–vi–IV–V in C, pentatonic melody
function startMusic() {
  if (musicT || !AC) return;
  const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  const pent = [523.3, 587.3, 659.3, 784, 880, 1046.5];
  let beat = 0, next = AC.currentTime + 0.1;
  musicT = setInterval(() => {
    if (!AC || muted || !musicOn || document.hidden) { next = AC ? AC.currentTime + 0.1 : 0; return; }
    while (next < AC.currentTime + 0.5) {
      const bar = Math.floor(beat / 8) % 4, b = beat % 8, ch = chords[bar];
      if (b === 0) ch.forEach(f => tone(f / 2, next, 1.6, 0.025, 'sine'));
      if (b % 2 === 0) tone(ch[(b / 2) % 3], next, 0.35, 0.03, 'triangle');
      if (rnd() < 0.55) tone(pent[Math.floor(rnd() * pent.length)], next, 0.3, 0.022, 'triangle');
      next += 0.28; beat++;
    }
  }, 120);
}

// ---------- boot ----------
function wireUI() {
  $('#btnShop').onclick = () => { setTool(null); if (openSheet('#shop')) renderShop(); };
  $('#btnPath').onclick = () => { closeSheets(); setTool(tool && tool.kind === 'path' ? null : { kind: 'path' }); };
  $('#btnBulldoze').onclick = () => { closeSheets(); setTool(tool && tool.kind === 'bulldoze' ? null : { kind: 'bulldoze' }); };
  $('#btnStorage').onclick = () => { setTool(null); if (openSheet('#storage')) { $('#storageBody').dataset.sig = ''; renderStorage(); } };
  $('#btnQuests').onclick = () => { setTool(null); if (openSheet('#quests')) renderQuests(true); };
  $('#btnHub').onclick = () => { setTool(null); if ($('#hub').hidden) openHub(); else closeSheets(); };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeSheets());
  $('#toolCancel').onclick = () => setTool(null);
  $('#welcomeOk').onclick = () => $('#welcome').hidden = true;
  $('#rewardOk').onclick = () => $('#reward').hidden = true;
  $('#tutSkip').onclick = skipTutorial;
  $('#tutOk').onclick = () => finishTutorial();
  $('#btnSound').onclick = () => { muted = !muted; $('#btnSound').classList.toggle('off', muted); $('#btnSound').setAttribute('aria-pressed', String(!muted)); if (!muted) audioUnlock(); };
  $('#meterChip').onclick = () => openHub('office');
  $('#btnZoomIn').onclick = () => { cam.z *= 1.2; clampCam(); };
  $('#btnZoomOut').onclick = () => { cam.z /= 1.2; clampCam(); };
  $('#resetNo').onclick = () => { $('#resetConfirm').hidden = true; };
  $('#resetYes').onclick = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} S = newGame(); visitors = []; rebuild(); select(null); setTool(null); closeSheets(); $('#resetConfirm').hidden = true; $('#tutorial').dataset.step = ''; centerCam(); computeMeter(); updateHUD(); };
  $('#icoCoin').appendChild(iconCanvas('coin', 22, 'icon')); $('#icoGem').appendChild(iconCanvas('gem', 22, 'icon')); $('#icoPaw').appendChild(iconCanvas('paw', 22, 'icon'));
  $('#icoVis').appendChild(iconCanvas('heart', 18, 'icon')); $('#icoStar').appendChild(iconCanvas('star', 18, 'icon'));
}
function boot(hot) {
  resize();
  S = (hot && hot.S) || load() || newGame();
  const ids = [...S.objects.flatMap(o => (o.animals || []).map(a => a.id)), ...S.storage.animals.map(a => a.id)];
  uid = Math.max(1, ...ids.filter(n => typeof n === 'number')) + 1000;
  rebuild(); wireUI();
  if (S.cam) { cam.x = S.cam.x; cam.y = S.cam.y; cam.z = S.cam.z; clampCam(); } else centerCam();
  if (!hot) offlineProgress();
  computeMeter(); updateHUD(); tutorialCheck();
  window.addEventListener('resize', () => { resize(); groundDirty = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else last = performance.now(); });
  window.addEventListener('pagehide', save);
  requestAnimationFrame(t => { last = t; frame(t); });
}
try { window.claude && window.claude.hot && window.claude.hot.snapshot && window.claude.hot.snapshot(() => { save(); return { S }; }); } catch (e) {}
const start = d => boot(d && d.S ? d : null);
if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start); else start((window.claude && window.claude.hot && window.claude.hot.data) || {});

window.__wg = { scr: (gx, gy) => { const p = iso(gx, gy); return { x: (p.x - cam.x) * cam.z + W / 2, y: (p.y - cam.y) * cam.z + H / 2 }; }, get S() { return S; }, get M() { return M; }, get tool() { return tool; }, rebuild, tick, render, setTool, select, place, careAll, collectShop, visitors: () => visitors, cam, openHub, computeMeter, skipTutorial, adopt, placeRec, storeRec };
})();
