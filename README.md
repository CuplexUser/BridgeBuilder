# Bridge Builder

A physics bridge-building game for the browser. Draw a bridge with a limited budget of road, heavy deck, wood, steel and cable, then send a vehicle across it. The bridge either holds, sags, or snaps into the river.

The 20 levels run from a 4 m brook to a 32 m suspension crossing. Along the way they introduce piers, sloped banks, heavy decks, lattice pylons, rock overhangs and cables. Each cable level is built around one idea, and the obvious "hang every joint" answer either runs out of cable or out of reach. Those guarantees are covered by tests. `TODO.md` lists planned features and improvements by priority.

## Run

Requires Node 22.13+ (it uses the built-in `node:sqlite`).

```sh
npm install
npm run dev      # game + SQLite API at the printed localhost URL
npm test         # physics, editor, scoring and storage tests
npm run lint     # Oxlint
npm run build    # static build in dist/
npm start        # production: serves dist/ + the SQLite API on :3000
```

`npm start` reads `PORT` (default 3000) and `DB_FILE` (default `data/bridgebuilder.db`). Add `?debug` to the URL for an FPS counter.

## Saving: SQLite or browser

On first launch you enter your name, which creates a profile (or continues an existing one with that name). Each profile keeps its unlocked levels, best scores and stars, and practice designs. Finished runs go into a shared top-10 table under the profile name.

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
| Mute | Speaker button | M |

Members can cross each other (X-bracing), but they can't lie along an existing member. For example, a wood beam can't run on top of the road.

## Materials

| Material | Reach | Notes |
| --- | --- | --- |
| Road | 2.25 m | Drivable, laid in runs. |
| Heavy deck | 2.25 m | Drivable, laid in runs. About twice as strong and stiff as road, but heavier. For trucks and long spans. |
| Wood | 3.2 m | Light and cheap. Buckles early in compression. |
| Steel | 4.25 m | Strong in tension and compression. |
| Cable | 10 m | Tension only: it goes slack instead of pushing. Hang decks from pylons and overhangs. |

A beam split into pieces still counts as one part toward the budget and par.

## How it works

- `src/physics/world.ts` is a small-step XPBD solver. Members are compliant distance constraints. Stress is axial force over the member's capacity; compression capacity falls off with length, like buckling. A member breaks when its smoothed stress reaches 100%. The vehicle is four particles in the same world, and its wheel contacts push load into the road members' nodes.
- `src/solutions.ts` holds a reference design per level, including the sloped levels. `tests/physics.test.ts` drives the real vehicle over each one, which guarantees all 20 levels are beatable within budget. Each level's par equals its reference solution's part count. The same file checks that the obvious shortcut designs on the cable levels fail.
- `tests/storage.test.ts` runs the same behavior contract against both storage backends. The SQLite one runs against a real HTTP server on an in-memory database.
- Rendering is Canvas 2D (`src/render/`). The UI is DOM overlays (`index.html`, `src/ui/ui.ts`). All sound is synthesized with WebAudio (`src/audio.ts`).

## Scoring

Each level scores 500 for crossing, plus 100 per unused part, plus up to 400 for safety (low peak stress). You earn stars for crossing, for staying at or under par, and for a peak stress below 75%. A run starts with 3 lives, and each collapse costs one. A 3-star level earns a life back.

The high-score screen has two boards:

- **Runs**: campaign runs. A run is banked when it ends, whether you clear every level, lose your last life, or quit mid-run.
- **Level records**: the best single-level score on each level across every profile, with your own best shown when someone else holds the record.
