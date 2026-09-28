# TODO

Features and improvements, by priority. Finished items stay checked for a release or two so the history is visible, then get pruned.

## P1: Visual fidelity and difficulty progression

### Done

- [x] Even-grade road runs: a sloped run is one straight line, with no grid steps.
- [x] Beam splitting: attach new members anywhere along a beam, with no extra part cost.
- [x] New materials: heavy deck (drivable, strong, heavy) and cable (tension only, 10 m reach).
- [x] Supporting structures: lattice pylons (`towers`) and rock overhangs (`overhangs`) as anchor points.
- [x] Levels 13–20: cable-stayed, cliff-hung, suspension and 32 m spans, plus a semi truck.
- [x] Budget and par rebalance. Par equals the reference part count, and slack over par shrinks from +1 early to +3 late.
- [x] Scene pass: drifting clouds, mountain range, trees and grass, bridge reflections on the water.
- [x] Member pass: deck slab edges, continuous lane dashes, guard rails, wood grain, steel I-beam flanges and rivets, braided cables that sag when slack, gusset plates, a pulsing glow near failure.
- [x] Vehicles: semi truck, headlight beams, tail lights, five-spoke wheels, tire dust and landing puffs.
- [x] Build mode: diamond markers for off-grid joints, attach-point hints, split cross-hairs, grade % and the invalid reason in the drag label.
- [x] High scores: a run is banked even when you quit mid-run, a per-level records board, and your own entries are highlighted.

### Next

- [ ] **Chapters with themes.** Group the 20 levels into 4 chapters (River, Canyon, Coast, Mountain pass), each with its own sky, palette, water and tree set. Show chapter headers on the level select.
- [ ] **Tutorial ghosts for new mechanics.** Level 1 has a ghost hint. Add the same kind of hint for the first cable (13) and the first split (16).
- [ ] **Per-level challenge goals** (optional fourth star), such as "under 12 parts", "no steel", or "peak stress below 50%".
- [ ] **Harder cable levels.** The cable reference solutions peak near 20–40% stress, so they are about finding the right geometry, not strength. Add wind gusts, heavier traffic or tighter cable budgets on 18–20.
- [ ] **Retune level 5.** With the even grade, its reference peak dropped from 86% to 32%. Tighten its steel budget, or raise the far bank.
- [ ] **Weather and time of day** per chapter: rain streaks, snow, night with working headlights.
- [ ] **Better break effects.** Heavy deck crumbles into chunks, and a snapped cable whips.

## P2: Gameplay depth

- [ ] **Money budget.** Replace piece counts with a cost per meter per material, like classic bridge builders. Tune so wood is cheap, steel dear, and cable cheap per meter.
- [ ] **Hydraulic members** that extend or contract during the run, for drawbridge levels with boat traffic.
- [ ] **Multiple vehicles per level**, such as a convoy, or a car then a truck.
- [ ] **Clearance zones.** A boat or a train passes under the bridge, so members can't enter a marked area.
- [ ] **Joint strength.** Joints fail when too many heavily loaded members meet, which rewards clean load paths.
- [ ] **Anchor costs.** Some levels charge for using an anchor, which pushes players toward fewer, better supports.

## P3: Polish and social

- [ ] **Replay and ghost** of your best run, plus a slow-motion replay of the moment of collapse.
- [ ] **Stress graph** after a run: the peak member over time, with a tap to highlight it on the bridge.
- [ ] **Design sharing** through a short code or URL that loads a design into practice mode.
- [ ] **Level editor** built on the same `LevelDef` format, with export and import.
- [ ] **Level records detail.** Store part count and peak stress with each record, and show the record holder's design.
- [ ] **Quit confirmation** during a run that shows how many points will be banked.
- [ ] **Accessibility.** A color-blind-safe stress palette (with patterns, not just hue), a reduced-motion mode that turns off shake and wobble, and a larger-UI option.

## P4: Tech

- [ ] Profile physics on the 32 m levels on low-end phones. If needed, lower substeps adaptively, or move the simulation to a worker.
- [ ] An end-to-end smoke test in headless Chromium: build a bridge with the keyboard, test it, and check the result screen.
- [ ] Cache static scene layers (mountains, trees, banks) in offscreen canvases per level and camera zoom level.
- [ ] Save format versioning for designs, so budget or material changes can migrate old saves instead of discarding them.
