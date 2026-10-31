// Settlements (Phase 2 T12): templates, deterministic placement, solids for walking and flying, discovery on the compass.
'use strict';
const { ok, core } = require('./harness.js');
const SE = core('settlement'), D = core('data'), T = core('terrain'), S = core('state'), F = core('flight'), WK = core('walk'), NV = core('nav'), SV = core('save');
const { mulberry } = core('math');
const dt = 1 / 60;

// 1. all five settlements are built, each on its plateau, with unique ids
const farm = SE.build('farm'), wild = SE.build('wild');
const places = farm.places.concat(wild.places);
ok(places.length === 5, 'five settlements: ' + places.map(p => p.id).join(', '));
ok(['farm.village', 'farm.hamlet', 'farm.outpost', 'wild.hamlet', 'wild.outpostS'].every(id => places.some(p => p.id === id)), 'settlement ids');
const all = farm.buildings.concat(wild.buildings);
ok(new Set(all.map(b => b.id)).size === all.length, 'building ids are unique (' + all.length + ')');
ok(all.some(b => b.id === 'farm.outpost.tower1') && all.some(b => b.id === 'farm.outpost.vault1'), 'ids like the save example: farm.outpost.tower1');
for (const town of [farm, wild]) {
  for (const pl of town.places) {
    const pt = T.plateauAt(town.region, pl.x, pl.z);
    ok(pt && pl.r + 4 <= pt.r, pl.id + ' fits on its plateau (' + pl.r.toFixed(1) + ' of ' + (pt && pt.r) + ')');
    for (const b of town.buildings.filter(q => q.place === pl.id)) {
      ok(Math.abs(b.pos[1] - T.surfaceAt(town.region, b.pos[0], b.pos[2])) < 1e-9, b.id + ' stands on the ground');
      ok(!T.liquidAt(town.region, b.pos[0], b.pos[2]), b.id + ' is not in water');
    }
    const types = town.buildings.filter(q => q.place === pl.id).map(q => q.type);
    for (const [type] of D.settlements[pl.type].buildings) ok(types.includes(type), pl.id + ' has a ' + type);
  }
}
// footprints never overlap (palisade pieces aside), pens are clear of buildings
for (const town of [farm, wild]) {
  const bs = town.buildings.filter(b => !b.seg);
  let bad = 0;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j];
    if (a.place === b.place && Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) < a.r + b.r) bad++;
  }
  for (const p of town.pens) for (const b of town.buildings) if (b.place === p.place && Math.hypot(p.pos[0] - b.pos[0], p.pos[2] - b.pos[2]) < p.r + b.r) bad++;
  ok(bad === 0, town.region + ': no overlapping footprints');
}
ok(farm.pens.length === 3 && wild.pens.length === 1, 'pens: village 2, farm hamlet 1, wild hamlet 1');
ok(farm.posts.filter(q => q.kind === 'archer').length === 3 && farm.posts.filter(q => q.kind === 'ballista').length === 2, 'farm posts: 3 archer towers, 2 ballista platforms');
ok(wild.posts.every(q => q.kind === 'archer'), 'no ballista in the Wildwood');

// 2. placement is deterministic and build() hands out fresh state each time
const again = SE.build('farm');
ok(JSON.stringify(again.buildings.map(b => b.pos)) === JSON.stringify(farm.buildings.map(b => b.pos)), 'same layout every build');
again.buildings[0].hp = 1; again.buildings[0].pos[1] = 999;
ok(SE.build('farm').buildings[0].hp === D.buildings[again.buildings[0].type].hp && SE.build('farm').buildings[0].pos[1] !== 999, 'build() copies (mutating one town leaves the next untouched)');
const ruined = SE.build('farm', { ruins: [{ id: 'farm.outpost.tower1', at: 50 }] });
const t1 = ruined.buildings.find(b => b.id === 'farm.outpost.tower1');
ok(t1.ruin && t1.ruinAt === 50, 'region state ruins mark buildings as ruins');
ok(SE.solidAt(ruined, t1.pos[0], t1.pos[2]) == null, 'a ruin is no solid');

// 3. solidAt: roof over a footprint, null outside; palisade capsules; the gate is open
const tower = farm.buildings.find(b => b.id === 'farm.outpost.tower1');
ok(Math.abs(SE.solidAt(farm, tower.pos[0], tower.pos[2]) - (tower.pos[1] + 16)) < 1e-9, 'tower roof = ground + 16');
ok(SE.solidAt(farm, tower.pos[0] + 3.5, tower.pos[2]) == null, 'just outside the tower: no solid');
ok(SE.solidAt(farm, tower.pos[0] + 3.5, tower.pos[2], 1) != null, 'pad widens the footprint');
const out = farm.places.find(p => p.id === 'farm.outpost');
const ringAt = a => { const r = 24, yaw = out.yaw; const lx = Math.sin(a) * r, lz = Math.cos(a) * r; return [out.x + lx * Math.cos(yaw) + lz * Math.sin(yaw), out.z - lx * Math.sin(yaw) + lz * Math.cos(yaw)]; };
{
  let wall = 0, n = 0;
  for (let a = 0.5; a < Math.PI * 2 - 0.5; a += 0.1) { n++; const q = ringAt(a); if (SE.solidAt(farm, q[0], q[1]) != null) wall++; }
  ok(wall === n, 'palisade closes the ring away from the gate (' + wall + ' / ' + n + ')');
  const g = ringAt(0);
  ok(SE.solidAt(farm, g[0], g[1], 1.5) == null, 'the gate (local +Z) is open');
}
ok(SE.solidAt(farm, 0, 0) == null && SE.solidAt(null, 0, 0) == null, 'no solid far from settlements / without a town');
{
  const h = SE.hit(farm, tower.pos[0] + 1, tower.pos[2], 0);
  ok(h && h.b.id === tower.id && Math.abs(h.nx - 1) < 1e-9 && Math.abs(h.depth - 2) < 1e-9, 'hit: outward normal and depth');
}
ok(SE.near(farm, out.x + 10, out.z, 50).id === 'farm.outpost' && SE.near(farm, 0, 0, 50) == null, 'near: settlement within range');

// 4. walking: the dragon cannot walk through a building, slides along it, and walks through the gate
function grounded(regionId, x, z, yaw, stage) {
  const cs = S.create({ regionId, rng: mulberry(5) });
  cs.field.list.length = 0; cs.field.herds.length = 0;
  cs.dragon.stage = stage || 0; cs.dragon.hunger = 100;
  const sc = S.scaleOf(cs);
  cs.dragon.pilot = F.newPilot([x, WK.standY({ regionId }, x, z, sc), z], yaw, 0);
  Object.assign(cs.dragon.pilot, { mode: 'ground', speed: 0 });
  return cs;
}
{
  const ang = Math.atan2(tower.pos[0] - out.x, tower.pos[2] - out.z);   // from the outpost centre toward the tower
  const x0 = tower.pos[0] - Math.sin(ang) * 14, z0 = tower.pos[2] - Math.cos(ang) * 14;
  const cs = grounded('farm', x0, z0, ang);
  const p = cs.dragon.pilot, sc = S.scaleOf(cs);
  let minD = Infinity;
  for (let i = 0; i < 600; i++) { S.step(cs, { sy: 1 }, dt); minD = Math.min(minD, Math.hypot(p.pos[0] - tower.pos[0], p.pos[2] - tower.pos[2])); }
  ok(minD >= tower.r + D.settlement.pad * sc - 0.05, 'walking straight at a tower stops at its wall (closest ' + minD.toFixed(2) + ')');
  ok(Math.abs(p.pos[1] - WK.standY({ regionId: 'farm' }, p.pos[0], p.pos[2], sc)) < 1e-6, 'still standing on the ground, not on the roof');
}
{
  // a glancing walk past the barracks slides along it instead of stopping dead
  const bar = farm.buildings.find(b => b.id === 'farm.outpost.barracks1');
  const sc = 1, rr = bar.r + D.settlement.pad * sc;
  const cs = grounded('farm', bar.pos[0] - 14, bar.pos[2] + rr * 0.5, Math.PI / 2 - 0.35);
  const p = cs.dragon.pilot, x0 = p.pos[0], z0 = p.pos[2];
  let inside = 0;
  for (let i = 0; i < 300; i++) { S.step(cs, { sy: 1 }, dt); if (Math.hypot(p.pos[0] - bar.pos[0], p.pos[2] - bar.pos[2]) < rr - 0.05) inside++; }
  ok(inside === 0 && Math.hypot(p.pos[0] - x0, p.pos[2] - z0) > 20, 'a glancing walk slides past the barracks (moved ' + Math.hypot(p.pos[0] - x0, p.pos[2] - z0).toFixed(1) + ')');
}
{
  // through the gate: start outside in front of it, walk in to the centre
  const g = ringAt(0), gOut = [g[0] + Math.sin(out.yaw) * 14, g[1] + Math.cos(out.yaw) * 14];
  const cs = grounded('farm', gOut[0], gOut[1], out.yaw + Math.PI);
  const p = cs.dragon.pilot;
  for (let i = 0; i < 360; i++) S.step(cs, { sy: 1 }, dt);
  ok(Math.hypot(p.pos[0] - out.x, p.pos[2] - out.z) < 18, 'a hatchling walks in through the outpost gate (' + Math.hypot(p.pos[0] - out.x, p.pos[2] - out.z).toFixed(1) + ' from the centre)');
  // and the wall stops it walking out the back
  p.yaw = out.yaw + Math.PI;
  let maxR = 0;
  for (let i = 0; i < 600; i++) { S.step(cs, { sy: 1 }, dt); maxR = Math.max(maxR, Math.hypot(p.pos[0] - out.x, p.pos[2] - out.z)); }
  ok(maxR < 24 - 1, 'the palisade stops a walk out the back (max ' + maxR.toFixed(1) + ' from the centre)');
}

// 5. flying: low into a tower = pushed out (never inside), over its roof = fine; landing on a roof is refused
{
  const ang = Math.atan2(tower.pos[0] - out.x, tower.pos[2] - out.z);
  const x0 = tower.pos[0] - Math.sin(ang) * 80, z0 = tower.pos[2] - Math.cos(ang) * 80;
  const cs = grounded('farm', x0, z0, ang);
  const p = cs.dragon.pilot;
  Object.assign(p, { mode: 'air', speed: 30, pos: [x0, tower.pos[1] + 7, z0] });
  let inside = 0;
  for (let i = 0; i < 300; i++) {
    S.step(cs, { sy: 0 }, dt);
    const roof = SE.solidAt(cs.town, p.pos[0], p.pos[2]);
    if (roof != null && p.pos[1] < roof - 0.01) inside++;
  }
  ok(inside === 0, 'a low flight at a tower never ends up inside it');
  p.pos = [tower.pos[0], tower.pos[1] + 30, tower.pos[2]]; p.pitch = 0; p.speed = 20;
  const c = WK.canLand(Object.assign({}, p, { pos: [tower.pos[0], tower.pos[1] + 16 + 6, tower.pos[2]] }), 'farm', S.solids(cs, 1).solidAt);
  ok(!c.ok && (c.why === 'roof' || c.why === 'high'), 'landing on a tower roof is refused (' + c.why + ')');
  const vault = farm.buildings.find(b => b.id === 'farm.outpost.vault1');
  const lp = Object.assign({}, p, { pos: [vault.pos[0], vault.pos[1] + 9, vault.pos[2]] });
  const c2 = WK.canLand(lp, 'farm', S.solids(cs, 1).solidAt);
  ok(!c2.ok && c2.why === 'roof', 'landing on the vault roof is refused: roof');
}
{
  // flying over a roof lower than the floor pull-up: the roof counts as ground
  const bar = farm.buildings.find(b => b.id === 'farm.outpost.barracks1');
  const cs = grounded('farm', bar.pos[0], bar.pos[2] - 60, 0);
  const p = cs.dragon.pilot;
  Object.assign(p, { mode: 'air', speed: 30, yaw: 0, pos: [bar.pos[0], bar.pos[1] + 9, bar.pos[2] - 60] });
  let below = 0;
  for (let i = 0; i < 240; i++) { S.step(cs, { sy: -0.3 }, dt); const roof = SE.solidAt(cs.town, p.pos[0], p.pos[2]); if (roof != null && p.pos[1] < roof) below++; }
  ok(below === 0, 'a dive across the barracks roof never goes through it');
}

// 6. discovery: in range and in sight -> discovered once, saved; then a compass marker
{
  const cs = grounded('farm', out.x + 200, out.z, -Math.PI / 2);
  const p = cs.dragon.pilot;
  Object.assign(p, { mode: 'air', speed: 30, pos: [out.x + 400, T.surfaceAt('farm', out.x + 400, out.z) + 60, out.z] });
  let ev = [];
  for (let i = 0; i < 60; i++) ev = ev.concat(S.step(cs, { sy: 0 }, dt));
  ok(!ev.some(e => e.e === 'place:discovered' && e.id === 'farm.outpost'), 'not discovered from 400 away');
  ok(!NV.markers(cs).some(m => m.kind === 'settlement'), 'no settlement marker before discovery');
  p.pos = [out.x + 180, T.surfaceAt('farm', out.x + 180, out.z) + 60, out.z];
  ev = [];
  for (let i = 0; i < 60; i++) ev = ev.concat(S.step(cs, { sy: 0 }, dt));
  const d = ev.filter(e => e.e === 'place:discovered' && e.id === 'farm.outpost');
  ok(d.length === 1 && d[0].type === 'outpost', 'discovered once within range and sight');
  for (let i = 0; i < 60; i++) ok(!S.step(cs, { sy: 0 }, dt).some(e => e.e === 'place:discovered' && e.id === 'farm.outpost'), 'no second discovery event');
  const m = NV.markers(cs).find(q => q.key === 'place:farm.outpost');
  ok(m && m.kind === 'settlement' && m.label.key === 'c.place.outpost', 'settlement marker on the compass');
  const saved = SV.serialise(cs);
  ok(Array.isArray(saved.regions.farm.discovered) && saved.regions.farm.discovered.includes('farm.outpost'), 'discovered places go into the save');
  const back = SV.deserialise(JSON.parse(JSON.stringify(saved)), mulberry(2));
  ok(back.discovered['farm.outpost'] === true && !back.discovered['farm.village'], 'and come back on load');
}
{
  // line of sight: a hill between the dragon and the settlement hides it
  const pl = { x: 0, z: 0, y: 0 };
  ok(NV.seesPlace('farm', [100, 50, 0], Object.assign({}, pl, { y: T.surfaceAt('farm', 0, 0) })), 'open ground: seen');
  const fake = 'farm';
  // a dragon skimming the ground behind the plateau rim cannot see a point low on the far side
  let hidden = 0, n = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.5) {
    const x = Math.sin(a) * 240, z = Math.cos(a) * 240;
    n++;
    if (!NV.seesPlace(fake, [x, T.surfaceAt(fake, x, z) - 50, z], Object.assign({}, pl, { y: T.surfaceAt(fake, 0, 0) }))) hidden++;
  }
  ok(hidden === n, 'from below the ground nothing is seen (LOS uses the terrain)');
}

// 7. region change rebuilds the town; i18n names exist
{
  const cs = S.create({ regionId: 'wild', rng: mulberry(3) });
  ok(S.ensureTown(cs).region === 'wild', 'town follows the region (wild)');
  cs.region = 'farm';
  ok(S.ensureTown(cs).region === 'farm' && cs.town.places.length === 3, 'and is rebuilt for the farm');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'i18n.js'), 'utf8');
  for (const type of Object.keys(D.settlements)) ok(src.split("'c.place." + type + "'").length === 3, 'EN and CS name for ' + type);
}
