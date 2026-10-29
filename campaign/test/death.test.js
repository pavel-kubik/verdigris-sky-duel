// Death and respawn (T13): HP 0 from a boar kills, the carried prey is lost, the dragon wakes in the lair
// (back in the Ash Wastes) with HP 50% and hunger at least 40; stage, food XP and the larder stay; starvation never kills.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), LR = core('lair'), T = core('terrain'), D = core('data'), F = core('flight'), G = core('growth'), PR = core('prey');
const { mulberry } = core('math');
const dt = 1 / 60;

// a dragon in Wildwood carrying a deer, skimming right above a boar (seeded like hunt.test.js)
function inWild(seed) {
  const cs = S.create({ regionId: 'wild', rng: mulberry(seed || 33) });
  const d = cs.dragon;
  const boar = cs.field.list.find(p => p.type === 'boar');
  const deer = cs.field.list.find(p => p.type === 'deer');
  d.pilot = F.newPilot([boar.pos[0] + 5, boar.pos[1] + 5, boar.pos[2]], 0, 30);
  deer.state = 'carried'; d.carried = deer.id;
  return { cs, d, boar, deer };
}
// keep the dragon low next to the boar until it dies (or time runs out)
function hoverUntilDeath(cs, boar, secs) {
  const ev = [];
  for (let i = 0; i < secs / dt && !cs.inLair; i++) {
    const p = cs.dragon.pilot; p.pos = [boar.pos[0] + 5, boar.pos[1] + 5, boar.pos[2]]; p.pitch = 0;
    ev.push(...S.step(cs, {}, dt));
  }
  return ev;
}

ok(LR.home() === 'ash' && LR.mouthPos(LR.home()), 'the lair region is the Ash Wastes');
ok(D.lair.respawnHp === 0.5 && D.lair.respawnHunger === 40, 'respawn tunables in data.js');

// 1. A boar can now take the last HP: death while carrying drops the prey, wake in the lair with HP 50%, hunger >= 40
{
  const { cs, d, boar } = inWild();
  d.hp = 3; d.hunger = 12;
  const ev = hoverUntilDeath(cs, boar, 20);
  const died = ev.find(e => e.e === 'dragon:died');
  ok(!!died && died.cause === 'boar' && died.region === 'wild' && died.lost === 'deer', 'boar kill: dragon:died with cause, region and the lost prey');
  ok(ev.some(e => e.e === 'boar:hit'), 'killed by a boar hit');
  ok(cs.region === 'ash' && cs.inLair, 'wakes inside the lair in the Ash Wastes');
  ok(d.carried === null && !cs.field.list.some(q => q.state === 'carried'), 'carried prey is lost');
  ok(cs.larder.length === 0, 'the lost prey does not go into the larder');
  near(d.hp, 0.5 * G.statsOf(d.stage).hpMax, 1e-9, 'HP 50% of max');
  ok(d.hunger === 40, 'hunger raised to 40');
  ok(d.deaths === 1, 'death counted');
  const order = ev.map(e => e.e).filter(e => e === 'dragon:died' || e === 'region:enter' || e === 'lair:enter');
  ok(order.join() === 'dragon:died,region:enter,lair:enter', 'events in order: died, region swap, lair: ' + order.join());
  ok(ev.find(e => e.e === 'region:enter').respawn === true && ev.find(e => e.e === 'lair:enter').respawn === true, 'swap and lair events marked as respawn');
  const m = LR.mouthPos('ash'), p = d.pilot;
  ok(Math.hypot(p.pos[0] - m[0], p.pos[1] - m[1], p.pos[2] - m[2]) < 1e-9 && Number.isFinite(p.speed), 'pilot placed at the cave mouth');
  ok(cs.field.list.every(q => T.region('ash').herds.some(h => h.type === q.type)), 'Ash Wastes prey field after the swap');
}

// 2. Hunger above 40 is kept; stage, food XP and the larder survive death
{
  const { cs, d, boar } = inWild(33);
  d.stage = 1; d.foodXp = 700; d.hunger = 75; d.hp = 1;
  cs.larder.push({ type: 'goat', food: 20 });
  hoverUntilDeath(cs, boar, 20);
  ok(cs.inLair && d.hunger > 70 && d.hunger < 75, 'hunger above 40 is kept as it was (minus the flight drain): ' + d.hunger.toFixed(1));
  ok(d.stage === 1 && d.foodXp === 700 && cs.larder.length === 1, 'stage, food XP and larder kept');
  near(d.hp, 0.5 * D.stages[1].hp, 1e-9, 'drake wakes with half its larger HP');
}

// 3. Death in the Ash Wastes stays in the region (no swap event); HP 0 from any source kills on the next step
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(5) });
  const s = T.region('ash').spawn;
  cs.dragon.pilot = F.newPilot([s.x + 300, 150, s.z + 300], 1, 30);
  const field = cs.field;
  cs.dragon.hp = 0;
  const ev = S.step(cs, {}, dt);
  ok(ev.some(e => e.e === 'dragon:died' && e.cause === 'wounds' && e.lost === null), 'HP 0 (debug damage): died, nothing lost');
  ok(!ev.some(e => e.e === 'region:enter') && cs.field === field && cs.inLair, 'same region: no swap, prey field kept, in the lair');
}

// 4. After waking: rest heals fully, leave puts the dragon at the spawn, flight and hunger run again
{
  const { cs, d, boar } = inWild(33);
  d.hp = 1;
  hoverUntilDeath(cs, boar, 20);
  const h = d.hunger;
  for (let i = 0; i < 60; i++) S.step(cs, {}, dt);
  ok(cs.inLair && d.hunger === h, 'waiting in the lair: hunger paused');
  S.lairRest(cs);
  ok(d.hp === G.statsOf(d.stage).hpMax, 'rest after death heals fully');
  S.lairLeave(cs);
  for (let i = 0; i < 120; i++) S.step(cs, {}, dt);
  ok(!cs.inLair && cs.region === 'ash' && d.hunger < h, 'left the lair: flying in the Ash Wastes again');
}

// 5. Starvation never kills: 20 starving minutes stay at the HP floor, no death
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(8) });
  cs.dragon.pilot = F.newPilot([400, 160, -400], 2, 30);
  cs.dragon.hunger = 0;
  let deaths = 0;
  for (let i = 0; i < 20 * 60 * 10; i++) {                             // 20 min at 10 Hz
    cs.dragon.hunger = 0;
    if (S.step(cs, {}, 0.1).some(e => e.e === 'dragon:died')) deaths++;
  }
  ok(deaths === 0 && !cs.inLair, 'starvation alone never kills');
  near(cs.dragon.hp, D.hunger.starving.hpFloor * D.stages[0].hp, 1e-6, 'HP rests at the starvation floor');
}
