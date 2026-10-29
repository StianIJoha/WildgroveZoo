# Wildgrove Zoo: handoff notes

Wildgrove Zoo is a browser zoo-management game, a spiritual successor to Bigpoint's Flash game **Zoomumba** (2010–2020). It copies Zoomumba's *mechanics* but uses its own name, characters and art. Keep it that way: don't add Zoomumba's name, logo, guide characters or ripped assets.

It is plain HTML, CSS and JavaScript with no framework and no dependencies. All art is drawn in code on a canvas; there are no image files. The built game is one self-contained `index.html` that runs offline by double-clicking it.

## Run, build, test

| Task | Command |
|---|---|
| Play | Open `index.html` in a browser |
| Rebuild after editing `src/` | `node build.js` |
| Smoke test (tutorial + key systems) | `pip install playwright`, `python -m playwright install chromium`, then `python tests/playthrough.py`. Set `PW_CHROMIUM=/path/to/chrome` to use an already-installed Chromium |
| Look at all sprites | Open `tools/art-preview.html` (params `?z=2&s=animals\|decor\|ui\|all`) |

`build.js` concatenates `src/shell.html` and then `art.js`, `data.js` and `engine.js` as inline `<script>` blocks, in that order. **Always edit `src/`, never `index.html`.**

## Files

| File | Lines | What's in it |
|---|---|---|
| `src/shell.html` | ~330 | Page markup and all CSS: HUD, tool dock, side panel, bottom sheets (Build, Storage, Zoo), tutorial card, modals |
| `src/art.js` | ~3,600 | Global `ART`: every sprite as a canvas-drawing function |
| `src/data.js` | ~300 | Global `GAME`: all game data and balance numbers (species, shops, prices, goals, tutorial text…) |
| `src/engine.js` | ~1,900 | One IIFE with simulation, rendering, input, UI panels, saving and audio |
| `tests/playthrough.py` | | Playwright smoke test that taps through the tutorial like a player |
| `tools/art-preview.html` | | Sprite sheet viewer for `art.js` |

## Architecture

**State.** Everything that is saved lives in one object `S`: coins, gems, paws, xp, level, `clock`, `owned` (land index), `objects[]`, `paths[]` (`"x,y"` strings), `litter[]`, `storage`, `food`, `medicine`, `helpers`, `cards`, `claimed`, `stats` (including `careBy[species]` and `rank`), `tut` (tutorial step, -1 when done), `wheelNext`, `tasks` (daily tasks), `event` (weekly festival), `wishLog` (missed visitor wishes) and `settings` (`muted`, `music`, `night`). `migrate(s)` fills in anything an older save is missing; call it on every loaded or imported save. It is saved to `localStorage['wildgrove.save.v2']` every 8 s, shortly after any action, and on `pagehide`. Keys starting with `_` (caches like `_conn`, `_props`) are stripped when saving. `exportCode()` / `parseSave()` turn a save into a base64 code and back; the Zoo office has a modal to copy, download, paste or open one, and `loadState()` swaps it in.

**Objects** in `S.objects` have a `kind`:
- `enc`: a 3×3 enclosure with `biome`, `level` (0–4), `species`, `variant`, `animals[]`, `dung[]`, `toys[]` and `breed` progress.
- `shop`: a 1×1 shop with `type` and `prog` (0–1, collectable at 1).
- `bld`: a 2×2 special building (`nursery` with `slots`, `lab` or `safari` with `job`).
- `deco`, `wild` (trees on unbuilt land), `gate`.

Any object can have `build`, the game time at which construction finishes, and `paid`, the coins refunded if the build is cancelled.

**Time.** `S.clock` is game seconds. It advances in `tick(dt)` and also while away: `offlineProgress()` simulates in 10 s steps, capped at 6 h, then shows the welcome-back summary. Only the wheel's free spin uses real wall-clock time.

**Grid.** The map is a 30×30 isometric grid with 64×32 px tiles, converted by `iso(gx, gy)`. You own the bottom-right corner, growing through `EXPANSIONS` from 14×14 to 23×23. `rebuild()` recomputes the occupancy grid, the path set and `reach`, a flood fill of paths from the gate. An object is *connected* (`_conn`) when a reachable path touches one of its edges.

**Rendering.**
- **Cached ground layer:** the ground, paths and the forest behind the zoo are pre-drawn into an offscreen canvas. It is redrawn only when `groundDirty` or `forestDirty` is set, or the zoom scale bucket changes.
- **Front forest:** the trees in front of the zoo are a second cached layer drawn on top.
- **Live layer:** objects, animals, visitors and litter are depth-sorted by `gx + gy` every frame.
- **Night layer:** when `DK` (darkness, 0–1) is above zero, `drawNight()` tints the view and adds glows for decor with `light: true`, the gate, shops and fireflies. Bubbles and floaters are drawn after it so they stay bright.
- **Icons:** world-space icons go through `drawIcon()`, which draws bitmaps cached per size and zoom bucket. Inline icons in HTML strings use `ic()`, which caches each icon as a data URL (a serialised canvas would be blank).
- **Static sprites:** static decor and shop sprites are cached per scale bucket (`cachedSprite`). Animated ones (`fountain`, `lamp`, `balloon`) and all animals and people are drawn live.
- **Culling and quality:** anything off-screen is skipped. If frames take longer than 18 ms, the game automatically lowers canvas resolution and raises it again when there is headroom.

**UI.** Panels rebuild their DOM only when their signature changes (`sigOf`). Otherwise `livePanel()` updates bars and counters in place every 0.3 s. Floating bubbles are drawn on the canvas and hit-tested in `tap()`.

**Debug handle.** `window.__wg` exposes the state and helpers (`S`, `M`, `tick`, `place`, `setTool`, `select`, `adopt`, `careAll`, `scr(gx, gy)` for grid-to-screen coordinates, `skipTutorial`…). The test script relies on it.

**Artifact hooks.** `window.claude.hot` is only present when the game runs as a claude.ai artifact and is ignored locally.

### Art API (`art.js`)

| Call | Anchor and notes |
|---|---|
| `ART.animals[id](ctx, t, { baby, flip, moving, sex, variant })` | Feet at (0,0), faces right. Babies draw at 0.6 scale. `variant` 0–4 are colour morphs; 3–4 sparkle |
| `ART.decor[id](ctx, t)` | Base centre at (0,0) on a 64×32 tile diamond. 2×2 buildings centre on a 128×64 diamond and `construction3` on 192×96. `ART.decor.litter(ctx, t, k)` with k 0–2 |
| `ART.icons[id](ctx, size)` | Centred |
| `ART.decor.toyBall` / `toyLog` / `toyTire` / `toyPost` | Enclosure toys, about 15–24 px wide, base at (0,0) |
| `ART.person(ctx, t, { shirt, skin, hair, moving, flip })` | Visitors |
| `ART.guide(ctx, size, t, mood)` | Tilda the head keeper; mood is `happy`, `surprised` or `wink` |
| `ART.wheel(ctx, radius, angle, segments)` | Segment 0 is centred at 12 o'clock when angle = 0 |
| `ART.variantNames[species]` | 5 display names per species |

## Game systems (current numbers are in `data.js`)

- **Currencies:**
  - Coins: tickets and shops.
  - Gems: level-ups, goals, wheel. Used to rush timers, hire staff, expand early and adopt rare animals.
  - Paws: earned from care actions (18% chance each), litter and the nursery. Used for enclosure upgrades and the lab.
- **19 species in 7 habitats**, each species locked to its own habitat:
  - Meadow: bunny, macaw
  - Ice floe: penguin, polar bear
  - Lagoon: flamingo, crocodile, elephant
  - Dunes: meerkat, fennec fox, camel
  - Bamboo grove: capuchin, red panda, panda
  - Savanna: zebra, lion, giraffe
  - Coast: seal, otter, sea turtle (eats kelp)

  `SPECIES_TOP` sets how high need icons float above each species.

  Each species has an unlock level, a price, a food type, attraction stars, breed and grow times, and a care multiplier.
- **Per-animal needs:** food (eaten from bought stock, 7 food types), water, pet and play, each due on its own timer (base 300/240/420/540 s × the species care multiplier). Bubbles above an enclosure care for every animal that needs it, and tapping one animal cares for just that one.
- **Mood** = 1 − 0.2 per unmet need − 0.4 if sick − a dung penalty, +0.1 in the home habitat. Breeding needs an adult ♂ and ♀, free space, and every adult healthy with mood ≥ 0.7.
- **Sickness:** checked every 10 s. An animal with a need overdue by more than one full interval has a 3% chance to fall sick. Medicine cures it. The first sickness shows a longer explanation. New zoos start with 5 medicine.
- **Toys:** up to 2 per enclosure, bought with coins and paws. Each adds `TOY_MOOD` mood and makes the play need last `TOY_PLAY` longer.
- **Dung** builds up in enclosures and **litter** on paths (a trash bin within 3 tiles cuts litter to a quarter). Both lower tidiness.
- **Zoo meter (0–100%)** is weighted: animal mood 40%, tidiness 25%, variety 15%, decor 10%, babies 10%. Variety is judged against `min(8, 2 + level × 0.6)` kinds. Visitor target = min(80, attraction stars ÷ 3 × (0.4 + 0.6 × meter)), lowered by up to 45% at night. Visitors spawn at the gate, pay a ticket (1 + level ÷ 3 coins), pick attractions (weighted by appeal and distance), route there over the path graph with `route()` (BFS), look for a while, and head back to the gate when their time is up.
- **Visitor wishes:** 30% of visitors wish for an animal, a shop or somewhere to sit (thought bubble; tap it to read). They head for a match; reaching one pays a tip (4 + 2 × level coins). Unmet wishes expire after 45 s and are counted in `wishLog`, shown in the Zoo office as "most missed".
- **Day/night:** a day is `DAY_LENGTH` (900) game seconds; night falls at 60% and lifts at 92%. Animals sleep, visitors thin out and lights glow. Off during the tutorial, and can be switched off in settings.
- **Zoo rank:** `RANKS` by attraction stars (Backyard zoo → World-famous zoo), shown under the logo; each new rank pays gems once.
- **Shops** (8 types): each fills over its pay period, faster with more visitors and a higher meter, and only when connected to a path. When full, a silver coin appears to collect. Shops are the main income.
- **Build timers** on enclosures, shops and buildings, which can be rushed with gems.
- **Enclosure upgrades:** 4 levels that raise capacity from 4 to 8, costing coins and paws.
- **Nursery:** 3 cribs where babies grow at triple speed; collecting gives +3 paws and the grown animal goes to storage.
- **Breeding lab:** breed a ♂+♀ pair of the same subspecies from storage. Both parents are used up, and the baby has a 45% chance of being one degree rarer, up to the 5th degree.
- **Safari station:** 3 expedition tiers returning coins, food, paws, cards and animals, sometimes rare.
- **Wheel of fortune:** a free spin every 4 real hours, otherwise 2 gems. 8 weighted prizes.
- **Collections:** 6 habitats × 5 fact cards. Cards drop from care, litter, the wheel and safaris; completing a set pays a reward plus a decor item.
- **Staff** (Zoo office): feeding keeper, water carrier, cuddle keeper, groundskeeper and vet (treats sick animals from your medicine stock), hired for 2 h with gems.
- **Land expansion:** 6 extra plots, unlocked by level and bought with coins, or earlier with gems. New land arrives covered in wild trees to clear.
- **Storage:** animals, stored buildings and decor (enclosures keep their level), food and medicine. Everything can be moved, stored, sold or removed.
- **Goals:** 25 sequential goals with 4 shown at a time.
- **Daily tasks:** three random tasks from `DAILY` (care, care for one species, shops, litter, dung, wishes, babies, visitors, coins), scaled by level, refreshed every 4 real hours. Progress is a stat delta from when the task was made. Finishing all three pays a bonus. Shown above the goals in the Goals sheet.
- **Weekly festival:** the theme follows the season (`EVENTS`). Points come from stat deltas since Monday (`EVENT_POINTS`), and fill a 10-step `EVENT_TRACK` with coins, paws, gems, an exclusive decor item and a rare (3rd-degree) animal. Finishing the track starts another lap. First tab of the Zoo hub.
- **Tutorial:** 9 steps with Tilda, opening with three escaped penguins to catch. It can be skipped.
- **Offline progress:** a welcome-back summary shows ticket income, full shops, babies born and animals needing care.
- **Audio:** WebAudio synth sound effects, a short call per species (`VOICE`) when you tap or care for an animal, and a generated marimba-style music loop. Sound, music and day/night are saved settings.
- **Quality of life:** cancel a build for a full refund, undo the last decor placement (Ctrl+Z or the Undo button, 30 s), Restock everything in Supplies, a low-food chip in the HUD, placement hints (bin range, path adjacency), "No path" warnings, long-press to open a panel, and keyboard shortcuts (B, P, C, S, G, Z, +/−, M, Esc).

## Known issues and limits

- **Saves are tied to the browser and origin.** Use the save code or file in the Zoo office to move a zoo between the artifact, local files and devices.
- **Money is fairly loose.** In a 30-minute QA run, goal rewards were ~42% of early income and passive income was ~80 coins/min with 2 enclosures. Food was cheap until its price was raised; medicine is the main drain, and players can miss that sickness blocks breeding.
- **Performance:** animals and visitors are still drawn live every frame. Icons are cached, but a maxed-out zoo (~100 animals, 80 visitors) costs ~30 ms a frame in headless software rendering; the auto-quality drop keeps it playable. Caching animal animation frames is the next step.
- **Old artifact saves** made before the habitat lock may still contain mixed-species enclosures, which load fine.
- **`engine.js` is one large IIFE** with no modules or types, and the test coverage is a single smoke test.
- **Fonts** (Grandstander and Nunito) load from Google Fonts and fall back to system fonts when offline.

## Improvement ideas (rough priority)

Done since the first handoff: save export/import, visitor wishes and attraction-seeking visitors, daily tasks, a weekly seasonal festival with laps, vet staff and 5 starting medicine, species calls and toys, day/night, the Coast habitat (seals, otters, sea turtles), two more Dunes animals, undo/cancel-build/restock, keyboard shortcuts, long-press and haptics.

1. **Balance pass:** tighten money (shop payouts versus costs, goal rewards) using `tests/economy.js`, and make upgrades need items as the original did.
2. **Event-exclusive animals:** the festival gives a rare variant of an existing species; truly exclusive species or variants per season would be stronger.
3. **Second area**, like the original's teased "Ocean World": an aquarium map with dolphins and rays (Coast is a first step).
4. **Cloud saves and friends with Supabase:** visit friends' zoos, leave a gift or help with care, and a leaderboard. This needs a small backend.
5. **Tech:** move `src/` to ES modules and a Vite build (keeping single-file output), add TypeScript types for `S`, unit-test the economy functions, and cache animal animation frames for performance.
6. **QoL:** a filter in storage, tooltips on everything, colour-blind-safe need icons, and a larger hit area for small animals.

After any change: run `node build.js` and `python tests/playthrough.py`, and look at the game at 1280×800 and at phone width (390 px).
