# TODO

Features and improvements, by priority. Finished items stay checked for a release or two so the history is visible, then get pruned.

## P1: Visual fidelity and difficulty progression

### Done

- [x] **Chapter themes.** Each chapter has its own painted scene: river at golden hour, red-rock canyon with mesas and cacti, rainy flood plain with willows and muddy water, bright coast with dunes, palms and gulls, snowy mountains with capped peaks and pines, and a night city with a lit skyline and street lamps. The title demo cycles through all six.
- [x] **Weather and time of day.** Rain with rings on the water (chapter 3), falling snow (chapter 5), and night (chapter 6), where the bridge and vehicle are shaded down and headlights and taillights glow.
- [x] **Tutorial ghosts** for the first cable (4-1), ship channel (4-4) and split (4-5). A ghost may span a whole road run, and a split mark shows where a ghost lands partway along a beam. Tests build every ghost in order with the real editor.
- [x] **Bonus goals.** Every level has one (✦, worth 250 points): a cost cap, a stress cap, a parts cap or "no <material>". A proof design for each is driven across in the tests.
- [x] **Semi on a suspension bridge.** Heavy deck now has bending stiffness that yields past a small limit, so it shares a wheel load with neighboring hangers but still can't span a gap on its own. The semi crosses the level 19 suspension design at 89% peak (it was 99%).
- [x] **Level 16 without splits.** An unsplit Pratt truss costs exactly the same as the split reference: splitting is free and gives the same structure, so no cost target can separate them. Its bonus goal (26 parts or fewer, where a split beam counts once) is what makes splitting pay.
- [x] **Retune level 2-1.** New reference: a wood truss on steel struts ($5,725, 67% peak). Target $6,000, budget $8,500.
- [x] **Break effects.** Heavy deck crumbles into slabs and rubble with a dust cloud; a snapped cable whips back toward its joints with a traveling ripple.
- [x] Chapters, money budgets, career scoring, leaderboards, levels 21–30, cable levels built around one idea each, road runs, beam splitting, heavy deck, and the scene and vehicle detail passes (earlier releases).

### Next

- [ ] **Loose cost targets.** Cheaper designs than the reference cross several levels, so the target star is easy: 2-4 (road deck, $8,714 vs $11,750), 2-5 (truss with no end struts, $9,479 vs $12,000), 5-3 ($14,927 vs $17,250), 6-1 (road deck, $26,324 vs $33,250) and 6-2 ($26,899 vs $30,250). Their bonus goals currently reward those designs; consider making them the references and tightening the targets.
- [ ] **Level 29 without cables.** An all-truss design ($26,790, 89% peak) beats the suspension reference ($28,701) and the target, so "hang the middle from the pylons" is optional. Lengthen the middle span or put a ship channel under it.
- [ ] **A suspension finale with the semi,** now that the physics carries it.
- [ ] **Heavy deck on the early cable levels.** With bending, a heavy deck and just two hangers cross 4-1 and 4-2 (over target, under budget). Check that the cheaper intended answers stay the better deal.

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
