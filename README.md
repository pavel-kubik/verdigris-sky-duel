# Verdigris Sky Duel

A procedural low-poly green dragon built from primitives in Three.js, with an orbit preview and an aerial fight mode against waves of crimson wyverns.

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

Single static `index.html`, no build step. Three.js r128 is loaded from cdnjs.

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
