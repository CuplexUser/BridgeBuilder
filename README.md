# Bridge Builder

A physics bridge-building game for the browser. Draw a truss with a limited budget of road, wood and steel, then send a vehicle across it. The bridge either holds, sags, or snaps into the river.

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
| Lay road | One drag lays a whole run; it splits into grid pieces automatically | Same |
| Remove a member | Tap it / right-click | X or Delete at cursor |
| Material | Toolbar | 1 / 2 / 3, Q / E to cycle |
| Undo / redo | Toolbar | Z / Y (or Ctrl+Z / Ctrl+Y) |
| Test / back to edit | TEST button | T |
| Zoom / pan | Wheel, pinch, drag empty space | F refits |
| Pause | II button | P / Esc |
| Mute | Speaker button | M |

Members can cross each other (X-bracing), but they can't lie along an existing member. For example, a wood beam can't run on top of the road.

## How it works

- `src/physics/world.ts` is a small-step XPBD solver. Members are compliant distance constraints. Stress is axial force over the member's capacity; compression capacity falls off with length, like buckling. A member breaks when its smoothed stress reaches 100%. The vehicle is four particles in the same world, and its wheel contacts push load into the road members' nodes.
- `src/solutions.ts` holds a reference design per level, including the sloped levels. `tests/physics.test.ts` drives the real vehicle over each one, which guarantees all 12 levels are beatable within budget.
- `tests/storage.test.ts` runs the same behavior contract against both storage backends. The SQLite one runs against a real HTTP server on an in-memory database.
- Rendering is Canvas 2D (`src/render/`). The UI is DOM overlays (`index.html`, `src/ui/ui.ts`). All sound is synthesized with WebAudio (`src/audio.ts`).

## Scoring

Each level scores 500 for crossing, plus 100 per unused part, plus up to 400 for safety (low peak stress). You earn stars for crossing, for staying at or under par, and for a peak stress below 75%. A run starts with 3 lives, and each collapse costs one. A 3-star level earns a life back.
