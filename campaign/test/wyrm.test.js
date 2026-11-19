// Wyrm stage (Phase 4 T03, 004_task_highlands.md 4.1 / 5.1): food XP 2400 qualifies for the Wyrm, the stage-up comes
// only at the nest (lair rest), its stats come from the stage row (carry 3, slower turn, hungrier), the chase camera
// pulls back with the scale and keeps more clearance over the terrain, a Wyrm still lands in the Vyshgard courtyard
// and on the wall walk, it lifts a cow (and a size 3 load a Drake cannot), the act stays 2 until the mother's fall
// (T13), and a Wyrm survives a save round trip.
'use strict';
const { ok, near, core } = require('./harness.js');
const D = core('data'), G = core('growth'), LR = core('lair'), S = core('state'), SE = core('settlement'), T = core('terrain'),
  W = core('walk'), F = core('flight'), PR = core('prey'), SY = core('story'), SV = core('save');
const { mulberry } = core('math');

const [, drake, wyrm] = D.stages;

/* the stage row */
ok(wyrm && wyrm.id === 'wyrm', 'a third stage: the wyrm');
ok(wyrm.foodFrom === 2400 && Math.abs(wyrm.growthFrom - 0.55) < 1e-9, 'wyrm from food XP 2400, growth 0.55');
ok(wyrm.carry === 3 && wyrm.breach === true, 'wyrm carries class 3 and may breach stone');
ok(D.growthCap.food === 4799 && D.growthCap.growth === 0.84, 'growth cap at the elder line');
ok(G.stageOf(2399).id === 'drake' && G.stageOf(2400).id === 'wyrm', 'food XP 2400 qualifies for the wyrm');
near(G.growthValue(2400), wyrm.growthFrom, 1e-9, 'growth at the wyrm threshold = its growthFrom');
ok(G.growthValue(1e9) <= D.growthCap.growth, 'growth stays under the cap');
near(G.scaleOf(2400, 2), wyrm.scaleFrom, 1e-9, 'a fresh wyrm starts at scaleFrom 2.5');
near(G.scaleOf(D.growthCap.food, 2), wyrm.scaleTo, 1e-3, 'a full wyrm reaches scaleTo 3.4 (the cap is one XP under the elder line)');
ok(G.scaleOf(2400, 2) > G.scaleOf(2400, 1), 'the stage-up is a visible size jump');
const st = G.statsOf(2);
ok(st.hpMax === 450 && st.carry === 3 && st.turn < G.statsOf(1).turn && st.hungerMult > G.statsOf(1).hungerMult, 'wyrm stats from the stage row');

/* stage-up only at the nest */
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(3) });
  Object.assign(cs.dragon, { stage: 1, foodXp: drake.foodFrom, hp: drake.hp });
  let ready = 0;
  for (let i = 0; i < 60; i++) if (G.addFood(cs.dragon, 30)) ready++;
  ok(ready === 1 && cs.dragon.stage === 1, 'eating to 2400+ makes the wyrm ready once, the stage stays drake');
  const r = LR.rest(cs);
  ok(r.grew && r.from === 1 && r.to === 2 && cs.dragon.stage === 2, 'the rest at the nest grows the wyrm');
  ok(r.events.some(e => e.e === 'stage:up' && e.to === 2), 'stage:up event to 2');
  ok(cs.dragon.hp === 450, 'rest heals to the wyrm hp');
  ok(SY.act(cs) === 2, 'a wyrm that has not seen the mother fall is still in act 2');
  ok(Math.abs(S.scaleOf(cs) - G.scaleOf(cs.dragon.foodXp, 2)) < 1e-9, 'state.scaleOf follows the wyrm stage');
}

/* camera: distance by scale, clearance over the terrain */
{
  near(G.camK(1), 1, 1e-12, 'camera factor 1 for a hatchling');
  near(G.camK(2), Math.pow(2, D.camera.scaleDist), 1e-12, 'camera factor = scale ^ scaleDist');
  ok(G.camK(3.4) > G.camK(2.4) && G.camK(2.4) > G.camK(1.5), 'the camera pulls back as the dragon grows');
  near(G.camFloor(10, 1), 10 + D.camera.clear, 1e-12, 'small body: 3 over the ground (as before T03)');
  ok(G.camFloor(10, 3.4) - 10 >= D.camera.clear * 3.4 - 1e-9, 'a wyrm keeps its camera at least clear x scale over the ground');
  // a full wyrm's chase camera (22 back, 7 up, x camK) never sits under its own floor: the floor wins over a hill
  const k = G.camK(3.4);
  ok(22 * k < 80 && 7 * k > D.camera.clear, 'wyrm camera distance stays in a sane range (' + (22 * k).toFixed(1) + ' back)');
}

/* carry: a cow and a size 3 load */
{
  const w = G.statsOf(2), dr = G.statsOf(1);
  const field = { list: [{ id: 1, type: 'cow', size: D.prey.cow.size, state: 'graze', pos: [0, 0, 0], herd: 1 }] };
  const pick = arr => arr[0] || null;
  ok(PR.inFront(field, pick, w, null).best && PR.inFront(field, pick, w, null).best.type === 'cow', 'a wyrm lifts a cow');
  const big = { list: [{ id: 2, type: 'ox', size: 3, state: 'graze', pos: [0, 0, 0], herd: 2 }] };
  ok(PR.inFront(big, pick, w, null).best && !PR.inFront(big, pick, dr, null).best, 'a size 3 load: a wyrm lifts it, a drake does not');
  ok(PR.inFront(big, pick, dr, null).heavy, 'for a drake the size 3 load is too heavy');
  ok(!PR.inFront(big, pick, w, { carryMax: 1 }).best, 'a starving wyrm (carryMax 1) cannot');
}

/* landing a wyrm in the Vyshgard courtyard and on the wall walk (the pad grows with the scale) */
{
  const town = SE.build('bend');
  const place = town.places.find(p => p.type === 'castle');
  const site = T.region('bend').settlements.find(s => s.type === 'castle');
  const cb = town.buildings.filter(b => b.place === place.id);
  const scale = wyrm.scaleTo, pad = D.settlement.pad * scale;
  const solidAt = (x, z) => SE.solidAt(town, x, z, pad), walkTop = (x, z) => SE.surfaceAt(town, x, z);
  const over = (x, z, alt) => F.newPilot([x, (SE.solidAt(town, x, z) || T.surfaceAt('bend', x, z)) + alt, z], 0, 20);
  // the courtyard: open ground inside the walls, sampled around the castle site
  let yardOk = 0, best = null;
  for (let dx = -40; dx <= 40; dx += 2) for (let dz = -40; dz <= 40; dz += 2) {
    const x = site.x + dx, z = site.z + dz;
    if (SE.solidAt(town, x, z, D.settlement.pad) != null) continue;
    if (Math.abs(T.surfaceAt('bend', x, z) - T.surfaceAt('bend', site.x, site.z)) > 0.8) continue;   // on the rock top
    const r = W.canLand(over(x, z, 6), 'bend', solidAt, walkTop);
    if (r.ok && r.top == null) { yardOk++; if (!best) best = [x, z]; }
  }
  ok(yardOk >= 4, 'a full wyrm (scale ' + scale + ') can land in the Vyshgard courtyard: ' + yardOk + ' spots');
  // the wall walk: the middle of the longest wall run
  const wall = cb.filter(b => b.type === 'wall').sort((a, b) => b.len - a.len)[0];
  const wx = (wall.seg[0] + wall.seg[2]) / 2, wz = (wall.seg[1] + wall.seg[3]) / 2;
  const r = W.canLand(over(wx, wz, 6), 'bend', solidAt, walkTop);
  ok(r.ok && r.top != null, 'a full wyrm can land on the wall walk (' + (r.why || 'ok') + ')');
  const keep = cb.find(b => b.type === 'keep');
  ok(W.canLand(over(keep.pos[0], keep.pos[2], 6), 'bend', solidAt, walkTop).why === 'roof', 'the keep roof still refuses a wyrm');
}

/* save round trip of a wyrm */
{
  const mem = () => { const m = {}; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const cs = S.create({ regionId: 'bend', rng: mulberry(9) });
  Object.assign(cs.dragon, { stage: 2, foodXp: 3000, hp: 400 });
  const store = mem();
  ok(SV.store(store, cs), 'a wyrm is stored');
  const l = SV.load(store);
  ok(l.status === 'ok', 'a wyrm save loads');
  const back = SV.deserialise(l.data, mulberry(9));
  ok(back.dragon.stage === 2 && Math.abs(back.dragon.foodXp - 3000) < 1 && back.dragon.hp === 400, 'stage, food XP and hp survive');
}
