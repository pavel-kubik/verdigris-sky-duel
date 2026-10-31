// Upgrades and the altar (Phase 2 T20): catalogue, buy with hoard gold (never negative), effects merged and wired into
// stamina, roasting, building fire, arrow / bolt damage and smell; the altar station in the cave; saved with the dragon.
'use strict';
const { ok, near, core } = require('./harness.js');
const S = core('state'), D = core('data'), UP = core('upgrades'), F = core('flight'), WK = core('walk'), T = core('terrain'), PR = core('prey'),
  NV = core('nav'), LR = core('lair'), CV = core('cave'), CT = core('controls'), SV = core('save'), DF = core('defenders'), SE = core('settlement'), HN = core('hunger');
const { mulberry } = core('math');
const dt = 1 / 30;

function make(region, seed) {
  const cs = S.create({ regionId: region || 'wild', rng: mulberry(seed || 11) });
  cs.story.act = 2;
  cs.dragon.pilot = F.newPilot([0, T.surfaceAt(cs.region, 0, 0) + 150, 0], 0, 30);
  S.step(cs, {}, dt);
  return cs;
}

// 1. Catalogue: five upgrades, prey sense the cheapest (the first tithe chest buys better hunting)
{
  const ids = UP.list();
  ok(ids.length === 5 && ['prey_sense', 'iron_scales_1', 'wing_muscles_1', 'hotter_fire_1', 'guard_sight'].every(id => ids.includes(id)), 'five upgrades');
  ok(ids.every(id => D.upgrades[id].cost > 0), 'every upgrade costs gold');
  ok(ids.every(id => D.upgrades.prey_sense.cost <= D.upgrades[id].cost), 'prey sense is the cheapest');
  ok(D.upgrades.prey_sense.cost <= D.loot.tithe.gold * 3, 'prey sense within a few tithe chests');
  ok(D.cave.stations.altar && D.cave.stations.altar.length === 3, 'altar station in the cave');
}

// 2. Buy: needs the gold, once each, gold never negative
{
  const cs = make();
  ok(cs.upgrades.length === 0 && UP.affordable(cs).length === 0, 'new dragon owns and affords nothing');
  let r = UP.buy(cs, 'prey_sense');
  ok(!r.ok && r.why === 'gold' && cs.hoard.gold === 0 && r.events.length === 0, 'no gold: refused, nothing changes');
  ok(UP.buy(cs, 'nope').why === 'unknown', 'unknown id refused');
  cs.hoard.gold = 130;
  ok(UP.affordable(cs).join() === 'prey_sense', 'only prey sense affordable at 130');
  r = UP.buy(cs, 'prey_sense');
  ok(r.ok && cs.hoard.gold === 10 && UP.has(cs, 'prey_sense') && r.events[0].e === 'upgrade:bought' && r.events[0].gold === 10, 'bought: 120 out of the hoard');
  cs.hoard.gold = 1000;
  r = UP.buy(cs, 'prey_sense');
  ok(!r.ok && r.why === 'owned' && cs.hoard.gold === 1000, 'bought once only');
  // random spending never drives the gold below 0
  const rng = mulberry(5);
  for (let k = 0; k < 300; k++) {
    const c = { hoard: { gold: Math.floor(rng() * 400) }, upgrades: [] };
    for (let i = 0; i < 8; i++) {
      const id = UP.list()[Math.floor(rng() * 5)], before = c.hoard.gold, res = UP.buy(c, id);
      ok(c.hoard.gold >= 0, 'gold never negative');
      ok(res.ok ? c.hoard.gold === before - D.upgrades[id].cost : c.hoard.gold === before, 'gold moves only on a buy');
    }
  }
  const neg = { hoard: { gold: -50 }, upgrades: [] };
  ok(!UP.buy(neg, 'prey_sense').ok && UP.canBuy(neg, 'prey_sense').why === 'gold', 'a broken negative hoard buys nothing');
}

// 3. Effects: neutral without upgrades, multipliers multiply, flags OR
{
  const none = UP.effects([]);
  ok(Object.keys(UP.NONE).every(k => none[k] === UP.NONE[k]), 'no upgrades = neutral');
  const all = UP.effects(UP.list());
  near(all.arrowDamage, 0.7, 1e-12, 'arrows x 0.7'); near(all.boltDamage, 0.85, 1e-12, 'bolts x 0.85');
  near(all.smellRange, 1.6, 1e-12, 'smell x 1.6'); near(all.cookRate, 1.3, 1e-12, 'cook x 1.3'); near(all.burnRate, 1.3, 1e-12, 'burn x 1.3');
  near(all.stRegen, 1.2, 1e-12, 'regen x 1.2'); near(all.boostSt, 0.85, 1e-12, 'boost cost x 0.85'); near(all.takeoffSt, 0.7, 1e-12, 'takeoff x 0.7');
  ok(all.smellType && all.preyHighlight && all.showCones, 'flags on');
  const eff = UP.apply(HN.effects(30), all);
  near(eff.stRegenMult, HN.effects(30).stRegenMult * 1.2, 1e-12, 'apply: regen on top of hunger');
}

// 4. Iron scales cut arrow damage by 30% (and bolts by 15%) in the frame step
{
  const orig = DF.step;
  const hit = (ups, kind) => {
    const cs = make('farm');
    cs.upgrades = ups;
    const hp0 = cs.dragon.hp = 150;
    DF.step = () => [{ e: kind, damage: 10, pos: [0, 0, 0] }];
    try { S.step(cs, {}, dt); } finally { DF.step = orig; }
    return hp0 - cs.dragon.hp;
  };
  near(hit([], 'arrow:hit'), 10, 1e-9, 'arrow 10 without scales');
  near(hit(['iron_scales_1'], 'arrow:hit'), 7, 1e-9, 'arrow 7 with iron scales (-30%)');
  near(hit(['iron_scales_1'], 'bolt:hit'), 8.5, 1e-9, 'bolt 8.5 with iron scales (-15%)');
  near(hit(['prey_sense'], 'arrow:hit'), 10, 1e-9, 'other upgrades leave damage alone');
}

// 5. Wing muscles: cheaper takeoff, cheaper boost, faster stamina regen
{
  const ground = () => Object.assign(F.newPilot([0, 10, 0], 0, 0), { mode: 'ground', st: 100 });
  const up = UP.effects(['wing_muscles_1']), base = HN.effects(30), eff = UP.apply(base, up);
  const p0 = ground(), p1 = ground();
  WK.startTakeoff(p0, { cruise: 30 }, base); WK.startTakeoff(p1, { cruise: 30 }, eff);
  near(100 - p0.st, D.takeoff.st, 1e-9, 'takeoff cost'); near(100 - p1.st, D.takeoff.st * 0.7, 1e-9, 'takeoff cost x 0.7');
  const tired = ground(); tired.st = D.takeoff.st * 0.8;
  ok(!WK.startTakeoff(tired, { cruise: 30 }, base).ok, 'tired: no takeoff without wing muscles');
  const tired2 = ground(); tired2.st = D.takeoff.st * 0.8;
  ok(WK.startTakeoff(tired2, { cruise: 30 }, eff).ok, 'wing muscles: takeoff with less stamina');
  const fly = (e, inp) => {
    const p = F.newPilot([0, T.surfaceAt('wild', 0, 0) + 120, 0], 0, 30); p.st = 50;
    F.step(p, inp, 0.5, { regionId: 'wild', stats: { turn: 1, cruise: 30, boost: 54 }, effects: e });
    return p.st - 50;
  };
  near(fly(eff, { boost: true }), fly(base, { boost: true }) * 0.85, 1e-6, 'boost drains x 0.85');
  near(fly(eff, {}), fly(base, {}) * 1.2, 1e-6, 'regen x 1.2');
}

// 6. Hotter fire: prey roasts 30% faster; the building fire gets mult 1.3
{
  const cone = { origin: [0, 0, 0], dir: [0, 0, 1], range: 50, cone: 0.5 };
  const goat = () => ({ list: [{ id: 1, type: 'goat', state: 'graze', pos: [0, 0, 10], cook: 0, heat: 0, size: 1, food: 30, herd: 0, speed: 0 }], herds: [], nextId: 2 });
  const a = goat(), b = goat();
  PR.cook(a, cone, 0.2, mulberry(1)); PR.cook(b, cone, 0.2, mulberry(1), 1.3);
  near(b.list[0].cook, a.list[0].cook * 1.3, 1e-12, 'cook x 1.3');
  const orig = SE.burn;
  let mult = null;
  SE.burn = (town, c, d, opts) => { mult = opts.mult; return []; };
  try {
    const cs = make('farm');
    S.step(cs, {}, dt); ok(mult === 1, 'burn mult 1 without hotter fire');
    cs.upgrades = ['hotter_fire_1']; S.step(cs, {}, dt); near(mult, 1.3, 1e-12, 'burn mult 1.3 with hotter fire');
  } finally { SE.burn = orig; }
}

// 7. Prey sense: smell reaches 60% further, the compass names the prey
{
  const cs = make('wild');
  const r0 = NV.smellRange(cs);
  cs.upgrades = ['prey_sense'];
  near(NV.smellRange(cs), r0 * 1.6, 1e-9, 'smell range x 1.6');
  cs.nav.next = 0; S.step(cs, {}, dt); S.step(cs, {}, 1);
  const sc = NV.markers(cs).filter(m => m.kind.indexOf('scent') === 0);
  ok(sc.length > 0, 'some scent with prey sense');
  ok(sc.every(m => m.label.key === 'c.nav.scentType' && m.label.p.prey === 'c.prey.' + m.prey && D.prey[m.prey]), 'scent markers name the prey');
  cs.upgrades = [];
  ok(NV.markers(cs).filter(m => m.kind.indexOf('scent') === 0).every(m => m.label.key !== 'c.nav.scentType' && m.prey === undefined), 'no type without prey sense');
}

// 8. The altar station: in reach at its stone, the Action slot names it, buying there autosaves
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(3) });
  cs.dragon.pilot = F.newPilot(LR.mouthPos('ash').slice(), Math.PI, 30);
  LR.enter(cs);
  const A = D.cave.stations.altar, p = cs.dragon.pilot;
  p.pos[0] = A[0]; p.pos[2] = A[1] + A[2] + 2;
  S.step(cs, {}, dt);
  ok(cs.station === 'altar' && CT.slots(cs).action === 'altar', 'altar in reach, the Action slot offers it');
  ok(S.caveAct(cs, 'altar', 'guard_sight').length === 0, 'no gold: nothing happens at the altar');
  cs.hoard.gold = 320;
  const ev = S.caveAct(cs, 'altar', 'guard_sight');
  ok(ev.some(e => e.e === 'upgrade:bought' && e.id === 'guard_sight') && ev.some(e => e.e === 'save' && e.why === 'upgrade'), 'bought at the altar and saved');
  ok(cs.hoard.gold === 20 && UP.effects(cs).showCones, 'gold spent, guard sight on');
  ok(CV.act(cs, 'altar', 'guard_sight').length === 0, 'buying it again does nothing');
}

// 9. Save: owned upgrades survive a reload; unknown or repeated ids are dropped
{
  const cs = make('wild');
  cs.upgrades = ['prey_sense', 'iron_scales_1'];
  const o = JSON.parse(JSON.stringify(SV.serialise(cs)));
  ok(o.dragon.upgrades.join() === 'prey_sense,iron_scales_1', 'written into dragon.upgrades');
  const back = SV.deserialise(o, mulberry(3));
  ok(back && back.upgrades.join() === 'prey_sense,iron_scales_1', 'restored');
  o.dragon.upgrades = ['prey_sense', 'prey_sense', 'laser_eyes', 7, 'guard_sight'];
  const odd = SV.deserialise(o, mulberry(3));
  ok(odd && odd.upgrades.join() === 'prey_sense,guard_sight', 'unknown and repeated ids dropped');
  const blank = SV.deserialise(SV.blank(), mulberry(3));
  ok(blank && Array.isArray(blank.upgrades) && blank.upgrades.length === 0, 'a blank save owns nothing');
}
