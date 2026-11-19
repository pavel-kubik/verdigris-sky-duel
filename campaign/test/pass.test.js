// Highland Pass (Phase 4 T05, 004_task_highlands.md 4.2): real terrain south-west of Prague from core/dem-pass.js
// (the Barrand Cliffs over the river on the east side, the Prokop Gorge cutting west, the Hlubowick viaducts, the
// Maidenhold promontory), the region data, the exits from the Farmlands and the Bend and the late-Drake gate.
'use strict';
const { ok, near, core } = require('./harness.js');
const T = core('terrain'), D = core('data'), RG = core('region'), W = core('walk'), S = core('state'), F = core('flight'), G = core('growth'), MP = core('map'), AE = core('aerie');
const { mulberry } = core('math');
require('../core/dem-pass.js');
const id = 'pass', R = D.regions[id], B = core('demPass');

// 1. the bake decodes to its grid, and the heights at the checked spots are the real ones
const g = T.demGrid(id);
ok(g.n === 241 && g.h.length === 241 * 241, 'dem-pass.js decodes to 241 x 241');
const raw = Buffer.from(B.h, 'base64');
for (const [x, z] of [[-90, 320], [300, 20], [0, 0], [-600, 600]]) {
  const i = ((z + B.radius) / B.cell) * B.size + (x + B.radius) / B.cell;
  near(T.demHeight(id, x, z), raw[i] / B.metresPerUnit * R.terrain.exag + R.terrain.offset, 1e-4, 'demHeight at a grid point (' + x + ', ' + z + ')');
}
const metres = (x, z) => (T.demHeight(id, x, z) - R.terrain.offset) / R.terrain.exag * B.metresPerUnit + B.base;
ok(Math.abs(metres(-90, 320) - 332) <= 4, 'Maidenhold top (Divci hrady) about 332 m: ' + metres(-90, 320).toFixed(1));
ok(Math.abs(metres(-50, 40) - 215) <= 6, 'Prokop Gorge floor at its mouth about 215 m: ' + metres(-50, 40).toFixed(1));
ok(metres(0, -300) > 290, 'Barrandov top behind the cliffs over 290 m: ' + metres(0, -300).toFixed(1));
for (const [x, z] of [[-235, -600], [-400, -150], [-530, 400]]) {
  const m = metres(x, z);
  ok(m > 183 && m < 195, 'river level about 186-192 m at (' + x + ', ' + z + '): ' + m.toFixed(1));
}
ok(metres(-90, 320) - metres(-525, 300) > 100, 'Maidenhold stands over 100 m above the river');

// 2. the river runs along the east side (game -X = east), south to north
let east = 0, n = 0;
for (let z = -1000; z <= 900; z += 50) {
  for (let x = -1100; x <= 1100; x += 10) if (T.maskAt(id, x, z) > 0.5) { n++; if (x < -150) east++; }
}
ok(n > 100 && east === n, 'every wet cell lies east of x = -150 (' + east + ' / ' + n + ')');
ok(T.liquidAt(id, -300, -1050) === 'water' && T.liquidAt(id, -540, 600) === 'water', 'the river enters in the south and leaves in the north-east');
const lv = g.lineLevel;
ok(lv.every((v, i) => i === 0 || v <= lv[i - 1] + 1e-6), 'river level never rises downstream');
for (const [x, z] of [[-90, 325], [300, 10], [720, -120], [0, -300]]) ok(T.liquidAt(id, x, z) === null, 'dry at (' + x + ', ' + z + ')');

// 3. the Prokop Gorge cuts west, the viaducts span it: dry, level, walkable decks high over the gorge floor
{
  let deep = 0;
  for (let x = -50; x <= 350; x += 50) {
    let lo = Infinity, hiS = -Infinity, hiN = -Infinity;
    for (let z = -20; z <= 60; z += 10) lo = Math.min(lo, metres(x, z));
    for (let z = -120; z <= -40; z += 10) hiS = Math.max(hiS, metres(x, z));
    for (let z = 80; z <= 160; z += 10) hiN = Math.max(hiN, metres(x, z));
    if (hiS - lo > 40 && hiN - lo > 40) deep++;
  }
  ok(deep >= 7, 'the gorge is over 40 m deep with rims on both sides from x -50 to 350 (' + deep + ' of 9)');
}
const viaducts = R.terrain.features.filter(f => f.type === 'bridge' && f.kind === 'viaduct');
ok(viaducts.length === 2 && viaducts[0].len > viaducts[1].len, 'two Hlubowick viaducts, the big one first');
for (const f of viaducts) {
  const name = (f === viaducts[0] ? 'big' : 'small') + ' viaduct';
  const deck = T.deckAt(id, f.x, f.z), s = Math.sin(f.yaw), c = Math.cos(f.yaw);
  ok(deck && T.dryAt(id, f.x, f.z), name + ': the deck is there and dry');
  let floor = Infinity, maxStep = 0, prev = null;
  for (let v = -0.45; v <= 0.45; v += 0.05) {
    const x = f.x + s * v * f.len, z = f.z + c * v * f.len, y = T.surfaceAt(id, x, z);
    floor = Math.min(floor, T.meshAt(id, x, z));
    if (prev != null) maxStep = Math.max(maxStep, Math.abs(y - prev));
    prev = y;
  }
  ok(maxStep < 0.01, name + ': the deck is level');
  ok(deck.y - floor > 30, name + ': the deck stands ' + (deck.y - floor).toFixed(1) + ' units over the gorge floor');
  for (const e of [-0.5, 0.5]) {
    const x = f.x + s * e * (f.len + 4), z = f.z + c * e * (f.len + 4);
    ok(Math.abs(T.meshAt(id, x, z) - deck.y) < 12, name + ' end ' + e + ' meets the rim (' + (T.meshAt(id, x, z) - deck.y).toFixed(1) + ')');
  }
  for (const v of [-0.3, 0, 0.3]) {
    const p = { mode: 'air', pos: [f.x + s * v * f.len, deck.y + 5, f.z + c * v * f.len], speed: 10 };
    ok(W.canLand(p, id).ok, name + ': a dragon can land on the deck at ' + v);
  }
}
ok(viaducts[1].road === false && T.lineDist(id, 'road', viaducts[0].x, viaducts[0].z - viaducts[0].len / 2) < 8, 'the gold road reaches the big viaduct, none on the small one');

// 4. Maidenhold: a flat top at the promontory's height, a cliff face to the river that cannot be walked
{
  const top = T.heightAt(id, -90, 325), cr = R.terrain.features.find(f => f.type === 'cliff').r;
  ok(Math.abs(top - T.demHeight(id, -90, 325)) < 4, 'Maidenhold plateau level with the promontory top: ' + top.toFixed(1));
  let faces = 0;
  for (let k = -3; k <= 3; k++) {
    const a = -Math.PI / 2 + k * 0.12, at = d => [-90 + Math.sin(a) * d, 325 + Math.cos(a) * d];
    const drop = T.heightAt(id, ...at(cr - 6)) - T.heightAt(id, ...at(cr + 6));
    let steep = 0;
    for (let d = cr - 6; d <= cr + 4; d += 1) if (T.surfaceSlope(id, ...at(d)) > D.land.maxSlope * 2) steep++;
    if (drop > 10 && steep >= 4) faces++;
  }
  ok(faces === 7, 'the east face drops over 10 units within 12 and is too steep to walk (' + faces + ' of 7)');
  const p = { mode: 'air', pos: [-90 - cr - 2, T.surfaceAt(id, -90 - cr - 2, 325) + 5, 325], speed: 10 };
  ok(W.canLand(p, id).why === 'steep', 'no landing on the cliff face');
}
// the Barrand Cliffs: steep limestone over the river between the gorge mouth and Chuchel
{
  let steep = 0, n2 = 0;
  for (let z = -450; z <= -150; z += 25) {
    n2++;
    let best = 0;
    for (let x = -260; x <= -140; x += 5) best = Math.max(best, T.surfaceSlope(id, x, z));
    if (best > D.land.maxSlope * 2) steep++;
  }
  ok(steep >= n2 - 2, 'the Barrand Cliffs are too steep to walk along most of their length (' + steep + ' / ' + n2 + ')');
}

// 5. every settlement footprint (T06 builds on them) is flat and dry
for (const f of R.terrain.features.filter(ff => ff.type === 'plateau')) {
  const y0 = T.heightAt(id, f.x, f.z);
  let worst = 0, wet = 0;
  for (let k = 0; k < 16; k++) for (const rr of [0.4, 0.8, 0.98]) {
    const x = f.x + Math.sin(k * Math.PI / 8) * f.r * rr, z = f.z + Math.cos(k * Math.PI / 8) * f.r * rr;
    worst = Math.max(worst, Math.abs(T.heightAt(id, x, z) - y0));
    if (T.liquidAt(id, x, z) !== null) wet++;
  }
  ok(worst < 1e-9 && wet === 0, 'plateau (' + f.x + ', ' + f.z + ') is flat and dry');
}
for (const f of R.terrain.features.filter(ff => ff.type === 'road')) {
  ok(f.points.every(p => T.liquidAt(id, p[0], p[1]) === null), 'road points are on dry ground');
}
ok(R.nameKey === 'c.region.pass' && R.palette === 'pass' && R.minGrowth === 0.45, 'region name key, palette, late-Drake gate');
{
  const s = AE.site(id);
  ok(s && T.liquidAt(id, s.mouth[0], s.mouth[2]) === null && s.mouth[1] > T.surfaceAt(id, s.mouth[0], s.mouth[2]), 'the aerie in the Barrand Cliffs has a dry mouth above the ground');
}

// 6. map: in the world, linked to the Farmlands and the Bend, no longer a "later" region
ok(D.map.world.pass && !D.map.later.pass, 'the pass is a world region, not a later one');
ok(D.map.links.some(l => l.includes('pass') && l.includes('bend')) && D.map.links.some(l => l.includes('pass') && l.includes('farm')), 'map links to the Farmlands and the Bend');
ok(MP.stageFor(id) === 1, 'the map says a Drake can reach it');

// 7. travel: the Farmlands west and the Bend south-west lead here; a Drake below minGrowth gets "too small"
function makeCs(region, foodXp) {
  const cs = S.create({ regionId: 'ash', rng: mulberry(5) });
  S.enterRegion(cs, region);
  cs.dragon.stage = 1; cs.dragon.hp = 100; cs.dragon.foodXp = foodXp;
  return cs;
}
function flyOut(region, angle, foodXp) {
  const cs = makeCs(region, foodXp), r = D.regions[region].radius - 30;
  const x = Math.sin(angle) * r, z = Math.cos(angle) * r;
  cs.dragon.pilot = F.newPilot([x, T.surfaceAt(region, x, z) + 40, z], angle, 20);
  for (let i = 0; i < 4 && cs.region === region; i++) S.step(cs, { sx: 0, sy: 0, confirm: true }, 0.05);
  return cs;
}
for (const [from, angle] of [['farm', Math.PI / 2], ['bend', 3 * Math.PI / 4]]) {
  const e = D.regions[from].exits.find(x => x.to === id);
  ok(e && e.minStage === 1 && RG.inArc(angle, e.angleFrom, e.angleTo), from + ' has an exit to the pass for a Drake');
  const r = D.regions[from].radius - 30;
  const ex = RG.exitAt(from, [Math.sin(angle) * r, 200, Math.cos(angle) * r], angle);
  ok(ex && ex.to === id, 'flying out of the ' + from + ' at ' + angle.toFixed(2) + ' offers the pass');
  let low = 0;
  while (G.growthValue(low + 50) < R.minGrowth) low += 50;
  const small = flyOut(from, angle, low);
  ok(small.region === from && small.exitSmall && small.exitSmall.to === id, 'a Drake below growth ' + R.minGrowth + ' (' + G.growthValue(low).toFixed(2) + ') cannot take the exit from the ' + from);
  const big = flyOut(from, angle, low + 400);
  ok(big.region === id, 'a late Drake (' + G.growthValue(low + 400).toFixed(2) + ') flies from the ' + from + ' into the pass');
  const at = big.dragon.pilot.pos;
  ok(Math.hypot(at[0], at[2]) < R.radius && RG.exitAt(id, at, big.dragon.pilot.yaw) === null, 'arrives inside the pass, no exit offered at the entry');
}
{
  const cs = flyOut(id, -0.4, 5000);
  ok(cs.region === 'bend', 'north-east, down the river, back to the Bend');
  const cs2 = flyOut(id, Math.PI / 2, 5000);
  ok(cs2.region === 'farm', 'west back to the Farmlands');
}
