# Verdigris Sky Duel

A procedural low-poly green dragon built from primitives in Three.js, with an orbit preview and an aerial fight mode against waves of crimson wyverns.

- **Play solo:** https://pavel-kubik.github.io/verdigris-sky-duel/
- **Play co-op (beta):** https://pavel-kubik.github.io/verdigris-sky-duel/mp/

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
