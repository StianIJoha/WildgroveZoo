"""
Smoke test for Wildgrove Zoo: plays the whole tutorial with real taps,
then checks a few late-game systems, and fails on any page error.

Setup (once):  pip install playwright  &&  python -m playwright install chromium
Run:           node build.js  &&  python tests/playthrough.py
"""
import asyncio, os, pathlib, sys
from playwright.async_api import async_playwright

PAGE = (pathlib.Path(__file__).resolve().parent.parent / 'index.html').as_uri()
OUT = pathlib.Path(__file__).resolve().parent / 'screenshots'


async def tap_grid(pg, gx, gy, dy=0):
    """Tap the screen at grid coordinate (gx, gy), like a player would."""
    p = await pg.evaluate(f"() => window.__wg.scr({gx},{gy})")
    await pg.mouse.click(p['x'], p['y'] + dy)
    await pg.wait_for_timeout(120)


async def tut(pg):
    return await pg.evaluate("() => window.__wg.S.tut")


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        check.failed = True
check.failed = False


async def main():
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as p:
        # PW_CHROMIUM lets you point at a preinstalled browser binary
        exe = os.environ.get('PW_CHROMIUM')
        browser = await p.chromium.launch(**({'executable_path': exe} if exe else {}))
        pg = await browser.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts' not in m.text and 'ERR_' not in m.text else None)
        await pg.goto(PAGE)
        await pg.evaluate("() => localStorage.removeItem('wildgrove.save.v2')")
        await pg.reload()
        await pg.wait_for_timeout(700)

        # 1. catch the three escaped penguins
        for _ in range(12):
            esc = await pg.evaluate("() => window.__wg.S.escaped.map(p => [p.x, p.y])")
            if not esc:
                break
            await tap_grid(pg, esc[0][0], esc[0][1], -14)
        check(await pg.evaluate("() => window.__wg.S.storage.animals.length") == 3, 'caught 3 penguins')

        # 2. build an ice floe enclosure through the Build menu
        await pg.click('#btnShop')
        await (await pg.query_selector_all('#shopGrid .card'))[1].click()
        await tap_grid(pg, 23.5, 20.5)
        await pg.wait_for_timeout(9000)  # tutorial build timer is 8 s
        check(await tut(pg) >= 3, 'enclosure finished building')

        # 3. move the penguins in from storage
        await tap_grid(pg, 23.5, 20.5)
        await pg.click('text=Add from storage')
        for _ in range(3):
            picks = await pg.query_selector_all('#panel .picklist .pick')
            if picks:
                await picks[0].click()
                await pg.wait_for_timeout(100)
        check(await pg.evaluate("() => window.__wg.S.objects.find(o => o.kind === 'enc').animals.length") == 3, 'penguins in enclosure')

        # 4. care for them with the panel buttons
        await pg.wait_for_timeout(500)
        for n in ['food', 'water', 'pet', 'play']:
            b = await pg.query_selector(f'[data-live="need-{n}"]')
            if b and await b.is_enabled():
                await b.click()
                await pg.wait_for_timeout(100)
        check(await pg.evaluate("() => window.__wg.S.stats.care") >= 3, 'cared for animals')
        await pg.click('#panel .x')

        # 5. draw a path from the gate to the enclosure
        ex, ey = await pg.evaluate("() => { const e = window.__wg.S.objects.find(o => o.kind === 'enc'); return [e.gx, e.gy]; }")
        await pg.click('#btnPath')
        for (x, y) in [(x, 24) for x in range(25, ex - 1, -1)] + [(ex, y) for y in range(24, ey + 2, -1)]:
            await tap_grid(pg, x + 0.5, y + 0.5)
        await pg.click('#toolCancel')
        await pg.wait_for_timeout(500)
        check(await tut(pg) >= 6, 'enclosure connected to the gate')

        # 6. build a feeding station next to the path and collect from it
        await pg.click('#btnShop')
        await pg.click('.tab >> text=Shops')
        await (await pg.query_selector_all('#shopGrid .card'))[0].click()
        await tap_grid(pg, 25.5, 25.5)
        await pg.wait_for_timeout(6500)
        await pg.evaluate("() => { for (const o of window.__wg.S.objects) if (o.kind === 'shop') o.prog = 1; }")  # shortcut: fill the shop
        await pg.wait_for_timeout(400)
        await tap_grid(pg, 25.5, 25.5, -84)
        await pg.wait_for_timeout(400)
        check(await pg.evaluate("() => window.__wg.S.stats.shopCollects") >= 1, 'collected silver coin')

        # 7. finish the tutorial and check the reward
        before = await pg.evaluate("() => window.__wg.S.coins")
        if await pg.is_visible('#tutOk'):
            await pg.click('#tutOk')
        await pg.wait_for_timeout(300)
        check(await tut(pg) == -1 and await pg.evaluate("() => window.__wg.S.coins") >= before + 300, 'tutorial complete, reward paid')
        await pg.screenshot(path=str(OUT / 'after_tutorial.png'))

        # 8. habitat rule: a meadow enclosure refuses a flamingo
        held = await pg.evaluate("""() => { const g = window.__wg, S = g.S; S.coins = 1e5; S.level = 15;
            S.objects = S.objects.filter(o => o.kind !== 'wild'); g.rebuild();
            g.setTool({ kind: 'enc', biome: 'meadow' }); g.place(17, 16); g.setTool(null);
            for (const o of S.objects) if (o.build) o.build = S.clock; g.tick(0.1);
            const e = S.objects.filter(o => o.kind === 'enc').pop();
            g.adopt(e, 'flamingo', 'm', 0); g.adopt(e, 'bunny', 'm', 0);
            return e.animals.map(a => a.species); }""")
        check(held == ['bunny'], 'habitat rule enforced')

        # 9. reload keeps the save
        await pg.evaluate("() => window.dispatchEvent(new Event('pagehide'))")
        await pg.reload()
        await pg.wait_for_timeout(800)
        check(await pg.evaluate("() => window.__wg.S.tut") == -1, 'save survives reload')

        check(not errors, 'no page errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))
        await browser.close()
    sys.exit(1 if check.failed else 0)

asyncio.run(main())
