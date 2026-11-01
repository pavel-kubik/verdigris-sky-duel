// Map (Phase 3 T07): exploration grid scales with stage and altitude, step rate, model lists only discovered places,
// locked regions report their stage, the lair is always known, state.step integration.
'use strict';
const { ok, near, core } = require('./harness.js');
const MP = core('map'), S = core('state'), D = core('data'), F = core('flight'), T = core('terrain'), SE = core('settlement');
const { mulberry } = core('math');

function makeCs(regionId, pos, stage) {
  const cs = S.create({ regionId, rng: mulberry(3) });
  cs.dragon.stage = stage || 0;
  cs.dragon.pilot = F.newPilot(pos || [0, 60, 0], 0, 30);
  return cs;
}
const countBits = b => b.reduce((n, w) => { for (let k = 0; k < 32; k++) n += (w >>> k) & 1; return n; }, 0);

// 1. grid: a region of radius 1200 has 48 x 48 cells; cells outside the square are -1
{
  const g = MP.grid('bend');
  ok(g.n === 48, 'bend grid 48 x 48: ' + g.n);
  ok(MP.grid('wild').n === 44, 'wild grid 44 x 44');
  ok(MP.cellOf('bend', 0, 0) >= 0 && MP.cellOf('bend', 5000, 0) === -1, 'cellOf inside / outside');
  ok(MP.bits(makeCs('bend'), 'bend').length === Math.ceil(48 * 48 / 32), 'bitset words');
}

// 2. reveal range: stage spot ^ 0.5, x revealAlt high up
{
  const lowH = makeCs('wild', [0, 40, 0], 0), lowD = makeCs('wild', [0, 40, 0], 1);
  const hi = makeCs('wild', [0, T.region('wild').ceiling * D.map.highAlt + 5, 0], 0);
  near(MP.revealRange(lowH), D.map.reveal, 1e-9, 'hatchling range');
  near(MP.revealRange(lowD), D.map.reveal * Math.sqrt(D.stages[1].spot), 1e-9, 'drake range');
  near(MP.revealRange(hi), D.map.reveal * D.map.revealAlt, 1e-9, 'high range');
  const n = cs => { MP.step(cs, 1); return countBits(cs.explored.wild); };
  const a = n(lowH), b = n(lowD), c = n(hi);
  ok(a > 0 && b > a && c > a, 'more cells for a drake and high up: ' + [a, b, c].join(' '));
  near(a, Math.PI * D.map.reveal * D.map.reveal / (D.map.cell * D.map.cell), a * 0.25, 'hatchling cells ~ circle area');
}

// 3. explored(): around the dragon yes, far away no; nothing in the lair; at most 4 Hz
{
  const cs = makeCs('farm', [300, 50, 200], 0);
  const ev = MP.step(cs, 0.016);
  ok(ev.length === 1 && ev[0].e === 'map:explored' && ev[0].region === 'farm', 'explored event');
  ok(MP.explored(cs, 'farm', 300, 200) && MP.explored(cs, 'farm', 380, 200), 'cells near the dragon');
  ok(!MP.explored(cs, 'farm', -600, -600) && !MP.explored(cs, 'wild', 300, 200), 'far cells and other regions stay fogged');
  cs.dragon.pilot.pos = [-600, 50, -600];
  ok(MP.step(cs, 0.1).length === 0 && !MP.explored(cs, 'farm', -600, -600), 'no update before map.every');
  MP.step(cs, D.map.every);
  ok(MP.explored(cs, 'farm', -600, -600), 'updated after map.every');
  ok(MP.step(cs, 1).length === 0, 'no event when nothing new opens');
  const cave = makeCs('ash', [0, 30, 0], 0); cave.inLair = true;
  ok(MP.step(cave, 1).length === 0 && countBits(MP.bits(cave, 'ash')) === 0, 'nothing explored in the lair');
  const f = MP.fraction(cs, 'farm');
  ok(f > 0 && f < 0.2, 'fraction small after two spots: ' + f.toFixed(3));
  MP.reveal(cs, 'farm', 0, 0, 5000);
  near(MP.fraction(cs, 'farm'), 1, 1e-9, 'fully revealed');
}

// 4. model: only discovered places, the lair always, castle kind, dragon only in its own region
{
  const cs = makeCs('bend', [0, 80, 0], 1);
  let m = MP.model(cs);
  ok(m.region === 'bend' && m.places.length === 0, 'no places before discovery');
  ok(m.dragon && m.dragon.x === 0 && m.dragon.z === 0, 'dragon on the map');
  const L = SE.layout('bend').places, castle = L.find(p => p.type === 'castle'), vill = L.find(p => p.type === 'village');
  cs.discovered[castle.id] = true;
  m = MP.model(cs);
  ok(m.places.length === 1 && m.places[0].kind === 'castle' && m.places[0].key === 'c.placeName.vyshgard', 'castle discovered');
  cs.discovered[vill.id] = true;
  m = MP.model(cs);
  ok(m.places.length === 2 && m.places.some(p => p.kind === 'settlement' && p.key === 'c.placeName.holeshwick'), 'village discovered');
  ok(m.places.every(p => cs.discovered[p.id]), 'every place shown is discovered');
  const ash = MP.model(cs, 'ash');
  ok(ash.places.length === 1 && ash.places[0].kind === 'lair', 'the lair is always on the map');
  ok(ash.dragon === null, 'no dragon on another region view');
  cs.inLair = true;
  ok(MP.model(cs).dragon === null, 'no dragon arrow from the cave');
}

// 5. regions: known / locked with the stage they need
{
  const cs = makeCs('ash', [0, 60, 0], 0);
  const by = m => Object.fromEntries(m.regions.map(r => [r.id, r]));
  let r = by(MP.model(cs));
  ok(r.ash.known && r.ash.here && r.ash.visited, 'ash known, here');
  ok(r.wild.known && !r.wild.visited && !r.wild.locked, 'wild known (neighbour), open to a hatchling');
  ok(!r.farm.known && !r.bend.known, 'farm and bend not known yet');
  cs.regionStates.wild = { heat: 0 };
  r = by(MP.model(cs));
  ok(r.farm.known && r.farm.locked && r.farm.locked.stage === 1, 'farm known from wild, locked for a hatchling (Drake)');
  cs.dragon.stage = 1;
  r = by(MP.model(cs));
  ok(!r.farm.locked, 'farm open for a Drake');
  cs.regionStates.bend = { heat: 2.4 };
  r = by(MP.model(cs));
  ok(r.bend.alert === 2, 'bend alert level');
  ok(r.low.known && r.low.locked && r.low.locked.stage === 2 && !r.low.playable, 'later region locked with its stage');
  ok(r.capital.locked.stage === 3, 'capital needs stage 3');
  ok(!r.pass.known, 'pass unknown until the farmlands are visited');
  ok(MP.model(cs).regions.length === Object.keys(D.map.world).length, 'every world region listed');
}

// 6. state.step explores while flying
{
  const cs = makeCs('wild', [100, 60, 100], 0);
  for (let i = 0; i < 20; i++) S.step(cs, { sx: 0, sy: 0 }, 0.05);
  ok(MP.explored(cs, 'wild', cs.dragon.pilot.pos[0], cs.dragon.pilot.pos[2]), 'state.step marks the cell under the dragon');
}
