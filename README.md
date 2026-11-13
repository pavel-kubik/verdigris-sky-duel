# Verdigris Sky Duel

A procedural green dragon modelled and textured in code with Three.js (no asset files), with an orbit preview and an aerial fight mode against waves of crimson wyverns.

**Mobile first.** The game is designed and built for touch phones first (portrait and landscape); desktop keyboard and mouse stay supported with lower priority. Every action has a touch control, on-screen texts on touch name the buttons rather than keys, layouts are checked at phone width (390 x 844) first, and performance budgets target a mid-range phone.

- **Play solo:** https://pavel-kubik.github.io/verdigris-sky-duel/
- **Play co-op (beta):** https://pavel-kubik.github.io/verdigris-sky-duel/mp/

## Models, textures and the living forest

Everything is generated in the browser - there are no image or model files.

- **Textures** (`shared/textures.js`, `VTex`): dragon scales, belly scutes, wing membrane, horn, ashlar, slates, shingles, planks, thatch, rock, turf, ash, bark, foliage, fur, fleece, hide and feathers are painted once into canvases from tileable noise. Models with UVs (the dragon) use them as colour and normal maps; everything else (terrain, castles, villages, bridges, rocks, trees, animals) gets them as triplanar detail with per-pixel relief through `VTex.detail(material, …)`, so vertex and instance colours keep their palette. The low quality tier skips the relief.
- **Dragon** (`shared/dragon.js`): one model for every mode - a smooth body lofted from cross-sections, a sculpted head with brow ridges, slit-pupilled eyes, curved horns, teeth and a tongue, belly scutes, dorsal spines, muscled legs with toes and claws and wings with fingers and scalloped, billowing membranes. Geometry is built once and shared by every dragon (about 90 draw calls, 11k triangles).
- **Castle, villages, animals**: Vyshgard and the settlements carry masonry, slate, timber and thatch textures; goats, deer, boars, sheep, cows and hens are rounded models with fur, fleece, hide and feathers.
- **Volcano** (`campaign/render/volcano-view.js`): a lake of flowing lava in the crater, four lava streams down the flanks (they are lava for the rules too: no landing, no walking - `terrain.lavaFlows`), a fountain of glowing lava with a bigger burst every few seconds and a column of ash and smoke. Toward the rim of the Ash Wastes the ash gives way to grass and a living forest.
- **Living forest** (`shared/forest.js` rules, `shared/forest-view.js` models): conifers, pines, broadleaves, birches, poplars and dead wood sway in the wind. **The same rules in the solo duel, the co-op, the campaign and the deathmatch:**
  - fly into a tree and it **breaks** and topples along your flight; the dragon is jolted (it keeps 55 % of its speed and takes 4 damage - never fatal in the campaign, harmless in the tutorial) but does not fall;
  - **fire breath** sets a tree alight after a moment, a bursting **fireball** at once; it burns for 9-15 s with flames, embers and smoke, the fire jumps to neighbours at most two trees on, and a charred snag is left;
  - felled and burnt trees **grow back** after 150 s (in the deathmatch also on a new round);
  - in the co-op and the deathmatch every browser decides what its own dragon fells and ignites and tells the host, who tells everyone and hands the state to players who join later.

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

## Meta Quest 3 (VR)

Every mode plays in immersive VR through WebXR (`shared/xr.js`), with nothing to install: the solo duel, the tutorial, the co-op, the deathmatch and the campaign. On the headset, open the game in Quest Browser and choose **Enter VR** on the start screen of the mode (or the **VR** button at the top once you are flying); the buttons only appear on devices that support VR. Play seated. To leave VR, press the Meta button; single-player modes pause and the flat page comes back.

- **View:** the camera follows the dragon with a level horizon - no pitch, roll or zoom; game logic only ever turns the view about the vertical axis. The dragon banks and pitches as a model in front of you.
- **Comfort menu:** click the **right stick** (B closes it). Three presets and every setting on its own; the choice is kept in `localStorage` (`vsd-comfort`). The first time you enter VR a note recommends **Comfortable**. Take a break at the first sign of discomfort.

  | Setting | Values (Recommended in bold) | What it does |
  |---|---|---|
  | Preset | Comfortable, **Recommended**, Advanced | Comfortable: snap turn, strong vignette, strong rest frame, gentle steering, no boost. Advanced: smooth uncapped turn, nothing else on. |
  | Turning | **Snap**, Smooth | Snap: the view turns in steps behind a 100 ms fade once the dragon's heading is a step away. Smooth: it follows, up to the speed cap. |
  | Snap angle / Smooth turn speed | 15, **30**, 45 deg / 30, **45**, 60, 90 deg/s, no limit | |
  | Comfort vignette (reduces peripheral motion) | Off, Low, **Medium**, High | A soft black ring narrows the view while it turns or accelerates and opens in steady flight. |
  | Rest frame | Off, **Subtle**, Strong | A saddle bow and horns fixed to your seat in the lower view; Strong adds taller horns, side rails and a speed / height readout. |
  | Camera effects (shake) | **Off**, On | The hit shake. Off: the view is never shaken. |
  | Render scale | 0.7 - 1.2 (**1.0**) | Eye buffer resolution; a raised value applies the next time you enter VR. |
  | Steering | Gentle, **Normal**, Free | Limits the turn and dive rate and how fast the stick can reverse. |
  | Gentle speed changes | **On**, Off | Boosts and jolts reach the view over half a second; the dragon pulls ahead meanwhile. |
  | Boost | **On**, Off | Off removes the boost in VR (the boost lesson keeps it). |

- **Performance:** 90 Hz is requested, fixed foveation starts at medium (0.66), dragons are drawn as skinned meshes (7 draw calls instead of 88), and when a second of frames runs over the budget the quality drops a level (full foveation, then the render scale in 10 % steps down to 0.6) and comes back when frames are good again. Not in the menu: `foveation`, `adaptive`, `compact`.
- **Debug overlay:** click the **left stick**: frame time and fps, CPU time per frame, draw calls and triangles (both eyes), speed, turn rate and acceleration of the view, foveation, render scale and adaptive level.
- **Test links:** `?comfort=key:value,key:value` overrides the stored settings for one page load, e.g. `?comfort=preset:comfortable,debug:true` or `?comfort=turn:smooth,vignette:off`. Keys: `preset turn snapAngle smoothSpeed vignette rest effects scale assist ease boost foveation adaptive compact debug`.
- **Status panel** (below your eye line): vitality and fire, the radar, and what the mode shows on the flat screen - wave and score, the lesson goal, the match clock, or in the campaign hunger, region, gold, mission clock, compass and the current prompt.
- **Floating bars:** vitality over every foe and teammate, vitality and fire over your own dragon, the roast over a tutorial chicken.
- **Menus:** whatever panel is open on the flat page (home screen, lesson briefing, pause, lobby, room settings, leaderboard, cave stations, mission board, aerie, map, journal, story cards) is mirrored on a panel in front of you. Flick a stick up or down to choose, press **A** or the right trigger to press the button, **B** to go back. Text fields cannot be typed in VR: enter your name or a room code on the flat page first (an invite link fills the code in).
- **Speed:** the duel, the tutorial and the campaign run at half speed in VR; the co-op and the deathmatch run at full speed, because all players share one clock.

| Action | Quest controllers |
|---|---|
| Turn, climb, dive (walk in the campaign) | Left stick |
| Fire breath (hold) | Right trigger |
| Boost (hold) | Left trigger |
| Barrel roll | Flick the right stick left / right |
| Fireball (duel, tutorial, co-op, deathmatch) | A |
| Pause / menu / back | B |
| Deathmatch: sit down / fly, leaderboard | X, Y |
| Campaign: land, take off, fly on, enter, use a cave station | A |
| Campaign: grab / eat (hold) | Right grip |
| Campaign: journal, map | X, Y |

In the campaign the status panel names what **A** and the grip do right now (the same context buttons as on a phone). The hatching cutscene is skipped in VR - the hatching card follows at once.

## Campaign (alpha, `/campaign/`)

- **Play:** https://pavel-kubik.github.io/verdigris-sky-duel/campaign/ (or **Campaign (alpha)** on the home screen)

A single-player dragon campaign in its own page, built mobile first: everything plays on a touch phone, and every keyboard action has a touch button. **Phase 1 (Survival MVP)**, **Phase 2 (Kingdom + hoard)** and **Phase 3 (Castle, map + missions)** are done. A hatchling hatches next to its mother, learns to fly and hunt from her, grows into a **Drake** in the **Ash Wastes** and **Wildwood**, raids the Order's settlements in the **River Farmlands** for gold, carries it home into its cave and spends it on upgrades - then flies on to the **Veltava Bend** and takes missions against **Vyshgard Castle**. Later phases (Highlands, Lowlands, endgame) are planned in [`ai_sdlc/001_campaign/000_spec.md`](ai_sdlc/001_campaign/000_spec.md).

- **Mother:** she flies with the hatchling, leads it to a herd and teaches each skill once (a caption at the top); after the lessons she flies off and comes back to visit now and then.
- **Trees and lava:** the dragon breaks the trees it flies (or runs) into and its fire breath burns them; the lava streams on the volcano cannot be landed on or walked through - see [Models, textures and the living forest](#models-textures-and-the-living-forest).
- **Hunting:** fly low over a herd and hold Grab to swoop and grab prey, then hold Eat to eat it in flight. A hatchling can lift goats and deer; a boar is too heavy and fights back - roast it with fire breath and eat the roast chunks (half the food).
- **Hunger:** drains over time and faster when boosting or breathing fire. Fed regenerates vitality, Hungry slows fire regen, Starving makes the dragon slow, without fire and slowly losing vitality.
- **Landing and walking:** press F / tap Land over flat ground (not too high, too fast or too steep, not on water, lava or roofs). On foot the dragon walks (Shift / Boost runs), picks up prey or loot in front of it with Grab and eats with Eat - but it is vulnerable, and guards hear it land. F / Fly takes off.
- **Compass and smell:** the strip at the top shows the cave, the region exits, discovered places and, when hungry, where prey smells. Click or tap a mark to see its name.
- **The cave:** fly into the mouth on the volcano (or tap Enter cave) to walk around the cave hall. Walk up to a station and press E / tap its button: the **nest** (rest, heal, grow, sleep until dusk or dawn), the **larder** (stored prey, spoils over time), the **hoard** (your gold as a growing pile) and the **altar** (upgrades). The tunnel leads back out.
- **The kingdom:** a Drake can fly from Wildwood into the River Farmlands (Wildwood also has a hamlet and a small Order outpost). Hamlets, a village and the Order outpost have archers on posts and bells, a ballista with a visible aim line, sheep and cows in pens and barns, and wooden buildings that catch fire, burn, spread and rebuild as ruins after a while.
- **Raiding:** tithe chests and strongboxes hold gold. Burn the guards or come at night, grab the chest (in flight or on foot), take off under fire and fly it into the cave: the gold goes on the hoard. Carrying loot slows the dragon.
- **Perception and alert:** guards see in cones (shorter at night, blocked by hills and buildings) and hear landings; a guard first wonders (?) then raises the alarm (!). Raids raise the Order's **alert** from 0 to 3: more archers, then patrols on the roads, then a ballista in the village. A few quiet minutes away lower it one level.
- **Upgrades** (altar, bought once each with hoard gold): Prey sense (longer smell, names the prey, rings around animals), Iron scales (less arrow and bolt damage), Wing muscles (stamina), Hotter fire (faster cooking and burning), Guard sight (shows the guards' sight cones).
- **Veltava Bend:** the fourth region, east of the Farmlands (a Drake only), built from the real terrain of Prague: the river loops round the old city under the castle rock, with Karlsbridge, Hradchan, Staromark and the other places named on the compass.
- **Vyshgard Castle:** walls with wall walks, towers, bastions and a gatehouse on the rock above the river, readable from far away by day and with torches and lit windows at night. Archers stand on the walls and towers, ballistae on the bastions, the gate drops on alarm and the keep horn puts the whole Bend on alert. Wooden roofs, hoardings and the workshop burn; stone stays, charred. You can land in the courtyard and on the wall walks.
- **Map:** Tab / the Map button opens a drawn map: the world view and each region with its terrain, fog over ground you have not flown over yet, the places and aeries you found and the mission target. Drag to pan, scroll / pinch to zoom.
- **Aeries:** small dragon caves in Wildwood, the Farmlands and the Bend. Fly in (or E / Enter aerie near it): loot you carry in is banked, **Rest** heals and saves. Growing up still needs the nest at home.
- **Fast travel:** the **map stone** in the cave flies you to any aerie you found, and an aerie flies you back home - not while a mission or mission loot is on.
- **Missions:** the **mission board** in the cave offers three Act 2 missions in the Bend, each with a briefing and a clock (9-10 min): **The Ember Chalice** (steal: land in the castle courtyard, take the relic from the chapel door and escape), **The Siege Workshop** (destroy: burn the castle workshop to a ruin) and **The Tithe Wagon** (intercept: stop the escorted wagon on its way across Karlsbridge before it reaches the gate, land and take its chest). The clock starts when you leave the Ash Wastes or an aerie, stops in the cave and in aeries, and the mission is won by flying into the lair or an aerie after the objective: gold, plus a bonus for spare time. Death or the end of the clock fails it; rest at the nest or an aerie before you try again.
- **Relics:** a relic in your claws slows you and blocks fire; it is lost on death or timeout. A banked relic stands in its niche on the **trophy wall** in the cave.
- **Freed village:** burn every Order building of the Farmlands village and kill its archers at once: the Order flag falls, the Order does not come back there, and the villagers bring food to your larder now and then.
- **Story:** Act 1 and Act 2 cards, mission briefings and outcome lines; the mother speaks on your first raid on the castle.
- **Messages:** L / the Messages button opens the log of the last messages and mission states; tap a message to close it.
- **Day and night:** a full day takes 20 minutes; at night guards see about half as far.
- **Tips:** one-time hints for landing, the compass, the cave, raiding, alert, night, the altar, the Farmlands, the Bend, the castle, the map, aeries, fast travel, the mission board, the timer, relics and the freed village; touch tips name buttons.
- **Regions:** at the edge of a region a travel prompt appears - press Enter or tap the travel button to fly to the other region. The Farmlands and the Veltava Bend open once the dragon is a Drake.
- **Death:** the dragon wakes in the cave with half vitality; prey and loot in its claws are lost, and a running mission fails.
- **Save:** progress is saved in `localStorage` (`vsd-campaign`, save v3; phase 1 and phase 2 saves migrate) on rest, region change, landing, entering the cave or an aerie, buying an upgrade, death and every minute. It keeps the hoard, upgrades, alert, ruins, discovered places, the explored map, aeries, the running mission and its clock, relics, freed villages, the castle gate and charred pieces, the story, the time of day and whether the dragon is flying, on the ground or in the cave. **Continue** on the start screen resumes it.

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
| Use a cave station (nest, larder, hoard, altar, mission board, trophy wall, map stone, tunnel) | E or Enter | The station's button (Missions, Trophies, Map stone, ...) |
| Enter an aerie | Fly into it, or E near it | Enter aerie button or fly into it |
| Map (drag to pan) | Tab, scroll to zoom | Map button, pinch to zoom |
| Message log | L | Messages button |
| Enter the cave | Fly into the mouth | Enter cave button or fly into the mouth |
| Name of a compass mark | Click the mark | Tap the mark |
| Travel to the next region | Enter | Travel button at the region edge |
| Panel buttons (Rest, Sleep, Eat, Buy, Accept, Fly there) | Click or Enter on the focused button | Tap |
| Close a panel / pause | Esc | II |

**Code layout.** Rules live in `campaign/core/` as pure UMD modules (no DOM, no Three.js) that run in the browser (`window.VCamp`) and in Node; all tunables are in `campaign/core/data.js`. Rendering is in `campaign/render/` and `campaign/game.js`; the dragon model is `shared/dragon.js`. Phase specs and task tables are in [`ai_sdlc/001_campaign/`](ai_sdlc/001_campaign/).

**Tests.** `node campaign/test/run.js` runs every campaign test (unit tests, save v1 / v2 / v3 and death rules, a seeded hunter bot that must reach Drake in 25-35 simulated minutes, a seeded raid bot that must bank a strongbox from the outpost and seeded mission bots that must win the steal, destroy and intercept missions in time; about a minute). `node mp/sim.test.js` tests the co-op simulation.

**Debug.** `campaign/?debug` shows a **DBG** button with a debug panel (build, fps, draw calls, quality tier, dragon parameters) and one button per debug action, grouped in tabs: feed, hunger, damage, die, to lair, to herd, to exit, Drake, alert, calm, to a ballista / loot / pen / town, ignite, gold, upgrades, next day phase, fast time, and for phase 3 the castle gate, alarm and fire, castle wall passes, aerie and every aerie, reveal the map, accept / finish / fail a mission, jump to the tithe wagon, the chalice or the siege workshop, free the village, tribute now, tips reset, save + reload, wipe save, reset. On desktop the same actions have hotkeys listed in the panel. `?region=wild` starts in Wildwood, `?region=farm` in the River Farmlands, `?region=bend` in the Veltava Bend, `campaign/preview/castle.html` shows the castle kit, and `window.__vcamp` exposes the game state.

## Deathmatch (beta, `/campaign/dm/`)

- **Play:** https://pavel-kubik.github.io/verdigris-sky-duel/campaign/dm/ (or **Deathmatch (beta)** on the home screen, under Co-op)

Dragon against dragon over the campaign's Wildwood (Phase 3 terrain, trees and the hamlet and outpost buildings, with no defenders). Only human players, no AI dragons: up to 8, connected peer-to-peer like the co-op (one player hosts and sends the link `…/campaign/dm/#ROOMCODE`). Without the matchmaking server the host flies a practice game alone.

- **Lobby:** a new room opens in a lobby panel with the room code, an **Invite** button (copies the link; phones open the share sheet), everyone in the room and, for the host, the settings (kills to win 5 / 10 / 15 / 20, time 5 / 10 / 15 min). Until the host presses **Start match** it is a warm-up: everyone flies, nothing hurts. After a match **Next round** opens the lobby again.
- **Opening a room** needs the free public PeerJS matchmaking server. When it does not answer, Host a game tries three times and then says so, with a **Practice alone** button (a game nobody can join) - it never starts a practice game by itself. `?peer=host:port` (e.g. `?peer=peer.example.org:443`) uses a PeerJS server of your own instead; the invite link and the QR code carry it, so friends use the same server.
- **QR code:** the **QR** button in the lobby panel (or **Show QR code** in the menu) shows the room's invite link as a QR code with the room code, for a friend to scan with a phone camera; on the start screen **Share the game (QR code)** shows the game's own link. Phones also get a **Share** button. The code is made in the browser by `shared/qr.js` (no network, works offline), tested by `campaign/test/qr.test.js`.
- **Saved room and host take-over:** the host sends the room record (everyone's kills, deaths and score, the phase, the clock and the settings) to every player once a second, and every browser keeps it in `localStorage` (`vsd-dm-room`, 6 hours). A player is recognised by a key made from a random token stored in the browser (`vsd-dm-token`), so leaving and joining again (or **Rejoin room** on the start screen) gives the seat its score back. When the host leaves or goes silent for 6 s, the guest who joined first claims the room code and hosts from the record; the others join it 2.5 s later. The code and the invite link stay the same. If nobody is left, the next player to rejoin hosts the room from their saved copy. Seat keys are not secure, so rooms are for friends. **One world per code:** whoever holds the room code at the PeerJS server is the host. A host that loses it (its phone's screen was locked or its network dropped, the server freed the code and a guest took over) steps down when it is back: it sends its guests to the new host and joins it itself. Every joining player brings its saved copy of the room and the host merges it (most kills and deaths per seat win), so the two copies become one world without losing scores. A take-over never gives up; after 45 s the game says it is still reconnecting.
- **Match:** first to 10 kills (or the host's choice), or the best score when the time runs out. A kill is +1; crashing with nobody to blame is -1. The **leaderboard** (kills, deaths, score) is always shown in short at the top left; Tab or the Board button opens the full one, and it opens by itself at the end of the match, where the host can start a new round.
- **Respawn:** 5 s after dying, at the spawn point farthest from the other dragons, with 3 s of spawn protection.
- **Food:** chickens, goats and sheep wander the arena and flee dragons. Fly low over one or sit down next to it to eat it (+15 / +25 / +30 vitality); it comes back after 18 s. Vitality otherwise regenerates only slowly.
- **Sitting down:** F / Sit within 8 m of any surface - the ground, a roof or the flat top of a rock pillar (not water). A sitting dragon turns, breathes fire and shoots fireballs, and its fire refills faster. F, W, Shift or Fly takes off.
- **Trees:** flying into a tree breaks it (a jolt: slower, 4 damage) and fire sets it alight - see [the living forest](#models-textures-and-the-living-forest).
- **Falling:** flying into another dragon, a rock pillar or a building wall, or diving steeply into the ground, sends the dragon tumbling out of control until it hits the ground or a roof: damage on impact, then a short stun. Both dragons fall in a dragon-on-dragon collision; a fall death counts as a kill for whoever hit or bumped the dragon in the last 8 s.

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Turn, climb, dive | A / D, W / S | Left stick |
| Fire breath (hold) | Space / left mouse | Breath |
| Fireball (auto-aim) | R / right mouse | Ball |
| Boost | Shift | Boost |
| Barrel roll | Q / E | Roll |
| Sit down / take off | F | Sit / Fly |
| Leaderboard | Tab | Board |
| Menu (invite link) | Esc | II |

Rules are in `campaign/core/dm.js` (pure, tested by `campaign/test/dm.test.js`), tunables in `data.dm`; rooms and networking in `campaign/core/dmnet.js`, tested by `campaign/test/dmnet.test.js` on a simulated PeerJS network (`campaign/test/fake-net.js`: closed tabs, dead phones, locked screens, dropped server sockets, lost networks and 20 seeds of random chaos must all end as one world with the scores kept); the client is `campaign/dm/game.js`. `?debug` exposes `window.__vdm` and keys 1-6 (to food, to a pillar, to a roof, take damage, a dummy dragon ahead, end the match).

## Languages

The game is available in **English** and **Czech** (solo, tutorial and co-op). The language follows the browser (`cs` and `sk` get Czech, everything else English) and can be switched with the **EN / CS** buttons on the home screen and in the co-op lobby. The choice is stored in `localStorage` (`vsd-lang`); `?lang=cs` forces a language for one visit.

All texts live in `i18n.js`. To add a language, add it to `LANGS` and add a dictionary with the same keys as `en`; missing keys fall back to English. Plurals use `Intl.PluralRules` (`{one, few, other}`), so Czech gets *1 wyverna, 3 wyverny, 5 wyveren*.

## Install as an app

The game is a Progressive Web App and can be installed from the browser:

- **Chrome, Edge, Android:** an **Install app** button appears on the home screen and in the co-op lobby (or use the install icon in the address bar).
- **iPhone / iPad:** tap **Install app** for a hint, then Share → Add to Home Screen.

The installed app opens fullscreen, has a Co-op shortcut and works offline for solo play (co-op still needs a connection). `sw.js` loads game files network first, so a new deploy shows up on the next start, and caches the versioned CDN libraries. Files requested with `?v=` (test links) always wait for the network and use the cache only offline, so a slow host never mixes a new page with older scripts. Bump `VERSION` in `sw.js` only when the list of precached files changes.

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
| `shared/` | The dragon model, textures, the living forest and the QR code, used by every mode |

**How the netcode works.** Each browser flies its own dragon locally and sends its pose 20 times a second. The host's browser owns the world (wyverns, fireballs, damage and score) and broadcasts snapshots and events 20 times a second. Remote dragons are smoothed and extrapolated between snapshots.

**Connections.** [PeerJS](https://peerjs.com) and its free public signalling server are used to find peers. After that, game traffic goes directly between browsers. Some strict corporate or carrier networks block direct WebRTC connections; switching to another network usually fixes it.

**Limitations of the beta.** If the host closes the tab, the game ends for everyone. In co-op, clients are trusted with their own movement. Add `?debug` to the URL to expose `window.__vsd` for inspection.

Created by Claude from a one-line prompt - see [PROMPT.md](PROMPT.md).
