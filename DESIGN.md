# Inukshuk — prototype design

Two ideas drive everything: every stone (and so every inukshuk) is one of a kind, and the figure belongs to the land it stands on.

## Scope
Personal web prototype. No gacha economy, no Play level, no Clan/Journal/Explore. Stones are cosmetic.

## Screens
- **Ridge (home)** — every inukshuk you've placed stands along one ridge, weathering in real time. Swipe sideways.
- **Build** — tray of 8 procedurally generated stones per style (river / canyon / slate), "New batch" rerolls. Free stacking under Rapier physics; a held stone passes over the others and is lifted clear before it drops. Single-finger drag, two-finger twist, wheel or Q/E to rotate; "Left 45° / Right 45°" turn the whole tray, and stones come out at that angle. 20 stones max.
  - Every time the stack settles, a save point is recorded. "Undo" returns to the previous stable state (so a collapse is one tap away from being reversed). The in-progress build and its save points persist in `localStorage` (`inukshuk.v1.build`).
  - Valid figure: two separate ground clusters (legs), one stone clear of the ground bridging them (body), whole stack still for 2 s. Arms and head are optional and inferred.
- **Preview** — Idle / Walk / Jump on a 6-bone rig (physics is gone; stones are welded to bones with spring wobble). Draft → "Place on the ridge"; saved → copy share link / remove; shared link → "Build my own".

## Living world (always the viewer's clock and time zone)
- Sky, sun, moon, stars follow the local hour.
- Season from the month, hemisphere guessed from time zone. Spring flowers, summer fireflies, autumn leaves, winter snow + snow caps.
- Weathering follows the inukshuk's age (same for everyone): lichen from day 1, moss on upward faces up to ~30 days, then stable. Never breaks.
- Animals gather as the inukshuk ages (cumulative, by the same age as weathering): squirrel 1 d, beaver 7 d, bison 30 d, moose 90 d, a pack of three wolves 180 d, grizzly 360 d. Each has idle (grazing for herbivores), walk, run and sleep; they sleep at night (wolves and beavers sometimes stay up, bears nap by day), rest beside the figure rather than behind it, scatter when it lands a jump, and drift with the ground while it walks. Shown in Preview (which zooms out to make room) and on the ridge.
- Birds perch on free flat tops during Idle in daylight and scatter when it moves.
- Sound off by default: synthesised wind tied to gusts; birds, crickets, clacks from `public/sfx` or synthesised.

## Data
- Saved in `localStorage` (`inukshuk.v1.ridge`).
- Share link `#/s/<code>`: base64url of version, creation time, and per stone style + seed + x/y/angle (11 bytes each). Stones regenerate from their seed.

## Debug
Add `?debug` to the URL: hour, age (0–400 d), season, hemisphere overrides; force an animal state; summon bird; gust; collider and bone overlays.

## Stack
Vite + TypeScript, PixiJS 8 for drawing, Rapier 2D (loaded only on Build). Deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to `main`.
