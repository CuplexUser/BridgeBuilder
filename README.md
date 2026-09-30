# Bridge Builder

A physics bridge-building game for the browser. Build a bridge within a cash budget from road, heavy deck, wood, steel and cable, then send a vehicle across it. The bridge either holds, sags, or snaps into the river.

There are 30 levels in six chapters that get harder as you go: from a 4 m brook in *Groundwork* to a 36 m, forty-tonne crossing in *Master Works*. Along the way the game introduces piers, slopes, lattice pylons, heavy deck, rock overhangs, cables, flood water and ship channels. Each chapter has its own scene when you test: a river at golden hour, a desert canyon, a flood plain in the rain, the coast, snowy mountains and a city at night. `TODO.md` lists planned features and improvements by priority.

## Run

Requires Node 22.13+ (it uses the built-in `node:sqlite`).

```sh
npm install
npm run dev      # game + SQLite API at the printed localhost URL
npm test         # physics, editor, scoring and storage tests
npm run lint     # Oxlint
npm run build    # static build in dist/
npm start        # production: serves dist/ + the SQLite API on :3000
npm run tune     # level optimizer: tunes budgets, targets, bonus goals and marked geometry
```

`npm start` reads `PORT` (default 3000) and `DB_FILE` (default `data/bridgebuilder.db`). Add `?debug` to the URL for an FPS counter.

## Saving: SQLite or browser

On first launch you enter your name, which creates a profile (or continues an existing one with that name). Each profile keeps its best score and stars per level, and its saved design for each level. Chapter challenge runs go into a shared top-10 table per chapter, under the profile name.

At startup the game probes `api/health`:

- **Server present** (`npm run dev`, `npm run preview`, `npm start`): everything is stored in SQLite (`server/api.mjs`). The tables are `profiles`, `level_progress` and `scores`.
- **No server** (GitHub Pages or any static host): everything is stored in the browser's `localStorage`, per device.

The profile screen tells you which storage is in use. The last-used profile resumes automatically on the same device.

### GitHub Pages

`.github/workflows/pages.yml` lints, tests and builds, then publishes `dist/` on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**. The build uses relative paths, so it works from the `/<repo>/` sub-path.

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Build a member | Drag from a bolt or node | Arrows/WASD move cursor, Space/Enter to start and place (chains) |
| Lay road | One drag lays a whole run of road or heavy deck. The pieces follow one straight, even grade, even between banks at different heights. | Same |
| Add a joint mid-beam | Drag from (or onto) a point along an existing beam. The beam is split there at no extra cost. | Space with the cursor on the beam point |
| Remove a member | Tap it / right-click | X or Delete at cursor |
| Material | Toolbar | 1–5, Q / E to cycle |
| Undo / redo | Toolbar | Z / Y (or Ctrl+Z / Ctrl+Y) |
| Test / back to edit | TEST button | T |
| Zoom / pan | Wheel, pinch, drag empty space | F refits |
| Pause | II button | P / Esc |
| Menus | Buttons | Title: Enter continue, C chapters, H leaderboards. Chapters: 1–6. Chapter: 1–5 plays a level. Leaderboards: ←/→ tabs, 1–6 chapter. |
| Mute | Speaker button | M |

Members can cross each other (X-bracing), but they can't lie along an existing member. For example, a wood beam can't run on top of the road.

## Materials

| Material | Price | Reach | Notes |
| --- | --- | --- | --- |
| Road | $180/m | 2.25 m | Drivable, laid in runs. Carries vehicles up to 30 t: everything but the semi. |
| Heavy deck | $380/m | 2.25 m | Drivable, laid in runs. About twice as strong and stiff as road, but heavier, and a little stiff in bending, so it spreads a wheel load onto neighboring joints. Carries up to 60 t. For the semi, long spans and suspension decks. |
| Wood | $90/m | 3.2 m | Light and cheap. Buckles early in compression. |
| Steel | $240/m | 4.25 m | Strong in tension and compression. |
| Cable | $140/m | 10 m | Tension only: it goes slack instead of pushing. Hang decks from pylons and overhangs. |

You pay by length, so splitting a beam to add a joint costs nothing. Each level lists the materials it offers.

Vehicles weigh from 9 t (the compact car) to 40 t (the semi). A vehicle heavier than a deck's rating crushes each piece it drives onto, however well the deck is braced. Heavy deck arrives in chapter 5, with the semi. The semi rides on three axles, so its weight spreads along a hung deck the way a real tractor-trailer's does.

A road run gets a joint at every bolt it passes over, so a deck laid across a pylon's bolt is fastened to it.

## How it works

- `src/physics/world.ts` is a small-step XPBD solver. Members are compliant distance constraints. Stress is axial force over the member's capacity; compression capacity falls off with length, like buckling. A member breaks when its smoothed stress reaches 100%. Consecutive heavy-deck pieces also get a bending constraint that yields past a small force, like a hinge, so a heavy deck shares load between hangers but can't bridge a gap by bending alone. The vehicle is four particles in the same world, and its wheel contacts push load into the road members' nodes. A deck piece that a vehicle over its weight rating touches is driven to breaking stress within a few frames.
- `src/levels.ts` defines each level as authored: geometry, vehicle, materials, tip. Its budget, target and bonus goal, plus any geometry the optimizer was allowed to adjust, come from `src/levels.tuned.json` (see below). `src/chapters.ts` groups levels into chapters and holds the unlock rules. Level ids are stable, and chapters list them in play order, so saved progress survives reordering.
- `src/rules.ts` holds the build rules (reach, bounds, channels, overlaps, budget). The editor, the tests and the optimizer all check designs with it.
- `src/solutions.ts` holds a hand-made design per level: the intended answer. The optimizer starts from it, and budgets always leave room for it.
- `tests/tuning.test.ts` drives the real vehicle over every level's tuned reference and bonus designs and over the hand-made ones, checks each level's shortcuts still fail, and fails when a level's tuning is stale. `tests/physics.test.ts` covers the solver itself: bending, weight ratings, stability, cables, and that a bare heavy deck crosses no level.
- `tests/storage.test.ts` runs the same behavior contract against both storage backends. The SQLite one runs against a real HTTP server on an in-memory database.
- Rendering is Canvas 2D (`src/render/`). `src/render/themes.ts` defines each chapter's sky, land, water, trees, weather and time of day. The UI is DOM overlays (`index.html`, `src/ui/ui.ts`). All sound is synthesized with WebAudio (`src/audio.ts`).

## Level tuning

`npm run tune` is an offline optimizer (`tools/tune/`) that decides each level's numbers, so they follow from what can actually be built rather than from guesswork:

1. **Search.** For each level it looks for the cheapest design that crosses with peak stress at or below 92%. A genetic algorithm searches a structure grammar built from the level's geometry: deck spans, trusses over or under them, struts, posts and trestles from low anchors, hangers from high anchors, and sagging main cables between them. Each result, and the hand-made design, is then polished by local search that removes members and swaps materials one at a time.
2. **Numbers.** The target is the best cost times a slack that shrinks by chapter (×1.15 to ×1.08). The budget is the best cost times ×1.63 down to ×1.22, and never less than the hand-made design plus 5%.
3. **Bonus goal.** It keeps the level's current kind of goal if it can: a stress cap the reference misses, a material the level can do without, or a parts cap. Each goal comes with a design proving it can be met.
4. **Intent.** `tools/tune/intents.ts` says what each level is about. `requires` names materials the level is built around: the best design without them must fail or blow the budget, which is how the cable levels keep their cables. `shortcuts` are specific designs that must fail. `minRoom` asks that enough one-step variations of the best design still cross, so there's more than one way over. `params` and `shape` mark geometry the optimizer may change. Level 30's channel clearance, pylon positions and pylon heights are tried in order of preference until everything holds.

Options: `--levels 7,30` tunes only those levels. `--effort quick|normal|thorough|max` trades time for search depth (the default is `normal`). `--time <minutes>` measures this machine and picks the most thorough effort expected to fit. `--estimate` just prints how long each effort would take. A live status line shows the stage, simulations per second, elapsed time and time left.

It runs designs in parallel on worker threads and restarts any worker that crashes or hangs. Every finished level is saved to `tools/tune/results/state.json` right away. An interrupted run continues where it stopped, and a level is only re-tuned when its inputs change (`--fresh` forces it). The results go to `src/levels.tuned.json`, `tools/tune/results/designs.json` (the proof designs the tests drive) and `tools/tune/results/report.md`. Bump `PHYSICS_VERSION` in `src/physics/world.ts` when a change alters how bridges behave; the tests then report every level as stale until it's tuned again.

## Chapters, scoring and leaderboards

**Chapters.** The first chapter is open from the start. A chapter opens once every level of the previous one has been crossed, and inside a chapter the levels open one after another. **Continue** on the title screen takes you to the first level you haven't crossed yet.

**Level score.** 500 for crossing, plus up to 1,000 for money left in the budget, plus up to 400 for safety (low peak stress), plus 250 for the bonus goal. You earn stars for crossing, for building at or under the target cost, and for a peak stress below 75%.

**Bonus goals.** Every level also has a bonus goal (✦), shown under the level name and on its card: build for less than a set amount, keep peak stress under a limit, use a limited number of parts (a split beam counts once), or build without one material. Meeting it earns the bonus star and 250 points. Free play has no lives: collapse, tweak and try again. Your saved design for each level comes back when you return.

**Career.** Your career score is the sum of your best score on every level. Improving any level raises it, so you never need to replay from the start.

**Chapter challenges.** A finished chapter unlocks its challenge: all five levels in a row, from blank designs, with three lives. Each collapse costs a life, and a 3-star crossing earns one back. The run's total goes on that chapter's challenge board, even if you quit part-way.

**Leaderboards** have four tabs:

- **Career**: every engineer, ranked by career score.
- **Chapter**: ranked by best scores on one chapter's five levels.
- **Levels**: the record holder on each level of a chapter, with your own best when someone else holds it.
- **Challenges**: the top challenge runs on one chapter.
