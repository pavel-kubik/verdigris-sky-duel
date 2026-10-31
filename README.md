# Verdigris Sky Duel

A procedural low-poly green dragon built from primitives in Three.js, with an orbit preview and an aerial fight mode against waves of crimson wyverns.

**Mobile first.** The game is designed and built for touch phones first (portrait and landscape); desktop keyboard and mouse stay supported with lower priority. Every action has a touch control, on-screen texts on touch name the buttons rather than keys, layouts are checked at phone width (390 x 844) first, and performance budgets target a mid-range phone.

- **Play solo:** https://pavel-kubik.github.io/verdigris-sky-duel/
- **Play co-op (beta):** https://pavel-kubik.github.io/verdigris-sky-duel/mp/

## Learn to fly (tutorial)

New players start with **Learn to fly** on the home screen. Nine short lessons unlock the controls one at a time, using golden rings and practice chickens as targets:

| # | Lesson | Goal |
|---|---|---|
| 1 | Steering | Turn through 4 rings (left / right only) |
| 2 | Climb and dive | 5 rings at different heights, optional inverted up / down |
| 3 | Finding your way | Follow the edge arrows and radar to rings behind you |
| 4 | Boost | Boost 2.5 s and reach two distant rings |
| 5 | Fire breath | Roast a chicken on a floating rock |
| 6 | Dinner time | Fly into the roast to eat it (+15 vitality) |
| 7 | Fireball | Roast two chickens with auto-aimed fireballs, then eat them |
| 8 | Barrel roll | Dodge 3 sparks from a practice wisp |
| 9 | Chicken hunt | Roast and eat 3 flying chickens |

Nothing can hurt the dragon during the tutorial. Each lesson opens with a paused briefing; the pause menu can restart or skip a lesson. Afterwards the player can start the duel or keep practicing. Completion and the invert setting are stored in `localStorage`, and the invert setting also applies to the duel. The co-op mode (`/mp/`) is unchanged.

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Turn | A / D | Left stick |
| Climb / dive | W / S | Left stick |
| Fire breath (hold) | Space / left mouse | Breath |
| Fireball (auto-aim) | F / right mouse | Ball |
| Boost | Shift | Boost |
| Barrel roll (dodge) | Q / E | Roll |
| Pause | Esc | II |

The campaign adds **Grab** (G / Grab button, hold), **Eat** (X / Eat button, hold), **Land / take off** (F / Land button) and walking, and uses the same flight controls - see [Campaign](#campaign-alpha-campaign) below.

Single static `index.html`, no build step. Three.js r128 is loaded from cdnjs.

## Campaign (alpha, `/campaign/`)

- **Play:** https://pavel-kubik.github.io/verdigris-sky-duel/campaign/ (or **Campaign (alpha)** on the home screen)

A single-player dragon campaign in its own page, built mobile first: everything plays on a touch phone, and every keyboard action has a touch button. **Phase 1 (Survival MVP)** and **Phase 2 (Kingdom + hoard)** are done. A hatchling hatches next to its mother, learns to fly and hunt from her, grows into a **Drake** in the **Ash Wastes** and **Wildwood**, then raids the Order's settlements in the **River Farmlands** for gold, carries it home into its cave and spends it on upgrades. Later phases (missions, Highlands, Lowlands, endgame) are planned in [`ai_sdlc/001_campaign/000_spec.md`](ai_sdlc/001_campaign/000_spec.md).

- **Mother:** she flies with the hatchling, leads it to a herd and teaches each skill once (a caption at the top); after the lessons she flies off and comes back to visit now and then.
- **Hunting:** fly low over a herd and hold Grab to swoop and grab prey, then hold Eat to eat it in flight. A hatchling can lift goats and deer; a boar is too heavy and fights back - roast it with fire breath and eat the roast chunks (half the food).
- **Hunger:** drains over time and faster when boosting or breathing fire. Fed regenerates vitality, Hungry slows fire regen, Starving makes the dragon slow, without fire and slowly losing vitality.
- **Landing and walking:** press F / tap Land over flat ground (not too high, too fast or too steep, not on water, lava or roofs). On foot the dragon walks (Shift / Boost runs), picks up prey or loot in front of it with Grab and eats with Eat - but it is vulnerable, and guards hear it land. F / Fly takes off.
- **Compass and smell:** the strip at the top shows the cave, the region exits, discovered places and, when hungry, where prey smells. Click or tap a mark to see its name.
- **The cave:** fly into the mouth on the volcano (or tap Enter cave) to walk around the cave hall. Walk up to a station and press E / tap its button: the **nest** (rest, heal, grow, sleep until dusk or dawn), the **larder** (stored prey, spoils over time), the **hoard** (your gold as a growing pile) and the **altar** (upgrades). The tunnel leads back out.
- **The kingdom:** a Drake can fly from Wildwood into the River Farmlands (Wildwood also has a hamlet and a small Order outpost). Hamlets, a village and the Order outpost have archers on posts and bells, a ballista with a visible aim line, sheep and cows in pens and barns, and wooden buildings that catch fire, burn, spread and rebuild as ruins after a while.
- **Raiding:** tithe chests and strongboxes hold gold. Burn the guards or come at night, grab the chest (in flight or on foot), take off under fire and fly it into the cave: the gold goes on the hoard. Carrying loot slows the dragon.
- **Perception and alert:** guards see in cones (shorter at night, blocked by hills and buildings) and hear landings; a guard first wonders (?) then raises the alarm (!). Raids raise the Order's **alert** from 0 to 3: more archers, then patrols on the roads, then a ballista in the village. A few quiet minutes away lower it one level.
- **Upgrades** (altar, bought once each with hoard gold): Prey sense (longer smell, names the prey, rings around animals), Iron scales (less arrow and bolt damage), Wing muscles (stamina), Hotter fire (faster cooking and burning), Guard sight (shows the guards' sight cones).
- **Day and night:** a full day takes 20 minutes; at night guards see about half as far.
- **Tips:** one-time hints for landing, the compass, the cave, raiding, alert, night, the altar and the Farmlands; touch tips name buttons.
- **Regions:** at the edge of a region a travel prompt appears - press Enter or tap the travel button to fly to the other region. The Farmlands open once the dragon is a Drake.
- **Death:** the dragon wakes in the cave with half vitality; prey and loot in its claws are lost.
- **Save:** progress is saved in `localStorage` (`vsd-campaign`, save v2; a phase 1 save migrates) on rest, region change, landing, entering the cave, buying an upgrade, death and every minute. It keeps the hoard, upgrades, alert, ruins, discovered places, the time of day and whether the dragon is flying, on the ground or in the cave. **Continue** on the start screen resumes it.

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Turn, climb, dive | A / D, W / S | Left stick |
| Fire breath (hold) | Space / left mouse | Breath |
| Boost (on foot: run) | Shift | Boost |
| Barrel roll | Q / E | Roll |
| Grab / swoop, pick up on foot (hold) | G | Grab |
| Eat (hold) | X | Eat |
| Land / take off | F | Land / Fly |
| Walk on foot and in the cave | W A S D | Left stick |
| Use a cave station (nest, larder, hoard, altar, tunnel) | E or Enter | The station's button |
| Enter the cave | Fly into the mouth | Enter cave button or fly into the mouth |
| Name of a compass mark | Click the mark | Tap the mark |
| Travel to the next region | Enter | Travel button at the region edge |
| Panel buttons (Rest, Sleep, Eat, Buy) | Click or Enter on the focused button | Tap |
| Close a panel / pause | Esc | II |

**Code layout.** Rules live in `campaign/core/` as pure UMD modules (no DOM, no Three.js) that run in the browser (`window.VCamp`) and in Node; all tunables are in `campaign/core/data.js`. Rendering is in `campaign/render/` and `campaign/game.js`; the dragon model is `shared/dragon.js`. Phase specs and task tables are in [`ai_sdlc/001_campaign/`](ai_sdlc/001_campaign/).

**Tests.** `node campaign/test/run.js` runs every campaign test (unit tests, save v1 / v2 and death rules, a seeded hunter bot that must reach Drake in 25-35 simulated minutes and a seeded raid bot that must bank a strongbox from the outpost; about 40 s). `node mp/sim.test.js` tests the co-op simulation.

**Debug.** `campaign/?debug` shows a **DBG** button with a debug panel (build, fps, dragon parameters) and one button per debug action (feed, hunger, damage, die, to lair, to herd, to exit, Drake, alert, calm, to a ballista / loot / pen / town, ignite, gold, upgrades, next day phase, fast time, tips reset, save + reload, wipe save, reset); on desktop the same actions have hotkeys listed in the panel. The panel also shows fps, draw calls and the quality tier. `?region=wild` starts in Wildwood, `?region=farm` in the River Farmlands, and `window.__vcamp` exposes the game state.

## Languages

The game is available in **English** and **Czech** (solo, tutorial and co-op). The language follows the browser (`cs` and `sk` get Czech, everything else English) and can be switched with the **EN / CS** buttons on the home screen and in the co-op lobby. The choice is stored in `localStorage` (`vsd-lang`); `?lang=cs` forces a language for one visit.

All texts live in `i18n.js`. To add a language, add it to `LANGS` and add a dictionary with the same keys as `en`; missing keys fall back to English. Plurals use `Intl.PluralRules` (`{one, few, other}`), so Czech gets *1 wyverna, 3 wyverny, 5 wyveren*.

## Install as an app

The game is a Progressive Web App and can be installed from the browser:

- **Chrome, Edge, Android:** an **Install app** button appears on the home screen and in the co-op lobby (or use the install icon in the address bar).
- **iPhone / iPad:** tap **Install app** for a hint, then Share → Add to Home Screen.

The installed app opens fullscreen, has a Co-op shortcut and works offline for solo play (co-op still needs a connection). `sw.js` loads game files network first, so a new deploy shows up on the next start, and caches the versioned CDN libraries. Bump `VERSION` in `sw.js` only when the list of precached files changes.

| File | Role |
|---|---|
| `i18n.js` | Translations, language detection and the EN / CS switch |
| `pwa.js` | Service worker registration and the install button |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icons/` | App name, icons, fullscreen display |

## Co-op multiplayer (`/mp/`)

Up to 6 dragons fight the wyvern waves together, connected peer-to-peer over WebRTC. There is no game server.

1. One player clicks **Host a game** and sends the invite link (`…/mp/#ROOMCODE`).
2. Friends open the link and press **Join**. Players can drop in mid-game.
3. A downed dragon respawns after 6 s. The run ends only when every dragon is down at the same time.

| File | Role |
|---|---|
| `mp/sim.js` | Shared simulation with no rendering: flight physics, wyvern AI, fireballs, breath-cone damage, waves, respawns. Runs in the browser and in Node. |
| `mp/game.js` | Rendering, input, lobby and networking. |
| `mp/sim.test.js` | Simulation tests: `node mp/sim.test.js` |

**How the netcode works.** Each browser flies its own dragon locally and sends its pose 20 times a second. The host's browser owns the world (wyverns, fireballs, damage and score) and broadcasts snapshots and events 20 times a second. Remote dragons are smoothed and extrapolated between snapshots.

**Connections.** [PeerJS](https://peerjs.com) and its free public signalling server are used to find peers. After that, game traffic goes directly between browsers. Some strict corporate or carrier networks block direct WebRTC connections; switching to another network usually fixes it.

**Limitations of the beta.** If the host closes the tab, the game ends for everyone. In co-op, clients are trusted with their own movement. Add `?debug` to the URL to expose `window.__vsd` for inspection.

Created by Claude from a one-line prompt - see [PROMPT.md](PROMPT.md).
