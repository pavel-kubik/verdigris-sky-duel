// Data consistency: catches broken tuning edits before they reach the game.
'use strict';
const { ok, core } = require('./harness.js');
const D = core('data'), RG = core('region');
const { wrap } = core('math');

// Stages ascend and keep the "bigger = stronger but slower and hungrier" rule
for (let i = 1; i < D.stages.length; i++) {
  const a = D.stages[i - 1], b = D.stages[i];
  ok(b.foodFrom > a.foodFrom && b.growthFrom > a.growthFrom, 'stage thresholds ascend: ' + b.id);
  ok(b.scaleFrom > a.scaleTo, 'stage-up makes a visible size jump: ' + b.id);
  ok(b.hp > a.hp && b.carry >= a.carry, 'bigger stage is stronger: ' + b.id);
  ok(b.turn < a.turn && b.hungerMult > a.hungerMult && b.spot > a.spot, 'bigger stage is slower to turn, hungrier, easier to spot: ' + b.id);
}
ok(D.stages[0].foodFrom === 0 && D.stages[0].growthFrom === 0, 'first stage starts at zero');
ok(D.growthCap.food < 2400, 'phase 1 caps food XP below the wyrm threshold');
D.stages.forEach(s => ok(s.scaleTo > s.scaleFrom && s.cruise < s.boost, 'stage curves sane: ' + s.id));

// Hunger thresholds
const H = D.hunger;
ok(H.states.starving < H.states.hungry && H.states.hungry < H.fedHpRegenAbove && H.fedHpRegenAbove <= H.max, 'hunger thresholds ordered');
ok(H.start > H.states.hungry && H.start <= H.max, 'start fed');
ok(H.starving.hpFloor > 0 && H.starving.hpFloor < 1, 'starvation HP floor keeps the dragon alive');

// Prey
Object.entries(D.prey).forEach(([id, p]) => {
  ok(p.size >= 1 && p.food > 0 && p.hp > 0 && p.flee >= p.speed * 0.8, 'prey sane: ' + id);
  ok(p.herd[0] >= 1 && p.herd[1] >= p.herd[0], 'herd size range: ' + id);
  ok(!p.fights || (p.charge && p.charge.damage > 0 && p.charge.cooldown > 0), 'fighters define a charge: ' + id);
});
ok(D.prey.boar.size > D.stages[0].carry, 'a hatchling cannot lift a boar (must burn it)');
ok(D.roast.chunkSize <= D.stages[0].carry, 'roast chunks are liftable by a hatchling');

// Regions: exits and entries point at real regions, arcs are consistent both ways
const ids = Object.keys(D.regions);
ok(ids.includes(D.startRegion), 'start region exists');
ids.forEach(id => {
  const r = D.regions[id];
  ok(r.radius > 200 && r.ceiling > 100, 'region bounds: ' + id);
  r.herds.forEach(h => ok(D.prey[h.type] && h.ring[0] < h.ring[1] && h.ring[1] <= r.radius, 'herd valid: ' + id + '/' + h.type));
  r.exits.forEach(ex => {
    const to = D.regions[ex.to];
    ok(!!to, 'exit target exists: ' + id + ' -> ' + ex.to);
    ok(to.entries && to.entries[id], 'target has a matching entry: ' + ex.to + ' from ' + id);
    // leaving through the middle of the arc should enter on the opposite side of the next region
    const mid = (ex.angleFrom + ex.angleTo) / 2;
    // (or, Phase 3 T02, anywhere on the target's own arc back: the Bend's entry follows the real river, off centre)
    const back = (to.exits || []).find(b => b.to === id);
    ok(Math.abs(Math.abs(wrap(to.entries[id].angle - mid)) - Math.PI) < 1e-9 || (back && RG.inArc(to.entries[id].angle, back.angleFrom, back.angleTo)),
      'entry is opposite the exit: ' + id + ' -> ' + ex.to);
  });
});
const ash = D.regions.ash;
ok(ash.lair && Math.hypot(ash.lair.x, ash.lair.z) < ash.terrain.features[0].r, 'lair sits on the volcano');
