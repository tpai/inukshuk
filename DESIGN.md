# Inukshuk — prototype design

Two ideas drive everything: every stone (and so every inukshuk) is one of a kind, and the figure belongs to the land it stands on.

## Scope
Personal web prototype. No gacha economy, no Play level, no Clan/Journal/Explore. Stones are cosmetic.

## Screens
- **Ridge (home)** — every inukshuk you've placed stands along one ridge, weathering in real time. Swipe sideways.
- **Build** — tray of 8 procedurally generated stones per style (river / canyon / slate), "New batch" rerolls. Free stacking under Rapier physics. Tap or drag a stone to select it: the build enters editor mode and gravity pauses for every stone, so nothing moves on its own. Dragging moves the selected stone (it passes through the others), and the drag can start anywhere off the other stones, not just on it; a tap there without moving deselects; the floating bar turns it 15°, resizes it (0.5×–2×, physics follows) or discards it. Deselecting doesn't bring gravity back; you can arrange several stones while frozen. "✓ Check" (in place of Done while frozen, or Enter) leaves editor mode: stones moved during it are lifted clear of real overlaps, gravity returns, and the stack shows whether it stands. Two fingers turn or resize, locked to whichever the gesture clearly starts as; also wheel / Q/E to turn, Ctrl+wheel or −/+ to resize, Delete discards, Esc deselects. Stones come out of the tray upright and already selected. 20 stones max.
  - Every time the stack settles, a save point is recorded, and in editor mode every edit (a drag, a turn, a resize, a discard, a stone from the tray; wheel and key turns coalesce) is a step of its own. "Undo" walks back one step at a time: through an edit, still frozen, then to the state editing began from; after Check, to the last arrangement (so a collapse is one tap away from being reversed). The in-progress build and its steps (up to 100) persist in `localStorage` (`inukshuk.v1.build`).
  - Valid figure: two separate ground clusters (legs), one stone clear of the ground bridging them (body), whole stack still for 2 s. Arms and head are optional and inferred.
- **Preview** — the finished inukshuk stands still in the living landscape (no figure animation). Below it: when building started, how long it took (time actually spent on the Build screen), stones used, times a stone was placed, and undos. Draft → "Place on the ridge"; saved → copy share link / remove / edit. "Edit" puts its stones back on the Build slab (a second tap is needed if it would replace a different unfinished build); finishing replaces it on the ridge ("Update it on the ridge"), keeping its id and first-finished date (so its age and weathering carry on), with time, moves and undos adding to its stats. Opening a share link puts that inukshuk on the viewer's own ridge (once: the same link, or a link to one already there, finds the existing one) and then shows it like any saved one, marked "Someone left this here".

## Living world (always the viewer's clock and time zone)
- Sky, sun, moon, stars follow the local hour.
- Season from the month, hemisphere guessed from time zone. Spring flowers, summer fireflies, autumn leaves, winter snow + snow caps.
- Weathering follows the inukshuk's age (same for everyone): lichen from day 1, moss on upward faces up to ~30 days, then stable. Never breaks.
- Animals gather as the inukshuk ages (cumulative, by the same age as weathering): squirrel 1 d, beaver 7 d, bison 30 d, moose 90 d, a pack of three wolves 180 d, grizzly 360 d. Arrivals while you watch turn up at random spots in the landscape, one at a time, fading in (no walking in from the edge). Each has idle (grazing for herbivores), walk, run and sleep; they sleep at night (wolves and beavers sometimes stay up, bears nap by day). They spread over the whole landscape: the ground in front of the figure (resting beside it, not behind) and the three ridges, smaller and hazier with distance and scrolling with their ridge. On the home ridge the land follows the oldest inukshuk.
- Birds perch on free flat tops in daylight.
- Sound off by default: synthesised wind tied to gusts; birds, crickets, clacks from `public/sfx` or synthesised.

## Data
- Saved in `localStorage` (`inukshuk.v1.ridge`).
- Share link `#/s/<code>`: base64url of version, finish time, build stats (v2: start time, duration, moves, undos) and per stone style + seed + x/y/angle (11 bytes each). If any stone is resized, the version byte gets the 0x80 flag and every stone carries one more byte for its size (×100). Stones regenerate from their seed. v1 links (no stats) still open.

## Debug
Add `?debug` to the URL: hour, age (0–400 d), season, hemisphere overrides; force an animal state; summon bird; gust; collider and bone overlays.

## Stack
Vite + TypeScript, PixiJS 8 for drawing, Rapier 2D (loaded only on Build). Deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to `main`.
