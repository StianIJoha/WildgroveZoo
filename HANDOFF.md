# Wildgrove Zoo: handoff notes

Wildgrove Zoo is a browser zoo-management game, a spiritual successor to Bigpoint's Flash game **Zoomumba** (2010–2020). It copies Zoomumba's *mechanics* but uses its own name, characters and art. Keep it that way: don't add Zoomumba's name, logo, guide characters or ripped assets.

It is plain HTML, CSS and JavaScript with no framework and no dependencies. All art is drawn in code on a canvas; there are no image files. The built game is one self-contained `index.html` that runs offline by double-clicking it.

## Run, build, test

| Task | Command |
|---|---|
| Play | Open `index.html` in a browser |
| Rebuild after editing `src/` | `node build.js` |
| Smoke test (tutorial + key systems) | `pip install playwright`, `python -m playwright install chromium`, then `python tests/playthrough.py` |
| Look at all sprites | Open `tools/art-preview.html` (params `?z=2&s=animals\|decor\|ui\|all`) |

`build.js` concatenates `src/shell.html` and then `art.js`, `data.js` and `engine.js` as inline `<script>` blocks, in that order. **Always edit `src/`, never `index.html`.**

## Files

| File | Lines | What's in it |
|---|---|---|
| `src/shell.html` | ~280 | Page markup and all CSS: HUD, tool dock, side panel, bottom sheets (Build, Storage, Zoo), tutorial card, modals |
| `src/art.js` | ~2,700 | Global `ART`: every sprite as a canvas-drawing function |
| `src/data.js` | ~210 | Global `GAME`: all game data and balance numbers (species, shops, prices, goals, tutorial text…) |
| `src/engine.js` | ~1,470 | One IIFE with simulation, rendering, input, UI panels, saving and audio |
| `tests/playthrough.py` | | Playwright smoke test that taps through the tutorial like a player |
| `tools/art-preview.html` | | Sprite sheet viewer for `art.js` |

## Architecture

**State.** Everything that is saved lives in one object `S`: coins, gems, paws, xp, level, `clock`, `owned` (land index), `objects[]`, `paths[]` (`"x,y"` strings), `litter[]`, `storage`, `food`, `medicine`, `helpers`, `cards`, `claimed`, `stats`, `tut` (tutorial step, -1 when done) and `wheelNext`. It is saved to `localStorage['wildgrove.save.v2']` every 8 s, shortly after any action, and on `pagehide`. Keys starting with `_` (caches like `_conn`, `_props`) are stripped when saving.

**Objects** in `S.objects` have a `kind`:
- `enc`: a 3×3 enclosure with `biome`, `level` (0–4), `species`, `variant`, `animals[]`, `dung[]` and `breed` progress.
- `shop`: a 1×1 shop with `type` and `prog` (0–1, collectable at 1).
- `bld`: a 2×2 special building (`nursery` with `slots`, `lab` or `safari` with `job`).
- `deco`, `wild` (trees on unbuilt land), `gate`.

Any object can have `build`, the game time at which construction finishes.

**Time.** `S.clock` is game seconds. It advances in `tick(dt)` and also while away: `offlineProgress()` simulates in 10 s steps, capped at 6 h, then shows the welcome-back summary. Only the wheel's free spin uses real wall-clock time.

**Grid.** The map is a 30×30 isometric grid with 64×32 px tiles, converted by `iso(gx, gy)`. You own the bottom-right corner, growing through `EXPANSIONS` from 14×14 to 23×23. `rebuild()` recomputes the occupancy grid, the path set and `reach`, a flood fill of paths from the gate. An object is *connected* (`_conn`) when a reachable path touches one of its edges.

**Rendering.**
- **Cached ground layer:** the ground, paths and the forest behind the zoo are pre-drawn into an offscreen canvas. It is redrawn only when `groundDirty` or `forestDirty` is set, or the zoom scale bucket changes.
- **Front forest:** the trees in front of the zoo are a second cached layer drawn on top.
- **Live layer:** objects, animals, visitors and litter are depth-sorted by `gx + gy` every frame.
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
| `ART.person(ctx, t, { shirt, skin, hair, moving, flip })` | Visitors |
| `ART.guide(ctx, size, t, mood)` | Tilda the head keeper; mood is `happy`, `surprised` or `wink` |
| `ART.wheel(ctx, radius, angle, segments)` | Segment 0 is centred at 12 o'clock when angle = 0 |
| `ART.variantNames[species]` | 5 display names per species |

## Game systems (current numbers are in `data.js`)

- **Currencies:**
  - Coins: tickets and shops.
  - Gems: level-ups, goals, wheel. Used to rush timers, hire staff, expand early and adopt rare animals.
  - Paws: earned from care actions (18% chance each), litter and the nursery. Used for enclosure upgrades and the lab.
- **14 species in 6 habitats**, each species locked to its own habitat:
  - Meadow: bunny, macaw
  - Ice floe: penguin, polar bear
  - Lagoon: flamingo, crocodile, elephant
  - Dunes: meerkat
  - Bamboo grove: capuchin, red panda, panda
  - Savanna: zebra, lion, giraffe

  Each species has an unlock level, a price, a food type, attraction stars, breed and grow times, and a care multiplier.
- **Per-animal needs:** food (eaten from bought stock, 7 food types), water, pet and play, each due on its own timer (base 300/240/420/540 s × the species care multiplier). Bubbles above an enclosure care for every animal that needs it, and tapping one animal cares for just that one.
- **Mood** = 1 − 0.2 per unmet need − 0.4 if sick − a dung penalty, +0.1 in the home habitat. Breeding needs an adult ♂ and ♀, free space, and every adult healthy with mood ≥ 0.7.
- **Sickness:** checked every 10 s. An animal with a need overdue by more than one full interval has a 3% chance to fall sick. Medicine cures it.
- **Dung** builds up in enclosures and **litter** on paths (a trash bin within 3 tiles cuts litter to a quarter). Both lower tidiness.
- **Zoo meter (0–100%)** is weighted: animal mood 40%, tidiness 25%, variety 15%, decor 10%, babies 10%. Visitor target = min(80, attraction stars ÷ 3 × (0.4 + 0.6 × meter)). Visitors spawn at the gate, pay a ticket (1 + level ÷ 3 coins) and random-walk the paths.
- **Shops** (8 types): each fills over its pay period, faster with more visitors and a higher meter, and only when connected to a path. When full, a silver coin appears to collect. Shops are the main income.
- **Build timers** on enclosures, shops and buildings, which can be rushed with gems.
- **Enclosure upgrades:** 4 levels that raise capacity from 4 to 8, costing coins and paws.
- **Nursery:** 3 cribs where babies grow at triple speed; collecting gives +3 paws and the grown animal goes to storage.
- **Breeding lab:** breed a ♂+♀ pair of the same subspecies from storage. Both parents are used up, and the baby has a 45% chance of being one degree rarer, up to the 5th degree.
- **Safari station:** 3 expedition tiers returning coins, food, paws, cards and animals, sometimes rare.
- **Wheel of fortune:** a free spin every 4 real hours, otherwise 2 gems. 8 weighted prizes.
- **Collections:** 6 habitats × 5 fact cards. Cards drop from care, litter, the wheel and safaris; completing a set pays a reward plus a decor item.
- **Staff** (Zoo office): feeding keeper, water carrier, cuddle keeper and groundskeeper, hired for 2 h with gems.
- **Land expansion:** 6 extra plots, unlocked by level and bought with coins, or earlier with gems. New land arrives covered in wild trees to clear.
- **Storage:** animals, stored buildings and decor (enclosures keep their level), food and medicine. Everything can be moved, stored, sold or removed.
- **Goals:** 21 sequential goals with 4 shown at a time.
- **Tutorial:** 9 steps with Tilda, opening with three escaped penguins to catch. It can be skipped.
- **Offline progress:** a welcome-back summary shows ticket income, full shops, babies born and animals needing care.
- **Audio:** WebAudio synth sound effects and a generated marimba-style music loop, with a mute button.

## Known issues and limits

- **Saves are tied to the browser and origin.** The claude.ai artifact version and this local file have separate saves, and there is no export/import yet.
- **Money is fairly loose.** In a 30-minute QA run, goal rewards were ~42% of early income and passive income was ~80 coins/min with 2 enclosures. Food was cheap until its price was raised; medicine is the main drain, and players can miss that sickness blocks breeding.
- **The early Zoo meter** plateaus around 65% until the player has more species, and the only explanation is the breakdown in the Zoo office (tap the meter).
- **Staff** don't treat sick animals.
- **Visitors** random-walk instead of heading for attractions.
- **Performance:** animals and visitors are drawn live every frame, which can get heavy on very large zoos.
- **Old artifact saves** made before the habitat lock may still contain mixed-species enclosures, which load fine.
- **`engine.js` is one large IIFE** with no modules or types, and the test coverage is a single smoke test.
- **Fonts** (Grandstander and Nunito) load from Google Fonts and fall back to system fonts when offline.

## Improvement ideas (rough priority)

1. **Save export/import:** a button that copies or downloads the save as JSON and loads it back. This is small and unblocks moving saves between the artifact, local files and devices.
2. **Visitor wish bubbles** (from the original): visitors ask for a specific animal or snack, and fulfilling it gives bonus coins and meter. Make visitors walk toward attractions instead of wandering randomly.
3. **Rotating daily and timed tasks** (the original's goals changed every few hours): e.g. "feed penguins 10 times", "raise 2 cubs", rewarding paws and gems. This gives a reason to return besides offline income.
4. **Events:** seasonal limited-time events with exclusive animals and decor and event "laps", which were Zoomumba's strongest retention hook.
5. **Balance pass:** tighten money (shop payouts versus costs, goal rewards), make upgrades need items as the original did, start with 5 medicine, and add a clear sickness hint plus a staff vet.
6. **Animal sounds and personality:** a sound when an animal is tapped, more idle animations, and favourite toys or enrichment items placed inside enclosures that boost mood.
7. **Day/night cycle:** lamps glow at night, and visitor numbers change with the time of day.
8. **Second area**, like the original's teased "Ocean World": an aquarium map with dolphins, sea turtles and seals.
9. **Cloud saves and friends with Supabase:** visit friends' zoos, leave a gift or help with care, and a leaderboard. This needs a small backend.
10. **Tech:** move `src/` to ES modules and a Vite build (keeping single-file output), add TypeScript types for `S`, unit-test the economy functions, and cache animal animation frames for performance.
11. **QoL:** undo the last placement, bulk-buy food for all species, a filter in storage, keyboard shortcuts, tooltips on everything, and colour-blind-safe need icons.
12. **Mobile polish:** long-press for info, haptics, and a larger hit area for small animals.

After any change: run `node build.js` and `python tests/playthrough.py`, and look at the game at 1280×800 and at phone width (390 px).
