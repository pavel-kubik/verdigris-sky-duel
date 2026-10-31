// The cave interior (Phase 2 T10): enter in the tunnel, walk to the stations, rest on the nest, eat from the larder,
// leave through the tunnel or the exit station, wake on the nest after death, walls and camera hold an Elder.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), LR = core('lair'), CV = core('cave'), CT = core('controls'), T = core('terrain'), D = core('data'), F = core('flight'), G = core('growth'), SV = core('save');
const { mulberry, wrap, clamp } = core('math');
const dt = 1 / 60, K = D.cave;

function inside(seed) {
  const cs = S.create({ regionId: 'ash', rng: mulberry(seed || 5) });
  const m = LR.mouthPos('ash');
  cs.dragon.pilot = F.newPilot(m.slice(), Math.PI, 30);
  const ev = LR.enter(cs);
  return { cs, ev };
}
/** Walks toward station id (turn on the spot, then forward) until it is in reach or secs run out. */
function walkTo(cs, id, secs) {
  const s = K.stations[id], ev = [];
  for (let i = 0; i < (secs || 20) / dt && cs.station !== id && cs.inLair; i++) {
    const p = cs.dragon.pilot, turn = wrap(Math.atan2(s[0] - p.pos[0], s[1] - p.pos[2]) - p.yaw);
    ev.push(...S.step(cs, { sx: clamp(-turn * 3, -1, 1), sy: Math.abs(turn) < 0.5 ? 1 : 0 }, dt));
  }
  return ev;
}

// 1. Flying in puts the dragon in the tunnel, facing into the hall, standing on the floor
{
  const { cs, ev } = inside();
  const p = cs.dragon.pilot;
  ok(cs.inLair && cs.location === 'cave' && ev[0].e === 'lair:enter' && ev[0].at === 'tunnel', 'lair:enter at the tunnel');
  ok(p.mode === 'ground' && p.pos[2] === K.entry[1] && Math.abs(wrap(p.yaw - Math.PI)) < 1e-9, 'standing in the tunnel, facing in (-Z)');
  near(p.pos[1], K.floor + D.walk.stand * S.scaleOf(cs), 1e-9, 'body at stand height over the floor');
  ok(cs.station === null, 'no station at the entry (Leave is not offered right away)');
}

// 2. Stations are a few seconds' walk apart; the Action slot names the one in reach
{
  const { cs } = inside();
  const t0 = cs.stats.played;
  walkTo(cs, 'nest');
  ok(cs.station === 'nest' && CT.slots(cs).action === 'nest', 'walked to the nest: Action = nest');
  ok(cs.stats.played - t0 < 10, 'tunnel to nest in under 10 s at hatchling speed: ' + (cs.stats.played - t0).toFixed(1) + ' s');
  const t1 = cs.stats.played;
  walkTo(cs, 'larder');
  ok(cs.station === 'larder' && CT.slots(cs).action === 'larder', 'walked to the larder: Action = larder');
  ok(cs.stats.played - t1 < 10, 'nest to larder in under 10 s: ' + (cs.stats.played - t1).toFixed(1) + ' s');
  walkTo(cs, 'exit');
  ok(cs.station === 'exit' && CT.slots(cs).action === 'exit' && cs.inLair, 'walked to the exit: Action = exit');
}

// 3. Rest at the nest, eat from the larder (station actions through state.caveAct)
{
  const { cs } = inside();
  const d = cs.dragon;
  d.hp = 3; d.pilot.st = 5; d.foodXp = D.stages[1].foodFrom + 1;
  walkTo(cs, 'nest');
  const ev = S.caveAct(cs, 'nest');
  ok(ev.some(e => e.e === 'lair:rest') && ev.some(e => e.e === 'stage:up') && ev.some(e => e.e === 'save'), 'rest: heals, grows when ready, autosaves');
  ok(d.hp === G.statsOf(d.stage).hpMax && d.pilot.st === 100 && cs.inLair, 'rest: full HP and fire, still inside');
  cs.larder.push({ type: 'goat', food: 20 });
  const h = d.hunger;
  const e2 = S.caveAct(cs, 'larder', 0);
  ok(e2.some(e => e.e === 'prey:eaten' && e.from === 'larder') && cs.larder.length === 0 && d.hunger > h, 'larder: eat the stored goat');
}

// 4. Walls: the dragon slides along the wall, never leaves the hall or the tunnel; hunger is paused inside
{
  const { cs } = inside();
  const d = cs.dragon, h = d.hunger;
  let outside = 0;
  for (let i = 0; i < 60 * 30; i++) {
    S.step(cs, { sx: i % 600 < 300 ? 0.15 : -0.1, sy: 1, boost: i % 200 < 100 }, dt);
    if (!cs.inLair) break;
    const p = d.pilot;
    if (!CV.walkable(p.pos[0], p.pos[2], S.scaleOf(cs))) outside++;
  }
  ok(outside === 0, 'never outside the walkable floor while running into the walls');
  ok(d.hunger === h, 'hunger paused inside the cave');
}

// 5. Walking out through the tunnel leaves the lair: back in the air in front of the mouth
{
  const { cs } = inside();
  const p = cs.dragon.pilot;
  p.yaw = 0;                                                    // turn around, facing out (+Z)
  const ev = [];
  for (let i = 0; i < 60 * 10 && cs.inLair; i++) ev.push(...S.step(cs, { sx: 0, sy: 1 }, dt));
  const lv = ev.find(e => e.e === 'lair:leave');
  ok(!cs.inLair && lv && lv.via === 'tunnel', 'walked out of the tunnel: lair:leave via tunnel');
  ok(p.mode === 'air' && p.pos[1] > T.surfaceAt('ash', p.pos[0], p.pos[2]) + D.flight.minAlt, 'flying again above the ground');
  ok(cs.station === null && CT.slots(cs).roll, 'no station outside, Roll back');
  // the exit station does the same
  const b = inside().cs;
  walkTo(b, 'exit');
  const e2 = S.caveAct(b, 'exit');
  ok(!b.inLair && e2.some(e => e.e === 'lair:leave'), 'exit station: leave');
}

// 6. Death wakes on the nest, a save inside restores on the nest
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(9) });
  cs.dragon.pilot = F.newPilot([100, 80, 100], 0, 30);
  cs.dragon.hp = 0;
  const ev = S.step(cs, { sx: 0, sy: 0 }, dt);
  ok(ev.some(e => e.e === 'dragon:died') && cs.inLair && cs.station === 'nest', 'death: wakes on the nest');
  const o = JSON.parse(JSON.stringify(SV.serialise(cs)));
  const m = LR.mouthPos('ash');
  ok(o.world.location === 'cave' && o.world.mode === 'air' && Math.hypot(o.world.pos[0] - m[0], o.world.pos[2] - m[2]) < 1, 'saved inside: location cave (v2), position at the mouth (not cave coordinates)');
  const back = SV.deserialise(o, mulberry(2));
  ok(back.inLair && back.station === 'nest' && back.dragon.pilot.mode === 'ground', 'a save inside restores in the cave on the nest');
  SV.apply(back, SV.migrate(SV.blank()));
  ok(!back.inLair && back.station === null, 'a new run clears the station');
}

// 7. Elder-sized dragon (scale 4): fits, walks, the camera never leaves the dome or the tunnel
{
  for (const scale of [0.6, 1, 2.2, 4]) {
    let bad = 0, n = 0;
    for (let x = -60; x <= 60; x += 3) for (let z = -60; z <= 75; z += 3) {
      const pos = CV.clampPos([x, 0, z], scale);
      pos[1] = CV.standY(scale);
      for (let yaw = 0; yaw < 2 * Math.PI; yaw += Math.PI / 6) {
        const c = CV.camera(pos, yaw, scale);
        n++;
        if (!CV.inside(c.pos, K.camera.pad - 1e-6)) bad++;
      }
    }
    ok(bad === 0, 'scale ' + scale + ': camera inside the rock with pad in all ' + n + ' poses');
    ok(CV.walkable(...[0, -34], scale) && CV.walkable(K.entry[0], K.entry[1], scale), 'scale ' + scale + ': nest and entry walkable');
  }
  const big = CV.camera([0, CV.standY(4), 0], 0, 4), free = CV.camera([0, CV.standY(1), 0], 0, 1);
  ok(Math.hypot(big.pos[0], big.pos[2] - 0) > Math.hypot(free.pos[0], free.pos[2]) * 1.5, 'an Elder camera sits further back in the middle of the hall');
  near(CV.camera([0, CV.standY(1), 0], 0, 1).pos[2], -K.camera.dist, 1e-9, 'unclamped in the middle: dist behind');
}
