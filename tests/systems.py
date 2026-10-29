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


# Deterministic Math.random (the engine grabs Math.random once at load), plus a fake clock
# (__setNow / __resetNow) for the weekly festival tests. The engine looks up the global Date on
# every call, so swapping window.Date moves the game's real-time clock.
INIT = """
(() => {
  let x = 123456789;
  Math.random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const R = Date;
  window.__setNow = ms => { class F extends R { constructor(...a) { if (a.length) super(...a); else super(ms); } static now() { return ms; } } window.Date = F; };
  window.__resetNow = () => { window.Date = R; };
})();
"""

# Builds a small finished zoo after the tutorial: a path from the gate west along y=24,
# a meadow enclosure (20..22, 21..23) with a bunny pair, a feeding station at (24,25) and a
# bench at (26,25), all touching the path. Returns ids for later lookups.
SETUP = """(opts) => {
  const g = window.__wg, S = g.S; opts = opts || {};
  if (S.tut >= 0) g.skipTutorial();
  S.settings.weather = !!opts.weather; S.weather = null;   // random showers would refill water needs mid-test
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
            # save, move savedAt an hour back, and stop this page from saving again before the reload
            # (all in one synchronous step, so no autosave or pagehide save can slip in between)
            c0 = await ev(pg, """() => { const g = window.__wg, S = g.S; for (const o of S.objects) if (o.kind === 'shop') o.prog = 0; g.save();
                const s = JSON.parse(localStorage.getItem('wildgrove.save.v2')); s.savedAt -= 3600 * 1000;
                localStorage.setItem('wildgrove.save.v2', JSON.stringify(s)); Storage.prototype.setItem = () => {}; window.__rewound = 3600; return s.coins; }""")
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

        # ================================================================ second pass: newer features

        # ---------------------------------------------------------------- level-up card
        async def level_card():
            await fresh(pg)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; S.clock = 900 * 5 + 90; g.tick(0.01);   // daytime
                const l0 = S.level, gem0 = S.gems; let need = -S.xp; for (let l = l0; l < l0 + 3; l++) need += Math.round(50 * Math.pow(l, 1.55));
                g.addXp(need);
                const unl = [...Object.values(GAME.SPECIES), ...Object.values(GAME.BIOMES), ...Object.values(GAME.SHOPS), ...Object.values(GAME.BUILDINGS)].filter(d => d.lvl > l0 && d.lvl <= l0 + 3).length;
                return { l0, level: S.level, dg: S.gems - gem0, vis: !document.querySelector('#levelUp').hidden, num: document.querySelector('#lvNum').textContent,
                         gems: document.querySelector('#lvGems').textContent, cards: document.querySelectorAll('#levelUp .unlock').length, unl }; }""")
            check(r['level'] == r['l0'] + 3 and r['vis'], f"three level-ups stack into one level-up card (level {r['l0']} → {r['level']})")
            check(r['num'] == str(r['level']) and r['gems'] == str(r['dg']) and r['dg'] > 0, f"level card shows the final level and the gems of all three levels (card: level {r['num']}, +{r['gems']} gems; paid {r['dg']})")
            check(r['cards'] >= r['unl'], f"level card lists the unlocks of every level gained ({r['cards']} cards, {r['unl']} unlocked species/habitats/shops/buildings)")
            await pg.click('#levelOk')
            check(not await pg.is_visible('#levelUp'), 'Let\'s build closes the level card')
            r = await ev(pg, """() => { const g = window.__wg, S = g.S, gem0 = S.gems; g.addXp(Math.round(50 * Math.pow(S.level, 1.55)) - S.xp);
                return { gems: document.querySelector('#lvGems').textContent, dg: S.gems - gem0 }; }""")
            check(r['gems'] == str(r['dg']), f"a new card after closing counts only the new level's gems ({r['gems']} shown, {r['dg']} paid)")
            await pg.click('#levelOk')
            # confetti: counted as rotated fillRect calls on the world canvas (nothing else draws rotated rects)
            r = await ev(pg, """async () => { const g = window.__wg, S = g.S, cv = document.getElementById('world'); let n = 0;
                const P = CanvasRenderingContext2D.prototype, f = P.fillRect;
                P.fillRect = function (...a) { if (this.canvas === cv) { const t = this.getTransform(); if (Math.abs(t.b) > 1e-3 && Math.abs(t.c) > 1e-3) n++; } return f.apply(this, a); };
                const wait = ms => new Promise(r => setTimeout(r, ms));
                await wait(300); const before = n; n = 0;
                g.addXp(Math.round(50 * Math.pow(S.level, 1.55)) - S.xp); await wait(300); const after = n; P.fillRect = f;
                document.querySelector('#levelOk').click(); return { before, after, dk: g.DK }; }""")
            check(r['after'] > r['before'] + 30, f"level-up confetti is drawn in daylight (rotated rects: {r['before']} before, {r['after']} after; darkness {r['dk']})")
            # never during the tutorial
            await fresh(pg, tutorial=True)
            r = await ev(pg, "() => { const g = window.__wg; g.addXp(60); return { level: g.S.level, vis: !document.querySelector('#levelUp').hidden }; }")
            check(r['level'] == 2 and not r['vis'], 'no level card during the tutorial (a toast instead)')
        await section('level-up card', level_card)

        # ---------------------------------------------------------------- Build "New" ribbons
        async def build_new():
            await fresh(pg)    # SETUP jumps to level 12, so everything from levels 2..12 is unseen
            await pg.wait_for_timeout(400)
            r = await ev(pg, "() => ({ badge: document.querySelector('#buildBadge').hidden ? 0 : +document.querySelector('#buildBadge').textContent })")
            check(r['badge'] > 5, f"Build badge counts unseen unlocks ({r['badge']})")
            await pg.click('#btnShop')
            n_new = len(await pg.query_selector_all('#shopGrid .card.new'))
            exp = await ev(pg, "() => Object.values(GAME.BIOMES).filter(b => b.lvl > 1 && b.lvl <= window.__wg.S.level).length")
            check(n_new == exp, f"Enclosures tab ribbons every newly unlocked habitat ({n_new} of {exp})")
            await pg.wait_for_timeout(400)
            b2 = await ev(pg, "() => document.querySelector('#buildBadge').hidden ? 0 : +document.querySelector('#buildBadge').textContent")
            check(b2 == r['badge'] - exp, f"viewing a tab clears its items from the badge ({r['badge']} → {b2})")
            await pg.click('#shopTabs .tab >> text=Enclosures')
            check(len(await pg.query_selector_all('#shopGrid .card.new')) == 0, 'seen items lose the New ribbon')
            for t in ['Shops', 'Buildings', 'Decor']:
                await pg.click(f'#shopTabs .tab >> text={t}')
            await pg.wait_for_timeout(400)
            check(await pg.is_hidden('#buildBadge'), 'badge disappears once every tab was viewed')
            await pg.click('#shop [data-close]')
            # an old save without seenBuild must not show its whole catalogue as new
            r = await ev(pg, """() => { const g = window.__wg; const s = g.parseSave(g.exportCode()); s.level = 12; delete s.seenBuild;
                const s2 = g.parseSave(JSON.stringify(s)); g.loadState(s2); return document.querySelector('#buildBadge').hidden; }""")
            check(r, 'an old save (no seenBuild) shows no New badge')
            r = await ev(pg, "() => { const g = window.__wg, S = g.S; g.addXp(Math.round(50 * Math.pow(S.level, 1.55)) - S.xp); g.addXp(0); return { lvl: S.level }; }")
            await pg.wait_for_timeout(400)
            await dismiss_level_up(pg)
            badge = await ev(pg, "() => document.querySelector('#buildBadge').hidden ? 0 : +document.querySelector('#buildBadge').textContent")
            check(badge >= 1, f"reaching level {r['lvl']} badges what it unlocked ({badge})")
        await section('build new ribbons', build_new)

        # ---------------------------------------------------------------- Ask Tilda
        NEUTRAL = """() => { const g = window.__wg, S = g.S; S.claimed = GAME.QUESTS.map(q => q.id); g.ensureTasks(); for (const t of S.tasks.list) t.claimed = true; S.tasks.bonus = true;
            const E = g.ensureEvent(); for (const k in E.base) E.base[k] = S.stats[k] || 0; E.spent = 0; E.claimed = 0;
            for (const o of S.objects) if (o.kind === 'shop') o.prog = 0; S.medicine = 10; for (const f in S.food) S.food[f] = 500; S.storage.animals = []; S.storage.items = [];
            for (const e of S.objects) if (e.kind === 'enc') for (const a of e.animals) { a.sick = false; for (const n in a.due) a.due[n] = S.clock + 1e5; } g.computeMeter(); }"""
        CASES = [
            ('sick without medicine', "S.objects.find(o => o.kind === 'enc').animals[0].sick = true; S.medicine = 0;", 'short on medicine', True),
            ('sick with medicine', "S.objects.find(o => o.kind === 'enc').animals[0].sick = true;", 'red medicine bubble', False),
            ('low food', "S.food.hay = 0;", 'nearly out of hay', True),
            ('unconnected enclosure', "g.setTool({ kind: 'enc', biome: 'meadow' }); g.place(17, 17); g.setTool(null); const e = S.objects.find(o => o.gx === 17 && o.gy === 17); e.build = S.clock; g.tick(0.01); g.adopt(e, 'bunny', 'm', 0); g.adopt(e, 'bunny', 'f', 0); for (const a of e.animals) for (const n in a.due) a.due[n] = S.clock + 1e5; g.rebuild();", "can't reach", True),
            ('full shop', "S.objects.find(o => o.kind === 'shop').prog = 1;", 'is full', False),
            ('empty enclosure + fitting storage', "g.setTool({ kind: 'enc', biome: 'meadow' }); g.place(17, 17); g.setTool(null); S.objects.find(o => o.gx === 17 && o.gy === 17).build = S.clock; g.tick(0.01); S.storage.animals.push(g.storeRec('bunny', 0, 'f', false));", 'in storage would fit', True),
            ('animal in storage with no habitat', "S.storage.animals.push(g.storeRec('penguin', 0, 'f', false));", 'waiting in storage', True),
            ('rewards ready', "S.claimed = S.claimed.filter(id => id !== 'g1');", 'waiting in Goals', True),
            ('low meter part', "for (const e of S.objects) if (e.kind === 'enc') for (const a of e.animals) for (const n in a.due) a.due[n] = S.clock - 1; g.computeMeter();", 'Zoo meter', False),
        ]
        async def tilda():
            for name, js, want, has_go in CASES:
                await fresh(pg)
                await ev(pg, NEUTRAL)
                r = await ev(pg, "() => { const g = window.__wg, S = g.S; " + js + " g.computeMeter(); const t = g.advice(); return { text: t.text, go: !!t.go }; }")
                check(want in r['text'] and r['go'] == has_go, f"Tilda's tip for {name}: \"{r['text'][:70]}…\" (Show me: {r['go']})")
            # UI: H opens the tip, Show me navigates, Close closes; hidden in the tutorial
            await fresh(pg)
            await ev(pg, NEUTRAL)
            await ev(pg, "() => { const S = window.__wg.S; S.objects.find(o => o.kind === 'enc').animals[0].sick = true; S.medicine = 0; }")
            await pg.wait_for_timeout(400)
            check(await pg.is_visible('#btnHelp'), 'Ask Tilda button shows after the tutorial')
            await pg.mouse.move(5, 400)
            await pg.keyboard.press('h')
            await pg.wait_for_timeout(200)
            r = await ev(pg, "() => ({ vis: !document.querySelector('#tutorial').hidden, step: document.querySelector('#tutStep').textContent, skip: document.querySelector('#tutSkip').textContent, ok: document.querySelector('#tutOk').hidden ? null : document.querySelector('#tutOk').textContent, text: document.querySelector('#tutText').textContent })")
            check(r['vis'] and r['step'] == 'Tip' and r['skip'] == 'Close' and r['ok'] == 'Show me' and 'medicine' in r['text'], f'H opens a tip with Close and Show me ({r})')
            await pg.wait_for_timeout(700)
            check(await pg.is_visible('#tutorial'), 'the tip stays open (the tutorial check does not hide it)')
            await pg.click('#tutOk')
            await pg.wait_for_timeout(200)
            check(await pg.is_visible('#shop') and await pg.is_visible('.supply.restock, .supply') and not await pg.is_visible('#tutorial'), 'Show me opens Build → Supplies and closes the tip')
            await pg.click('#shop [data-close]')
            await pg.click('#btnHelp')
            await pg.click('#tutSkip')
            await pg.wait_for_timeout(500)
            check(not await pg.is_visible('#tutorial'), 'Close closes the tip and it stays closed')
            # start a new zoo right after using a tip: the tutorial card must be the real tutorial
            await pg.click('#btnHelp')
            await ev(pg, "() => window.__wg.openHub('office')")
            await pg.wait_for_timeout(750)
            await pg.click('#hubBody button:has-text("Start a new zoo")')
            await pg.click('#resetYes')
            await pg.wait_for_timeout(500)
            r = await ev(pg, "() => ({ vis: !document.querySelector('#tutorial').hidden, step: document.querySelector('#tutStep').textContent, skip: document.querySelector('#tutSkip').textContent, okHidden: document.querySelector('#tutOk').hidden, okText: document.querySelector('#tutOk').textContent, text: document.querySelector('#tutText').textContent.slice(0, 20), help: document.querySelector('#btnHelp').hidden })")
            check(r['vis'] and r['step'].startswith('1 /') and r['skip'] == 'Skip tutorial' and r['okHidden'] and r['okText'] == "Let's go" and r['text'].startswith('Welcome'), f'after a tip, a new zoo shows the real tutorial card ({r})')
            check(r['help'], 'Ask Tilda is hidden during the tutorial')
            await pg.keyboard.press('h')
            await pg.wait_for_timeout(200)
            check((await pg.inner_text('#tutStep')).startswith('1 /'), 'H does nothing during the tutorial')
            await pg.click('#tutSkip')
            await pg.wait_for_timeout(300)
            check(not await pg.is_visible('#tutorial') and await ev(pg, "() => window.__wg.S.tut") == -1, 'Skip tutorial still skips after a tip was used')
        await section('ask tilda', tilda)

        # ---------------------------------------------------------------- traits & names
        async def traits():
            ids = await fresh(pg)
            r = await ev(pg, """() => { const g = window.__wg; const s = g.parseSave(g.exportCode());
                const raw = JSON.parse(JSON.stringify(s)); for (const o of raw.objects) for (const a of o.animals || []) delete a.trait;
                raw.storage.animals.push({ id: 9001, species: 'bunny', variant: 0, sex: 'm', baby: false, grow: 1, name: 'Old' });
                g.loadState(g.parseSave(JSON.stringify(raw)));
                const all = [...g.S.objects.flatMap(o => o.animals || []), ...g.S.storage.animals];
                return all.every(a => GAME.TRAITS[a.trait]); }""")
            check(r, 'migration gives every animal (enclosures and storage) a trait')
            r = await ev(pg, """() => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.kind === 'enc'), a = e.animals[0];
                e.toys = ['toyBall', 'toyLog']; let lo = 1e9;
                for (const tr of ['playful', 'easy']) { a.trait = tr; let m = 1e9; for (let i = 0; i < 40; i++) { a.due.play = S.clock - 1; g.careAll(e, 'play'); m = Math.min(m, a.due.play - S.clock); } if (tr === 'playful') lo = m; else return { playful: lo, easy: m }; } }""")
            check(r['playful'] > 540 * 0.9 * 0.8 * 1.5 * 0.85, f"Playful animals still get a long playtime from toys ({r['playful']:.0f}s minimum, Easy-going {r['easy']:.0f}s)")
            r = await ev(pg, """() => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.kind === 'enc');
                const [x, s] = e.animals; x.trait = 'explorer'; s.trait = 'sleepy'; const p0 = [x.lx, x.ly];
                let moved = 0, slept = 0; S.clock = 900 * 9 + 50;
                for (let i = 0; i < 1200; i++) { g.tick(0.05); if (x.moving) moved++; if (s.sleep) slept++; }
                const inside = e.animals.every(a => isFinite(a.lx) && isFinite(a.ly) && a.lx >= 0 && a.ly >= 0 && a.lx <= e.w && a.ly <= e.h);
                return { moved, slept, inside, dk: g.DK }; }""")
            check(r['inside'] and r['moved'] > 400, f"Explorer keeps moving and stays inside the fence ({r['moved']}/1200 moving ticks)")
            check(r['slept'] > 0, f"Sleepy naps during the day ({r['slept']} sleeping ticks, darkness {r['dk']})")
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; S.storage.animals = [];
                for (let i = 0; i < 30; i++) S.storage.animals.push(g.storeRec('bunny', 0, 'f', false));
                const names = [...S.objects.flatMap(o => o.animals || []), ...S.storage.animals].map(a => a.name); return { n: names.length, u: new Set(names).size }; }""")
            check(r['n'] == r['u'], f"new animals get unique names ({r['u']} unique of {r['n']})")
            r = await ev(pg, """() => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.kind === 'enc'); S.storage.animals = [];
                for (const a of e.animals) S.storage.animals.push(...[]); const names = new Set(e.animals.map(a => a.name));
                // babies: breed many times into a big enclosure and check names stay unique while names are left
                e.level = 4; for (const a of e.animals) { a.sick = false; for (const n in a.due) a.due[n] = S.clock + 1e6; }
                for (let i = 0; i < 4; i++) { e.breed = 0.9999; g.tick(1); for (const a of e.animals) for (const n in a.due) a.due[n] = S.clock + 1e6; }
                const nm = e.animals.map(a => a.name); return { n: nm.length, u: new Set(nm).size }; }""")
            check(r['n'] == r['u'], f"babies born in the zoo get unique names ({r['u']} unique of {r['n']})")
            await ev(pg, "(id) => window.__wg.select(window.__wg.S.objects.find(o => o.id === id))", ids['enc'])
            await pg.wait_for_timeout(200)
            check(len(await pg.query_selector_all('#panel .trait')) >= 2, 'the enclosure panel shows each animal\'s trait')
        await section('traits & names', traits)

        # ---------------------------------------------------------------- storage habitat filter
        async def storage_filter():
            await fresh(pg)
            await ev(pg, """() => { const g = window.__wg, S = g.S; S.storage.animals = [];
                for (let i = 0; i < 4; i++) S.storage.animals.push(g.storeRec('bunny', 0, i % 2 ? 'm' : 'f', false));
                for (let i = 0; i < 2; i++) S.storage.animals.push(g.storeRec('penguin', 0, i % 2 ? 'm' : 'f', false)); }""")
            await pg.click('#btnStorage')
            await pg.wait_for_timeout(200)
            btns = await pg.query_selector_all('#storageBody .filters button')
            check(len(btns) == 3, f'storage with 6 animals in 2 habitats shows All + 2 habitat filters ({len(btns)})')
            await pg.click('#storageBody .filters button:has-text("Ice floe")')
            await pg.wait_for_timeout(150)
            rows = await pg.query_selector_all('#storageBody > .pick')
            check(len(rows) == 2, f'Ice floe filter shows only the 2 penguins ({len(rows)})')
            # selling one penguin drops the total to 5: the filter row disappears, so the filter must too
            await pg.click('#storageBody > .pick button:has-text("Sell")')
            await pg.wait_for_timeout(150)
            r = await ev(pg, "() => ({ filters: !!document.querySelector('#storageBody .filters'), rows: document.querySelectorAll('#storageBody > .pick').length, n: window.__wg.S.storage.animals.length })")
            check(r['filters'] or r['rows'] == r['n'], f"when the filter row hides, every stored animal is listed again ({r['rows']} rows for {r['n']} animals, filter row shown: {r['filters']})")
            await pg.click('#storage [data-close]')
        await section('storage filter', storage_filter)

        # ---------------------------------------------------------------- zoo rank
        async def rank():
            await fresh(pg)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; S.stats.rank = 0; const g0 = S.gems;
                for (let x = 16; x <= 29; x++) for (let y = 16; y <= 19; y++) if (!S.objects.some(o => o.gx === x && o.gy === y)) S.objects.push({ id: 'f' + x + '_' + y, kind: 'deco', type: 'fountain', gx: x, gy: y, w: 1, h: 1 });
                g.rebuild(); g.computeMeter(); const r = S.stats.rank, att = g.M.attraction, d1 = S.gems - g0;
                for (let i = 0; i < 5; i++) g.computeMeter(); const d2 = S.gems - g0;
                const exp = GAME.RANKS.slice(1, r + 1).reduce((a, k) => a + (k.gems || 0), 0);
                return { r, att, d1, d2, exp, name: GAME.RANKS[r].name }; }""")
            check(r['r'] >= 2, f"{r['att']} stars reaches rank {r['r']} ({r['name']})")
            check(r['d2'] == r['d1'], 'rank gems are paid once')
            check(r['d1'] == r['exp'], f"jumping several ranks pays every rank passed ({r['d1']} gems paid, {r['exp']} expected)")
            await pg.wait_for_timeout(400)
            shown = await ev(pg, "() => document.querySelector('#rankName').textContent")
            check(shown == r['name'], f"HUD shows the rank name ({shown!r})")
            await fresh(pg, tutorial=True)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S, g0 = S.gems;
                for (let x = 16; x <= 29; x++) S.objects.push({ id: 'f' + x, kind: 'deco', type: 'fountain', gx: x, gy: 16, w: 1, h: 1 }); g.rebuild(); g.computeMeter();
                return { rank: S.stats.rank || 0, dg: S.gems - g0, att: g.M.attraction }; }""")
            check(r['rank'] == 0 and r['dg'] == 0, f"no rank or rank gems during the tutorial ({r['att']} stars)")
        await section('zoo rank', rank)

        # ---------------------------------------------------------------- zoomed-out drawing & summary bubbles
        async def zoomed_out():
            ids = await fresh(pg)
            await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id); e.level = 3;
                for (const a of e.animals) { a.due.food = S.clock - 1; a.due.water = S.clock - 1; } e.dung = [{ lx: 1, ly: 1 }, { lx: 2, ly: 1 }]; }""", ids['enc'])
            await ev(pg, RUN, [60, 0.1])
            for z in [1.0, 0.7, 0.6, 0.45]:
                await ev(pg, f"() => {{ const g = window.__wg, c = g.cam; c.z = {z}; const p = {{ x: (21.5 - 22.5) * 32, y: (21.5 + 22.5) * 16 }}; c.x = p.x; c.y = p.y; }}")
                await pg.wait_for_timeout(350)
            await ev(pg, "() => { const c = window.__wg.cam; c.z = 0.6; c.x = (21.5 - 22.5) * 32; c.y = (21.5 + 22.5) * 16; }")
            await pg.wait_for_timeout(300)
            p = await ev(pg, "() => window.__wg.scr(21.5, 22.5)")
            care0 = await ev(pg, "() => window.__wg.S.stats.care")
            await pg.mouse.click(p['x'], p['y'] - 88 * 0.6)
            await pg.wait_for_timeout(250)
            r = await ev(pg, "() => ({ panel: !document.querySelector('#panel').hidden, h: (document.querySelector('#panel h2') || {}).textContent, care: window.__wg.S.stats.care })")
            check(r['panel'] and 'Bunny' in (r['h'] or '') and r['care'] == care0, f"at zoom 0.6 the single summary bubble opens the enclosure panel ({r})")
            await ev(pg, "() => { window.__wg.select(null); window.__wg.cam.z = 1; }")
        await section('zoomed out', zoomed_out)

        # ---------------------------------------------------------------- visitor looks & viewing spots
        async def visitor_looks():
            ids = await fresh(pg)
            await ev(pg, "() => { const g = window.__wg; g.setTool({ kind: 'shop', type: 'balloon' }); g.place(26, 23); g.setTool(null); for (const o of g.S.objects) if (o.build) o.build = g.S.clock; g.tick(0.01); }")
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; window.__seenV = new Set(); const spots = new Set();
                const e = S.objects.find(o => o.kind === 'enc'), front = new Set([]);
                for (let x = e.gx; x < e.gx + 3; x++) front.add(x + ',' + (e.gy + 3));
                for (let t = 0; t < 600; t += 0.1) { g.tick(0.1); for (const v of g.visitors()) { window.__seenV.add(v); if (v.pause > 0 && front.has(v.cx + ',' + v.cy)) spots.add(v.cx + ',' + v.cy); } }
                const vs = [...window.__seenV];
                return { n: vs.length, kids: vs.filter(v => v.kid).length, kidBalloons: vs.filter(v => v.kid && v.balloon).length, adultBalloons: vs.filter(v => !v.kid && v.balloon).length,
                         hats: [...new Set(vs.map(v => v.hat || null))], spots: spots.size }; }""")
            check(r['kids'] > 0 and r['kidBalloons'] > 0 and r['adultBalloons'] == 0, f"kids (only kids) get balloons at the balloon cart ({r['kidBalloons']} of {r['kids']} kids, {r['adultBalloons']} adults)")
            check(set(r['hats']) <= {None, 'sun', 'cap', 'beanie'} and len(r['hats']) > 1, f"visitors wear a mix of hats ({r['hats']})")
            check(r['spots'] >= 2, f"visitors spread over several fence viewing spots ({r['spots']} of 3)")
            await ev(pg, "() => { const c = window.__wg.cam; c.z = 0.7; }")
            await pg.wait_for_timeout(500)
            await ev(pg, "() => { window.__wg.cam.z = 1; }")
        await section('visitor looks', visitor_looks)

        # ---------------------------------------------------------------- long-press
        async def long_press():
            ids = await fresh(pg)
            await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id), a = e.animals[0];
                for (const b of e.animals) { b.tx = null; b.wait = 1e9; } a.lx = 0.6; a.ly = 2.4; e.animals[1].lx = 2.4; e.animals[1].ly = 0.6; a.due.food = S.clock - 1;
                const c = g.cam; c.z = 1.2; c.x = (21.5 - 22.5) * 32; c.y = (21.5 + 22.5) * 16; }""", ids['enc'])
            await pg.wait_for_timeout(300)
            p = await ev(pg, "() => { const p = window.__wg.scr(20.6, 23.4); return { x: p.x, y: p.y - 14 * 1.2 }; }")
            c0 = await ev(pg, "() => window.__wg.S.stats.care")
            await pg.mouse.move(p['x'], p['y'])
            await pg.mouse.down()
            await pg.wait_for_timeout(650)
            mid = await ev(pg, "() => !document.querySelector('#panel').hidden")
            await pg.mouse.up()
            await pg.wait_for_timeout(200)
            r = await ev(pg, "() => ({ panel: !document.querySelector('#panel').hidden, care: window.__wg.S.stats.care })")
            check(mid and r['panel'], 'a 600 ms press on an animal opens its enclosure panel')
            check(r['care'] == c0, f"the long-press does not also feed the animal on release (care {c0} → {r['care']})")
            await ev(pg, "() => window.__wg.select(null)")
            await pg.mouse.click(p['x'], p['y'])
            await pg.wait_for_timeout(200)
            check(await ev(pg, "() => window.__wg.S.stats.care") == c0 + 1, 'a short tap on the same animal still feeds it')
        await section('long press', long_press)

        # ---------------------------------------------------------------- festival
        async def festival():
            await fresh(pg)
            MON = 1788177600000  # Mon 31 Aug 2026 12:00 UTC (summer)
            # enough care for the whole first lap, plus the first step of lap 2 (which needs twice the points) and 50 spare
            TR = await ev(pg, "() => GAME.EVENT_TRACK.map(m => m.at)")
            PTS, LEFT = TR[-1] + 2 * TR[0] + 50, 2 * TR[0] + 50
            r = await ev(pg, f"""() => {{ window.__setNow({MON}); const g = window.__wg, S = g.S; S.event = null; const E = g.ensureEvent(); S.stats.care += {PTS};
                return {{ id: E.id, p: g.eventPoints() }}; }}""")
            check(r['id'] == 'summer' and r['p'] == PTS, f"festival starts ({r['id']}, {r['p']} points from {PTS} care actions)")
            await ev(pg, "() => window.__wg.openHub('event')")
            await pg.wait_for_timeout(200)
            await pg.click('#hubBody .evstep.ready button')
            await pg.wait_for_timeout(200)
            check(await pg.is_visible('#reward') and await ev(pg, "() => window.__wg.S.event.claimed") == 1, 'Claim in the Festival tab pays the first milestone and shows the reward')
            await pg.click('#rewardOk')
            r = await ev(pg, """() => { const g = window.__wg, S = g.S, ev = GAME.EVENTS[S.event.id], log = [];
                const items0 = S.storage.items.filter(i => i.type === ev.decor).length;
                for (let i = 1; i < GAME.EVENT_TRACK.length; i++) { g.claimEvent(); document.querySelector('#reward').hidden = true; log.push(S.event.claimed); }
                const items = S.storage.items.filter(i => i.type === ev.decor).length - items0;
                const star = S.storage.animals.filter(a => a.species === ev.star && a.variant === 2).length;
                const out = { log, items, star, lap: S.event.lap, claimed: S.event.claimed, p: g.eventPoints() }; g.claimEvent(); document.querySelector('#reward').hidden = true; out.extra = S.event.claimed; return out; }""")
            check(r['items'] == 2, f"both decor milestones put the festival decor in storage ({r['items']})")
            check(r['star'] == 1, f"the last milestone puts a rare star animal in storage ({r['star']})")
            check(r['lap'] == 2 and r['claimed'] == 0 and r['p'] == LEFT and r['extra'] == 1, f"after the last milestone lap 2 starts with the leftover points (lap {r['lap']}, claimed {r['claimed']}, points {r['p']}, then claimed {r['extra']})")
            r = await ev(pg, f"""() => {{ const g = window.__wg, S = g.S; window.__setNow({MON} + 7 * 86400000); const E = g.ensureEvent(); const out = {{ lap: E.lap, claimed: E.claimed, p: g.eventPoints() }}; return out; }}""")
            check(r['lap'] == 1 and r['claimed'] == 0 and r['p'] == 0, f"a new week resets the festival ({r})")
            # a season change in the middle of a week must not wipe the week's progress
            r = await ev(pg, f"""() => {{ const g = window.__wg, S = g.S; window.__setNow({MON}); S.event = null; g.ensureEvent(); S.stats.care += 100; g.claimEvent(); g.claimEvent(); document.querySelector('#reward').hidden = true;
                const before = {{ id: S.event.id, claimed: S.event.claimed, p: g.eventPoints() }};
                window.__setNow({MON} + 86400000); g.ensureEvent(); const after = {{ id: S.event.id, claimed: S.event.claimed, p: g.eventPoints() }};
                window.__resetNow(); return {{ before, after }}; }}""")
            check(r['after']['claimed'] == r['before']['claimed'] and r['after']['p'] == r['before']['p'], f"Mon 31 Aug → Tue 1 Sep keeps the week's festival progress ({r['before']} → {r['after']})")
            await ev(pg, "() => { window.__resetNow(); window.__wg.S.event = null; }")
            await pg.click('#hub [data-close]')
        await section('festival', festival)

        # ---------------------------------------------------------------- 390 / 1000 px layouts of the new UI
        async def new_layouts():
            shots = os.environ.get('QA_SHOTS')
            for w, h in [(390, 844), (1000, 700)]:
                ph = await ctx.new_page()
                await ph.set_viewport_size({'width': w, 'height': h})
                ph.on('pageerror', lambda e: errors.append(str(e)))
                await ph.goto(PAGE)
                await ph.wait_for_timeout(400)
                await ev(ph, SETUP)
                await ph.wait_for_timeout(400)
                inside = """(sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const b = e.getBoundingClientRect();
                    return b.left >= -0.5 && b.top >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5 && b.width > 0; }"""
                r = await ev(ph, """() => { const hud = [...document.querySelectorAll('.hud > *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect());
                    const ov = []; for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) { const a = hud[i], b = hud[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) ov.push([i, j]); }
                    return { right: Math.max(...hud.map(b => b.right)), sw: document.documentElement.scrollWidth, ov: ov.length }; }""")
                check(r['right'] <= w and r['sw'] <= w and r['ov'] == 0, f"{w}px: HUD fits without overlapping chips (rightmost {r['right']:.0f}, {r['ov']} overlaps)")
                check(await ev(ph, inside, '#btnHelp'), f'{w}px: Ask Tilda button is on screen')
                if shots:
                    await ph.screenshot(path=f'{shots}/{w}-hud.png')
                await ev(ph, "() => { const g = window.__wg, S = g.S; let need = -S.xp; for (let l = S.level; l < S.level + 3; l++) need += Math.round(50 * Math.pow(l, 1.55)); g.addXp(need); }")
                await ph.wait_for_timeout(200)
                check(await ev(ph, inside, '#levelUp .lvsheet'), f'{w}px: the level card fits on screen')
                check(await ev(ph, inside, '#levelOk'), f'{w}px: the level card button is reachable')
                if shots:
                    await ph.screenshot(path=f'{shots}/{w}-level.png')
                await ph.click('#levelOk')
                await ev(ph, "() => window.__wg.showTip()")
                await ph.wait_for_timeout(200)
                check(await ev(ph, inside, '#tutorial'), f'{w}px: the tip box fits on screen')
                if shots:
                    await ph.screenshot(path=f'{shots}/{w}-tip.png')
                await ph.click('#tutSkip')
                await ev(ph, "() => { window.__wg.S.seenBuild = []; }")   # the pages share localStorage, so forget what an earlier page saw
                await ph.click('#btnShop')
                await ph.wait_for_timeout(200)
                r = await ev(ph, "() => [...document.querySelectorAll('#shopGrid .card.new')].map(c => { const b = c.getBoundingClientRect(), s = getComputedStyle(c, '::after'); return b.right <= innerWidth + 0.5 && s.content.includes('New'); })")
                check(len(r) > 0 and all(r), f'{w}px: New ribbons show on {len(r)} Build cards')
                if shots:
                    await ph.screenshot(path=f'{shots}/{w}-build.png')
                await ph.close()
        await section('new ui layouts', new_layouts)

        # ---------------------------------------------------------------- weather
        async def weather():
            await fresh(pg, tutorial=True)
            r = await ev(pg, "() => { const g = window.__wg, S = g.S; S.weather = { kind: 'rain', until: S.clock + 100 }; for (let i = 0; i < 20; i++) g.tick(0.1); return g.WX; }")
            check(r is None, 'no weather during the tutorial')
            ids = await ev(pg, SETUP, {'weather': True})
            r = await ev(pg, """(id) => { const g = window.__wg, S = g.S, e = S.objects.find(o => o.id === id); S.clock = 900 * 3 + 50;
                S.weather = { kind: 'rain', until: S.clock + 60 }; for (const a of e.animals) a.due.water = S.clock - 1; const c0 = S.stats.care;
                for (let i = 0; i < 35; i++) g.tick(0.1);
                return { wx: g.WX, thirsty: e.animals.filter(a => S.clock >= a.due.water).length, care: S.stats.care - c0 }; }""", ids['enc'])
            check(r['wx'] == 'rain' and r['thirsty'] == 0, f"rain fills every water trough within ~3 s ({r['thirsty']} still thirsty)")
            # average crowd over the same daytime stretch, dry and then rainy (the target itself wobbles with the meter)
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; const run = kind => { S.clock = 900 * 20 + (kind ? 1800 : 0); S.weather = { kind, until: S.clock + 1e4 };
                    let sum = 0, n = 0, tsum = 0; for (let i = 0; i < 4500; i++) { g.tick(0.1); if (i > 1500) { sum += g.visitors().length; tsum += g.M.target; n++; } } return [sum / n, tsum / n]; };
                const [dry, tdry] = run(null), [wet, twet] = run('rain'); return { dry, wet, tdry, twet }; }""")
            check(r['wet'] < r['dry'] * 0.85 and r['wet'] > 0, f"rain thins the crowd (avg {r['dry']:.1f} visitors dry vs {r['wet']:.1f} in rain; target {r['tdry']:.1f}/{r['twet']:.1f})")
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; S.weather = { kind: 'rain', until: S.clock + 0.5 }; for (let i = 0; i < 20; i++) g.tick(0.1);
                return { kind: S.weather.kind, dry: S.weather.until - S.clock, wx: g.WX }; }""")
            check(r['kind'] is None and r['dry'] > 200 and r['wx'] is None, f"a shower is followed by a dry spell ({r['dry']:.0f} s)")
            # snow cheers up ice-floe animals
            r = await ev(pg, """() => { const g = window.__wg, S = g.S; g.setTool({ kind: 'enc', biome: 'ice' }); g.place(17, 17); g.setTool(null);
                const e = S.objects.find(o => o.gx === 17 && o.gy === 17); e.build = S.clock; g.tick(0.01); g.adopt(e, 'penguin', 'm', 0);
                const a = e.animals[0]; for (const n in a.due) a.due[n] = S.clock - 1; e.dung = [];
                S.weather = { kind: null, until: S.clock + 1e4 }; g.tick(0.01); const dry = g.WX;
                const m = () => { g.computeMeter(); return g.M.parts.mood; };
                const without = m(); S.weather = { kind: 'snow', until: S.clock + 100 }; g.tick(0.01); const wx = g.WX, withSnow = m();
                return { dry, wx, without, withSnow }; }""")
            check(r['wx'] == 'snow' and r['withSnow'] > r['without'], f"snow lifts ice-floe mood ({r['without']:.3f} → {r['withSnow']:.3f})")
            # showers roll by themselves, and snow only falls in winter
            for label, when, want_snow in [('July', 1784116800000, False), ('January', 1767960000000, True)]:
                r = await ev(pg, f"""() => {{ window.__setNow({when}); const g = window.__wg, S = g.S; const kinds = new Set();
                    for (let k = 0; k < 40; k++) {{ S.weather = {{ kind: null, until: 0 }}; for (let i = 0; i < 3000 && !(S.weather && S.weather.kind); i++) g.tick(0.1); if (S.weather.kind) kinds.add(S.weather.kind); }}
                    window.__resetNow(); return [...kinds]; }}""")
                check(len(r) > 0 and (('snow' in r) == want_snow), f"in {label} showers roll on their own: {r}")
            # settings toggle
            await ev(pg, "() => { const S = window.__wg.S; S.weather = { kind: 'rain', until: S.clock + 1e4 }; window.__wg.tick(0.01); window.__wg.openHub('office'); }")
            await pg.wait_for_timeout(750)
            await pg.click('#hubBody button:has-text("Weather on")')
            r = await ev(pg, "() => { const g = window.__wg; g.tick(0.05); return { set: g.S.settings.weather, wx: g.WX }; }")
            check(r['set'] is False and r['wx'] is None, 'turning Weather off in the Zoo office stops the rain at once')
            await pg.click('#hub [data-close]')
            # rain is drawn without errors at both zooms and on top of night
            await ev(pg, "() => { const g = window.__wg, S = g.S; S.settings.weather = true; S.weather = { kind: 'rain', until: S.clock + 1e4 }; S.clock = 900 * 6 + 0.8 * 900; }")
            await pg.wait_for_timeout(400)
            await ev(pg, "() => { const g = window.__wg, S = g.S; S.weather = { kind: 'snow', until: S.clock + 1e4 }; g.cam.z = 0.6; }")
            await pg.wait_for_timeout(400)
            await ev(pg, "() => { const g = window.__wg; g.S.settings.weather = false; g.cam.z = 1; }")
        await section('weather', weather)

        # ---------------------------------------------------------------- rain and ambient sound
        async def sound():
            await fresh(pg)
            # count looping noise sources (the rain hiss) that are started and stopped
            await ev(pg, """() => { window.__rain = { on: 0, off: 0 }; const P = AudioBufferSourceNode.prototype, st = P.start, sp = P.stop;
                P.start = function (...a) { if (this.loop) window.__rain.on++; return st.apply(this, a); };
                P.stop = function (...a) { if (this.loop) window.__rain.off++; return sp.apply(this, a); };
                const S = window.__wg.S; S.settings.muted = false; S.settings.music = true; S.settings.weather = true; S.weather = { kind: 'rain', until: S.clock + 1e4 }; }""")
            if await ev(pg, "() => window.__wg.S.settings.muted"):
                await pg.click('#btnSound')
            p = await ev(pg, "() => window.__wg.scr(18, 18)")
            await pg.mouse.click(p['x'], p['y'])          # a real gesture unlocks WebAudio
            await pg.wait_for_timeout(1200)
            r0 = await ev(pg, "() => ({ ...window.__rain, wx: window.__wg.WX })")
            check(r0['on'] == 1 and r0['off'] == 0, f"rain starts a rain sound ({r0})")
            await pg.click('#btnSound')                   # mute while it rains
            await pg.wait_for_timeout(1500)
            r1 = await ev(pg, "() => ({ ...window.__rain, muted: window.__wg.S.settings.muted })")
            check(r1['muted'] and r1['off'] == 1, f"muting during rain stops the rain sound ({r1})")
            await pg.click('#btnSound')
            await ev(pg, "() => { const S = window.__wg.S; S.settings.weather = false; S.clock = 900 * 8 + 0.8 * 900; }")
            await pg.wait_for_timeout(1500)              # night crickets and day birds run inside the music loop
            r2 = await ev(pg, "() => window.__rain")
            check(r2['off'] >= r2['on'] - 0, f"the rain sound stops when the rain does ({r2})")
        await section('sound', sound)

        # ---------------------------------------------------------------- zoo name & photo
        async def name_photo():
            await fresh(pg)
            await ev(pg, "() => window.__wg.openHub('office')")
            await pg.wait_for_timeout(200)
            await pg.fill('#hubBody .namefield', 'Sunny Acres')
            await pg.press('#hubBody .namefield', 'Enter')
            await pg.wait_for_timeout(400)
            r = await ev(pg, "() => ({ hud: document.querySelector('#zooName').textContent, title: document.title, gate: ART.gateLabel, saved: window.__wg.S.settings.zooName })")
            check(r['hud'] == 'Sunny Acres' and 'Sunny Acres' in r['title'] and r['gate'] == 'Sunny Acres' and r['saved'] == 'Sunny Acres', f"zoo name updates the HUD, title, gate sign and save ({r})")
            # typing a name must survive the hub's periodic refresh (it re-renders every 30 game seconds)
            await pg.click('#hubBody .namefield')
            await pg.fill('#hubBody .namefield', '')
            await pg.keyboard.type('Otter')
            await ev(pg, "() => { window.__wg.S.clock += 31; }")
            await pg.wait_for_timeout(500)
            await pg.keyboard.type(' Bay Park')     # keeps typing, as a player would
            await pg.wait_for_timeout(200)
            r = await ev(pg, "() => { const f = document.querySelector('#hubBody .namefield'); return { value: f && f.value, focused: document.activeElement === f, tool: window.__wg.tool && window.__wg.tool.kind, hub: !document.querySelector('#hub').hidden }; }")
            check(r['value'] == 'Otter Bay Park' and r['focused'] and r['tool'] is None and r['hub'], f"typing a zoo name survives the hub's 30-second refresh (no lost focus, no hotkeys firing) ({r})")
            await ev(pg, "() => { window.__wg.setTool(null); window.__wg.openHub('office'); }")
            await pg.wait_for_timeout(200)
            await ev(pg, "() => { const f = document.querySelector('#hubBody .namefield'); f.value = 'A very long zoo name that goes on'; f.dispatchEvent(new Event('change')); }")
            r = await ev(pg, "() => window.__wg.S.settings.zooName")
            check(len(r) <= 22, f"zoo name is capped at 22 characters ({r!r})")
            await ev(pg, "() => { const f = document.querySelector('#hubBody .namefield'); f.value = '  '; f.dispatchEvent(new Event('change')); }")
            await pg.wait_for_timeout(400)
            r = await ev(pg, "() => ({ hud: document.querySelector('#zooName').textContent, gate: ART.gateLabel })")
            check(r['hud'] == 'Wildgrove' and r['gate'].upper() == 'WILDGROVE', f"a blank name falls back to Wildgrove ({r})")
            await ev(pg, "() => { const f = document.querySelector('#hubBody .namefield'); f.value = 'Ørnereir Zoo'; f.dispatchEvent(new Event('change')); }")
            await pg.wait_for_timeout(750)
            async with pg.expect_download() as dl:
                await pg.click('#hubBody button:has-text("Take a photo")')
            d = await dl.value
            path = await d.path()
            size = os.path.getsize(path) if path else 0
            head = open(path, 'rb').read(8) if path else b''
            check(head == b'\x89PNG\r\n\x1a\n' and size > 20000, f"Take a photo downloads a PNG of the zoo ({d.suggested_filename}, {size // 1024} KB)")
            check(d.suggested_filename not in ('-zoo.png', '--zoo.png') and d.suggested_filename.endswith('-zoo.png') and 'rnereir' in d.suggested_filename, f"photo filename keeps the zoo's name ({d.suggested_filename})")
            check(await pg.is_hidden('#hub'), 'taking a photo closes the sheet so the zoo is in the picture')
            await ev(pg, "() => { window.__wg.S.settings.zooName = ''; window.__wg.select(null); }")
        await section('zoo name & photo', name_photo)

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
