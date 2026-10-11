# TODO

Features and improvements, by priority. Finished items stay checked for a release or two so the history is visible, then get pruned.

## P1: Visual fidelity and difficulty progression

### Done

- [x] **Level optimizer** (`npm run tune`). Genetic search over a structure grammar plus local polishing finds each level's cheapest robust design, then derives target, budget and bonus goal, and checks each level's intent: shortcuts fail, required materials are really needed, and there's room for more than one answer. It can also tune marked geometry. Effort levels, a time budget, live progress with time left, and checkpoints so a crashed or interrupted run resumes.
- [x] **Level verifier** (`npm run verify`). Checks every level in about two minutes without optimizing: it drives the tuner's stock starting designs and seeded random ones, plus the reference, ghost and shortcuts, and reports stale tuning, a lesson that probes get around, probes that undercut the reference, free bonus goals, hazards that hardly bite, broken ghosts, bad level data and chapter part ranges that don't fit.
- [x] **Normal-effort tuning of levels 46–50, 55 and 56–70.** All 21 tuned and passing their checks in 3 h 44 min. The searches found cheaper references on several levels, such as *Parade* ($38,141 instead of $69,819) and *Viaduct*, whose reference peaks at 49% instead of 79%. Chapter part ranges were widened to fit.
- [x] **Arch rings with mortared joints that crack and hinge.** Each wedge block of a ring has its own corners and meets its neighbors through a mortared face that holds each edge shut up to 25 kN of pull. Past that the mortar cracks for good (drawn as a dark seam) and the joint only presses from then on, so it gapes on one edge and hinges on the other like a real voussoir. Thrust and point loads now matter. A bare 18 m ring holds 10 t hung at quarter span and folds under 20 t. A flat 16 m arch for a truck that held at 20% now works at 94%, and two rows of block struts against the bank walls bring it back to 21%. *Great Arch* peaks at 68% under the semi on a ring sprung from three-block towers (the old four-block towers left it at 92%), and *Hanging Deck*'s through arch rose from 17% to 47%. The seven arch levels were quick-tuned again, and their free stress bonuses became cost goals: the tuner no longer keeps an old bonus goal that the reference already meets.
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
- [x] **Arch levels reworked.** Chapter 10's five levels no longer all fall to block towers with an arch between them and posts on top. *Keystone* stays as the ghost of that classic form; *Hanging Deck* has no rock below, so the arch springs from the bank bolts, rises over the road and carries the deck on hangers; *High and Low* springs from shelves at different heights; *Short Supply* allows four blocks, which crack out on the shelves but hold stacked against the walls; and *Grand Viaduct* takes a semi over deck arches to island piers built up to the road, with a through arch over the ship channel between them. An arch's default rise now stays under the level's height limit, and the optimizer can lay an arch over the road and build piers up to the deck.
- [x] **Chapters of seven, and two ways to see them.** The 70 levels sit in ten chapters of seven, ordered by difficulty with each topic's levels together where they can be and its ghost first, so no level uses a mechanic before it is taught; five new levels fill the last chapter. Levels keep their topic's scene. The chapters screen is a **map**, one winding road of level nodes chapter by chapter with the next level lit and the locked ones ahead, or a **book** of chapter cards six to a page, turned by arrows, swipe, dots or ←/→; V switches, and the choice is remembered. Challenges are all seven levels in a row, on fresh boards (the five-level ones stay in storage, unseen). Stars, records and saved designs carry over, since they are keyed by level id. Keys 1–9 and 0 open chapters, Enter plays the next level.
- [x] Chapters, money budgets, career scoring, leaderboards, levels 21–30, cable levels built around one idea each, road runs, beam splitting, heavy deck, and the scene and vehicle detail passes (earlier releases).

### Next

- [ ] **Cheaper hand-made designs where they set a lenient star target.** A star target never goes under the hand-made design, so where that design costs far more than the best one, three stars come easy. `npm run verify` flags the levels whose target sits over 60% above the reference: *Parade* (10-2, 187%: $109,308 against $38,141), *Down the Gorge* (2-4, 79%), *Signal Stop* (6-4, 78%), *The Long Way* (9-2, 67%), *Aftershock* (9-7, 64%) and *Flash Flood* (7-1, 61%). A cheaper hand design for each, then a re-derive (no new search), brings their targets down.

## P2: Gameplay depth

### Done

- [x] **Modern Works, a new chapter 10** (played before the finale, which becomes 11; ids stay put, and players see a chapter's place in the order). Seven levels: *Tendon* (a ghost), *Two Spans*, *Double Bascule*, *Lift Bridge*, *Double Deck*, *Swing Bridge* and *Ship Waits*. Each has a hand-made design and shortcuts that must fail, and the optimizer builds block girders with tendons and double decks.
- [x] **Prestressed concrete.** Every concrete block now has mortared joints like an arch ring's, so a beam of blocks cracks where it is pulled apart. A tendon is a steel strand threaded through blocks from corner to corner and pulled to 250 kN as the test starts. Measured on a two-block girder over a 14 m channel for a truck: the plain girder breaks, and one with a tendon low holds at 66%. Over two 12 m spans for a semi, a tendon low breaks over the middle pier, but one along the middle of the beam holds at 71%. A tendon at the very bottom of a one-block beam cracks its top, just as a real one outside the middle third would.
- [x] **Two-track railway, as a double deck.** A lower deck (`lower`) with its own traffic coming out of a tunnel in each bank. On a 16 m crossing with a truck above a locomotive and wagon, posts alone fail and so does a web alone; a Warren web between the decks plus a truss over the road holds at 78%.
- [x] **Harder hazards.** Each one now bites where it should:
  - The quake can sweep its frequency (`sweep`; Aftershock shakes from 0.5 to 3 Hz), which breaks the old reference while braced towers hold.
  - The gale can flutter (`flutter`), feeding a deck's own bounce: Gale now needs a stiffening truss, and Storm Parade more dampers.
  - Brake levels can put the road ends on sliding bearings (`sliding`), so Signal Stop must be braced to its low bolts both ways.
  - Floods push at about real drag (2000 N per meter under water) and carry driftwood logs that ram whatever stands in the stream.
  - The verifier counts the hand-made design among what a hazard must bite, and its remaining hazard warnings are listed under Next.
- [x] **Double-leaf bascules, lift bridges, swing bridges and a ship that waits.**
  - A center lock (`lock`) holds two leaves level while shut.
  - Guide towers (`lift`) let rams raise a span straight up, where two upright rams alone sway like a parallelogram.
  - A swing bridge (`swing`) turns aside on two pivot bolts, its ends lifting off the banks, so it must hang as a balanced cantilever.
  - `ship.after` sends the traffic first and wins only once the ship is through.
- [x] **Dynamics: march, wind and earthquakes.** The damper, a hydraulic member with a soft spring that fights fast motion; squads of soldiers marching in step; gusts that push on members and lift the deck; and an earthquake that starts when the lead vehicle reaches a mark. Five levels in a storm scene: *Slow March* (a ghost of dampers under a footbridge), *Gale* (tie the deck down; heavy deck is no longer offered, since a bare heavy deck carried the van), *Aftershock*, *Parade* and *Storm Parade*. Test drives last long enough for slow convoys (`testSeconds`), so the optimizer gets the squads across, and it can brace a deck with dampers.
- [x] **Foundations: mud, piles and floods.** Bolts on mud sink once they carry more than 15 kN; nothing can be built inside the mud; piles, driven onto it on whole meters at the level's price, never sink; and a flood raises the river, pushes on what stands in it and scours out bolts on the mud. Five levels in a new river delta scene: *Mudflats* (a ghost: one pile), *Soft Ground*, *Flash Flood*, *Long Flats* and *Floodtide*. The optimizer drives piles on the even meters of the mud and checks that a level can't be crossed without them (`requires: ['piles']`). The level editor paints mud by dragging and sets the pile price and a flood.
- [x] **Grand Finale**, five new levels that each combine two lessons: *Great Arch* (a 36 m block arch for the semi), *Washout Line* (a train over flooding mud), *Marsh March* (dampers on the free mud bolts hold where stiff props sink), *Delta Haul* (a semi over a flooding delta) and *Last Crossing* (48 m for the semi over a delta in flood, with a ship channel).
- [x] **Hydraulic rams and drawbridges.** A ram extends by 75% while the bridge opens. On a drawbridge level a tall ship sails through the channel's middle before traffic may go: the bridge opens, the ship passes (and fails the run if it touches anything), the bridge closes and the vehicles drive.
- [x] **Convoys.** Several vehicles cross nose to tail at the slowest one's speed, and all of them have to reach the goal.
- [x] **Joint strength.** Past a joint's two busiest members, the rest of their stress ratios may add up to at most 180%, or the busiest member breaks. Every hand-made design stays under it (the highest is 145%, on 2-5).
- [x] **Anchor costs.** A level can charge for building from each bolt but the two road ends, shown on the blueprint.
- [x] **Material limits.** A level can cap the parts of a material; the toolbar shows how many are left. The cable levels 4-1, 4-2, 4-3, 5-2, 5-5, 6-3 and 6-4 use them to rule out a truss under the deck, which the optimizer found could otherwise cross them without cables; 4-2 also allows only four cables.
- [x] **Chapter 11, Railway: trains.** A locomotive and freight wagons, coupled into one long, heavy train that runs on track only. Track is a new deck that climbs 3% at most. Rail wheels drive and brake against the deck, so a brake stop on the bridge shoves it along its length. Five levels on the prairie: *Branch Line* (a ghost), *Freight* (four cars over a pier), *Gentle Grade* (banks at different heights), *Signal Stop* (the train stops out on the span) and *Viaduct* (block arches for the railway). Toolbar keys now number the level's own materials.
- [x] **Chapter 10, Arches: concrete blocks.** A block brush paints 1 m concrete blocks that take huge compression, crack when pulled apart, and bear on rock by friction without being bolted to it. A block arch tool lays a ring of wedge blocks in one drag, with a handle at its crown for the rise. Levels have rock shelves and islands to build on. Five levels in a limestone gorge: *Keystone* (a ghost), *Stepping Stones* (two arches meeting on an island pier), *High and Low*, *Deep Gorge* (towers of blocks up from deep shelves) and *Grand Viaduct* (a semi over three arches). The optimizer stacks towers on the rocks and springs arches between them. A 40 m road drag now lands on 2 m joints, so 9-1's hinted hangers line up with the main cable.
- [x] **Chapter 9, Main Cable: very long spans.** A main cable laid in one drag as a smooth curve, its joints above the deck joints, with a ring to drag its sag deeper or shallower; it counts as one part and comes off whole. Concrete, five times steel's crushing strength but weak in tension, for tall towers. Levels may set heavier concrete anchors, and the bank bolts hold no cables where anchors are offered. Five levels of 40 to 64 m in a golden bay: *Saddle* (a ghost on hinged masts), *Concrete Pylons*, *One Tower*, *Uneven Banks* and *Tall Ships* (a semi over a ship channel, two anchors a side). The optimizer raises pylons and lays main cables, and the chapter select fits all nine chapters on a phone without scrolling.
- [x] **Concrete anchors and hinged masts.** Drag a member onto a bank to set a 5 t concrete block there ($1,500). It holds until the pull beats its weight, friction and the soil, so a steep backstay lifts it and a flat one slides it, then it tears out of its pit and drags. Masts stand on hinges and tip over unless backstayed. Chapter 8, *Anchorage*, has five levels in a new fjord scene: *Deadweight*, *Lift-Off*, *Raise Your Own* (brace your own towers), *Side Spans* and *Anchorage* (a semi that needs two blocks per side). The level editor has a Mast tool and an anchor-strip setting, and the optimizer builds towers and backstays.
- [x] **Chapter 7, Moving Parts**, with a harbor theme: *Bascule* (first drawbridge), *Convoy* (three vans, six steel parts), *Toll Bridge* ($1,000 per bolt), *Harbor Gate* (a fixed span, then a leaf) and *Rush Hour* (car, van and dump truck over one ram).

### Next

- [ ] **Two trains passing:** the side-by-side half of the two-track idea, two trains crossing in opposite directions on one deck line. The double deck (one over the other) is done.
- [ ] **Balanced cantilever in prestressed concrete:** girder arms built out from a pier with their tendons along the top, the other classic shape a tendon makes possible.
- [ ] **Floods on the piled finale levels.** On *Washout Line*, *Delta Haul* and *Last Crossing* the piled bridges stand well clear of the driftwood and shrug off the current, so their floods add little; the mud is what those levels test. A higher flood that reaches the deck, or a level with posts out in the stream, would let it bite.

## P3: Polish and social

### Done

- [x] **Engineer's review.** The result card compares the cost with the best known design ("14% above the best known design ($8,204)"). Hints in the briefing each reveal one member of that design as a ghost, for 100 points off every score on the level.
- [x] **Efficiency view.** After a crossing, parts that never passed 20% load and steel that wood could carry under 75% are counted on the result card with their cost, and marked on the blueprint until the bridge changes.
- [x] **Level records detail.** Each best score keeps its bridge's cost, peak stress and design. The Levels board shows them, and Watch it drives the record bridge for anyone who has crossed the level.
- [x] **Quit confirmation** during a challenge, saying how many points go on the board.
- [x] **Level briefing.** Each level opens with a card listing the three stars, the bonus goal with what it means, and the level's special rules; the ⓘ button or I reopens it. The bonus goal under the level name is clickable and shows ✓ or ✗ live for cost, parts and banned materials, with the current part count.
- [x] **Stress graph** after a run: the busiest member's load over time with the safety and breaking lines, breaks and drawbridge phases. Tap the graph to ring that moment's busiest member on the bridge, or tap a member to see its own curve.
- [x] **Easier drawbridge intro and roomier budgets.** 7-1's ghost is the whole working bridge, tutorial levels can play an example first, and the ram is magenta and drawn as a cylinder so it can't be mistaken for wood. Targets now sit 18–30% over the optimizer's best (never below the hand-made design) and budgets 55–100% over.
- [x] **Chapter list without a scrollbar** on desktop: four columns, the challenge button in each card's corner, and thin dark scrollbars wherever one is still needed.
- [x] **Level editor** on the same `LevelDef` format: bolts, piers, pylons, ship channels, vehicles and convoys, drawbridges, materials and limits, budget, target, tolls, bonus goal and scene. Playtest without touching the career; export and import as JSON. Custom levels live in the browser.

### Next

- [ ] **Replay and ghost** of your best run, plus a slow-motion replay of the moment of collapse. The stress graph could scrub through it.
- [ ] **Design sharing** through a short code or URL that loads a design. Custom levels could share the same way.
- [ ] **Level editor extras:** rock overhangs and raised road ends as tools, a solvability check that runs the optimizer on a custom level, and saving custom levels to the server profile.

Let the optimizer teach:

- [ ] **Verified community levels.** On top of design sharing: upload custom levels to the server, run the optimizer before publishing, and set budget and target from it. Every community level gets a *Verified solvable* badge and fair numbers without its creator balancing anything. Builds on `src/autotune.ts`.

## P4: Platforms and tech

- [ ] **Desktop and Android from one codebase.** Keep a single game codebase and add two build targets rather than forking:
  - **Desktop:** the web build, optionally packaged with Tauri or Electron. Full keyboard and mouse, denser UI, and room for larger levels.
  - **Android:** the same web build wrapped with Capacitor, with a touch-first UI profile, native storage, and app-store packaging.
  - Put platform differences (input, UI density, storage, level caps) behind one small `platform` module.
- [ ] Profile physics on the 30 m+ levels on low-end phones. If needed, lower substeps adaptively, or move the simulation to a worker.
- [x] **End-to-end smoke test** (`npm run smoke`): a headless Chrome or Edge builds 1-1 with the keyboard, tests it, and checks the result screen and leaderboards, against its own dev server and database.
- [x] **Batched member painting.** Measured first: with the CPU slowed 4×, a test drive on 9-5 spent 1.4 ms of a 21 ms frame on the static scenery (hills, trees, banks), so caching it wasn't worth it, and 11 ms painting members a few strokes at a time. Members and joints are now painted a few strokes per material and shade, which brought that to under 5 ms. Physics is most of what's left.
- [ ] **Android extras.** The Play upload still waits on account verification.
  - **Haptics synced to stress:** a light buzz as members creak, a hard pulse when something snaps (Capacitor Haptics).
  - **Collapse clip export:** record the last seconds of the canvas with MediaRecorder and share the video through the share sheet. Collapses are the best marketing material.
  - **Play Games Services:** achievements, cloud save and sign-in, so Android players reach the server leaderboards without the name-based profile.
  - **Monetization:** the first two or three chapters free, then a one-time unlock for the rest and future chapters. No ads while building; they kill a puzzle game's flow.
- [x] **Save format versioning.** Designs carry a version, and a saved design is fitted to a changed level instead of discarded: what no longer fits comes off and the player is told, and an over-budget bridge loads for trimming.
