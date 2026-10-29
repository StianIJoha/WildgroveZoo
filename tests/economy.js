// Economy simulation for balance tuning: plays ~45 minutes of game time with an "active player"
// bot driven through window.__wg (plus the real panel/sheet buttons for things __wg doesn't
// expose: cleaning, healing, upgrades, food and medicine, goal and task claims) and prints a table.
//
// Run:  node build.js && node tests/economy.js [minutes=45] [seed=1]
// Deterministic: Math.random is seeded and the game's own animation loop is switched off, so the
// bot advances time only with __wg.tick(). PW_CHROMIUM=/path/to/chrome uses a preinstalled browser.
const path = require('path');
const { chromium } = require('playwright');

// CARE = how often (game seconds) the player looks at the zoo: 8 = very active, 60 = casual
const MINUTES = +(process.argv[2] || 45), SEED = +(process.argv[3] || 1), CARE = +(process.argv[4] || 8);
const LEVEL_GEMS = 2;   // engine.js LEVEL_GEMS (gems per level-up)
const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');

const INIT = `
(() => {
  let x = ${(SEED * 2654435761) >>> 0 || 1};
  Math.random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  window.requestAnimationFrame = () => 0;          // no real-time loop: the bot owns the clock
  try { localStorage.removeItem('wildgrove.save.v2'); } catch (e) {}
})();`;

// ------------------------------------------------------------------ the bot (runs in the page)
function installBot() {
  const g = window.__wg, S = g.S;
  const SP = GAME.SPECIES, BI = GAME.BIOMES, SH = GAME.SHOPS, UP = GAME.UPGRADES, FOODS = GAME.FOODS;
  const $ = s => document.querySelector(s);
  const L = { inc: { tickets: 0, shops: 0, goals: 0, tasks: 0, wishes: 0, festival: 0, other: 0 }, spend: { build: 0, animals: 0, food: 0, medicine: 0, upgrades: 0, land: 0, decor: 0 },
    medUsed: 0, medBought: 0, sick: 0, sickIds: new Set(), animalSec: 0, needSec: 0, rows: [], gemsFrom: { goals: 0, tasks: 0, festival: 0, rank: 0, level: 0 }, meterSum: 0, meterN: 0, visSum: 0,
    built: [], notes: [] };
  const ticket = () => 1 + Math.floor(S.level / 3);
  const tip = () => 2 + Math.ceil(S.level / 2);   // must match grantWish() in engine.js; the "earned" check below catches drift
  const encs = () => S.objects.filter(o => o.kind === 'enc');
  const kept = () => new Set(encs().flatMap(e => e.animals.map(a => a.species)));
  const animals = () => encs().flatMap(e => e.animals);
  // spend tracking: wrap an action, attribute the coin drop to a category
  const spend = (cat, fn) => { const c0 = S.coins; const r = fn(); if (S.coins < c0) L.spend[cat] += c0 - S.coins; return r; };
  const gain = (cat, fn) => { const c0 = S.coins, g0 = S.gems; const r = fn(); if (S.coins > c0) L.inc[cat] += S.coins - c0; if (cat in L.gemsFrom && S.gems > g0) L.gemsFrom[cat] += S.gems - g0; return r; };

  // layout: a spine path along y=24 (gate at 29,24) and a branch up x=19; 3×3 slots touch a path
  const ENC_SLOTS = [[20, 21], [24, 21], [20, 25], [24, 25], [16, 21], [16, 25], [20, 17], [16, 17]];
  const SHOP_SLOTS = [[23, 25], [27, 25], [23, 23], [27, 23], [19, 25], [28, 25]];
  const DECO_SLOTS = [[23, 22], [27, 22], [28, 22], [23, 26], [27, 26], [28, 26], [23, 27], [27, 27], [28, 27], [23, 28], [27, 28]];
  const BIN = [28, 23];
  const reserve = () => 150 + 12 * animals().length;
  function clear(x0, y0, w, h) {
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) {
      const o = S.objects.find(o => !o.fixed && x >= o.gx && x < o.gx + o.w && y >= o.gy && y < o.gy + o.h);
      if (o && (o.kind === 'wild' || o.kind === 'deco')) spend('build', () => { g.setTool({ kind: 'bulldoze' }); g.place(x, y); g.setTool(null); });
    }
  }
  function path(cells) { for (const [x, y] of cells) { clear(x, y, 1, 1); spend('build', () => { g.setTool({ kind: 'path' }); g.place(x, y); g.setTool(null); }); } }
  const free = (x, y, w, h) => { for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) { if (S.paths.includes(i + ',' + j)) return false; if (S.objects.some(o => o.kind !== 'wild' && !(o.kind === 'deco' && o.type === 'crate') && i >= o.gx && i < o.gx + o.w && j >= o.gy && j < o.gy + o.h)) return false; } return true; };
  let branch = false;
  function buildAt(kind, t, x, y, w) {
    clear(x, y, w, w);
    const n0 = S.objects.length;
    spend(kind === 'deco' ? 'decor' : 'build', () => { g.setTool(Object.assign({ kind }, t)); g.place(x, y); g.setTool(null); });
    return S.objects.length > n0;
  }
  // pick the best species we can afford for a new enclosure: unlocked, new to the zoo if possible, highest appeal
  // a player saves up for the most appealing species they don't have yet; with nothing new unlocked
  // they build another enclosure of the best one they can afford
  function bestSpecies(budget) {
    const have = kept(), cost = k => BI[SP[k].biome].cost + 2 * SP[k].cost;
    const unlocked = Object.keys(SP).filter(k => SP[k].lvl <= S.level && BI[SP[k].biome].lvl <= S.level).sort((a, b) => SP[b].appeal - SP[a].appeal);
    const fresh = unlocked.filter(k => !have.has(k) && !encs().some(e => e._want === k));
    if (fresh.length) return cost(fresh[0]) <= budget ? fresh[0] : (cost(fresh[0]) > 4 * Math.max(budget, 500) && fresh.find(k => cost(k) <= budget)) || null;
    return unlocked.find(k => cost(k) <= budget) || null;
  }
  function newEnclosure() {
    const slot = ENC_SLOTS.find(([x, y]) => free(x, y, 3, 3) && !S.objects.some(o => o.kind === 'enc' && o.gx === x && o.gy === y));
    if (!slot) return false;
    const sp = bestSpecies(S.coins - reserve()); if (!sp) return false;
    if ((slot[0] === 20 || slot[0] === 16) && slot[1] === 17 && !branch) { path([...Array(8)].map((_, i) => [19, 23 - i])); branch = true; }
    if (!buildAt('enc', { biome: SP[sp].biome }, slot[0], slot[1], 3)) return false;
    const e = S.objects.find(o => o.kind === 'enc' && o.gx === slot[0] && o.gy === slot[1]);
    e._want = sp; L.built.push(`${fmtT()} enclosure ${sp}`);
    return true;
  }
  function stockEnclosures() {
    for (const e of encs()) {
      if (e.build) continue;
      const sp = e.species || e._want; if (!sp) continue;
      const ad = e.animals.filter(a => !a.baby);
      for (const sex of ['m', 'f']) if (!ad.some(a => a.sex === sex) && e.animals.length < 4 + e.level && S.coins - SP[sp].cost >= reserve() * 0.5) spend('animals', () => g.adopt(e, sp, sex, 0));
    }
  }
  function newShop() {
    const n = S.objects.filter(o => o.kind === 'shop').length, slot = SHOP_SLOTS.find(([x, y]) => free(x, y, 1, 1));
    if (!slot) return false;
    // the next shop: the best paying type we have unlocked and can afford, at most 2 of each
    const types = Object.entries(SH).filter(([k, d]) => d.lvl <= S.level && d.cost <= S.coins - reserve() && S.objects.filter(o => o.type === k).length < 2).sort((a, b) => b[1].pay / b[1].period - a[1].pay / a[1].period);
    if (!types.length || (n >= 2 && encs().length < 2)) return false;
    if (buildAt('shop', { type: types[0][0] }, slot[0], slot[1], 1)) { L.built.push(`${fmtT()} shop ${types[0][0]}`); return true; }
    return false;
  }
  function decor() {
    if (!S.objects.some(o => o.type === 'trashbin') && S.coins > 300) buildAt('deco', { type: 'trashbin' }, BIN[0], BIN[1], 1);
    const parts = g.M.parts; if (!parts || parts.decor > 0.75 || S.coins < reserve() + 900) return;
    const slot = DECO_SLOTS.find(([x, y]) => free(x, y, 1, 1)); if (!slot) return;
    const best = Object.entries(GAME.DECOR).filter(([k, d]) => d.lvl <= S.level && d.cost <= (S.coins - reserve()) / 3 && !d.bin).sort((a, b) => b[1].appeal / b[1].cost - a[1].appeal / a[1].cost || b[1].appeal - a[1].appeal);
    const pickD = best.find(([k, d]) => d.appeal >= 2) || best[0];
    if (pickD) buildAt('deco', { type: pickD[0] }, slot[0], slot[1], 1);
  }
  // ---- panel / sheet helpers for actions __wg does not expose
  const panelBtn = (o, test) => { g.select(o); const b = [...document.querySelectorAll('#panel button')].find(test); if (b && !b.disabled) { b.click(); return true; } return false; };
  function supplies() { g.select(null); if ($('#shop').hidden) $('#btnShop').click(); [...document.querySelectorAll('#shopTabs .tab')].find(b => b.textContent === 'Supplies').click(); }
  function closeAll() {
    document.querySelectorAll('[data-close]').forEach(b => { if (!b.closest('[hidden]')) b.click(); }); g.select(null);
    const lv = $('#levelUp'); if (lv && !lv.hidden) $('#levelOk').click();   // the level-up card, if this build has one
  }
  function buyFood() {
    const low = [...new Set(animals().map(a => SP[a.species].food))].some(f => S.food[f] < 6 + 2 * animals().filter(a => SP[a.species].food === f).length);
    if (!low) return;
    const plan = g.restockPlan(40); if (!plan.cost || plan.cost > S.coins) return;
    supplies(); const b = document.querySelector('.supply.restock button'); if (b) spend('food', () => b.click()); closeAll();
  }
  function buyMedicine() {
    if (S.medicine >= 2 || S.coins < 125 + reserve()) return;
    supplies(); const row = [...document.querySelectorAll('.supply')].find(r => r.textContent.includes('Medicine'));
    const b = row && [...row.querySelectorAll('button')].find(b => b.textContent.includes('+5'));
    if (b) { const m0 = S.medicine; spend('medicine', () => b.click()); L.medBought += S.medicine - m0; } closeAll();
  }
  function claims() {
    if ($('#quests').hidden) $('#btnQuests').click();
    for (let k = 0; k < 8; k++) {
      const b = document.querySelector('#questList .quest.done button'); if (!b) break;
      const q = b.closest('.quest'), cat = q.classList.contains('task') || q.classList.contains('bonus') ? 'tasks' : 'goals';
      gain(cat, () => b.click());
      if (!$('#reward').hidden) $('#rewardOk').click();
    }
    // weekly festival milestones (the bot claims them as soon as they're ready)
    for (let k = 0; k < 12 && g.ensureEvent && g.ensureEvent(); k++) {
      const E = S.event, before = E.claimed + E.lap * 100;
      gain('festival', () => g.claimEvent()); $('#reward').hidden = true;
      if (S.event.claimed + S.event.lap * 100 === before) break;
    }
    closeAll();
  }
  function upgrades() {
    for (const e of encs()) {
      if (e.build || e.level >= 4 || e.animals.length < 4 + e.level) continue;
      const U = UP[e.level + 1]; if (S.coins - U.coins < reserve() + 1500 || S.paws < U.paws) continue;
      spend('upgrades', () => panelBtn(e, b => b.textContent.startsWith('Upgrade')));
    }
    g.select(null);
  }
  // ---- caring: the "active player" reacts to bubbles every few seconds
  function care() {
    for (const e of encs()) {
      if (e.build || !e.animals.length) continue;
      if (e.animals.some(a => a.sick) && S.medicine > 0) { const m0 = S.medicine; panelBtn(e, b => b.classList.contains('warn') && b.textContent.includes('Heal')); L.medUsed += m0 - S.medicine; }
      for (const n of ['food', 'water', 'pet', 'play']) if (e.animals.some(a => S.clock >= a.due[n])) g.careAll(e, n);
      if (e.dung.length >= 2) panelBtn(e, b => b.textContent.includes('Clean'));
    }
    g.select(null);
    if (S.litter.length) { g.setTool({ kind: 'bulldoze' }); for (const l of S.litter.slice()) g.place(l.x, l.y); g.setTool(null); }
    for (const o of S.objects) if (o.kind === 'shop' && o.prog >= 1) gain('shops', () => g.collectShop(o));
  }
  function plan() {
    // what an active player saves up for, in order
    const encN = encs().length, shopN = S.objects.filter(o => o.kind === 'shop').length;
    if (encN === 0 || (shopN >= encN && encN < ENC_SLOTS.length)) { if (newEnclosure()) return; }
    if (shopN < encN + 1) { if (newShop()) return; }
    if (encN < ENC_SLOTS.length && S.coins > 2500) newEnclosure();
    upgrades(); decor();
  }
  const fmtT = () => `${Math.floor(S.clock / 60)}m`;
  // ---- time: tick in 0.1 s steps, account income per step
  function step(sec, actEvery) {
    for (let t = 0; t < sec; t += 0.1) {
      const v0 = S.stats.visitorsIn, w0 = S.stats.wishes, tp = ticket(), ti = tip();
      g.tick(0.1);
      L.inc.tickets += (S.stats.visitorsIn - v0) * tp; L.inc.wishes += (S.stats.wishes - w0) * ti;
      if (Math.round(S.clock * 10) % 10 === 0) {
        for (const a of animals()) { L.animalSec++; if (['food', 'water', 'pet', 'play'].some(n => S.clock >= a.due[n])) L.needSec++; if (a.sick && !L.sickIds.has(a.id)) { L.sick++; L.sickIds.add(a.id); } if (!a.sick) L.sickIds.delete(a.id); }
        L.meterSum += g.M.meter; L.meterN++; L.visSum += g.visitors().length;
      }
      if (Math.round(S.clock * 10) % Math.round(actEvery * 10) === 0) { care(); stockEnclosures(); buyFood(); buyMedicine(); }
      if (Math.round(S.clock * 10) % 300 === 0) { plan(); claims(); }
    }
  }
  function opening() {
    // the tutorial's outcome: three penguins in an ice floe enclosure on a path, a feeding station, +300 coins/+3 gems
    g.skipTutorial(); S.coins += 300; S.gems += 3;
    path([...Array(9)].map((_, i) => [24 - i, 24]));
    buildAt('enc', { biome: 'ice' }, 24, 21, 3);
    const e = S.objects.find(o => o.kind === 'enc'); e.build = S.clock;
    g.tick(0.1);
    for (const r of S.storage.animals.splice(0)) g.placeRec(e, r);
    buildAt('shop', { type: 'feeder' }, 23, 25, 1);
    for (const o of S.objects) if (o.build) o.build = S.clock;
    g.tick(0.1);
    L.inc = { tickets: 0, shops: 0, goals: 0, tasks: 0, wishes: 0, festival: 0, other: 0 }; L.spend = { build: 0, animals: 0, food: 0, medicine: 0, upgrades: 0, land: 0, decor: 0 };
  }
  window.__bot = { L, step, opening, snapshot: () => ({ t: S.clock, level: S.level, coins: S.coins, gems: S.gems, paws: S.paws, earned: S.stats.earned, meter: g.M.meter, target: g.M.target, vis: g.visitors().length,
    encs: encs().length, shops: S.objects.filter(o => o.kind === 'shop').length, animals: animals().length, species: kept().size, sick: animals().filter(a => a.sick).length, medicine: S.medicine,
    wishes: S.stats.wishes, missed: Object.values(S.wishLog).reduce((a, b) => a + b, 0), babies: S.stats.babies, care: S.stats.care, dk: g.DK, rank: S.stats.rank || 0, rankName: GAME.RANKS[S.stats.rank || 0].name, rankGems: GAME.RANKS.slice(1, (S.stats.rank || 0) + 1).reduce((a, k) => a + (k.gems || 0), 0), festLap: S.event ? S.event.lap : 0, festClaimed: S.event ? S.event.claimed : 0 }) };
}

(async () => {
  const exe = process.env.PW_CHROMIUM;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(INIT);
  await page.goto(PAGE);
  await page.waitForTimeout(300);
  await page.evaluate(installBot);
  await page.evaluate(() => window.__bot.opening());

  const rows = []; let prev = await page.evaluate(() => window.__bot.snapshot());
  const t0 = prev.t, earned0 = prev.earned, lvl0 = prev.level;
  for (let m = 1; m <= MINUTES; m++) {
    await page.evaluate(c => window.__bot.step(60, c), CARE);
    const s = await page.evaluate(() => window.__bot.snapshot());
    if (m % 5 === 0 || m === 1) rows.push({ min: m, lvl: s.level, coins: s.coins, 'earned/min': Math.round((s.earned - prev.earned) / ((s.t - prev.t) / 60)), gems: s.gems, paws: s.paws,
      meter: s.meter, vis: s.vis, target: s.target, encs: s.encs, shops: s.shops, animals: s.animals, species: s.species, sick: s.sick, meds: s.medicine, night: s.dk > 0.5 ? 'yes' : '' });
    if (m % 5 === 0 || m === 1) prev = s;
  }
  const s = await page.evaluate(() => window.__bot.snapshot());
  const L = await page.evaluate(() => { const L = window.__bot.L; return { ...L, sickIds: null }; });
  console.log(`\nWildgrove economy run: ${MINUTES} min of game time, seed ${SEED}, player checks the zoo every ${CARE} s\n`);
  console.table(rows);
  const inc = L.inc, tot = Object.values(inc).reduce((a, b) => a + b, 0);
  const mins = (s.t - t0) / 60;
  console.log(`\nIncome ${Math.round(tot)} coins = ${Math.round(tot / mins)} coins/min (engine "earned" stat: ${Math.round((s.earned - earned0) / mins)} /min)`);
  if (Math.abs(tot - (s.earned - earned0)) > 0.02 * tot) console.log(`WARNING: the income categories (${Math.round(tot)}) and the engine's earned stat (${Math.round(s.earned - earned0)}) differ by more than 2%: a formula copied into this bot (ticket price, wish tip) is out of date.`);
  console.table(Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, { coins: Math.round(v), share: (100 * v / tot).toFixed(1) + '%', perMin: Math.round(v / mins) }])));
  const sp = L.spend, stot = Object.values(sp).reduce((a, b) => a + b, 0);
  console.log(`Spending ${Math.round(stot)} coins`);
  console.table(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, { coins: Math.round(v), share: stot ? (100 * v / stot).toFixed(1) + '%' : '-' }])));
  const animalH = L.animalSec / 3600;
  console.log(`Level ${s.level} reached · gems ${s.gems} (from goals ${L.gemsFrom.goals}, tasks ${L.gemsFrom.tasks}, festival ${L.gemsFrom.festival}, ranks ${s.rankGems} (${s.rankName}), level-ups ${LEVEL_GEMS * (s.level - lvl0)}) · paws ${s.paws}`);
  console.log(`Festival: lap ${s.festLap}, ${s.festClaimed} milestones into it`);
  console.log(`Animals ${s.animals} in ${s.encs} enclosures (${s.species} species) · ${s.babies} babies · ${s.care} care actions`);
  console.log(`Sickness: ${L.sick} cases (${(L.sick / Math.max(1e-9, animalH)).toFixed(2)} per animal-hour) · medicine used ${L.medUsed}, bought ${L.medBought} · animals had an unmet need ${(100 * L.needSec / Math.max(1, L.animalSec)).toFixed(0)}% of the time`);
  console.log(`Visitors avg ${(L.visSum / L.meterN).toFixed(1)} · meter avg ${(L.meterSum / L.meterN).toFixed(0)}% · wishes granted ${s.wishes}, expired ${s.missed}`);
  console.log(`Build order: ${L.built.join(' · ')}`);
  if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5).join(' | '));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
