# Bridge Builder

A physics bridge-building game for the browser. Build a bridge within a cash budget from road, heavy deck, wood, steel and cable, then send a vehicle across it. The bridge either holds, sags, or snaps into the river.

There are 30 levels in six chapters that get harder as you go: from a 4 m brook in *Groundwork* to a 36 m, forty-tonne crossing in *Master Works*. Along the way the game introduces piers, slopes, heavy decks, lattice pylons, rock overhangs, cables, flood water and ship channels. `TODO.md` lists planned features and improvements by priority.

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
| Road | $180/m | 2.25 m | Drivable, laid in runs. |
| Heavy deck | $380/m | 2.25 m | Drivable, laid in runs. About twice as strong and stiff as road, but heavier. For trucks and long spans. |
| Wood | $90/m | 3.2 m | Light and cheap. Buckles early in compression. |
| Steel | $240/m | 4.25 m | Strong in tension and compression. |
| Cable | $140/m | 10 m | Tension only: it goes slack instead of pushing. Hang decks from pylons and overhangs. |

You pay by length, so splitting a beam to add a joint costs nothing. Each level lists the materials it offers.

## How it works

- `src/physics/world.ts` is a small-step XPBD solver. Members are compliant distance constraints. Stress is axial force over the member's capacity; compression capacity falls off with length, like buckling. A member breaks when its smoothed stress reaches 100%. The vehicle is four particles in the same world, and its wheel contacts push load into the road members' nodes.
- `src/levels.ts` defines the levels; `src/chapters.ts` groups them into chapters and holds the unlock rules. Level ids are stable, and chapters list them in play order, so saved progress survives reordering.
- `src/solutions.ts` holds a reference design per level. `tests/physics.test.ts` drives the real vehicle over each one. That guarantees all 30 levels are beatable within their target cost, and that every reference design follows the editor's build rules. Each level's budget is the reference cost times a slack factor that shrinks by chapter (×1.6 down to ×1.22), and the target is about 5% above the reference cost. The same file checks that the obvious shortcut designs on the cable levels fail.
- `tests/storage.test.ts` runs the same behavior contract against both storage backends. The SQLite one runs against a real HTTP server on an in-memory database.
- Rendering is Canvas 2D (`src/render/`). The UI is DOM overlays (`index.html`, `src/ui/ui.ts`). All sound is synthesized with WebAudio (`src/audio.ts`).

## Chapters, scoring and leaderboards

**Chapters.** The first chapter is open from the start. A chapter opens once every level of the previous one has been crossed, and inside a chapter the levels open one after another. **Continue** on the title screen takes you to the first level you haven't crossed yet.

**Level score.** 500 for crossing, plus up to 1,000 for money left in the budget, plus up to 400 for safety (low peak stress). You earn stars for crossing, for building at or under the target cost, and for a peak stress below 75%. Free play has no lives: collapse, tweak and try again. Your saved design for each level comes back when you return.

**Career.** Your career score is the sum of your best score on every level. Improving any level raises it, so you never need to replay from the start.

**Chapter challenges.** A finished chapter unlocks its challenge: all five levels in a row, from blank designs, with three lives. Each collapse costs a life, and a 3-star crossing earns one back. The run's total goes on that chapter's challenge board, even if you quit part-way.

**Leaderboards** have four tabs:

- **Career**: every engineer, ranked by career score.
- **Chapter**: ranked by best scores on one chapter's five levels.
- **Levels**: the record holder on each level of a chapter, with your own best when someone else holds it.
- **Challenges**: the top challenge runs on one chapter.
