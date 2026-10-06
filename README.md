# Bridge Builder

A physics bridge-building game for the browser. Build a bridge within a cash budget from road, heavy deck, wood, steel and cable, then send a vehicle across it. The bridge either holds, sags, or snaps into the river.

There are 35 levels in seven chapters that get harder as you go: from a 4 m brook in *Groundwork* to a 36 m, forty-tonne crossing in *Master Works*, and then bridges that move in *Moving Parts*. Along the way the game introduces piers, slopes, lattice pylons, heavy deck, rock overhangs, cables, flood water, ship channels, drawbridges on hydraulic rams, convoys, toll bolts and rationed materials. Each chapter has its own scene when you test: a river at golden hour, a desert canyon, a flood plain in the rain, the coast, snowy mountains, a city at night and a harbor. `TODO.md` lists planned features and improvements by priority.

## Run

Requires Node 22.15+ (it uses the built-in `node:sqlite` and `module.registerHooks`).

```sh
npm install
npm run dev      # game + SQLite API at the printed localhost URL
npm test         # physics, editor, scoring and storage tests
npm run lint     # Oxlint
npm run build    # static build in dist/
npm start        # production: serves dist/ + the SQLite API on :3000
npm run tuner    # tuner page: pick levels and effort, run the optimizer, edit the difficulty
npm run tune     # level optimizer from the command line: tunes budgets, targets, bonus goals and marked geometry
npm run tune:unpack  # readable JSON copies of src/levels.res in tools/tune/results
```

`npm start` reads `PORT` (default 3000) and `DB_FILE` (default `data/bridgebuilder.db`). Add `?debug` to the URL for an FPS counter.

## Saving: SQLite or browser

On first launch you enter your name, which creates a profile (or continues an existing one with that name). Each profile keeps its best score and stars per level, and its saved design for each level. Chapter challenge runs go into a shared top-10 table per chapter, under the profile name.

At startup the game probes `api/health`:

- **Server present** (`npm run dev`, `npm run preview`, `npm start`): everything is stored in SQLite (`server/api.mjs`). The tables are `profiles`, `level_progress` and `scores`.
- **No server** (GitHub Pages or any static host): everything is stored in the browser's `localStorage`, per device.
- **Android app**: no server probe. Everything is stored on the phone in native preferences (`src/native.ts`), which the system doesn't clear the way it can clear a WebView's `localStorage`.

The profile screen tells you which storage is in use. The last-used profile resumes automatically on the same device.

### GitHub Pages

`.github/workflows/pages.yml` lints, tests and builds, then publishes `dist/` on every push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**. The build uses relative paths, so it works from the `/<repo>/` sub-path.

### Android

The Android app is the same web build wrapped with [Capacitor](https://capacitorjs.com) (app ID `se.cuplex.bridgebuilder`). The native project lives in `android/`. Platform differences sit in `src/platform.ts`, which loads `src/native.ts` only inside the app: device storage, the back button (it does what Escape does, and leaves the app from the title screen), level export through the share sheet, the clipboard, and saving when the app goes to the background.

Requires Android Studio (its bundled JDK is enough) and the Android SDK.

```sh
npm run android       # build the web app and copy it into android/
npm run android:open  # open the project in Android Studio
npm run android:run   # build, copy and run on a connected device or emulator
```

Run `npm run android` after every web change before building in Android Studio. Release builds (a signed `.aab` for Google Play) are made in Android Studio under **Build → Generate Signed App Bundle**. Keep the keystore out of git.

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Build a member | Drag from a bolt or node | Arrows/WASD move cursor, Space/Enter to start and place (chains) |
| Lay road | One drag lays a whole run of road or heavy deck. The pieces follow one straight, even grade, even between banks at different heights. | Same |
| Add a joint mid-beam | Drag from (or onto) a point along an existing beam. The beam is split there at no extra cost. | Space with the cursor on the beam point |
| Remove a member | Tap it / right-click. A beam it had split is joined back up. | X or Delete at cursor |
| Material | Toolbar | 1–6, Q / E to cycle |
| Undo / redo | Toolbar | Z / Y (or Ctrl+Z / Ctrl+Y) |
| Test / back to edit | TEST button | T |
| Zoom / pan | Wheel, pinch, drag empty space | F refits |
| See under your finger | A magnifier above the finger shows the joint you're placing on touch screens | |
| Goals and rules | ⓘ button, or tap the ✦ goal under the level name | I |
| Stress graph after a test | Link on the result or collapse screen; tap the graph or a member | G, ←/→ to step, Esc back |
| Pause | II button | P / Esc |
| Menus | Buttons | Title: Enter continue, C chapters, H leaderboards, L level editor. Chapters: 1–7. Chapter: 1–5 plays a level. Leaderboards: ←/→ tabs, 1–7 chapter. |
| Mute | Speaker button | M |

Members can cross each other (X-bracing), but they can't lie along an existing member. For example, a wood beam can't run on top of the road.

**Briefing.** Every level opens with a briefing card: who crosses and how far, the level's tip, the three stars (cross, build under the target, keep peak stress below 75%), the bonus goal and what it means, and any special rules such as a drawbridge, a convoy, toll bolts, part limits, or a deck too weak for the vehicle. The ⓘ button or I brings it back while you build. Tutorial levels (the ones with a ghost) also offer **Watch an example** (W): the intended bridge drives across first, then you get your own blueprint back. On 7-1 the ghost is that whole drawbridge, ready to trace. The bonus goal also sits under the level name and is checked live where it can be: ✓ or ✗ for cost, parts and banned materials as you build (with your current part count), while a stress goal is judged on the test drive.

**Stress graph.** After a test, *See the stress graph* (G) docks a graph under the bridge: the busiest member's load over the whole run, colored by stress, with the 75% safety line, the 100% breaking line, a mark for every break and the drawbridge phases shaded. It opens at the worst moment. Tap or drag across the graph to find the busiest member at any moment, ringed on the bridge (a broken one is shown dashed where it stood), or tap a member to follow its own load as a dashed curve.

## Level editor

**L** on the title screen opens the level editor. Make a new level or edit one of yours:

- **Tools** (1–5): *Bolt* adds or removes a bolt, *Pier* stands a pier under a bolt in the gap, *Pylon* raises a lattice pylon with a bolt on top, *Channel* marks a ship channel by dragging across the gap (it stays clear up to the height you start at), and *Erase* removes whatever is under the tap. The cursor says what a tap will do before you tap. A tap acts where the finger lifts, so it can slide into place first under a magnifier, and two fingers pan and zoom without placing anything. Z and Y undo and redo.
- **Settings** (S): name and tip, the gap's width, far bank height and water level, the vehicle and up to three more behind it, a tall ship's mast height for a drawbridge, the materials on offer and any part limits, budget, star target, toll per bolt, the bonus goal and the scene for the test drive.
- **Auto-tune**, under *Money and goals* in Settings, searches the level for 5 seconds and sets the budget, star target and bonus goal for the difficulty picked (Easy, Medium or Hard). It keeps the level's kind of bonus goal when it can be met, else picks a peak-stress cap, then a parts cap, then a cost cap. It starts from the last bridge you playtested, and the budget always covers that bridge. The bridges it finds are never shown, only what they tell: the note under the button gives the cheapest crossing found and the lowest peak stress, and the header warns if you then set the budget, star target or stress cap below them. It is a quick, rough search, so a sharper player can beat its numbers. Any edit, including the tune, can be undone.
- **Playtest** (P) plays it like any level, with the briefing, scoring and stress graph, but nothing goes on your career or the leaderboards. The header says what still stops a level from being played, such as a drawbridge with no rams on offer.
- **Export** shows the level as JSON to copy or download, and **Import** reads one back from pasted text or a `.json` file. The format is the game's own `LevelDef` (`src/levels.ts`), so a built-in level copied from the source imports too. Everything is checked and clamped on the way in.

Custom levels and the last bridge built on each are kept in this browser's local storage.

## Materials

| Material | Price | Reach | Notes |
| --- | --- | --- | --- |
| Road | $180/m | 2.25 m | Drivable, laid in runs. Carries vehicles up to 30 t: everything but the semi. |
| Heavy deck | $380/m | 2.25 m | Drivable, laid in runs. About twice as strong and stiff as road, but heavier, and a little stiff in bending, so it spreads a wheel load onto neighboring joints. Carries up to 60 t. For the semi, long spans and suspension decks. |
| Wood | $90/m | 3.2 m | Light and cheap. Buckles early in compression. |
| Steel | $240/m | 4.25 m | Strong in tension and compression. |
| Cable | $140/m | 10 m | Tension only: it goes slack instead of pushing. Hang decks from pylons and overhangs. |
| Hydraulic ram | $420/m | 4.25 m | Magenta, drawn as a cylinder: a fat barrel on its lower end, a chrome rod above. Strong, heavy and expensive. On drawbridge levels it extends by 75% to lift the leaf, then pulls it back down. Elsewhere it's a stiff, pricey strut. |

You pay by length, so splitting a beam to add a joint costs nothing. Each level lists the materials it offers.

Vehicles weigh from 9 t (the compact car) to 40 t (the semi). A vehicle heavier than a deck's rating crushes each piece it drives onto, however well the deck is braced. Heavy deck arrives in chapter 5, with the semi. The semi rides on three axles, so its weight spreads along a hung deck the way a real tractor-trailer's does.

A road run gets a joint at every bolt it passes over, so a deck laid across a pylon's bolt is fastened to it.

**Joints.** A joint fails when too many loaded members pull on it at once: past its two busiest members, the rest of their stress ratios may add up to at most 180%. The busiest member then breaks. A joint glows while it's working hard. Clean load paths with few members per joint keep clear of it.

## Moving parts

Chapter 7 adds four mechanics, which levels can mix:

- **Drawbridges.** A tall ship has to pass through the channel before traffic may go. When you test, the bridge opens on its hydraulic rams, the ship sails through at the channel's middle, the bridge closes and the vehicle drives. Hinge the leaf at a bank or pier, stand a ram under it, and keep everything clear of the ship's mast.
- **Convoys.** Several vehicles cross nose to tail at the slowest one's speed, so the bridge carries them all at once. The level card lists them, and all of them have to reach the far side.
- **Toll bolts.** On some levels every bolt but the two road ends costs money to build from, shown next to the bolt and charged once, however many members use it.
- **Material limits.** Some levels cap how many parts of a material you may use, on top of the budget. The toolbar shows how many are left. Several cable levels in chapters 4 to 6 ration wood and steel this way, so the cables have to carry the deck.

## How it works

- `src/physics/world.ts` is a small-step XPBD solver. Members are compliant distance constraints; a ram's rest length follows the drawbridge's opening. Stress is axial force over the member's capacity; compression capacity falls off with length, like buckling. A member breaks when its smoothed stress reaches 100%. Consecutive heavy-deck pieces also get a bending constraint that yields past a small force, like a hinge, so a heavy deck shares load between hangers but can't bridge a gap by bending alone. Each vehicle is a few particles in the same world, and its wheel contacts push load into the road members' nodes. The drawbridge timeline (open, ship, close, drive) and the ship's collision check live in `TestRun`. A deck piece that a vehicle over its weight rating touches is driven to breaking stress within a few frames.
- `src/levels.ts` defines each level as authored: geometry, vehicle, materials, tip. Its budget, target and bonus goal, plus any geometry the optimizer was allowed to adjust, come from `src/levels.res` (see below). `src/chapters.ts` groups levels into chapters and holds the unlock rules. Level ids are stable, and chapters list them in play order, so saved progress survives reordering.
- `src/maker.ts` is the level editor's logic: editing a `LevelDef` in place, checking it can be played, and reading and writing it as JSON. `src/brief.ts` writes the level briefing and judges the bonus goal live. `src/physics/stresslog.ts` samples every member's stress ten times a second during a test drive, for the stress graph (`src/ui/graph.ts`).
- `src/rules.ts` holds the build rules (reach, bounds, channels, overlaps, budget). The editor, the tests and the optimizer all check designs with it.
- `src/solutions.ts` holds a hand-made design per level: the intended answer. The optimizer starts from it, and budgets always leave room for it.
- `tests/tuning.test.ts` drives the real vehicle over every level's tuned reference and bonus designs and over the hand-made ones, checks each level's shortcuts still fail, and fails when a level's tuning is stale. `tests/physics.test.ts` covers the solver itself: bending, weight ratings, stability, cables, and that a bare heavy deck crosses no level.
- `tests/storage.test.ts` runs the same behavior contract against both storage backends. The SQLite one runs against a real HTTP server on an in-memory database.
- Rendering is Canvas 2D (`src/render/`). `src/render/themes.ts` defines each chapter's sky, land, water, trees, weather and time of day. The UI is DOM overlays (`index.html`, `src/ui/ui.ts`). All sound is synthesized with WebAudio (`src/audio.ts`).

## Level tuning

`npm run tune` is an offline optimizer (`tools/tune/`) that decides each level's numbers, so they follow from what can actually be built rather than from guesswork:

1. **Search.** For each level it looks for the cheapest design that crosses with peak stress at or below 92% and without breaking a single member. A genetic algorithm searches a structure grammar built from the level's geometry: deck spans, trusses over or under them, struts, posts and trestles from low anchors, hangers from high anchors, and sagging main cables between them. On drawbridge levels a support may be a ram. Each result, and the hand-made design, is then polished by local search that removes members and swaps materials one at a time.
2. **Numbers.** The target is the best cost times a slack that shrinks by chapter (by default ×1.3 down to ×1.18), and never less than what the hand-made design costs, so the intended answer earns the cost star. The budget is the best cost times ×2.0 down to ×1.55, at least $1,000 over the target, and never less than the hand-made design plus 35%. The search's best is hard for a person to match, so both leave real room. These slacks are the difficulty settings (see below).
3. **Bonus goal.** It keeps the level's current kind of goal if it can: a stress cap the reference misses, a material the level can do without, or a parts cap. Each search also starts from the reference itself: upgraded member by member for a stress cap, stripped for a parts cap, or with the banned material swapped for its neighbor. Each goal comes with a design proving it can be met. A geometry whose bonus nothing proves is still usable; the optimizer only prefers another one that has both.
4. **Intent.** `tools/tune/intents.ts` says what each level is about. `requires` names materials the level is built around: the best design without them must fail or blow the budget, which is how the cable levels keep their cables. `shortcuts` are specific designs that must fail. `minRoom` asks that enough one-step variations of the best design still cross, so there's more than one way over. `params` and `shape` mark geometry the optimizer may change. Level 30's channel clearance, pylon positions and pylon heights are tried in order of preference until everything holds.

### Running it

`npm run tuner` opens the tuner page on the dev server (`/tuner`; it is never part of a build). It lists every level with its status (tuned, stale, needs a re-tune), best and hand-made cost, star target, budget and bonus goal. Tick levels, pick an effort or a time budget, and start a run; the page shows progress, time left and the tuner's output live, can stop a run (finished levels are kept), and shows the matching command line.

From the command line, `npm run tune` takes the same options. `--levels 7,30` tunes only those levels. `--effort quick|normal|thorough|max` trades time for search depth (the default is `normal`). `--time <minutes>` measures this machine and picks the most thorough effort expected to fit. `--estimate` just prints how long each effort would take. A live status line shows the stage, simulations per second, elapsed time and time left.

The level editor's **Auto-tune** (`src/autotune.ts`) runs the same search and polishing in the browser, on Web Workers (`src/tunepool.ts`), for a few seconds instead of minutes, with no intents, no hand-made design and no geometry changes. Its difficulties are fixed slacks over what the short search found.

It runs designs in parallel on worker threads and restarts any worker that crashes or hangs. Every finished level is saved right away. An interrupted run continues where it stopped, and a level is only re-tuned when its inputs change (`--fresh` forces it). Bump `PHYSICS_VERSION` in `src/physics/world.ts` when a change alters how bridges behave; the tests then report every level as stale until it's tuned again.

### Difficulty

The slacks are editable without touching code. On the tuner page they read as *room over the best design*: a star-target room of +30% means the star target is 30% above the cheapest design the search found, and more room is easier. Each chapter has a star-target and a budget room, each level can have its own in place of its chapter's, and there's the budget's spare over the hand-made design. Every chapter shows a rating in words (the cost star from Easy to Very hard, the budget from Generous to Tight, thresholds in `RATINGS` in `tools/tune/difficulty.ts`) from the room its levels really get, an example level in dollars, and a difficulty curve plots every level's room in play order. The page previews every level's new numbers as you drag. Saving re-derives all of them from the stored search results at once, with no new search, and re-checks each level's shortcuts against its new budget. A level whose checks no longer hold is marked for a re-tune. The "requires" checks reuse designs found under the old budget, so after a large budget increase it's worth re-tuning the cable levels with `--fresh`.

### The level resource

Everything the tuner decides lives in one committed file, `src/levels.res`: the difficulty, each level's numbers and tuned geometry, the proof designs the tests drive, and the full search results that resuming and re-deriving need. It's gzip-packed JSON (about 10 kB), marked binary in `.gitattributes`, so a tuning run is a one-file change instead of thousands of JSON lines. A Vite plugin (`vite.config.ts`) and a Node loader hook (`tools/tune/res-register.mjs`) both import it as a module; the game only uses the numbers, and the build tree-shakes the rest away. Readable copies (`tuned.json`, `designs.json`, `state.json`, `difficulty.json`, `report.md`) are written to the git-ignored `tools/tune/results/` whenever the resource changes; `npm run tune:unpack` regenerates them after a pull.

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
