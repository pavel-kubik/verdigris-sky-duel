// Growth: stage thresholds, continuous visual growth capped per stage, stage-up only on rest.
'use strict';
const { ok, near, core } = require('./harness.js');
const G = core('growth'), D = core('data');
const [hatch, drake] = D.stages;

// Stage thresholds
ok(G.stageOf(0).id === 'hatchling' && G.stageOf(drake.foodFrom - 1).id === 'hatchling', 'hatchling below the drake threshold');
ok(G.stageOf(drake.foodFrom).id === 'drake' && G.stageOf(D.growthCap.food).id === 'drake', 'drake from its threshold to the cap');
near(G.stageOf(drake.foodFrom / 2).progress, 0.5, 1e-9, 'progress halfway through the hatchling stage');

// Growth value: monotonic, 0 at start, at the stage boundary equals the drake's growthFrom, capped for phase 1
{
  let prev = -1;
  for (let xp = 0; xp <= D.growthCap.food; xp += 7) { const g = G.growthValue(xp); ok(g >= prev && g >= 0 && g <= D.growthCap.growth, 'growth monotonic and capped'); prev = g; }
  near(G.growthValue(0), 0, 1e-12, 'growth starts at 0');
  near(G.growthValue(drake.foodFrom), drake.growthFrom, 1e-9, 'growth at the drake threshold');
}

// Visual scale: grows with food inside a stage, capped at scaleTo until the dragon rests
{
  near(G.scaleOf(0, 0), hatch.scaleFrom, 1e-12, 'hatchling starts at scaleFrom');
  near(G.scaleOf(drake.foodFrom / 2, 0), (hatch.scaleFrom + hatch.scaleTo) / 2, 1e-9, 'halfway grown hatchling');
  near(G.scaleOf(2000, 0), hatch.scaleTo, 1e-12, 'an unrested hatchling stops at scaleTo');
  near(G.scaleOf(drake.foodFrom, 1), drake.scaleFrom, 1e-12, 'a fresh drake starts at its scaleFrom');
  ok(G.scaleOf(drake.foodFrom, 1) > G.scaleOf(drake.foodFrom, 0), 'resting makes a visible size jump');
  let prev = 0;
  for (let xp = 0; xp < drake.foodFrom; xp += 5) { const s = G.scaleOf(xp, 0); ok(s >= prev, 'scale grows monotonically'); prev = s; }
}

// addFood / readyStage / growUp: the stage changes only on rest, the "ready" moment fires once
{
  const d = { stage: 0, foodXp: 0 };
  let readyCount = 0;
  for (let i = 0; i < 40; i++) if (G.addFood(d, 30)) readyCount++;   // 1200 food
  ok(readyCount === 1, 'the ready moment fires exactly once');
  ok(d.stage === 0, 'eating alone never changes the stage');
  ok(G.readyStage(d.foodXp, d.stage) === 1, 'drake is ready');
  const r = G.growUp(d);
  ok(r.grew && r.from === 0 && r.to === 1 && d.stage === 1, 'rest grows the dragon');
  ok(!G.growUp(d).grew, 'resting again changes nothing');
  for (let i = 0; i < 200; i++) G.addFood(d, 45);
  ok(d.foodXp === D.growthCap.food && d.stage === 1, 'food XP is capped for phase 1, no wyrm yet');
  ok(!G.addFood(d, -50) && d.foodXp === D.growthCap.food, 'negative food is ignored');
  ok(G.readyStage(0, 1) === 1, 'readyStage never demotes');
}

// Stats follow the stage table
{
  const s0 = G.statsOf(0), s1 = G.statsOf(1);
  ok(s0.hpMax === hatch.hp && s1.hpMax === drake.hp && s1.carry === drake.carry && s1.turn === drake.turn, 'stats from the stage table');
}
