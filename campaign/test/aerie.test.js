// Aeries (Phase 3 T08): sites, discovery by sight, entering by flight and by the Move slot, banking loot at an aerie,
// death after banking keeps the gold, rest heals and saves, leave, compass and map markers, the world pauses inside.
'use strict';
const { ok, near, core } = require('./harness.js');
const AE = core('aerie'), S = core('state'), D = core('data'), F = core('flight'), T = core('terrain'), NV = core('nav'), MP = core('map'), CT = core('controls'), SV = core('save');
const { mulberry } = core('math');

const IN = { sx: 0, sy: 0, breath: false, boost: false, grab: false, eat: false, confirm: false, enter: false, land: false };

function makeCs(regionId, stage) {
  const cs = S.create({ regionId, rng: mulberry(5) });
  cs.dragon.stage = stage == null ? 1 : stage;
  cs.dragon.hp = 100;
  return cs;
}
/** The pilot `dist` out in front of the mouth, `up` above it, facing the mouth. */
function inFront(cs, dist, up) {
  const s = AE.site(cs.region);
  cs.dragon.pilot = F.newPilot([s.mouth[0] + s.dir[0] * dist, s.mouth[1] + (up || 0), s.mouth[2] + s.dir[1] * dist], s.facing + Math.PI, 20);
  return s;
}

// 1. sites: wild, farm, bend have one; the Ash Wastes has none; the mouth is above the ground, inside the region
{
  for (const id of ['wild', 'farm', 'bend']) {
    const s = AE.site(id);
    ok(!!s && s.id === id + '.aerie', id + ' aerie site');
    ok(s.mouth[1] > T.surfaceAt(id, s.x, s.z), id + ' mouth above the ground');
    ok(Math.hypot(s.x, s.z) < T.region(id).radius - 50, id + ' aerie inside the region');
    ok(!T.liquidAt(id, s.x, s.z), id + ' aerie not in water');
  }
  ok(AE.site('ash') === null, 'no aerie in the Ash Wastes');
}

// 2. discovery: needs range and sight; only once; not found -> no enter, no marker
{
  const cs = makeCs('bend');
  inFront(cs, 400, 60);
  ok(AE.discover(cs).length === 0 && !AE.found(cs), 'too far: not found');
  inFront(cs, 150, 40);
  ok(!AE.inMouth(cs) && !AE.canEnter(cs), 'not found: cannot enter');
  const ev = AE.discover(cs);
  ok(ev.length === 1 && ev[0].e === 'aerie:found' && ev[0].id === 'bend.aerie', 'found in sight: ' + JSON.stringify(ev));
  ok(AE.found(cs) && cs.discovered['bend.aerie'] === true, 'found flag in cs.discovered');
  ok(AE.discover(cs).length === 0, 'found only once');
  ok(NV.markers(cs).some(m => m.kind === 'aerie'), 'compass marker once found');
  ok(MP.model(cs, 'bend').places.some(p => p.kind === 'aerie' && p.id === 'bend.aerie'), 'map place once found');
  const other = makeCs('bend');
  inFront(other, 150, 40);
  ok(!NV.markers(other).some(m => m.kind === 'aerie') && !MP.model(other, 'bend').places.some(p => p.kind === 'aerie'), 'never shown before it is found');
}

// 3. discovery through state.step; a hill between the dragon and the aerie hides it (line of sight)
{
  const cs = makeCs('farm');
  inFront(cs, 120, 30);
  let found = false;
  for (let i = 0; i < 10 && !found; i++) found = S.step(cs, IN, 0.1).some(e => e.e === 'aerie:found');
  ok(found, 'state.step finds the aerie');
  const s = AE.site('farm'), low = makeCs('farm');
  low.dragon.pilot = F.newPilot([s.x + s.dir[0] * 150, s.ground - 30, s.z + s.dir[1] * 150], 0, 20);   // under the ground: no sight
  ok(AE.discover(low).length === 0, 'no sight, not found');
}

// 4. banking at an aerie: flying into the mouth enters, the strongbox goes onto the hoard; death after keeps the gold
{
  const cs = makeCs('bend');
  cs.discovered['bend.aerie'] = true;
  cs.carriedLoot = { id: 'bend.x.box', kind: 'strongbox', gold: D.loot.strongbox.gold, size: D.loot.strongbox.size, region: 'bend' };
  const gold0 = cs.hoard.gold;
  inFront(cs, 3, 0);
  ok(AE.inMouth(cs), 'in the mouth');
  const ev = S.step(cs, IN, 0.05);
  ok(ev.some(e => e.e === 'aerie:enter'), 'aerie:enter');
  const b = ev.find(e => e.e === 'hoard:banked');
  ok(!!b && b.at === 'aerie' && b.gold === D.loot.strongbox.gold, 'banked at the aerie');
  ok(cs.inAerie === 'bend' && cs.carriedLoot === null && cs.hoard.gold === gold0 + D.loot.strongbox.gold, 'gold on the hoard, claws empty');
  ok(CT.slots(cs).move === null && CT.slots(cs).action === null, 'no slots inside (the aerie panel has the buttons)');
  // the world waits inside: hunger does not move, no defenders' events, play time runs
  const h0 = cs.dragon.hunger, t0 = cs.stats.played, pos0 = cs.dragon.pilot.pos.slice();
  for (let i = 0; i < 20; i++) S.step(cs, Object.assign({}, IN, { sy: 1, boost: true }), 0.1);
  near(cs.dragon.hunger, h0, 1e-9, 'hunger paused inside');
  near(cs.stats.played - t0, 2, 1e-6, 'play time runs inside');
  ok(cs.dragon.pilot.pos.every((v, i) => Math.abs(v - pos0[i]) < 1e-9), 'the dragon stays on the ledge');
  // leave, then die: the banked gold stays
  const lv = S.aerieAct(cs, 'leave');
  ok(lv.some(e => e.e === 'aerie:leave') && cs.inAerie === null, 'leave');
  const s = AE.site('bend'), p = cs.dragon.pilot;
  ok(Math.hypot(p.pos[0] - s.mouth[0], p.pos[2] - s.mouth[2]) > D.aeries.mouthR * 2 && p.pos[1] > s.mouth[1], 'out in front of the mouth, above it');
  near(p.yaw, s.facing, 1e-9, 'facing out');
  let entered = false;
  for (let i = 0; i < 5; i++) entered = entered || S.step(cs, IN, 0.05).some(e => e.e === 'aerie:enter');
  ok(!entered, 'leaving does not enter again at once');
  cs.dragon.hp = 0;
  const dv = S.step(cs, IN, 0.05);
  ok(dv.some(e => e.e === 'dragon:died') && cs.hoard.gold === gold0 + D.loot.strongbox.gold, 'death after banking keeps the gold');
}

// 5. the Move slot: "Enter aerie" close by and heading to it; enter input enters; not when heading away
{
  const cs = makeCs('wild');
  cs.discovered['wild.aerie'] = true;
  inFront(cs, 30, 4);
  S.step(cs, IN, 0.02);
  ok(cs.aerieNear && CT.slots(cs).move && CT.slots(cs).move.kind === 'aerie', 'Move slot offers Enter aerie');
  ok(CT.moveInput(CT.slots(cs).move).enter === true, 'Enter aerie -> enter input');
  ok(cs.hint === 'aerie', 'hint aerie: ' + cs.hint);
  const ev = S.step(cs, Object.assign({}, IN, { enter: true }), 0.02);
  ok(ev.some(e => e.e === 'aerie:enter') && cs.inAerie === 'wild', 'entered by the Move slot');
  const away = makeCs('wild');
  away.discovered['wild.aerie'] = true;
  const s = inFront(away, 30, 4);
  away.dragon.pilot.yaw = s.facing;                                    // heading away from the mouth
  ok(!AE.near(away) && !AE.canEnter(away), 'not offered while heading away');
}

// 6. rest: heals, stamina full, no stage-up, autosaves ('save' why rest), counts as a rest; the found aerie is saved
{
  const cs = makeCs('farm', 0);
  cs.discovered['farm.aerie'] = true;
  cs.dragon.foodXp = D.stages[1].foodFrom + 10;                         // ready to grow: an aerie does not grow it
  inFront(cs, 2, 0);
  S.step(cs, IN, 0.05);
  ok(cs.inAerie === 'farm', 'inside');
  cs.dragon.hp = 5; cs.dragon.pilot.st = 10;
  const r0 = cs.flags.rested || 0;
  const ev = S.aerieAct(cs, 'rest');
  ok(ev.some(e => e.e === 'aerie:rest') && ev.some(e => e.e === 'save' && e.why === 'rest'), 'rest autosaves: ' + ev.map(e => e.e).join(','));
  ok(cs.dragon.hp === core('growth').statsOf(0).hpMax && cs.dragon.pilot.st === 100, 'healed');
  ok(cs.dragon.stage === 0, 'no stage-up at an aerie');
  ok(cs.flags.rested === r0 + 1, 'counts as a rest (mission retry)');
  const back = SV.deserialise(JSON.parse(JSON.stringify(SV.serialise(cs))), mulberry(1));
  ok(AE.found(back, 'farm'), 'the found aerie survives a save and load');
}

// 7. guards: no aerie in the Ash Wastes; region change clears inAerie; the lair clears it
{
  const cs = makeCs('ash');
  cs.dragon.pilot = F.newPilot([0, 80, 0], 0, 20);
  ok(AE.discover(cs).length === 0 && !AE.canEnter(cs) && AE.distToMouth(cs) === Infinity, 'Ash Wastes: nothing');
  ok(AE.rest(cs).length === 0 && AE.leave(cs).length === 0, 'rest / leave outside do nothing');
  const b = makeCs('bend');
  b.discovered['bend.aerie'] = true;
  inFront(b, 2, 0);
  S.step(b, IN, 0.05);
  ok(b.inAerie === 'bend', 'inside the Bend aerie');
  core('region').enter(b, 'farm', 'bend');
  ok(b.inAerie === null, 'region change clears it');
}
