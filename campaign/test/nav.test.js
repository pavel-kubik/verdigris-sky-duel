// Compass and smell (Phase 2 T09): smell range, exact / blurred / stable scent bearings, strongest herds,
// lair and exit markers (also through another region), heading-relative angles, state.step integration.
'use strict';
const { ok, near, core } = require('./harness.js');
const NV = core('nav'), S = core('state'), D = core('data'), F = core('flight'), T = core('terrain');
const { mulberry, wrap } = core('math');
const SM = D.smell;

function makeCs(regionId, pos, yaw) {
  const cs = S.create({ regionId, rng: mulberry(7) });
  cs.dragon.pilot = F.newPilot(pos || [0, 80, 0], yaw || 0, 30);
  return cs;
}
/** A field with herds at given [x, z] centres and sizes (members bunched within 2 units). */
function field(regionId, herds) {
  const f = { regionId, herds: [], list: [], nextId: 1, t: 0 };
  herds.forEach((h, i) => {
    f.herds.push({ id: i + 1, type: h.type || 'deer', centre: [h.x, h.z], emptyT: 0 });
    for (let k = 0; k < (h.n || 3); k++) {
      const x = h.x + (k % 2) * 2 - 1, z = h.z + (k > 1 ? 2 : -2) * 0.5;
      f.list.push({ id: f.nextId++, type: h.type || 'deer', herd: i + 1, pos: [x, 0, z], state: h.state || 'graze', size: 1, food: 20 });
    }
  });
  return f;
}
const scents = cs => NV.markers(cs).filter(m => m.kind === 'scent' || m.kind === 'scentLivestock');

// 1. smell range: stage spot, hungry, starving
{
  const cs = makeCs('wild');
  cs.dragon.hunger = 90; near(NV.smellRange(cs), SM.range, 1e-9, 'fed hatchling smells data.smell.range');
  cs.dragon.hunger = 25; near(NV.smellRange(cs), SM.range * SM.hungryMult, 1e-9, 'hungry smells further');
  cs.dragon.hunger = 5; near(NV.smellRange(cs), SM.range * SM.hungryMult * SM.starveMult, 1e-9, 'starving smells further still');
  cs.dragon.hunger = 90; cs.dragon.stage = 1; near(NV.smellRange(cs), SM.range * Math.sqrt(D.stages[1].spot), 1e-9, 'a Drake smells further (spot ^ 0.5)');
}

// 2. inside smell.sharp the marker points exactly at the herd, on every update
{
  const cs = makeCs('wild', [0, 80, 0], 0.3);
  cs.field = field('wild', [{ x: 60, z: 70, n: 4 }]);
  const src = NV.sources(cs.field)[0];
  let worst = 0;
  for (let i = 0; i < 600; i++) {                                   // 60 s
    S.step(cs, {}, 0.1);
    cs.dragon.pilot.pos = [0, 80, 0];                                 // hold the dragon still (the herd may graze a little)
    const m = scents(cs)[0], s = NV.sources(cs.field)[0];
    ok(m, 'scent marker present');
    worst = Math.max(worst, Math.abs(wrap(m.bearing - Math.atan2(s.x, s.z))));
  }
  ok(src.n === 4, 'herd counted');
  ok(worst < 0.02, 'inside sharp the scent is exact (worst ' + worst.toFixed(4) + ' rad, the herd grazes between updates)');
}

// 3. far out: blurred but within smell.blur, drifting slowly (no jitter between updates), stable for a still dragon
{
  const cs = makeCs('wild', [0, 80, 0], 0);
  cs.dragon.hunger = 25;                                             // hungry: range 532
  const f = field('wild', [{ x: 0, z: 480, n: 5 }]);
  cs.field = f;
  for (const p of f.list) p.held = 1e9;                             // keep the herd still
  const truth = () => { const s = NV.sources(f)[0]; return Math.atan2(s.x, s.z); };
  let maxOff = 0, maxJump = 0, prev = null, minOff = Infinity;
  for (let i = 0; i < 1200; i++) {                                  // 120 s at 10 Hz
    cs.nav = cs.nav || null;
    NV.step(cs, 0.1);
    const m = scents(cs)[0];
    const off = Math.abs(wrap(m.bearing - truth()));
    maxOff = Math.max(maxOff, off); minOff = Math.min(minOff, off);
    if (prev != null) maxJump = Math.max(maxJump, Math.abs(wrap(m.bearing - prev)));
    prev = m.bearing;
  }
  const k = (480 - SM.sharp) / (NV.smellRange(cs) - SM.sharp);
  ok(maxOff <= SM.blur * k + 1e-9, 'far blur stays within blur x distance share (' + maxOff.toFixed(3) + ')');
  ok(maxOff > 0.15, 'far out the marker is really blurred (' + maxOff.toFixed(3) + ' rad)');
  ok(maxJump < 0.06, 'no jitter: one update moves the marker less than 0.06 rad (' + maxJump.toFixed(4) + ')');
  ok(minOff < maxOff - 0.1, 'the blur drifts over time');
}

// 4. range grows when hungry: a herd at 450 is smelled only when hungry
{
  const cs = makeCs('wild');
  cs.field = field('wild', [{ x: 450, z: 0, n: 3 }]);
  cs.dragon.hunger = 90; NV.step(cs, 1);
  ok(scents(cs).length === 0, 'fed: herd at 450 is out of smell range');
  cs.dragon.hunger = 25; NV.step(cs, 1);
  ok(scents(cs).length === 1, 'hungry: the same herd is smelled');
}

// 5. only the strongest smell.max herds; carried and roasted prey do not smell; livestock get their own kind
{
  const cs = makeCs('wild');
  cs.field = field('wild', [{ x: 100, z: 0, n: 1 }, { x: 0, z: 150, n: 6 }, { x: -200, z: 0, n: 5 }, { x: 0, z: -300, n: 2 },
                           { x: 50, z: 50, n: 3, state: 'carried' }, { x: -40, z: -40, n: 2, state: 'roast' }]);
  NV.step(cs, 1);
  const got = cs.nav.scents.map(s => s.herd);
  ok(got.length === SM.max, 'at most smell.max scents');
  ok(got[0] === 2 && got.indexOf(3) >= 0 && got.indexOf(5) < 0 && got.indexOf(6) < 0, 'strongest herds first, carried / roast ignored: ' + got);
  for (let i = 1; i < cs.nav.scents.length; i++) ok(cs.nav.scents[i - 1].strength >= cs.nav.scents[i].strength, 'sorted by strength');
  D.prey.testSheep = { size: 1, food: 20, hp: 20, speed: 6, flee: 6, fleeRange: 30, herd: [3, 5], fights: false, livestock: true };
  cs.field = field('wild', [{ x: 80, z: 40, n: 4, type: 'testSheep' }]);
  NV.step(cs, 1);
  ok(scents(cs)[0].kind === 'scentLivestock' && scents(cs)[0].label.key === 'c.nav.scentLivestock', 'livestock smell different');
  delete D.prey.testSheep;
}

// 6. lair and exits: in the Ash Wastes the lair is the mouth, in Wildwood the lair marker leads through the exit home
{
  const ash = makeCs('ash', [0, 120, 600], 0);
  NV.step(ash, 1);
  const mk = NV.markers(ash), lair = mk.find(m => m.kind === 'lair'), m0 = T.lairPos('ash');
  ok(lair && !lair.via, 'ash: lair marker');
  near(lair.bearing, Math.atan2(m0[0] - 0, m0[2] - 600), 1e-9, 'ash: lair bearing points at the mouth');
  near(lair.dist, Math.hypot(m0[0], m0[2] - 600), 1e-9, 'ash: lair distance');
  ok(mk.some(m => m.kind === 'exit' && m.key === 'exit:wild'), 'ash: exit to Wildwood');

  const wild = makeCs('wild', [0, 80, 0], 0);
  const wm = NV.markers(wild), wl = wm.find(m => m.kind === 'lair');
  ok(wl && wl.via === 'ash' && wl.label.key === 'c.nav.lairVia', 'wild: lair via the Ash Wastes');
  near(Math.abs(wl.bearing), Math.PI, 1e-9, 'wild: lair marker points at the south exit');
  near(wl.dist, T.region('wild').radius, 1e-6, 'wild: distance to the exit');
  ok(!wm.some(m => m.kind === 'exit' && m.key === 'exit:ash'), 'wild: no duplicate exit marker on the way home');

  D.regions.wild.exits.push({ to: 'farmTest', angleFrom: -0.6, angleTo: 0.6, minStage: 1 });
  let ex = NV.markers(wild).find(m => m.key === 'exit:farmTest');
  ok(ex && ex.dim && ex.label.key === 'c.nav.exitSmall', 'a gated exit is greyed out for a hatchling');
  near(ex.bearing, 0, 1e-9, 'exit bearing to the arc middle');
  wild.dragon.stage = 1;
  ex = NV.markers(wild).find(m => m.key === 'exit:farmTest');
  ok(ex && !ex.dim && ex.label.key === 'c.nav.exit', 'a Drake may use it');
  D.regions.wild.exits.pop();
  ok(NV.routeExit('wild', 'ash').to === 'ash' && NV.routeExit('ash', 'ash') === null, 'routeExit');
  ok(NV.markers(wild).length <= D.nav.markers, 'marker cap');
}

// 7. relative angle: positive = right of the heading (stick right lowers yaw)
{
  near(NV.relative(-Math.PI / 2, 0), Math.PI / 2, 1e-12, '-X bearing is to the right when facing +Z');
  near(NV.relative(0.2, 0.2), 0, 1e-12, 'dead ahead');
  near(Math.abs(NV.relative(Math.PI, 0)), Math.PI, 1e-12, 'behind');
}

// 8. state.step keeps the scents current; the lair pauses smell; a region change re-reads at once
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(3) });
  S.enterRegion(cs, 'wild', [0, 80, 0], 0);
  cs.dragon.hunger = 25;
  for (let i = 0; i < 10; i++) S.step(cs, {}, 0.05);
  ok(cs.nav && Array.isArray(cs.nav.scents), 'cs.nav filled by state.step');
  const t0 = cs.nav.t;
  cs.inLair = true; S.step(cs, {}, 1); ok(cs.nav.t === t0, 'nothing in the lair');
  cs.inLair = false;
  const old = cs.field;
  S.enterRegion(cs, 'wild', [0, 80, 0], 0);
  cs.nav.next = 10;
  S.step(cs, {}, 0.01);
  ok(cs.nav.field === cs.field && cs.field !== old, 'new field read at once');
}
