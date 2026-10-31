// Touch action layout (T101): the Action and Move context slots follow the game state;
// the Move slot's "Enter cave" enters the lair only close to the mouth.
'use strict';
const { ok, core } = require('./harness.js');
const S = core('state'), LR = core('lair'), T = core('terrain'), D = core('data'), F = core('flight'), CT = core('controls'), RG = core('region');
const { mulberry } = core('math');
const dt = 1 / 60;

function fresh(region, seed) {
  const cs = S.create({ regionId: region || 'ash', rng: mulberry(seed || 7) });
  const s = T.region(cs.region).spawn;
  cs.dragon.pilot = F.newPilot([s.x, Math.max(s.y, T.surfaceAt(cs.region, s.x, s.z) + 40), s.z], s.yaw, 30);
  return cs;
}
const mouth = LR.mouthPos('ash');

// 1. Nothing applies: both context slots hidden, Roll shown (airborne)
{
  const cs = fresh();
  cs.hint = null; cs.exit = null;
  const sl = CT.slots(cs);
  ok(sl.action === null && sl.move === null && sl.roll === true, 'empty sky: no context slots, Roll shown');
  ok(CT.slots(null).action === null && CT.slots(Object.assign({}, cs, { inLair: true })).move === null, 'no slots without a run, no Move inside the lair');
}

// 2. Action: grab while a prey is in reach or targeted, eat while carrying; not for a heavy or a far prey
{
  const cs = fresh();
  for (const [hint, want] of [['grab', 'grab'], ['swoop', 'grab'], ['heavy', null], ['near', null], ['lair', null]]) {
    cs.hint = hint;
    ok(CT.slots(cs).action === want, 'hint ' + hint + ' -> Action ' + want);
  }
  const g = cs.field.list[0]; g.state = 'carried'; cs.dragon.carried = g.id; cs.hint = 'eat';
  ok(CT.slots(cs).action === 'eat', 'carrying -> Action Eat');
  cs.hint = 'lairStore';
  ok(CT.slots(cs).action === 'eat', 'carrying near the lair -> Action Eat');
}

// 3. Action press is latched: a grab hold never also eats, an eat hold never grabs
{
  const a = CT.input('grab', true), b = CT.input('eat', true), c = CT.input('eat', false);
  ok(a.grab && !a.eat && b.eat && !b.grab && !c.eat && !c.grab, 'Action input follows the kind latched at press');
}

// 4. Move: Fly to <region> at an exit (confirm travels), as in phase 1 with Enter
{
  const cs = fresh('ash');
  const arc = D.regions.ash.exits[0], R = T.region('ash').radius;
  const ang = (arc.angleFrom + arc.angleTo) / 2, r = R - D.travel.edgeBand / 2;
  const x = Math.sin(ang) * r, z = Math.cos(ang) * r;
  cs.dragon.pilot = F.newPilot([x, T.surfaceAt('ash', x, z) + 60, z], ang, 30);
  S.step(cs, {}, dt);
  const sl = CT.slots(cs);
  ok(sl.move && sl.move.kind === 'travel' && sl.move.to === 'wild', 'at the Wildwood exit: Move = Fly to Wildwood');
  const mi = CT.moveInput(sl.move);
  ok(mi.confirm && !mi.enter, 'Move tap at an exit = confirm');
  const ev = S.step(cs, mi, dt);
  ok(cs.region === 'wild' && ev.some(e => e.e === 'region:enter'), 'Move tap travels to Wildwood');
}

// 5. Move: Enter cave only within enterRange of the mouth while heading toward it
{
  const cs = fresh();
  const p = cs.dragon.pilot;
  p.pos = [mouth[0], mouth[1] + 30, mouth[2] + (D.lair.nearRange + D.lair.enterRange) / 2]; p.yaw = Math.PI;
  S.step(cs, {}, dt);
  ok(cs.hint === 'lair' && !LR.canEnter(cs) && CT.slots(cs).move === null, 'near but beyond enterRange: no Enter cave yet');
  S.step(cs, { enter: true }, dt);
  ok(!cs.inLair, 'a stray enter input far out does nothing');
  p.pos = [mouth[0], mouth[1] + 20, mouth[2] + D.lair.enterRange * 0.6]; p.yaw = Math.PI;
  S.step(cs, {}, dt);
  const sl = CT.slots(cs);
  ok(sl.move && sl.move.kind === 'cave', 'close to the mouth: Move = Enter cave');
  p.yaw = 0;
  ok(!LR.canEnter(cs), 'heading away from the mouth: no Enter cave');
  p.yaw = Math.PI;
  const ev = S.step(cs, CT.moveInput(sl.move), dt);
  ok(cs.inLair && ev.some(e => e.e === 'lair:enter'), 'Move tap enters the lair');
  ok(CT.slots(cs).move === null && CT.slots(cs).action === null && !CT.slots(cs).roll, 'inside the lair, in the tunnel: no Move, no Roll, no station yet');
  for (let i = 0; i < 60 * 12 && cs.station !== 'nest'; i++) S.step(cs, { sx: 0, sy: 1 }, dt);
  ok(cs.inLair && CT.slots(cs).action === 'nest' && CT.isStation('nest') && !CT.isStation('grab'), 'T10: walking in toward the nest, the Action slot offers the nest');
}

// 6. Enter cave stores a carried prey like flying in
{
  const cs = fresh('ash', 9);
  const p = cs.dragon.pilot;
  const g = cs.field.list.find(q => q.type === 'goat') || cs.field.list[0];
  g.state = 'carried'; cs.dragon.carried = g.id;
  p.pos = [mouth[0], mouth[1] + 20, mouth[2] + D.lair.enterRange * 0.6]; p.yaw = Math.PI;
  S.step(cs, {}, dt);
  ok(cs.hint === 'lairStore' && CT.slots(cs).action === 'eat' && CT.slots(cs).move.kind === 'cave', 'carrying near the mouth: Eat and Enter cave');
  const ev = S.step(cs, CT.moveInput(CT.slots(cs).move), dt);
  ok(cs.inLair && ev.some(e => e.e === 'lair:stored') && cs.larder.length === 1, 'Enter cave stores the carried prey');
}
ok(typeof RG.exitAt === 'function', 'region module loaded');
