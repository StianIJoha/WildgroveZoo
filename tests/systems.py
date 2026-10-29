"""
System tests for Wildgrove Zoo: exercises the newer systems (save export/import, daily tasks,
toys, vet, visitor wishes and routing, day/night, cancel/undo refunds, restock, keyboard
shortcuts, offline progress, coast habitat, old-save migration, tutorial isolation) through
window.__wg and real clicks, and fails on any page error.

Run:  node build.js  &&  python tests/playthrough.py  &&  python tests/systems.py
      (PW_CHROMIUM=/path/to/chrome points at a preinstalled browser binary)
"""
import asyncio, json, os, pathlib, sys, tempfile, traceback
from playwright.async_api import async_playwright

PAGE = (pathlib.Path(__file__).resolve().parent.parent / 'index.html').as_uri()
SAVE_KEY = 'wildgrove.save.v2'


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        check.failed = True
check.failed = False


# Deterministic Math.random (the engine grabs Math.random once at load), plus an optional
# "rewind the save's savedAt" hook used by the offline-progress test: it runs before the game
# boots, after the old page's pagehide save, so the rewind is not overwritten.
INIT = """
(() => {
  let x = 123456789;
  Math.random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  try {
    const back = +sessionStorage.getItem('wg.rewind');
    if (back) {
      sessionStorage.removeItem('wg.rewind');
      const s = JSON.parse(localStorage.getItem('wildgrove.save.v2'));
      s.savedAt -= back * 1000; localStorage.setItem('wildgrove.save.v2', JSON.stringify(s));
      window.__rewound = (Date.now() - s.savedAt) / 1000;
    }
  } catch (e) {}
})();
"""

# Builds a small finished zoo after the tutorial: a path from the gate west along y=24,
# a meadow enclosure (20..22, 21..23) with a bunny pair, a feeding station at (24,25) and a
# bench at (26,25), all touching the path. Returns ids for later lookups.
SETUP = """(opts) => {
  const g = window.__wg, S = g.S; opts = opts || {};
  if (S.tut >= 0) g.skipTutorial();
  S.coins = 100000; S.gems = 50; S.paws = 30; S.level = opts.level || 12; S.medicine = 5;
  S.objects = S.objects.filter(o => o.kind === 'gate'); S.storage.animals = []; S.litter = [];
  g.rebuild();
  g.setTool({ kind: 'path' }); for (let x = 28; x >= 17; x--) g.place(x, 24); g.setTool(null);
  g.setTool({ kind: 'enc', biome: 'meadow' }); g.place(20, 21); g.setTool(null);
  g.setTool({ kind: 'shop', type: 'feeder' }); g.place(24, 25); g.setTool(null);
  g.setTool({ kind: 'deco', type: 'bench' }); g.place(26, 25); g.setTool(null);
  g.setTool({ kind: 'deco', type: 'fountain' }); for (let x = 17; x <= 20; x++) g.place(x, 28); g.setTool(null);
  for (const o of S.objects) if (o.build) o.build = S.clock;
  g.tick(0.05);
  const e =S.objects.find(o => o.kind === 'enc' && o.gx === 20 && o.gy === 21);
  g.adopt(e, 'bunny', 'm', 0); g.adopt(e, 'bunny', 'f', 0);
  for (const a of e.animals) for (const n of ['food', 'water', 'pet', 'play']) a.due[n] = S.clock + 1e5;
  S.food.hay = 500;
  g.rebuild(); g.computeMeter();
  if (opts.tut != null) { S.tut = opts.tut; S.tasks = { next: 0, list: [] }; }
  return { enc: e.id, conn: e._conn, shop: S.objects.find(o => o.kind === 'shop').id };
}"""

# fast-forward game time inside the page, tracking every visitor that ever existed
RUN = """([sec, dt]) => {
  const g = window.__wg; window.__seenV = window.__seenV || new Set();
  for (let t = 0; t < sec; t += dt) { g.tick(dt); for (const v of g.visitors()) window.__seenV.add(v); }
  return g.visitors().length;
}"""


async def fresh(pg, tutorial=False):
    """Start a brand-new zoo (optionally finishing setup) and return the setup ids."""
    # block this page's pagehide save, or it would write the old zoo back during the reload
    await pg.evaluate(f"() => {{ localStorage.removeItem('{SAVE_KEY}'); Storage.prototype.setItem = () => {{}}; }}")
    await pg.reload()
    await pg.wait_for_timeout(500)
    if tutorial:
        return None
    return await pg.evaluate(SETUP)


async def ev(pg, js, arg=None):
    return await pg.evaluate(js, arg) if arg is not None else await pg.evaluate(js)


async def dismiss_level_up(pg):
    """Close the level-up card like a player would, so it doesn't cover the next click."""
    if await pg.query_selector('#levelUp:not([hidden])'):
        await pg.click('#levelOk')


async def section(name, fn):
    """Run one test group; `python tests/systems.py toys vet` runs only groups whose name contains those words."""
    if sys.argv[1:] and not any(a in name for a in sys.argv[1:]):
        return
    print(f'--- {name}')
    try:
        await fn()
    except Exception as e:  # a crashed section is a failure, but keep testing the rest
        traceback.print_exc()
        check(False, f'{name}: raised {type(e).__name__}: {str(e).splitlines()[0][:160]}')


async def main():
    async with async_playwright() as p:
        exe = os.environ.get('PW_CHROMIUM')
        browser = await p.chromium.launch(**({'executable_path': exe} if exe else {}))
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        await ctx.add_init_script(INIT)
        pg = await ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts' not in m.text and 'ERR_' not in m.text else None)
        await pg.goto(PAGE)

        # ---------------------------------------------------------------- tutorial isolation
        async def tutorial_isolation():
            await fresh(pg, tutorial=True)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S;
                S.clock = 0.8 * 900; g.tick(0.05); g.render();
                return { tut: S.tut, tasks: S.tasks.list.length, dk: g.DK, day: document.querySelector('#btnDay').hidden,
                         low: document.querySelector('#lowFood').hidden }; }""")
            check(r['tut'] == 0 and r['tasks'] == 0, 'no daily tasks are generated during the tutorial')
            check(r['dk'] == 0 and r['day'], 'no night (and no day/night button) during the tutorial')
            check(r['low'], 'low-food chip hidden during the tutorial')
            await pg.click('#btnQuests')
            txt = await pg.inner_text('#questList')
            check('tutorial' in txt.lower() and 'Daily tasks' not in txt, 'goals sheet only says to finish the tutorial')
            await pg.click('#quests [data-close]')
            # cancelling the tutorial's ice floe enclosure must not strand the tutorial on "Builders are on it"
            await ev(pg, "() => { const g = window.__wg, S = g.S; for (const p of S.escaped.splice(0)) S.storage.animals.push(g.storeRec('penguin', 0, p.sex, false)); }")
            await pg.wait_for_timeout(400)
            await ev(pg, "() => { const g = window.__wg; g.setTool({ kind: 'enc', biome: 'ice' }); g.place(22, 19); }")
            await pg.wait_for_timeout(400)
            cancel = await pg.query_selector('#panel button:has-text("Cancel")')
            if cancel:
                await cancel.click()
                await pg.wait_for_timeout(400)
            r = await ev(pg, "() => ({ tut: window.__wg.S.tut, encs: window.__wg.S.objects.filter(o => o.kind === 'enc').length })")
            check(cancel is None or r['tut'] <= 1, f"cancelling the tutorial enclosure is not offered or rewinds the tutorial (step {r['tut'] + 1}, {r['encs']} enclosures)")
            # a built zoo still in the tutorial: visitors come, but nobody makes a wish
            await ev(pg, SETUP, {'tut': 7})
            await ev(pg, RUN, [120, 0.1])
            r = await ev(pg, "() => ({ wishes: [...window.__seenV].filter(v => v.wish).length, seen: window.__seenV.size, tasks: window.__wg.S.tasks.list.length, dk: window.__wg.DK, tut: window.__wg.S.tut })")
            check(r['seen'] > 0 and r['wishes'] == 0, f"visitors during the tutorial make no wishes ({r['seen']} visitors)")
            check(r['tasks'] == 0 and r['dk'] == 0 and r['tut'] >= 0, 'still no tasks or night while the tutorial runs')
        await section('tutorial isolation', tutorial_isolation)

        # ---------------------------------------------------------------- save export / import
        async def save_roundtrip():
            await fresh(pg)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S;
                const e = S.objects.find(o => o.kind === 'enc'); e.animals[0].name = 'Bjørn'; S.coins = 4321;
                const code = g.exportCode(), s = g.parseSave(code);
                return { ok: !!s, coins: s && s.coins, objs: s && s.objects.length, n0: S.objects.length,
                         name: s && s.objects.find(o => o.kind === 'enc').animals[0].name,
                         priv: code ? JSON.stringify(s).includes('"_conn"') : true,
                         json: !!g.parseSave(JSON.stringify(s)), bad: g.parseSave('not a save'), bad2: g.parseSave('{"v":1}') }; }""")
            check(r['ok'] and r['coins'] == 4321 and r['objs'] == r['n0'], 'exportCode → parseSave round trip keeps coins and objects')
            check(r['name'] == 'Bjørn', 'save code survives non-ASCII animal names')
            check(not r['priv'], 'exported save has no private _ keys')
            check(r['json'] and r['bad'] is None and r['bad2'] is None, 'parseSave accepts raw JSON and rejects junk')

            # real clicks: Zoo office → Settings → Save code & backup
            await pg.click('#btnHub')
            await pg.click('#hubTabs .tab >> text=Zoo office')
            await pg.click('#hubBody button:has-text("Save code & backup")')
            check(await pg.is_visible('#saveModal'), 'save modal opens from the Zoo office')
            code = await pg.input_value('#saveOut')
            check(len(code) > 100, 'save modal shows a code')
            await ev(pg, "() => { const S = window.__wg.S; S.coins = 7; S.objects = S.objects.filter(o => o.kind !== 'enc'); }")
            await pg.fill('#saveIn', 'garbage')
            await pg.click('#saveLoad')
            msg = await pg.inner_text('#saveMsg')
            check('look like' in msg and await pg.is_visible('#saveModal'), 'loading junk shows an error and keeps the modal open')
            await pg.fill('#saveIn', code)
            await pg.click('#saveLoad')
            await pg.wait_for_timeout(200)
            r = await ev(pg, "() => ({ coins: window.__wg.S.coins, enc: window.__wg.S.objects.filter(o => o.kind === 'enc').length, hidden: document.querySelector('#saveModal').hidden, hub: document.querySelector('#hub').hidden })")
            check(4321 <= r['coins'] < 4400 and r['enc'] == 1 and r['hidden'] and r['hub'], 'pasting the code restores the zoo and closes the modal and sheet')

            # file import through the hidden <input type=file>
            data = await ev(pg, "() => { const s = JSON.parse(atob(window.__wg.exportCode())); s.coins = 999; return JSON.stringify(s); }")
            tmp = pathlib.Path(tempfile.mkdtemp()) / 'zoo.json'
            tmp.write_text(data)
            await pg.click('#btnHub')
            await pg.click('#hubTabs .tab >> text=Zoo office')
            await pg.wait_for_timeout(750)
            await pg.click('#hubBody button:has-text("Save code & backup")')
            async with pg.expect_download() as dl:
                await pg.click('#saveDownload')
            d = await dl.value
            check(d.suggested_filename.startswith('wildgrove-zoo-level') and d.suggested_filename.endswith('.json'), 'Download file gives a .json backup')
            await pg.set_input_files('#saveFile', str(tmp))
            await pg.wait_for_timeout(300)
            check(await ev(pg, "() => window.__wg.S.coins") in range(999, 1100), 'opening a .json backup loads it')

            # loading while a tool is active and an object is selected
            await ev(pg, "() => { const g = window.__wg; g.setTool({ kind: 'deco', type: 'bush' }); }")
            await ev(pg, "() => window.__wg.loadState(window.__wg.parseSave(window.__wg.exportCode()))")
            r = await ev(pg, "() => ({ tool: window.__wg.tool, hint: document.querySelector('#toolHint').hidden, panel: document.querySelector('#panel').hidden })")
            check(r['tool'] is None and r['hint'] and r['panel'], 'loading a save clears the active tool and panel')
            # settings from the loaded save are applied (sound button state)
            await ev(pg, "() => { const g = window.__wg; const s = g.parseSave(g.exportCode()); s.settings.muted = true; g.loadState(s); }")
            off = await ev(pg, "() => document.querySelector('#btnSound').classList.contains('off')")
            check(off, 'a loaded save with sound muted shows the sound button as off')
            await ev(pg, "() => { const g = window.__wg; g.S.settings.muted = false; document.querySelector('#btnSound').click(); document.querySelector('#btnSound').click(); }")
        await section('save export/import', save_roundtrip)

        # ---------------------------------------------------------------- daily tasks
        async def daily_tasks():
            await fresh(pg)
            r = await ev(pg, "() => { const g = window.__wg; g.ensureTasks(); return window.__wg.S.tasks; }")
            check(len(r['list']) == 3 and len({t['id'] for t in r['list']}) == 3, 'three distinct daily tasks are generated')
            check(r['next'] > 0 and all(t['n'] > 0 for t in r['list']), 'tasks have a refresh time and targets')
            # finish two tasks through stats; the last stays open for now
            await ev(pg, """() => { const S = window.__wg.S;
                for (const t of S.tasks.list.slice(0, 2)) { if (t.stat === 'care:') S.stats.careBy[t.sp] = (S.stats.careBy[t.sp] || 0) + t.n; else S.stats[t.stat] += t.n; } }""")
            prog = await ev(pg, "() => window.__wg.S.tasks.list.map(t => window.__wg.taskProg(t))")
            # the third task may track something that grows on its own (visitors, coins), so only require it unfinished
            check(prog[0] >= 1 and prog[2] < r['list'][2]['n'], 'task progress counts from when the task was given')
            await pg.wait_for_timeout(400)
            badge = int(await pg.inner_text('#questBadge') or 0)
            check(badge >= 2, f'goals badge counts the claimable tasks (badge {badge})')
            await pg.click('#btnQuests')
            check('Daily tasks' in await pg.inner_text('#questList'), 'goals sheet lists daily tasks')
            gems0 = await ev(pg, "() => window.__wg.S.gems")
            for _ in range(2):
                await pg.click('#questList .quest.task.done button:has-text("Claim")')
                await pg.wait_for_timeout(120)
                await dismiss_level_up(pg)
            check(await ev(pg, "() => window.__wg.S.tasks.list.filter(t => t.claimed).length") == 2, 'claiming tasks with real clicks marks them claimed')
            check(await pg.query_selector('#questList .quest.bonus button') is None, 'bonus not claimable before all three are done')
            await ev(pg, """() => { const S = window.__wg.S, t = S.tasks.list[2]; if (t.stat === 'care:') S.stats.careBy[t.sp] = (S.stats.careBy[t.sp] || 0) + t.n; else S.stats[t.stat] += t.n; }""")
            await pg.wait_for_timeout(400)
            await pg.click('#questList .quest.task.done button:has-text("Claim")')
            await pg.wait_for_timeout(150)
            await dismiss_level_up(pg)
            await pg.click('#questList .quest.bonus button')
            await pg.wait_for_timeout(150)
            r = await ev(pg, "() => ({ bonus: window.__wg.S.tasks.bonus, gems: window.__wg.S.gems, reward: !document.querySelector('#reward').hidden })")
            check(r['bonus'] and r['gems'] >= gems0 + 1 + 2 and r['reward'], 'bonus pays 2 gems (+1 from the third task) and shows the reward')
            await pg.click('#rewardOk')
            check(await pg.query_selector('#questList .quest.task button, #questList .quest.bonus button') is None, 'no claim buttons left once everything is claimed')
            # refresh: an expired timer gives three new unclaimed tasks
            r = await ev(pg, "() => { const S = window.__wg.S; S.tasks.next = Date.now() - 1; window.__wg.ensureTasks(); return S.tasks; }")
            check(len(r['list']) == 3 and not any(t['claimed'] for t in r['list']) and not r['bonus'], 'tasks refresh after the timer runs out')
            await pg.click('#quests [data-close]')
        await section('daily tasks', daily_tasks)

        # ---------------------------------------------------------------- toys
        async def toys():
            ids = await fresh(pg)
            p = await ev(pg, "() => window.__wg.scr(21.5, 22.5)")
            await ev(pg, "(id) => window.__wg.select(window.__wg.S.objects.find(o => o.id === id))", ids['enc'])
            await pg.wait_for_timeout(100)
            c0 = await ev(pg, "() => [(window.__wg.S.coins - window.__wg.S.stats.earned), window.__wg.S.paws]")
            mood0 = await ev(pg, "(id) => { const S = window.__wg.S, e = S.objects.find(o => o.id === id); e.animals[0].due.pet = S.clock - 1; window.__wg.computeMeter(); return window.__wg.M.parts.mood; }", ids['enc'])
            await pg.click('#panel button:has-text("Play ball")')
            await pg.wait_for_timeout(100)
            r = await ev(pg, "(id) => { const S = window.__wg.S, e = S.objects.find(o => o.id === id); window.__wg.computeMeter(); return { toys: e.toys, coins: S.coins - S.stats.earned, paws: S.paws, mood: window.__wg.M.parts.mood }; }", ids['enc'])
            check(r['toys'] == ['toyBall'] and r['coins'] == c0[0] - 150 and r['paws'] == c0[1] - 2, 'buying a play ball from the enclosure panel charges 150 coins + 2 paws')
            check(r['mood'] > mood0, 'a toy raises animal mood')
            await pg.click('#panel button:has-text("Climbing log")')
            await pg.wait_for_timeout(100)
            n = await ev(pg, "(id) => window.__wg.S.objects.find(o => o.id === id).toys.length", ids['enc'])
            btns = await pg.query_selector_all('#panel button:has-text("Tyre swing")')
            check(n == 2 and not btns, 'enclosure takes 2 toys, then no more toy buttons')
            check('Toys 2/2' in await pg.inner_text('#panel'), 'panel shows toy count')
            # play need lasts longer with toys
            r = await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id), a = e.animals[0];
                a.due.play = S.clock - 1; g.careAll(e, 'play'); return (a.due.play - S.clock) / 540 / 0.9; }""", ids['enc'])
            check(r > 1.4, f'with 2 toys the play need lasts longer ({r:.2f}× base)')
            # store and re-place keeps toys; selling an enclosure with toys
            await ev(pg, "(id) => { const e = window.__wg.S.objects.find(o => o.id === id); e.animals.splice(0); e.species = null; }", ids['enc'])
            await ev(pg, "(id) => window.__wg.select(window.__wg.S.objects.find(o => o.id === id))", ids['enc'])
            await pg.wait_for_timeout(100)
            await pg.click('#panel .foot button:has-text("Store")')
            it = await ev(pg, "() => window.__wg.S.storage.items.find(i => i.kind === 'enc')")
            check(it is not None and it.get('toys') == ['toyBall', 'toyLog'], 'storing an enclosure keeps its toys')
        await section('toys', toys)

        # ---------------------------------------------------------------- vet
        async def vet():
            ids = await fresh(pg)
            r = await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id);
                for (const a of e.animals) a.sick = true; S.medicine = 1; S.helpers.vet = S.clock + 7200;
                for (let i = 0; i < 40; i++) g.tick(0.1);
                return { sick: e.animals.filter(a => a.sick).length, med: S.medicine }; }""", ids['enc'])
            check(r['med'] == 0 and r['sick'] == 1, 'vet treats a sick animal per medicine and stops when medicine runs out')
            r = await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id);
                S.medicine = 3; for (let i = 0; i < 30; i++) g.tick(0.1);
                return { sick: e.animals.filter(a => a.sick).length, med: S.medicine }; }""", ids['enc'])
            check(r['sick'] == 0 and r['med'] == 2, 'vet heals the rest once medicine is restocked')
            r = await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id);
                S.helpers.vet = 0; e.animals[0].sick = true; for (let i = 0; i < 30; i++) g.tick(0.1);
                return e.animals[0].sick; }""", ids['enc'])
            check(r, 'no healing once the vet contract has ended')
            await pg.click('#btnHub')
            await pg.click('#hubTabs .tab >> text=Zoo office')
            check('Zoo vet' in await pg.inner_text('#hubBody'), 'vet is listed in the Zoo office staff')
            await pg.click('#hub [data-close]')
        await section('vet', vet)

        # ---------------------------------------------------------------- wishes & visitors
        async def wishes_visitors():
            ids = await fresh(pg)
            check(ids['conn'], 'test zoo: enclosure is connected to the gate')
            await ev(pg, RUN, [400, 0.1])
            r = await ev(pg, """() => { const S = window.__wg.S, seen = [...window.__seenV], live = window.__wg.visitors();
                const gone = seen.filter(v => !live.includes(v));
                return { wishes: S.stats.wishes, seen: seen.length, removed: gone.length, viaGate: gone.filter(v => v.gone).length,
                         timedOut: gone.filter(v => !v.gone).length, earned: S.stats.earned, missed: Object.keys(S.wishLog).length }; }""")
            check(r['seen'] >= 10, f"visitors come to the zoo ({r['seen']} in 400 s)")
            check(r['wishes'] >= 1, f"visitor wishes get granted ({r['wishes']} granted, {r['missed']} kinds missed)")
            check(r['removed'] > 0 and r['timedOut'] == 0, f"visitors leave through the gate ({r['viaGate']} via gate, {r['timedOut']} timed out on the paths)")
            # nobody is parked on a non-path tile and nobody keeps a dead destination
            r = await ev(pg, """() => window.__wg.visitors().filter(v => !(v.cx === 29 && v.cy === 24) && !window.__wg.S.paths.includes(v.cx + ',' + v.cy)).length""")
            check(r == 0, 'every visitor stands on a path tile')

            # a wish for an animal routes the visitor to that enclosure and pays a tip
            r = await ev(pg, """(id) => { const g = window.__wg, S = g.S; const v = g.visitors().find(v => !v.leaving) || null; if (!v) return null;
                v.wish = { kind: 'animal', key: 'bunny', t: -120 }; v.dest = null; v.route = null; v.age = 0; v.life = 500; v.sad = 0;
                for (let i = 0; i < 1500 && v.wish && g.visitors().includes(v); i++) g.tick(0.1);
                return { granted: !v.wish && !(v.sad > 0), left: !g.visitors().includes(v) }; }""", ids['enc'])
            check(r and r['granted'], f'a visitor wishing for bunnies walks to them and the wish is granted ({r})')

            # removing a path tile a visitor is routed over: they must re-plan and still leave via the gate
            r = await ev(pg, """() => { const g = window.__wg, S = g.S;
                let v = null; for (let i = 0; i < 3000 && !v; i++) { g.tick(0.05); v = g.visitors().find(v => v.route && v.route.length >= 3 && !v.leaving); }
                if (!v) return { found: false };
                S.litter = [];
                const [x, y] = v.route[0];
                g.setTool({ kind: 'bulldoze' }); g.place(x, y); g.setTool(null);
                for (let i = 0; i < 200 && v.route; i++) g.tick(0.05);
                const broke = v.route === null;
                g.setTool({ kind: 'path' }); g.place(x, y); g.setTool(null);   // repair the path
                v.age = 0; v.life = 30; const keep = v;
                for (let i = 0; i < 1200 && g.visitors().includes(keep); i++) g.tick(0.1);
                return { found: true, broke, gone: !!keep.gone, stillDest: !!keep.dest, inZoo: g.visitors().includes(keep) }; }""")
            if r['found']:
                check(r['broke'], 'a removed path tile breaks the visitor\'s route')
                check(r['gone'], f"after a path tile on their route is removed, the visitor still leaves via the gate (left via gate: {r['gone']})")
            else:
                check(False, 'could not find a routed visitor to test path removal')

            # moving the enclosure a wishing visitor is heading to: no wish granted at the old spot
            r = await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id);
                let v = null; for (let i = 0; i < 3000 && !v; i++) { g.tick(0.05); v = g.visitors().find(v => v.dest && v.dest.obj === e && v.route && v.route.length >= 2); }
                if (!v) return null;
                v.wish = { kind: 'animal', key: 'bunny', t: 0 };
                g.setTool({ kind: 'move', obj: e, w: 3, h: 3 }); g.place(17, 17); g.setTool(null);
                const w0 = S.stats.wishes; for (let i = 0; i < 200 && v.dest; i++) g.tick(0.05);
                return { grantedAtOldSpot: S.stats.wishes > w0 && !v.wish, conn: e._conn }; }""", ids['enc'])
            if r is not None:
                check(not r['grantedAtOldSpot'], 'a visitor does not get a bunny wish granted where the moved enclosure used to be')
        await section('wishes & visitors', wishes_visitors)

        # ---------------------------------------------------------------- day / night
        async def day_night():
            await fresh(pg)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; S.settings.night = true;
                S.clock = 900 * 3 + 0.8 * 900; g.tick(0.01); const night = g.DK;
                S.clock = 900 * 4 + 0.3 * 900; g.tick(0.01); const day = g.DK;
                S.clock = 900 * 4 + 0.8 * 900; g.tick(0.01); return { night, day }; }""")
            check(r['night'] > 0.99 and r['day'] == 0, 'darkness follows the day cycle')
            await pg.wait_for_timeout(400)
            check(await pg.is_visible('#btnDay'), 'day/night button shows after the tutorial')
            await pg.click('#btnHub')
            await pg.click('#hubTabs .tab >> text=Zoo office')
            await pg.wait_for_timeout(750)
            await pg.click('#hubBody button:has-text("Day & night on")')
            await pg.wait_for_timeout(100)
            r = await ev(pg, "() => { const g = window.__wg; g.tick(0.01); return { dk: g.DK, set: g.S.settings.night }; }")
            check(r['set'] is False and r['dk'] == 0, 'turning Day & night off in settings removes the darkness')
            await pg.wait_for_timeout(400)
            check(not await pg.is_visible('#btnDay'), 'day/night button hides when the cycle is off')
            await pg.wait_for_timeout(750)
            await pg.click('#hubBody button:has-text("Day & night off")')
            r = await ev(pg, "() => { const g = window.__wg; g.tick(0.01); return g.DK; }")
            check(r > 0.99, 'turning it back on brings the night back')
            await pg.click('#hub [data-close]')
            # fewer visitors at night
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; const T = g.M.target;
                S.clock = 900 * 10 + 0.68 * 900; for (let i = 0; i < 2000; i++) g.tick(0.1); const night = g.visitors().length;
                S.clock = 900 * 11; for (let i = 0; i < 2000; i++) g.tick(0.1); const day = g.visitors().length;
                return { night, day, T: g.M.target }; }""")
            check(r['night'] <= r['day'], f"fewer visitors at night ({r['night']} night vs {r['day']} day, target {r['T']})")
        await section('day / night', day_night)

        # ---------------------------------------------------------------- cancel build & undo decor
        async def refunds():
            await fresh(pg)
            r0 = await ev(pg, "() => ({ coins: (window.__wg.S.coins - window.__wg.S.stats.earned), xp: window.__wg.S.xp, level: window.__wg.S.level })")
            await ev(pg, "() => { const g = window.__wg; g.setTool({ kind: 'shop', type: 'lemonade' }); g.place(22, 25); }")
            check(await ev(pg, "() => (window.__wg.S.coins - window.__wg.S.stats.earned)") == r0['coins'] - 350, 'placing a lemonade stand charges 350')
            await pg.wait_for_timeout(100)
            btn = await pg.query_selector('#panel button:has-text("Cancel")')
            check(btn is not None, 'construction panel offers Cancel with a refund')
            if btn:
                await btn.click()
                await pg.wait_for_timeout(100)
            r = await ev(pg, "() => ({ coins: (window.__wg.S.coins - window.__wg.S.stats.earned), xp: window.__wg.S.xp, level: window.__wg.S.level, n: window.__wg.S.objects.filter(o => o.type === 'lemonade').length })")
            check(r['coins'] == r0['coins'] and r['n'] == 0, 'cancelling construction refunds every coin and removes the site')
            check((r['level'], r['xp']) == (r0['level'], r0['xp']), f"cancelling construction takes back the placement XP (xp {r0['xp']} → {r['xp']})")
            # repeated place+cancel must not farm levels/gems
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; const l0 = S.level, g0 = S.gems, c0 = S.coins;
                for (let i = 0; i < 1000; i++) { g.setTool({ kind: 'enc', biome: 'meadow' }); g.place(17, 17);   // place() selects the site
                  const b = [...document.querySelectorAll('#panel button')].find(b => b.textContent.startsWith('Cancel')); if (!b) break; b.click(); }
                g.setTool(null); return { dl: S.level - l0, dg: S.gems - g0, dc: S.coins - c0 }; }""")
            await dismiss_level_up(pg)
            check(r['dl'] == 0 and r['dg'] == 0, f"1000× place + cancel gains no levels or gems (+{r['dl']} levels, +{r['dg']} gems)")
            # undo decor with Ctrl+Z
            c0 = await ev(pg, "() => (window.__wg.S.coins - window.__wg.S.stats.earned)")
            x0 = await ev(pg, "() => window.__wg.S.xp")
            await ev(pg, "() => { const g = window.__wg; g.setTool({ kind: 'deco', type: 'fountain' }); g.place(18, 25); g.place(19, 25); }")
            check(await pg.is_visible('#toolUndo'), 'Undo button shows while placing decor')
            await pg.keyboard.press('Control+z')
            r = await ev(pg, "() => ({ coins: (window.__wg.S.coins - window.__wg.S.stats.earned), f: window.__wg.S.objects.filter(o => o.type === 'fountain' && o.gy === 25).map(o => o.gx) })")
            check(r['f'] == [18] and r['coins'] == c0 - 400, f"Ctrl+Z removes the last decor and refunds it (fountains at x={r['f']}, coins {r['coins'] - c0:+})")
            await pg.click('#toolUndo')
            r = await ev(pg, "() => ({ coins: (window.__wg.S.coins - window.__wg.S.stats.earned), f: window.__wg.S.objects.filter(o => o.type === 'fountain' && o.gy === 25).length })")
            check(r['f'] == 1 and r['coins'] == c0 - 400, 'only the most recent placement can be undone')
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; const l0 = S.level, g0 = S.gems, x0 = S.xp;
                g.setTool({ kind: 'deco', type: 'bush' }); for (let i = 0; i < 300; i++) { g.place(23, 27); g.undoPlace(); } g.setTool(null);
                return { dl: S.level - l0, dg: S.gems - g0, dx: S.xp - x0 }; }""")
            check(r['dl'] == 0 and r['dx'] <= 0, f"300× place + undo decor gains no XP (+{r['dl']} levels, +{r['dg']} gems, xp {r['dx']:+})")
            await ev(pg, "() => window.__wg.setTool(null)")
        await section('cancel build & undo decor', refunds)

        # ---------------------------------------------------------------- restock & low food chip
        async def restock():
            await fresh(pg)
            await ev(pg, "() => { const S = window.__wg.S; S.food.hay = 1; }")
            await pg.wait_for_timeout(400)
            check(await pg.is_visible('#lowFood'), 'low-food chip appears when hay runs low')
            check('hay' in (await pg.inner_text('#lowFood')).lower() or await pg.query_selector('#lowFood img') is not None, 'low-food chip names/shows the food')
            plan = await ev(pg, "() => window.__wg.restockPlan(40)")
            await pg.click('#lowFood', force=True)  # the chip pulses forever, so it is never "stable"
            await pg.wait_for_timeout(150)
            check(await pg.is_visible('#shop') and await pg.is_visible('.supply.restock'), 'chip opens Build → Supplies with a restock row')
            c0 = await ev(pg, "() => (window.__wg.S.coins - window.__wg.S.stats.earned)")
            await pg.click('.supply.restock button')
            await pg.wait_for_timeout(450)
            r = await ev(pg, "() => ({ hay: window.__wg.S.food.hay, coins: (window.__wg.S.coins - window.__wg.S.stats.earned) })")
            check(r['hay'] == 40 and r['coins'] == c0 - plan['cost'], f"restock brings hay to 40 for {plan['cost']} coins")
            check(not await pg.is_visible('#lowFood'), 'low-food chip goes away after restocking')
            check(await pg.query_selector('.supply.restock') is None, 'restock row hides when everything is stocked')
            await pg.click('#shop [data-close]')
        await section('restock', restock)

        # ---------------------------------------------------------------- keyboard shortcuts
        async def keys():
            await fresh(pg)
            await pg.mouse.move(5, 400)
            for k, sel in [('b', '#shop'), ('s', '#storage'), ('g', '#quests'), ('z', '#hub')]:
                await pg.keyboard.press(k)
                await pg.wait_for_timeout(80)
                check(await pg.is_visible(sel), f'key {k.upper()} opens {sel}')
                await pg.keyboard.press('Escape')
                await pg.wait_for_timeout(80)
                check(not await pg.is_visible(sel), f'Esc closes {sel}')
            await pg.keyboard.press('p')
            check(await ev(pg, "() => window.__wg.tool && window.__wg.tool.kind") == 'path', 'key P picks the path tool')
            await pg.keyboard.press('c')
            check(await ev(pg, "() => window.__wg.tool && window.__wg.tool.kind") == 'bulldoze', 'key C picks the clear tool')
            await pg.keyboard.press('Escape')
            check(await ev(pg, "() => window.__wg.tool") is None, 'Esc drops the tool')
            z0 = await ev(pg, "() => window.__wg.cam.z")
            await pg.keyboard.press('=')
            check(await ev(pg, "() => window.__wg.cam.z") > z0, '+ zooms in')
            m0 = await ev(pg, "() => window.__wg.S.settings.muted")
            await pg.keyboard.press('m')
            check(await ev(pg, "() => window.__wg.S.settings.muted") != m0, 'M toggles sound')
            await pg.keyboard.press('m')
            # shortcuts are ignored while typing in the save modal
            await ev(pg, "() => window.__wg.openHub('office')")
            await pg.click('#hubBody button:has-text("Save code & backup")')
            await pg.click('#saveIn')
            await pg.keyboard.type('bgs')
            check(await pg.input_value('#saveIn') == 'bgs' and not await pg.is_visible('#shop'), 'typing in the save box does not trigger shortcuts')
            await pg.click('#saveClose')
        await section('keyboard shortcuts', keys)

        # ---------------------------------------------------------------- offline progress
        async def offline():
            await fresh(pg)
            await ev(pg, """() => { const S = window.__wg.S; for (const o of S.objects) if (o.kind === 'shop') o.prog = 0; window.__wg.save(); }""")
            c0 = await ev(pg, "() => window.__wg.S.coins")
            await ev(pg, "() => sessionStorage.setItem('wg.rewind', '3600')")
            await pg.reload()
            try:
                await pg.wait_for_selector('#welcome', state='visible', timeout=5000)
            except Exception:
                pass
            diag = await ev(pg, "() => ({ rewound: window.__rewound, tut: window.__wg.S.tut, modals: [...document.querySelectorAll('.modal:not([hidden])')].map(m => m.id) })")
            check(await pg.is_visible('#welcome'), f'welcome-back modal after an hour away ({diag})')
            body = await pg.inner_text('#welcome .wbody')
            check('1 h' in body or '60 min' in body, f'welcome modal reports the time away ({body.splitlines()[0][:60]})')
            r = await ev(pg, "() => ({ coins: window.__wg.S.coins, ready: window.__wg.S.objects.filter(o => o.kind === 'shop' && o.prog >= 1).length })")
            check(r['coins'] > c0 and r['ready'] >= 1, f"offline tickets paid (+{r['coins'] - c0}) and shops filled")
            await pg.click('#welcomeOk')
            check(not await pg.is_visible('#welcome'), 'welcome modal closes')
        await section('offline progress', offline)

        # ---------------------------------------------------------------- coast habitat
        async def coast():
            await fresh(pg)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S;
                g.setTool({ kind: 'enc', biome: 'coast' }); g.place(17, 17); g.setTool({ kind: 'enc', biome: 'ice' }); g.place(17, 20); g.setTool(null);
                for (const o of S.objects) if (o.build) o.build = S.clock; g.tick(0.05);
                const c = S.objects.find(o => o.biome === 'coast'), i = S.objects.find(o => o.biome === 'ice');
                g.adopt(c, 'penguin', 'm', 0); g.adopt(c, 'seal', 'm', 0); g.adopt(c, 'otter', 'f', 0); g.adopt(i, 'seal', 'f', 0);
                const c2 = { ...c }; return { coast: c.animals.map(a => a.species), ice: i.animals.map(a => a.species), food: S.food.kelp }; }""")
            check(r['coast'] == ['seal'] and r['ice'] == [], 'coast enclosure takes seals only; penguins, otters (mixed species) and ice-floe seals refused')
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; const e = S.objects.filter(o => o.kind === 'enc' && !o.species && o.biome === 'coast')[0] || null;
                g.setTool({ kind: 'enc', biome: 'coast' }); g.place(23, 17); g.setTool(null); for (const o of S.objects) if (o.build) o.build = S.clock; g.tick(0.05);
                const t = S.objects.find(o => o.gx === 23 && o.gy === 17); g.adopt(t, 'turtle', 'm', 0); g.adopt(t, 'turtle', 'f', 0);
                for (const a of t.animals) a.due.food = S.clock - 1; S.food.kelp = 1; const n = g.careAll(t, 'food');
                return { n: t.animals.length, fed: n, kelp: S.food.kelp, low: g.lowFoods() }; }""")
            check(r['n'] == 2 and r['fed'] == 1 and r['kelp'] == 0, 'sea turtles eat kelp from stock')
            check('kelp' in r['low'], 'kelp shows up as low food')
        await section('coast habitat', coast)

        # ---------------------------------------------------------------- migration
        async def migration():
            await fresh(pg)
            old = await ev(pg, """() => { const s = JSON.parse(atob(window.__wg.exportCode()));
                delete s.tasks; delete s.settings; delete s.wishLog; delete s.stats.careBy; delete s.stats.wishes; delete s.stats.visitorsIn; delete s.stats.dung; delete s.stats.earned;
                delete s.food.kelp; delete s.helpers.vet; delete s.cards.coast;
                for (const o of s.objects) delete o.toys; for (const it of s.storage.items) delete it.toys;
                s.storage.items.push({ kind: 'enc', type: 'enc', biome: 'meadow', level: 1, w: 3, h: 3 });
                return JSON.stringify(s); }""")
            # write the old save, then stop this page from saving over it before the reload
            await ev(pg, "(raw) => { localStorage.setItem('wildgrove.save.v2', raw); Storage.prototype.setItem = () => {}; }", old)
            await pg.reload()
            await pg.wait_for_timeout(600)
            r = await ev(pg, """() => { const S = window.__wg.S; return { tasks: !!S.tasks, settings: S.settings, careBy: S.stats.careBy, kelp: S.food.kelp, vet: S.helpers.vet,
                coast: S.cards.coast, toys: S.objects.filter(o => o.kind === 'enc').every(o => Array.isArray(o.toys)), wishLog: !!S.wishLog }; }""")
            check(r['tasks'] and r['settings'] == {'muted': False, 'music': True, 'night': True} and r['careBy'] == {} and r['kelp'] == 0 and r['vet'] == 0 and r['wishLog'], 'old save is migrated with tasks, settings, careBy, kelp, vet')
            check(r['toys'] and r['coast'] == [0, 0, 0, 0, 0], 'old enclosures get an empty toy list and the coast collection exists')
            # the migrated zoo works: tick, open every sheet, select the enclosure, place the stored enclosure
            await ev(pg, RUN, [60, 0.1])
            for b in ['#btnQuests', '#btnHub', '#btnStorage', '#btnShop']:
                await pg.click(b)
                await pg.wait_for_timeout(120)
            await ev(pg, "() => { const g = window.__wg, S = g.S; g.select(S.objects.find(o => o.kind === 'enc')); }")
            await pg.wait_for_timeout(350)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; const it = S.storage.items.find(i => i.kind === 'enc');
                g.setTool({ kind: 'place', item: it, w: 3, h: 3 }); g.place(17, 17); const e = S.objects.find(o => o.gx === 17 && o.gy === 17); g.select(e); return e && e.toys; }""")
            await pg.wait_for_timeout(350)
            check(r == [], 'a stored enclosure from an old save places with an empty toy list')
        await section('migration', migration)

        # ---------------------------------------------------------------- reset
        async def reset():
            await fresh(pg)
            await ev(pg, "() => window.__wg.openHub('office')")
            await pg.wait_for_timeout(750)
            await pg.click('#hubBody button:has-text("Start a new zoo")')
            await pg.click('#resetYes')
            await pg.wait_for_timeout(300)
            r = await ev(pg, "() => { const S = window.__wg.S; return { tut: S.tut, coins: S.coins - S.stats.earned, esc: S.escaped.length, vis: window.__wg.visitors().length, hub: document.querySelector('#hub').hidden, tutBox: document.querySelector('#tutorial').hidden, tasks: S.tasks.list.length }; }")
            check(r['tut'] == 0 and r['esc'] == 3 and r['vis'] == 0 and r['hub'] and not r['tutBox'] and r['tasks'] == 0, 'Start a new zoo resets to the tutorial with no visitors, tasks or open sheets')
            await pg.keyboard.press('Control+z')
            check(await ev(pg, "() => (window.__wg.S.coins - window.__wg.S.stats.earned)") == r['coins'], 'undo after a reset refunds nothing')
        await section('reset', reset)

        # ---------------------------------------------------------------- art coverage
        async def art():
            r = await ev(pg, """() => {
                const miss = (keys, set) => keys.filter(k => !set[k]);
                const helperIcon = k => k === 'food' ? 'hay' : k === 'clean' ? 'broom' : k;
                return {
                  animals: miss(Object.keys(GAME.SPECIES), ART.animals),
                  variants: miss(Object.keys(GAME.SPECIES), ART.variantNames || {}),
                  decor: miss([...Object.keys(GAME.DECOR), ...Object.keys(GAME.SHOPS), ...Object.keys(GAME.BUILDINGS), ...Object.keys(GAME.TOYS)], ART.decor),
                  icons: miss([...Object.keys(GAME.FOODS), ...Object.keys(GAME.HELPERS).map(helperIcon), 'toy', 'save', 'sun', 'moon', 'medicine', 'sick'], ART.icons),
                }; }""")
            for k, v in r.items():
                check(not v, f'every {k[:-1] if k.endswith("s") else k} used by the game data has art' + (f' (missing: {", ".join(v)})' if v else ''))
        await section('art coverage', art)

        # ---------------------------------------------------------------- phone layout (390 px)
        async def phone():
            ph = await ctx.new_page()
            await ph.set_viewport_size({'width': 390, 'height': 844})
            ph.on('pageerror', lambda e: errors.append(str(e)))
            await ph.goto(PAGE)
            await ph.wait_for_timeout(400)
            await ev(ph, SETUP)
            await ev(ph, "() => { const g = window.__wg, S = g.S; S.food.hay = 1; g.ensureTasks(); g.select(null); }")
            await ph.wait_for_timeout(400)
            r = await ev(ph, """() => { const c = document.querySelector('#lowFood'), i = c.querySelector('.ic'), b = c.getBoundingClientRect();
                const hud = [...document.querySelectorAll('.hud > *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect());
                return { icon: !!i && getComputedStyle(i).display !== 'none', w: b.width, right: Math.max(...hud.map(h => h.right)), sw: document.documentElement.scrollWidth }; }""")
            check(r['icon'] and r['w'] >= 28, f"low-food chip shows its food icon at 390 px (chip {r['w']:.0f}px wide)")
            check(r['right'] <= 390 and r['sw'] <= 390, f"HUD fits the phone width (rightmost {r['right']:.0f}px, page {r['sw']}px)")
            await ph.click('#btnQuests')
            await ph.wait_for_timeout(200)
            r = await ev(ph, "() => { const b = document.querySelector('#quests').getBoundingClientRect(); return [b.left, b.right, document.querySelectorAll('#questList .quest.task').length]; }")
            check(r[0] >= 0 and r[1] <= 390 and r[2] == 3, 'tasks sheet fits the phone and lists 3 tasks')
            await ph.click('#quests [data-close]')
            await ev(ph, "() => { const g = window.__wg; g.select(g.S.objects.find(o => o.kind === 'enc')); }")
            await ph.wait_for_timeout(200)
            r = await ev(ph, """() => { const p = document.querySelector('#panel').getBoundingClientRect();
                const bs = [...document.querySelectorAll('#panel .toys button')].map(b => b.getBoundingClientRect());
                return { n: bs.length, ok: bs.every(b => b.left >= p.left && b.right <= p.right + 0.5) }; }""")
            check(r['n'] >= 1 and r['ok'], f"toy buttons wrap inside the enclosure panel ({r['n']} buttons)")
            await ev(ph, "() => { window.__wg.select(null); window.__wg.openHub('office'); }")
            await ph.click('#hubBody button:has-text("Save code & backup")')
            await ph.wait_for_timeout(200)
            r = await ev(ph, """() => { const s = document.querySelector('#saveModal .sheet').getBoundingClientRect(), l = document.querySelector('#saveLoad').getBoundingClientRect();
                return [s.left, s.right, s.top, s.bottom, l.bottom]; }""")
            check(r[0] >= 0 and r[1] <= 390 and r[2] >= 0 and r[3] <= 844, 'save modal fits on a 390×844 phone')
            await ph.click('#saveClose')
            await ph.close()
        await section('phone layout', phone)

        check(not errors, 'no page errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))
        await browser.close()
    sys.exit(1 if check.failed else 0)

asyncio.run(main())
