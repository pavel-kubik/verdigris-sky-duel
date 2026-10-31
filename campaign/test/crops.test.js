// Corn fields (Pavel's request 2026-10-31): corn fields in the Farmlands, breath ignites them, the fire front pops the
// corn across the field, burned fields grow back, state.step + save keep the burned ones.
'use strict';
const { ok, near, core } = require('./harness.js');
const CR = core('crops'), D = core('data'), T = core('terrain'), S = core('state'), F = core('flight'), SV = core('save');
const { mulberry } = core('math');
const C = D.corn;

// 1. the Farmlands have corn fields, the other regions none; ids are stable
{
  const ids = CR.ids('farm');
  ok(ids.length >= 2, 'at least 2 corn fields in the Farmlands: ' + ids.length);
  ok(ids.every(c => c.f.crop === C.crop && /^farm\.corn\d+$/.test(c.id)), 'corn crop, ids farm.corn<n>');
  ok(CR.ids('farm').map(c => c.id).join() === ids.map(c => c.id).join(), 'same fields every time');
  ok(CR.ids('ash').length === 0 && CR.ids('wild').length === 0, 'no corn outside the Farmlands');
}

/** A breath cone from 20 above a spot of field f, pointing down at it. */
function coneAt(f, u, v) {
  const s = Math.sin(f.yaw), c = Math.cos(f.yaw), x = f.x + u * c + v * s, z = f.z - u * s + v * c, g = T.surfaceAt('farm', x, z);
  return { origin: [x, g + 20, z - 4], dir: [0, -0.98, 0.2], range: 36, cone: 0.2 };
}

// 2. hot: breath on the stalks reaches the field; breath on open ground beside it or high above does not
{
  const crops = CR.build('farm'), c = crops.list[0], f = c.f;
  ok(CR.hot(c, coneAt(f, 0, 0), 'farm'), 'breath down onto the field centre reaches the corn');
  ok(!CR.hot(c, coneAt(f, f.w, 0), 'farm'), 'breath beside the field does not');
  const high = coneAt(f, 0, 0); high.origin[1] += 60;
  ok(!CR.hot(c, high, 'farm'), 'breath out of range high above does not');
  ok(!CR.hot(c, null, 'farm'), 'no breath, no heat');
  ok(CR.inField(f, f.x, f.z) && !CR.inField(f, f.x + f.w + f.l, f.z), 'inField');
}

// 3. ignite after corn.ignite s, the front crosses the field at corn.spread, then burned; regrows after corn.regrow
{
  const crops = CR.build('farm'), c = crops.list[0], f = c.f, cone = coneAt(f, 0, 0);
  let ev = [], t = 0;
  while (!c.burn && t < 2) { ev = ev.concat(CR.step(crops, cone, 0.05, t)); t += 0.05; }
  ok(ev.some(e => e.e === 'corn:burning' && e.id === c.id), 'corn:burning');
  near(t, C.ignite, 0.06, 'ignites after corn.ignite s of breath');
  ok(CR.state(c, c.burn.ig[0], c.burn.ig[1]) !== 'corn', 'the spot under the breath pops at once');
  // a spot 15 out pops when the front gets there and is burned a band later
  const s15 = [c.burn.ig[0] + 15, c.burn.ig[1]];
  for (let i = 0; i < 20; i++) CR.step(crops, null, 0.1, t);       // 2 s: front at 10
  ok(CR.state(c, s15[0], s15[1]) === 'corn', 'still corn before the front arrives');
  for (let i = 0; i < 15; i++) CR.step(crops, null, 0.1, t);       // 3.5 s: front at 17.5
  ok(CR.state(c, s15[0], s15[1]) === 'popping', 'popping when the front passes');
  for (let i = 0; i < 20; i++) CR.step(crops, null, 0.1, t);       // 5.5 s: front at 27.5
  ok(CR.state(c, s15[0], s15[1]) === 'burned', 'burned behind the front');
  ev = [];
  let k = 0;
  while (c.burn && k++ < 1000) ev = ev.concat(CR.step(crops, null, 0.1, 100));
  ok(ev.some(e => e.e === 'corn:burned' && e.at === 100) && c.burnedAt === 100, 'corn:burned once the front has crossed it all');
  ok(k * 0.1 < (Math.hypot(f.w, f.l) + C.band) / C.spread + 1, 'the front needs at most the field diagonal / spread');
  ok(CR.state(c, f.x, f.z) === 'burned', 'whole field burned');
  ok(!CR.hot(c, cone, 'farm'), 'a burned field does not burn again');
  ok(CR.step(crops, null, 0.1, 100 + C.regrow - 1).length === 0, 'not regrown before corn.regrow');
  ev = CR.step(crops, null, 0.1, 100 + C.regrow);
  ok(ev.some(e => e.e === 'corn:regrown') && c.burnedAt == null && CR.state(c, f.x, f.z) === 'corn', 'grows back after corn.regrow');
  // other fields untouched
  ok(crops.list.slice(1).every(o => !o.burn && o.burnedAt == null), 'the fire stays in its field');
}

// 4. heat cools out of the breath: short puffs do not ignite
{
  const crops = CR.build('farm'), c = crops.list[1], cone = coneAt(c.f, 0, 0);
  for (let i = 0; i < 20; i++) { CR.step(crops, cone, 0.1 * C.ignite, i); CR.step(crops, null, 1, i); }
  ok(!c.burn, 'short puffs with pauses never ignite');
}

// 5. state.step: the dragon's breath burns a field; burned fields saved in the region state and a save round trip
{
  const cs = S.create({ regionId: 'farm', rng: mulberry(5) });
  const crops = S.ensureCrops(cs), c = crops.list[0], f = c.f;
  const g = T.surfaceAt('farm', f.x, f.z);
  cs.dragon.pilot = F.newPilot([f.x, g + 16, f.z - 10], 0, 0);
  const evs = [];
  cs.bus.on('corn:burning', e => evs.push(e.e));
  cs.bus.on('corn:burned', e => evs.push(e.e));
  for (let i = 0; i < 40 && !c.burn; i++) {
    const p = cs.dragon.pilot;
    Object.assign(p, { pos: [f.x, g + 16, f.z - 10], yaw: 0, pitch: -0.9, speed: 0, st: 100 });
    S.step(cs, { breath: true }, 0.05);
  }
  ok(evs.includes('corn:burning'), 'breathing down on the corn sets it alight in state.step');
  for (let i = 0; i < 400 && c.burnedAt == null; i++) {
    Object.assign(cs.dragon.pilot, { pos: [f.x + 300, g + 80, f.z], pitch: 0, speed: 0 });
    S.step(cs, {}, 0.1);
  }
  ok(evs.includes('corn:burned') && c.burnedAt != null, 'burns down in state.step');
  ok(cs.regionStates.farm.corn.some(r => r.id === c.id), 'kept in the region state');
  const data = SV.serialise(cs);
  ok(data.regions.farm.corn && data.regions.farm.corn[0].id === c.id, 'saved: regions.farm.corn');
  const cs2 = S.create({ regionId: 'farm', rng: mulberry(6) });
  SV.apply(cs2, SV.migrate(JSON.parse(JSON.stringify(data))));
  const c2 = S.ensureCrops(cs2).list.find(o => o.id === c.id);
  ok(c2 && c2.burnedAt != null, 'a reload keeps the field burned');
}
