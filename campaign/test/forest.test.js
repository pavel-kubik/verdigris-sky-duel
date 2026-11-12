// The living forest (shared/forest.js): one set of rules for the campaign, the co-op and the deathmatch.
'use strict';
const { ok, near } = require('./harness.js');
const VF = require('../../shared/forest.js');

const grid = (n, gap) => { const t = []; for (let i = 0; i < n * n; i++) t.push({ x: (i % n) * gap, y: 0, z: Math.floor(i / n) * gap, r: 4, h: 14 }); return t; };

// 1. Flying into a tree fells it along the flight; above the crown or beside it nothing happens
{
  const F = VF.create(grid(5, 20));
  ok(VF.hit(F, [0, 30, 0], 2, [10, 0, 0]).length === 0, 'above the top: no hit');
  ok(VF.hit(F, [9, 5, 0], 2, [10, 0, 0]).length === 0, 'beside the crown: no hit');
  const ev = VF.hit(F, [1, 5, 0], 2, [0, 0, 12]);
  ok(ev.length === 1 && ev[0].e === 'fell' && ev[0].i === 0 && ev[0].dz === 1, 'felled along the velocity');
  ok(F.list[0].st === 1, 'state: felled');
  ok(VF.hit(F, [1, 5, 0], 2, [0, 0, 12]).length === 0, 'a felled tree is not hit again');
  ok(VF.standing(F).length === 24, '24 left standing');
}

// 2. Fire breath: a tree in the cone catches fire after RULES.igniteHeat s; trees outside stay cold; heat cools off
{
  const F = VF.create(grid(5, 20));
  const dir = [0, 0, 1], from = [40, 8, -20];
  let ev = [], t = 0;
  while (!ev.length && t < 2) { ev = VF.heat(F, from, dir, 36, Math.cos(0.3), 1 / 60); t += 1 / 60; }
  ok(ev.length >= 1 && ev[0].e === 'ignite' && ev[0].i === 2 && ev[0].g === 0, 'the tree ahead catches fire');
  near(t, VF.RULES.igniteHeat / (1 + VF.RULES.cool), 0.05, 'after about the ignite time');
  ok(F.list[0].fire === 0 && F.list[4].fire === 0, 'trees outside the cone do not burn');
  const G = VF.create(grid(5, 20));
  VF.heat(G, from, dir, 36, Math.cos(0.3), 0.05);
  ok(G.list[2].heat > 0, 'warmed');
  for (let i = 0; i < 60; i++) VF.step(G, 0.05);
  ok(G.list[2].heat === 0 && G.list[2].fire === 0 && G.down.size === 0, 'cooled off again');
}

// 3. A fire burns out to a charred snag, spreads at most RULES.spread.hops trees on, and everything grows back
{
  const F = VF.create(grid(9, 9));
  VF.apply(F, { e: 'ignite', i: 40, g: 0 });
  ok(F.burning.size === 1, 'burning');
  const seen = { ignite: 0, burnt: 0, regrow: 0 };
  let maxGen = 0;
  for (let i = 0; i < 60 / 0.05; i++) VF.step(F, 0.05).forEach(e => { seen[e.e]++; if (e.e === 'ignite') maxGen = Math.max(maxGen, e.g); });
  ok(seen.ignite > 0, 'the fire spread to ' + seen.ignite + ' trees');
  ok(maxGen <= VF.RULES.spread.hops, 'not beyond ' + VF.RULES.spread.hops + ' hops');
  ok(seen.ignite < 60, 'the whole forest does not burn down (' + seen.ignite + ')');
  ok(F.burning.size === 0 && seen.burnt === seen.ignite + 1, 'every fire burnt out');
  ok(F.list[40].fire === 2, 'a charred snag is left');
  ok(VF.hit(F, [F.list[40].x + 3, 5, F.list[40].z], 1, [1, 0, 0]).length === 0 && VF.hit(F, [F.list[40].x + 0.5, 5, F.list[40].z], 1, [1, 0, 0]).length === 1, 'a snag is only its trunk');
  for (let i = 0; i < (VF.RULES.regrow + 5) / 0.25; i++) VF.step(F, 0.25).forEach(e => { seen[e.e]++; });
  ok(seen.regrow === seen.ignite + 1 && F.down.size === 0 && F.list.every(t => t.st === 0 && t.fire === 0), 'the forest grew back');
}

// 4. The same events give the same forest in every browser; a late joiner gets the state
{
  const A = VF.create(grid(9, 9)), B = VF.create(grid(9, 9));
  const evs = [{ e: 'ignite', i: 30, g: 0 }, { e: 'fell', i: 3, dx: 0.6, dz: 0.8 }, { e: 'fell', i: 30, dx: 1, dz: 0 }];
  evs.forEach(e => { ok(VF.apply(A, e), 'applied ' + e.e); VF.apply(B, JSON.parse(JSON.stringify(e))); });
  ok(!VF.apply(A, evs[1]) && !VF.apply(A, { e: 'fell', i: 9999 }) && !VF.apply(A, null), 'duplicates and junk change nothing');
  for (let i = 0; i < 1000; i++) { VF.step(A, 0.05); VF.step(B, 0.02); VF.step(B, 0.03); }   // 50 s: every fire is out
  ok(JSON.stringify(VF.snapshot(A)) === JSON.stringify(VF.snapshot(B)), 'same fires in both (different frame rates)');
  const C = VF.create(grid(9, 9));
  VF.restore(C, JSON.parse(JSON.stringify(VF.snapshot(A))));
  ok(JSON.stringify(VF.snapshot(C).map(r => [r[0], r[1], r[2] ? 1 : 0])) === JSON.stringify(VF.snapshot(A).map(r => [r[0], r[1], r[2] ? 1 : 0])), 'a late joiner sees the same trees down');
  VF.reset(C);
  ok(VF.snapshot(C).length === 0 && C.burning.size === 0, 'reset: all standing');
}

// 5. A fireball burst sets the trees around it alight
{
  const F = VF.create(grid(5, 20));
  const ev = VF.blast(F, [20, 6, 20], 9);
  ok(ev.length === 1 && ev[0].i === 6, 'the tree at the burst burns');
}

// 6. Every page loads the shared forest and the campaign's Ash Wastes have a living outer forest and lava streams
{
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..', '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
  for (const f of ['index.html', 'mp/index.html', 'campaign/index.html', 'campaign/dm/index.html']) {
    const s = read(f);
    for (const js of ['shared/textures.js', 'shared/forest.js', 'shared/forest-view.js']) ok(s.includes(js), f + ' loads ' + js);
  }
  const sw = read('sw.js');
  for (const js of ['shared/textures.js', 'shared/forest.js', 'shared/forest-view.js', 'campaign/render/volcano-view.js']) ok(sw.includes("'" + js + "'"), 'sw.js precaches ' + js);
  const { core } = require('./harness.js'), D = core('data'), T = core('terrain');
  ok(D.regions.ash.flora.far && D.regions.ash.flora.far.trees > 300, 'the Ash Wastes have a forest toward the rim');
  const flows = T.lavaFlows('ash');
  ok(flows.length >= 3, 'lava streams: ' + flows.length);
  for (const s of flows) {
    const r = (s.r0 + s.r1) / 2, a = T.flowAngle(s, r), x = Math.sin(a) * r, z = Math.cos(a) * r;
    ok(T.lavaAt('ash', x, z) > 0.95 && T.liquidAt('ash', x, z) === 'lava', 'the middle of a stream is lava');
    const w = T.flowWidth(s, r), px = Math.cos(a), pz = -Math.sin(a);
    ok(T.liquidAt('ash', x + px * w * 1.5, z + pz * w * 1.5) !== 'lava', 'beside it is ground');
    ok(Math.abs(Math.atan2(Math.sin(s.f.a), Math.cos(s.f.a))) > 0.9, 'no stream runs down the cave side');
  }
  const L = D.regions.ash.lair;
  ok(T.liquidAt('ash', L.x, L.z) == null && T.lavaAt('ash', D.regions.ash.spawn.x, D.regions.ash.spawn.z) === 0, 'the cave mouth and the spawn are clear of lava');
  ok(T.lavaFlows('wild').length === 0 && T.lavaAt('wild', 10, 10) === 0, 'no lava elsewhere');
}
