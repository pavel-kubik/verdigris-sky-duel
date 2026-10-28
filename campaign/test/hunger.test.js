// Hunger: drain rates per stage, state boundaries, HP floor under starvation, regen when well fed.
'use strict';
const { ok, near, core } = require('./harness.js');
const Hn = core('hunger'), G = core('growth'), D = core('data');
const H = D.hunger, dt = 1 / 60;
const dragon = (stage, hunger, hp) => ({ stage, foodXp: stage ? D.stages[stage].foodFrom : 0, hunger, hp: hp == null ? D.stages[stage].hp : hp });
const run = (d, secs, act) => { for (let i = 0; i < secs * 60; i++) Hn.step(d, dt, act); return d; };

// State boundaries
ok(Hn.stateOf(100) === 'fed' && Hn.stateOf(H.states.hungry + 0.01) === 'fed', 'fed above the hungry threshold');
ok(Hn.stateOf(H.states.hungry) === 'hungry' && Hn.stateOf(H.states.starving + 0.01) === 'hungry', 'hungry band');
ok(Hn.stateOf(H.states.starving) === 'starving' && Hn.stateOf(0) === 'starving', 'starving band');

// Drain rates: base, boost and breath extras, stage multiplier; resting pauses
{
  near(80 - run(dragon(0, 80), 10).hunger, H.drain * 10, 1e-6, 'hatchling base drain');
  near(80 - run(dragon(1, 80), 10).hunger, H.drain * 10 * D.stages[1].hungerMult, 1e-6, 'drake drains faster');
  near(80 - run(dragon(0, 80), 10, { boosting: true, breathing: true }).hunger, (H.drain + H.boostDrain + H.breathDrain) * 10, 1e-6, 'boost and breath drain extra');
  ok(run(dragon(0, 50), 60, { inLair: true }).hunger === 50, 'no drain while resting in the lair');
  ok(run(dragon(0, 1), 60).hunger === 0, 'hunger stops at 0');
  // full to empty for a hatchling in about 6 minutes, as the spec says
  const mins = H.max / H.drain / 60;
  ok(mins > 5 && mins < 7, 'hatchling empties in about 6 min: ' + mins.toFixed(1));
}

// Effects per state
{
  const fed = Hn.effects(90), fedLow = Hn.effects(50), hungry = Hn.effects(20), starving = Hn.effects(5);
  ok(fed.hpRegen === H.fedHpRegen && fedLow.hpRegen === 0, 'HP regenerates only above the fed regen threshold');
  ok(hungry.stRegenMult === H.hungryStRegenMult && hungry.hpRegen === 0 && hungry.canBreath, 'hungry: half stamina regen, no HP regen');
  ok(starving.speedMult === H.starving.speedMult && !starving.canBreath && starving.carryMax === H.starving.carryMax && starving.hpDrain > 0, 'starving effects');
  ok(fed.carryMax === Infinity && fed.speedMult === 1 && fed.canBreath, 'fed has no penalties');
}

// HP: regen when well fed (capped at max), starvation drains to the floor and never below
{
  const a = dragon(0, 100, 40); run(a, 20);
  near(a.hp, 40 + H.fedHpRegen * 20, 1e-6, 'fed regen'); ok(a.hp <= D.stages[0].hp, 'regen capped');
  const b = dragon(0, 100, 99.5); run(b, 30); ok(b.hp === D.stages[0].hp, 'regen stops at max HP');
  for (const stage of [0, 1]) {
    const floor = H.starving.hpFloor * D.stages[stage].hp;
    const s = dragon(stage, 5); let minHp = Infinity;
    for (let i = 0; i < 60 * 60 * 20; i++) { Hn.step(s, dt); minHp = Math.min(minHp, s.hp); }
    near(s.hp, floor, 1e-6, 'starvation settles exactly at the floor: stage ' + stage);
    ok(minHp >= floor - 1e-9, 'starvation never takes HP below the floor: stage ' + stage);
  }
  const hurt = dragon(0, 5, 10); run(hurt, 60);
  ok(hurt.hp === 10, 'starvation does not drain a dragon already below the floor (only other damage got it there)');
}

// State change is reported once when crossing a boundary
{
  const d = dragon(0, H.states.hungry + 0.5); const changes = [];
  for (let i = 0; i < 60 * 120; i++) { const c = Hn.step(d, dt); if (c) changes.push(c); }
  ok(changes.join(',') === 'hungry,starving', 'reports fed -> hungry -> starving once each: ' + changes.join(','));
}

// Feeding fills hunger (capped) and counts as growth food
{
  const d = dragon(0, 70);
  Hn.feed(d, 45);
  ok(d.hunger === H.max && d.foodXp === 45, 'feed caps hunger and adds the full meal as food XP');
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) ready = Hn.feed(d, 30);
  ok(ready && G.readyStage(d.foodXp, d.stage) === 1, 'feeding eventually makes the drake stage ready');
}
