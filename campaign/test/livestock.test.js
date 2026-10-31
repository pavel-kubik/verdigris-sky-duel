// Livestock (Phase 2 T18): sheep and cows in the settlements' pens, taking one raises the alert, at alert 3 the pens
// are empty and the barn holds the herd, a burned barn releases it, empty pens restock away from the dragon.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), PR = core('prey'), D = core('data'), F = core('flight'), T = core('terrain'), AL = core('alert'), RG = core('region'), SV = core('save');
const { mulberry } = core('math');

const dt = 1 / 30;
const penned = (cs, pn) => cs.field.list.filter(p => p.pen && p.pen.id === pn.id);
const far = (cs, x, z) => { const p = cs.dragon.pilot; p.pos = [x, T.surfaceAt(cs.region, x, z) + 120, z]; p.speed = 20; };

function make(region, seed) {
  const cs = S.create({ regionId: region, rng: mulberry(seed || 5) });
  cs.story.act = 2;                                            // no mother in the way
  cs.dragon.pilot = F.newPilot([0, T.surfaceAt(region, 0, 0) + 150, 0], 0, 20);
  S.step(cs, {}, dt);
  return cs;
}

// 1. data: sheep and cow are livestock prey as in 002 4.6
{
  ok(D.prey.sheep && D.prey.sheep.livestock && D.prey.sheep.size === 1 && D.prey.sheep.food === 25, 'sheep: size 1, 25 food, livestock');
  ok(D.prey.cow && D.prey.cow.livestock && D.prey.cow.size === 2 && D.prey.cow.food === 60, 'cow: size 2, 60 food, livestock');
  ok(D.alert.add.livestock === 1, 'taking livestock adds 1 heat');
  ok(!D.regions.wild.herds.some(h => D.prey[h.type].livestock), 'no livestock in the region herds');
}

// 2. pens are stocked from the town: Wildwood hamlet 4 sheep, Farmlands village 5 sheep + 3 cows, hamlet 4 sheep
{
  const cs = make('wild');
  const pens = cs.town.pens;
  ok(pens.length === 1 && pens[0].type === 'sheep', 'Wildwood has the hamlet sheep pen');
  const sh = penned(cs, pens[0]);
  ok(sh.length === 4 && sh.every(p => p.type === 'sheep'), '4 sheep in the hamlet pen: ' + sh.length);
  ok(sh.every(p => Math.hypot(p.pos[0] - pens[0].pos[0], p.pos[2] - pens[0].pos[2]) <= pens[0].r), 'all inside the fence');
  ok(cs.field.list.filter(p => !p.pen).length <= D.preyAi.maxActive, 'wild prey still capped at maxActive');
  const n0 = cs.field.list.length;
  S.step(cs, {}, dt);
  ok(cs.field.list.length === n0, 'pens are stocked once, not every frame');

  const fm = make('farm');
  const byType = {};
  for (const pn of fm.town.pens) byType[pn.place + ':' + pn.type] = penned(fm, pn).length;
  ok(byType['farm.village:sheep'] === 5 && byType['farm.village:cow'] === 3 && byType['farm.hamlet:sheep'] === 4, 'Farmlands pens: ' + JSON.stringify(byType));
  ok(fm.field.herds.filter(h => h.pen).every(h => h.barn && fm.town.buildings.some(b => b.id === h.barn && b.type === 'barn')), 'every pen herd has its barn');
}

// 3. penned animals graze and flee inside the fence (a low dragon right over the pen for 30 s)
{
  const cs = make('wild', 9), pn = cs.town.pens[0], p = cs.dragon.pilot;
  let fled = false, out = 0;
  for (let i = 0; i < 30 / dt; i++) {
    p.pos = [pn.pos[0] + 14, pn.pos[1] + 12, pn.pos[2]]; p.speed = 12;
    S.step(cs, {}, dt);
    for (const s of penned(cs, pn)) {
      if (s.state === 'flee') fled = true;
      if (Math.hypot(s.pos[0] - pn.pos[0], s.pos[2] - pn.pos[2]) > pn.r + 1e-6) out++;
    }
  }
  ok(fled, 'the sheep panic when the dragon comes low');
  ok(out === 0, 'and never leave the pen (' + out + ' frames outside)');
  ok(penned(cs, pn).length === 4, 'all 4 still there');
}

// 4. taking a sheep raises the heat by 1 (once per animal), stats.livestockTaken counts it
{
  const cs = make('wild', 11), pn = cs.town.pens[0], p = cs.dragon.pilot, rs = () => cs.regionStates.wild;
  const sheep = penned(cs, pn)[0];
  const h0 = (rs() && rs().heat) || 0;
  p.pos = [sheep.pos[0], sheep.pos[1] + 3, sheep.pos[2]]; p.pitch = 0; p.speed = 10;
  const ev = S.step(cs, { grab: true }, dt);
  ok(ev.some(e => e.e === 'prey:grabbed' && e.type === 'sheep'), 'grabbed a sheep from the pen');
  near(rs().heat - h0, 1, 1e-6, 'heat +1 for the sheep');
  ok(cs.stats.livestockTaken === 1, 'stats.livestockTaken = 1');
  const q = PR.byId(cs.field, cs.dragon.carried);
  PR.release(cs.field, q, [pn.pos[0] + 40, 0, pn.pos[2]]); cs.dragon.carried = null;
  ok(!q.pen, 'a sheep dropped outside the fence runs free');
  p.pos = [q.pos[0], q.pos[1] + 3, q.pos[2]];
  const ev2 = S.step(cs, { grab: true }, dt);
  ok(ev2.some(e => e.e === 'prey:grabbed' && e.id === q.id), 'grabbed the same sheep again');
  near(rs().heat - h0, 1, 0.05, 'the same sheep does not count twice');
  ok(cs.stats.livestockTaken === 1, 'still 1 taken');
  // wild prey adds nothing
  const deer = cs.field.list.find(o => o.type === 'deer' && o.state === 'graze');
  S.step(cs, {}, dt);
  cs.dragon.carried = null; q.state = 'flee';
  const h1 = rs().heat;
  p.pos = [deer.pos[0], deer.pos[1] + 3, deer.pos[2]];
  const ev3 = S.step(cs, { grab: true }, dt);
  ok(ev3.some(e => e.e === 'prey:grabbed' && e.type === 'deer'), 'grabbed a deer');
  ok(rs().heat <= h1 + 1e-9, 'a deer raises no alert');
}

// 5. roasting a sheep in its pen counts as taking it
{
  const cs = make('wild', 12), pn = cs.town.pens[0];
  const flock = penned(cs, pn);
  flock[0].taken = true;                                       // grabbed and dropped before: already counted
  const cone = { origin: [pn.pos[0], pn.pos[1] + 0.8, pn.pos[2] - pn.r - 1], dir: [0, 0, 1], range: pn.r * 2 + 2, cone: 1.2 };
  const ev = PR.cook(cs.field, cone, D.roast.cookTime + 0.1, cs.rng).filter(e => e.e === 'prey:roasted' && e.type === 'sheep');
  ok(ev.length >= 2, 'sheep roast in their pen: ' + ev.length);
  ok(ev.every(e => e.id != null && e.taken === (e.id === flock[0].id)), 'prey:roasted names each sheep and whether it was taken before');
}

// 6. alert 3: pens empty, the barn holds the herd; below 3 they come out again
{
  const cs = make('farm', 13), rs = cs.regionStates.farm = cs.regionStates.farm || {};
  far(cs, -900, 0);
  rs.heat = 3; rs.lastIncident = cs.stats.played;
  const ev = S.step(cs, {}, dt);
  const ins = ev.filter(e => e.e === 'livestock:inside');
  ok(ins.length === 3, '3 herds go into their barns: ' + ins.length);
  ok(cs.town.pens.every(pn => penned(cs, pn).length === 0), 'all pens are empty at alert 3');
  const v = cs.town.pens.find(pn => pn.place === 'farm.village' && pn.type === 'cow');
  ok(PR.penCount(cs.field, v.id).inside === 3, 'the village barn holds the 3 cows');
  ok(AL.responses(3).livestockInside, 'livestockInside is the alert 3 response');
  for (let i = 0; i < 60; i++) S.step(cs, {}, dt);
  ok(cs.town.pens.every(pn => penned(cs, pn).length === 0), 'and they stay inside');
  rs.heat = 1.5;
  const ev2 = S.step(cs, {}, dt);
  ok(ev2.filter(e => e.e === 'livestock:out').length === 3, 'below 3 the herds come out');
  ok(penned(cs, v).length === 3 && PR.penCount(cs.field, v.id).inside === 0, 'cows back in their pen');
}

// 7. a burning barn releases the herd inside: free animals, fleeing; the pen restocks later, away from the dragon
{
  const cs = make('wild', 14), rs = cs.regionStates.wild = cs.regionStates.wild || {}, pn = cs.town.pens[0];
  far(cs, -700, 400);
  rs.heat = 3.5; rs.lastIncident = cs.stats.played;
  S.step(cs, {}, dt);
  const h = cs.field.herds.find(o => o.pen && o.pen.id === pn.id);
  ok(h.inside === 4, '4 sheep inside the hamlet barn');
  const barn = cs.town.buildings.find(b => b.id === h.barn);
  barn.fire = 1; barn.hp = 0.01;                               // burns down this frame
  const ev = S.step(cs, {}, dt);
  ok(ev.some(e => e.e === 'building:ruined' && e.type === 'barn'), 'the barn burns down');
  const rel = ev.find(e => e.e === 'livestock:released');
  ok(rel && rel.n === 4 && rel.type === 'sheep', 'livestock:released with the 4 sheep');
  const free = cs.field.list.filter(p => p.type === 'sheep' && !p.pen);
  ok(free.length === 4 && free.every(p => p.state === 'flee'), 'the sheep run free');
  ok(free.every(p => Math.hypot(p.pos[0] - barn.pos[0], p.pos[2] - barn.pos[2]) < barn.r + 4), 'out of the barn door');
  ok(h.inside === 0, 'the barn holds nothing now');
  // the free herd never respawns; the empty pen restocks after herdCooldown when the dragon is far
  for (const p of free) PR.remove(cs.field, p.id);
  rs.heat = 0;
  for (let t = 0; t < D.respawn.herdCooldown + 5; t += 1) S.step(cs, {}, 1);
  ok(penned(cs, pn).length === 4, 'the pen restocks after herdCooldown: ' + penned(cs, pn).length);
  ok(!cs.field.list.some(p => p.type === 'sheep' && !p.pen), 'released sheep do not come back on their own');
}

// 8. an empty pen does not restock under the dragon's eyes
{
  const cs = make('wild', 15), pn = cs.town.pens[0], p = cs.dragon.pilot;
  for (const s of penned(cs, pn)) PR.remove(cs.field, s.id);
  for (let t = 0; t < D.respawn.herdCooldown + 20; t += 1) { p.pos = [pn.pos[0] + 60, pn.pos[1] + 150, pn.pos[2]]; p.speed = 20; S.step(cs, {}, 1); }
  ok(penned(cs, pn).length === 0, 'no restock while the dragon is close');
  far(cs, -700, 400);
  S.step(cs, {}, 1);
  ok(penned(cs, pn).length === 4, 'restocked once it is gone');
}

// 9. pens belong to their region: travelling from Wildwood to Ash Wastes brings no sheep along
{
  const cs = make('wild', 16);
  RG.enter(cs, 'ash', 'wild');
  S.step(cs, {}, dt);
  ok(!cs.field.list.some(p => p.pen || D.prey[p.type] && D.prey[p.type].livestock), 'no livestock in the Ash Wastes field');
  RG.enter(cs, 'wild', 'ash');
  S.step(cs, {}, dt);
  ok(penned(cs, cs.town.pens[0]).length === 4, 'back in Wildwood the pen is stocked again');
}

// 10. stats.livestockTaken is saved
{
  const cs = make('wild', 17);
  cs.stats.livestockTaken = 3;
  const o = JSON.parse(JSON.stringify(SV.serialise(cs)));
  const cs2 = S.create({ regionId: 'ash', rng: mulberry(1) });
  SV.apply(cs2, o);
  ok(cs2.stats.livestockTaken === 3, 'livestockTaken survives a save');
}
