# TODO

Features and improvements, by priority. Finished items stay checked for a release or two so the history is visible, then get pruned.

## P1: Visual fidelity and difficulty progression

### Done

- [x] **Chapters.** 30 levels in six chapters of rising difficulty (Groundwork → Master Works). A chapter opens when the previous one is finished; levels inside open one by one. There's a chapter map, a per-chapter level list, and Continue on the title screen.
- [x] **Money budget.** Materials are priced per meter, each level has a budget and a target cost, and every level offers several materials, so there are real design options.
- [x] **Career scoring.** Your career score is the sum of your best score on every level, so nothing has to be replayed from the start. Chapter challenges (five levels in a row, three lives) have their own boards.
- [x] **Leaderboards.** Tabs for career, chapter, level records and challenges, with a chapter picker.
- [x] **Ten new levels (21–30).** They add flood water with no room below the deck, a ship channel the deck must ramp over, a steep 20% climb, a cliff-to-pylon crossing, deep-pier trestles, and 24–36 m semi-truck trusses.
- [x] **Cable levels built around one idea each.** Tests check that the obvious shortcuts fail or overrun the budget.
- [x] **Even-grade road runs and beam splitting.** Deleting any piece of a split beam removes the whole beam.
- [x] **Heavy deck and cable materials; lattice pylons, rock overhangs and ship channels as level features.**
- [x] **Scene, member and vehicle detail passes.** Clouds, mountains, trees and water reflections. Guard rails, wood grain, steel flanges and joint plates. Detailed bodies and wheels for all five vehicles.

### Next

- [ ] **Chapter themes.** Give each chapter its own sky, palette, water and tree set (river, canyon, flood plain, coast, mountains, night city).
- [ ] **Tutorial ghosts for new mechanics.** Level 1 has a ghost hint. Add the same kind of hint for the first cable (4-1), the first split (4-5) and the first ship channel (4-4).
- [ ] **Per-level bonus goals** (optional fourth star), such as "no steel", "under $X" or "peak stress below 50%".
- [ ] **Semi on a suspension bridge.** In testing, the semi only crossed a suspension design at 99% stress. It needs stiffer cable physics, or deck bending stiffness, before a suspension finale can use it.
- [ ] **Level 16 without splits.** Check whether a Warren or K-truss comes in under target without splitting beams. If so, tighten the target so splitting stays the key idea.
- [ ] **Retune level 2-1 (Uphill Climb).** With the even grade, its reference peak stress dropped from 86% to 32%.
- [ ] **Weather and time of day** per chapter: rain streaks, snow, night with working headlights.
- [ ] **Better break effects.** Heavy deck crumbles into chunks, and a snapped cable whips.

## P2: Gameplay depth

- [ ] **Hydraulic members** that extend or contract during the run, for drawbridge levels with boat traffic.
- [ ] **Multiple vehicles per level**, such as a convoy, or a car then a truck.
- [ ] **Joint strength.** Joints fail when too many heavily loaded members meet, which rewards clean load paths.
- [ ] **Anchor costs.** Some levels charge for using an anchor, which pushes players toward fewer, better supports.
- [ ] **Material limits as puzzle modifiers**, such as "wood only" or "no more than 4 cables", layered on top of the money budget for selected levels.

## P3: Polish and social

- [ ] **Replay and ghost** of your best run, plus a slow-motion replay of the moment of collapse.
- [ ] **Stress graph** after a run: the peak member over time, with a tap to highlight it on the bridge.
- [ ] **Design sharing** through a short code or URL that loads a design.
- [ ] **Level editor** built on the same `LevelDef` format, with export and import.
- [ ] **Level records detail.** Store cost and peak stress with each record, and show the record holder's design.
- [ ] **Quit confirmation** during a challenge, showing how many points will be banked.
- [ ] **Accessibility.** A color-blind-safe stress palette (with patterns, not just hue), a reduced-motion mode that turns off shake and wobble, and a larger-UI option.

## P4: Platforms and tech

- [ ] **Desktop and Android from one codebase.** Keep a single game codebase and add two build targets rather than forking:
  - **Desktop:** the web build, optionally packaged with Tauri or Electron. Full keyboard and mouse, denser UI, and room for larger levels.
  - **Android:** the same web build wrapped with Capacitor, with a touch-first UI profile, native storage, and app-store packaging.
  - Put platform differences (input, UI density, storage, level caps) behind one small `platform` module.
- [ ] Profile physics on the 30 m+ levels on low-end phones. If needed, lower substeps adaptively, or move the simulation to a worker.
- [ ] An end-to-end smoke test in headless Chromium: build a bridge with the keyboard, test it, and check the result screen and leaderboards.
- [ ] Cache static scene layers (mountains, trees, banks) in offscreen canvases per level and camera zoom level.
- [ ] Save format versioning for designs, so price or material changes can migrate old saves instead of discarding them.
