# Inukshuk — prototype design

Two ideas drive everything: every stone (and so every inukshuk) is one of a kind, and the figure belongs to the land it stands on.

## Scope
Personal web prototype. No gacha economy, no Play level, no Clan/Journal/Explore. Stones are cosmetic.

## Screens
- **Ridge (home)** — every inukshuk you've placed stands along one ridge, weathering in real time. Swipe sideways.
- **Build** — tray of 8 procedurally generated stones per style (river / canyon / slate), "New batch" rerolls. Free stacking under Rapier physics; a held stone passes over the others and is lifted clear before it drops. Single-finger drag, two-finger twist, wheel or Q/E to rotate; two-finger pinch, Ctrl+wheel (trackpad pinch) or −/+ to resize a held stone (0.5×–2×, physics follows). "Left 45° / Right 45°" turn the whole tray, and stones come out at that angle. A stone let go anywhere, the tray included, drops onto the slab; while one is held a bin appears above the tray, and dropping it there discards it for good. 20 stones max.
  - Every time the stack settles, a save point is recorded. "Undo" returns to the previous stable state (so a collapse is one tap away from being reversed). The in-progress build and its save points persist in `localStorage` (`inukshuk.v1.build`).
  - Valid figure: two separate ground clusters (legs), one stone clear of the ground bridging them (body), whole stack still for 2 s. Arms and head are optional and inferred.
- **Preview** — the finished inukshuk stands still in the living landscape (no figure animation). Below it: when building started, how long it took (time actually spent on the Build screen), stones used, times a stone was placed, and undos. Draft → "Place on the ridge"; saved → copy share link / remove; shared link → "Build my own".

## Living world (always the viewer's clock and time zone)
- Sky, sun, moon, stars follow the local hour.
- Season from the month, hemisphere guessed from time zone. Spring flowers, summer fireflies, autumn leaves, winter snow + snow caps.
- Weathering follows the inukshuk's age (same for everyone): lichen from day 1, moss on upward faces up to ~30 days, then stable. Never breaks.
- Animals gather as the inukshuk ages (cumulative, by the same age as weathering): squirrel 1 d, beaver 7 d, bison 30 d, moose 90 d, a pack of three wolves 180 d, grizzly 360 d. Each has idle (grazing for herbivores), walk, run and sleep; they sleep at night (wolves and beavers sometimes stay up, bears nap by day). They spread over the whole landscape: the ground in front of the figure (resting beside it, not behind) and the three ridges, smaller and hazier with distance and scrolling with their ridge. On the home ridge the land follows the oldest inukshuk.
- Birds perch on free flat tops in daylight.
- Sound off by default: synthesised wind tied to gusts; birds, crickets, clacks from `public/sfx` or synthesised.

## Data
- Saved in `localStorage` (`inukshuk.v1.ridge`).
- Share link `#/s/<code>`: base64url of version, finish time, build stats (v2: start time, duration, moves, undos) and per stone style + seed + x/y/angle (11 bytes each). If any stone is resized, the version byte gets the 0x80 flag and every stone carries one more byte for its size (×100). Stones regenerate from their seed. v1 links (no stats) still open.

## Debug
Add `?debug` to the URL: hour, age (0–400 d), season, hemisphere overrides; force an animal state; summon bird; gust; collider and bone overlays.

## Stack
Vite + TypeScript, PixiJS 8 for drawing, Rapier 2D (loaded only on Build). Deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to `main`.
