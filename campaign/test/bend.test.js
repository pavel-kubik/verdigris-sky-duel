// Veltava Bend (Phase 3 T02): real Prague terrain from core/dem-bend.js, the river from the baked mask, overlays
// (plateau, cliff, ruins, bridge), the region data of 003_task_missions.md 4.2 and the Farmlands exit.
'use strict';
const { ok, near, core } = require('./harness.js');
const T = core('terrain'), D = core('data'), RG = core('region'), W = core('walk'), ST = core('settlement');
require('../core/dem-bend.js');
const id = 'bend', R = D.regions[id], B = core('demBend');

// 1. the bake decodes to its grid, and the game heights follow the declared formula
const g = T.demGrid(id);
ok(g.n === 241 && g.h.length === 241 * 241 && g.wet.length === 241 * 241, 'dem-bend.js decodes to 241 x 241');
const raw = Buffer.from(B.h, 'base64');
for (const [x, z] of [[-200, -830], [-740, -230], [0, 0], [600, -600]]) {
  const i = ((z + B.radius) / B.cell) * B.size + (x + B.radius) / B.cell;
  near(T.demHeight(id, x, z), raw[i] / B.metresPerUnit * R.terrain.exag + R.terrain.offset, 1e-4, 'demHeight at a grid point (' + x + ', ' + z + ')');
}
const metres = (x, z) => (T.demHeight(id, x, z) - R.terrain.offset) / R.terrain.exag * B.metresPerUnit + B.base;
ok(Math.abs(metres(-200, -830) - 236) <= 2.5, 'Vyshgard rock about 236 m: ' + metres(-200, -830).toFixed(1));
ok(Math.abs(metres(-745, -230) - 326) <= 3.5, 'Petrovel about 326 m: ' + metres(-745, -230).toFixed(1));
ok(Math.abs(metres(-190, 250) - 229) <= 6, 'Lethna about 229 m: ' + metres(-190, 250).toFixed(1));
ok(metres(345, -45) > 230, 'Vitkar Ridge stands high over the river: ' + metres(345, -45).toFixed(1));
// the ground of the game follows the bake away from the overlays (detail noise only)
for (const [x, z] of [[600, -600], [-900, 400], [700, 900]]) {
  ok(Math.abs(T.heightAt(id, x, z) - T.demHeight(id, x, z)) < 0.7, 'heightAt = bake + detail at (' + x + ', ' + z + ')');
}

// 2. the river: water from the mask, in the south, under Karlsbridge, east after it and back west in the north
ok(T.liquidAt(id, -310, -1135) === 'water' && T.liquidAt(id, -345, -850) === 'water', 'the river enters in the south, west of the rock');
ok(T.maskAt(id, -410, -160) > 0.5 && T.liquidAt(id, -410, -160) === 'water', 'the river flows past Karlsbridge');
ok(T.liquidAt(id, 400, 250) === 'water' && T.liquidAt(id, 530, 510) === 'water', 'after Karlsbridge it turns east (Holeshwick loop)');
ok(T.liquidAt(id, -110, 670) === 'water' && T.liquidAt(id, -540, 730) === 'water', 'and loops back west in the north');
for (const [x, z] of [[-230, -200], [-220, -815], [345, -45], [-745, -230]]) ok(T.liquidAt(id, x, z) === null, 'dry at (' + x + ', ' + z + ')');
// the water level falls downstream (about 15 m over the region) and the river bed lies under it
const lv = g.lineLevel;
ok(lv.every((v, i) => i === 0 || v <= lv[i - 1] + 1e-6), 'river level never rises downstream');
const fall = (lv[0] - lv[lv.length - 1]) / R.terrain.exag * B.metresPerUnit;
ok(fall > 5 && fall < 25, 'river falls ' + fall.toFixed(1) + ' m through the region');
let wetBelow = 0, wetN = 0;
for (let k = 0; k < B.river.length; k++) {
  const [x, z] = B.river[k];
  if (T.maskAt(id, x, z) < 0.99 || T.deckAt(id, x, z) || Math.hypot(x, z) > R.radius - 60) continue;   // the boundary ridge rises at the edge
  wetN++;
  if (T.surfaceAt(id, x, z) < T.waterY(id, x, z) - 1) wetBelow++;
}
ok(wetN > 10 && wetBelow === wetN, 'the bed is under the water along the centre line (' + wetBelow + ' / ' + wetN + ')');
// dry shore: dry cells next to the river stand above the water surface (no puddles where the mask says dry)
let shoreBad = 0, shoreN = 0;
for (let x = -1100; x <= 1100; x += 20) for (let z = -1100; z <= 1100; z += 20) {
  if (Math.hypot(x, z) > 1100 || T.maskAt(id, x, z) > 0.01 || T.deckAt(id, x, z, 6)) continue;
  if (T.maskAt(id, x + 20, z) < 0.5 && T.maskAt(id, x - 20, z) < 0.5 && T.maskAt(id, x, z + 20) < 0.5 && T.maskAt(id, x, z - 20) < 0.5) continue;
  shoreN++;
  if (T.heightAt(id, x, z) < T.waterY(id, x, z)) shoreBad++;
}
ok(shoreN > 50 && shoreBad === 0, 'dry shore stays above the water (' + shoreBad + ' of ' + shoreN + ' below)');

// 3. bridges: dry, landable, walkable decks over the water
for (const f of R.terrain.features.filter(ff => ff.type === 'bridge')) {
  const name = f.kind === 'wood' ? 'wooden bridge' : 'Karlsbridge';
  const deck = T.deckAt(id, f.x, f.z);
  ok(deck && T.liquidAt(id, f.x, f.z) === null && T.dryAt(id, f.x, f.z), name + ': the deck is dry');
  ok(T.maskAt(id, f.x, f.z) > 0.5 || T.maskAt(id, f.x + 10, f.z + 10) > 0.5 || T.maskAt(id, f.x - 10, f.z - 10) > 0.5, name + ': it spans the river');
  ok(T.surfaceAt(id, f.x, f.z) >= T.waterY(id, f.x, f.z) + 1, name + ': the deck is above the water');
  const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
  let maxStep = 0, prev = null;
  for (let v = -0.45; v <= 0.45; v += 0.05) {
    const y = T.surfaceAt(id, f.x + s * v * f.len, f.z + c * v * f.len);
    if (prev != null) maxStep = Math.max(maxStep, Math.abs(y - prev));
    prev = y;
    ok(T.liquidAt(id, f.x + s * v * f.len, f.z + c * v * f.len) === null, name + ': dry along the deck at ' + v.toFixed(2));
  }
  ok(maxStep < 0.01, name + ': the deck is level');
  const p = { mode: 'air', pos: [f.x, T.surfaceAt(id, f.x, f.z) + 5, f.z], speed: 10 };
  ok(W.canLand(p, id).ok, name + ': a dragon can land on the deck');
}
// Karlsbridge reaches from bank to bank
{
  const f = R.terrain.features.find(ff => ff.type === 'bridge' && ff.towers), s = Math.sin(f.yaw), c = Math.cos(f.yaw);
  for (const e of [-0.5, 0.5]) ok(T.maskAt(id, f.x + s * e * (f.len + 8), f.z + c * e * (f.len + 8)) < 0.5, 'Karlsbridge end ' + e + ' is on dry land');
}

// 4. the Vyshgard rock: a flat top at the rock's height, a cliff face to the river that cannot be walked
{
  const top = T.heightAt(id, -220, -815);
  ok(Math.abs(top - T.demHeight(id, -230, -820)) < 3, 'Vyshgard plateau level with the rock top: ' + top.toFixed(1));
  ok(top > T.waterY(id, -345, -815) + 15, 'the rock stands well over the river');
  let faces = 0;
  const cr = R.terrain.features.find(f => f.type === 'cliff').r;   // the face starts at the cliff rim (T03: 84, room for the castle)
  for (let k = -3; k <= 3; k++) {
    const a = -Math.PI / 2 + k * 0.12, at = d => [-220 + Math.sin(a) * d, -815 + Math.cos(a) * d];
    const drop = T.heightAt(id, ...at(cr - 6)) - T.heightAt(id, ...at(cr + 6));
    let steep = 0;
    for (let d = cr - 6; d <= cr + 4; d += 1) if (T.surfaceSlope(id, ...at(d)) > D.land.maxSlope * 2) steep++;
    if (drop > 10 && steep >= 4) faces++;
  }
  ok(faces === 7, 'the west face drops over 10 units within 12 and is too steep to walk (' + faces + ' of 7)');
  const foot = T.heightAt(id, -220 - 84, -815);
  let rise = 0;
  for (let d = 84; d < 130; d += 2) rise = Math.max(rise, T.heightAt(id, -220 - d, -815) - foot);
  ok(rise < 2.5, 'below the face the ground runs on to the river (no ditch): rise ' + rise.toFixed(1));
  const p = { mode: 'air', pos: [-220 - 78, T.surfaceAt(id, -298, -815) + 5, -815], speed: 10 };
  ok(W.canLand(p, id).why === 'steep', 'no landing on the cliff face');
}

// 5. every settlement footprint is flat (plateaus), on dry ground, and the settlements build
for (const f of R.terrain.features.filter(ff => ff.type === 'plateau')) {
  const y0 = T.heightAt(id, f.x, f.z);
  let worst = 0;
  for (let k = 0; k < 16; k++) for (const rr of [0.4, 0.8, 0.98]) {
    const x = f.x + Math.sin(k * Math.PI / 8) * f.r * rr, z = f.z + Math.cos(k * Math.PI / 8) * f.r * rr;
    worst = Math.max(worst, Math.abs(T.heightAt(id, x, z) - y0));
    ok(T.liquidAt(id, x, z) === null, 'plateau (' + f.x + ', ' + f.z + ') is dry');
  }
  ok(worst < 1e-9, 'plateau (' + f.x + ', ' + f.z + ') is flat');
}
ok(R.settlements.every(s => T.plateauAt(id, s.x, s.z)), 'every settlement sits on a plateau');
ok(T.plateauAt(id, -220, -815), 'Vyshgard top keeps its plateau for the castle (T03)');
{
  const town = ST.build(id, {});
  ok(town && town.buildings.length > 10 && town.places.length === R.settlements.length, 'the Bend settlements build');
}

// 6. ruins, roads, names
ok(T.ruinsAt(id, -230, -200) && T.ruinsAt(id, -645, 0) && !T.ruinsAt(id, 600, 600), 'Staromark and Hradchan are ruins areas');
for (const f of R.terrain.features.filter(ff => ff.type === 'road')) {
  let wet = 0;
  for (const p of f.points) if (T.liquidAt(id, p[0], p[1])) wet++;
  ok(wet === 0, 'road points are on dry ground or a bridge');
}
ok(R.nameKey === 'c.region.bend' && R.palette === 'bend', 'region name key and palette');

// 7. travel: Farmlands <-> Bend, a hatchling is too small for it
{
  const e = D.regions.farm.exits.find(x => x.to === 'bend');
  ok(e && e.minStage === 1, 'the Farmlands exit to the Bend needs a Drake');
  const r = D.regions.farm.radius - 30, pos = [0, T.surfaceAt('farm', 0, r) + 40, r];
  const ex = RG.exitAt('farm', pos, 0);
  ok(ex && ex.to === 'bend', 'flying out north of the Farmlands offers the Bend');
  const at = RG.entryPoint('bend', 'farm');
  ok(at.pos[2] < -900 && Math.hypot(at.pos[0], at.pos[2]) < R.radius - D.travel.edgeBand, 'the dragon arrives in the south of the Bend');
  ok(RG.exitAt('bend', at.pos, at.yaw) === null, 'no exit offered at the entry');
  const back = RG.exitAt('bend', [Math.sin(Math.PI) * (R.radius - 30), 60, Math.cos(Math.PI) * (R.radius - 30)], Math.PI);
  ok(back && back.to === 'farm', 'south edge of the Bend leads back to the Farmlands');
  const fb = RG.entryPoint('farm', 'bend');
  ok(fb.pos[2] > 800, 'coming back, the dragon appears in the north of the Farmlands');
}
