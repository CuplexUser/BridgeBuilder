# TODO

Features and improvements, by priority. Finished items stay checked for a release or two so the history is visible, then get pruned.

## P1: Visual fidelity and difficulty progression

### Done

- [x] **Level optimizer** (`npm run tune`). Genetic search over a structure grammar plus local polishing finds each level's cheapest robust design, then derives target, budget and bonus goal, and checks each level's intent: shortcuts fail, required materials are really needed, and there's room for more than one answer. It can also tune marked geometry. Effort levels, a time budget, live progress with time left, and checkpoints so a crashed or interrupted run resumes.
- [x] **Semi suspension margins.** The semi rides on three axles, so a hung deck no longer kinks under two concentrated wheel loads.
- [x] **Level 30 channel.** The ship channel is 2 m clear of the water, the deck climbs to bolts 2 m up the pylons, and road runs snap to any bolt they pass over, so those bolts can be used. The optimizer tried this, its preferred layout, first and kept it: trusses 2 or 3 m deep over the channel fail, and the best design ($32,370) hangs the deck from main cables.
- [x] **Heavy deck as a lesson.** Heavy deck now arrives in chapter 5 with the semi, where road can't carry the load.
- [x] **Deck weight ratings.** Road carries up to 30 t and heavy deck 60 t. The 40 t semi crushes road wherever its wheels touch, so the semi levels need heavy deck. Level cards show the vehicle's weight, the material buttons show the rating, and the collapse screen says what happened.
- [x] **Tight cost targets.** New references from sweeps over truss materials, struts and pier bracing: road trusses on 2-4 ($8,204) and 2-5 ($9,479), no end struts on 5-1 ($18,820) and 6-2 ($23,899), wood end diagonals on 5-3 ($13,222), and a road deck on 6-1 ($21,872). Targets and budgets follow, and each of these levels has a new bonus goal with a tested design.
- [x] **Level 29 needs cables.** The middle span is now 18 m (34 m overall). Trusses 2 or 3 m deep drop the truck, and one deep enough to hold costs more than the budget.
- [x] **Suspension finale.** 6-5 *Magnum Opus* is a 36 m suspension bridge for the semi, with a 20 m main span over a ship channel.
- [x] **No heavy deck on 4-1, 4-2 and 4-5.** A bare heavy deck with end struts sagged into a tension ribbon that carried the van across 4-1 and 4-5, and on 4-2 it needed only two hangers and outscored the intended design. These van levels no longer offer it, and a test checks that a bare heavy deck crosses no level.
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

- [ ] Nothing queued; see P2.

## P2: Gameplay depth

### Done

- [x] **Hydraulic rams and drawbridges.** A ram extends by 75% while the bridge opens. On a drawbridge level a tall ship sails through the channel's middle before traffic may go: the bridge opens, the ship passes (and fails the run if it touches anything), the bridge closes and the vehicles drive.
- [x] **Convoys.** Several vehicles cross nose to tail at the slowest one's speed, and all of them have to reach the goal.
- [x] **Joint strength.** Past a joint's two busiest members, the rest of their stress ratios may add up to at most 180%, or the busiest member breaks. Every hand-made design stays under it (the highest is 145%, on 2-5).
- [x] **Anchor costs.** A level can charge for building from each bolt but the two road ends, shown on the blueprint.
- [x] **Material limits.** A level can cap the parts of a material; the toolbar shows how many are left. The cable levels 4-1, 4-3, 5-2, 5-5 and 6-3 use them to rule out a truss under the deck, which the optimizer found could otherwise cross them without cables.
- [x] **Chapter 7, Moving Parts**, with a harbor theme: *Bascule* (first drawbridge), *Convoy* (three vans, six steel parts), *Toll Bridge* ($1,000 per bolt), *Harbor Gate* (a fixed span, then a leaf) and *Rush Hour* (car, van and dump truck over one ram).

### Next

- [ ] Ideas: double-leaf bascules, lift bridges, a swing bridge, and a ship that has to wait for traffic instead of the other way around.

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
