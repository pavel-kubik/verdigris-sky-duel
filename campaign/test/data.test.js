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

// Regions: exits point at real regions, both ways, across a shared edge
const ids = Object.keys(D.regions);
ok(ids.includes(D.startRegion), 'start region exists');
ids.forEach(id => {
  const r = D.regions[id];
  ok(r.radius > 200 && r.ceiling > 100, 'region bounds: ' + id);
  r.herds.forEach(h => ok(D.prey[h.type] && h.ring[0] < h.ring[1] && h.ring[1] <= r.radius, 'herd valid: ' + id + '/' + h.type));
  r.exits.forEach(ex => {
    const to = D.regions[ex.to];
    ok(!!to, 'exit target exists: ' + id + ' -> ' + ex.to);
    // one world: the exit is a whole side, and the region on the other side has the way back on its opposite side
    const back = (to.exits || []).find(b => b.to === id);
    ok(back && ({ n: 's', s: 'n' })[ex.side] === back.side, 'the way back is on the opposite side: ' + id + ' -> ' + ex.to);
    const dz = to.origin[1] - r.origin[1];
    ok(Math.abs(Math.abs(dz) - (r.radius + to.radius)) < 1e-9 && (ex.side === 'n') === (dz > 0) && to.origin[0] === r.origin[0], 'neighbours share the edge: ' + id + ' -> ' + ex.to);
  });
});
// the one world: Prahold in the south at 0, 0, Mount Rip due north; the origins sit on the terrain chunk grid (seamless meshes)
ok(D.regions.bend.origin[0] === 0 && D.regions.bend.origin[1] === 0 && D.regions.ash.origin[1] > D.regions.wild.origin[1] && D.regions.wild.origin[1] > D.regions.farm.origin[1], 'Rip, Wildwood, Farmlands, Bend from north to south');
ids.forEach(id => ok(D.regions[id].origin.every(v => v % 300 === 0) && D.regions[id].radius % 300 === 0, 'origin and size on the chunk grid: ' + id));
const ash = D.regions.ash;
ok(ash.lair && Math.hypot(ash.lair.x, ash.lair.z) < ash.terrain.features[0].r, 'lair sits on the volcano');
