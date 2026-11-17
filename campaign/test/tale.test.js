// People on foot and the tales (core/hero.js, core/guise.js, core/tale.js): a person walks the streets but not through
// houses or into the river, jumps, runs out of breath; the dragon takes human form on the ground and back, unseen by
// guards; every tale (wizard, prince, princess) can be played to its end, every objective on open ground, every text
// in English and Czech.
'use strict';
const fs = require('fs'), path = require('path');
const { ok, core } = require('./harness.js');
const D = core('data'), T = core('terrain'), CI = core('city'), H = core('hero'), TL = core('tale'), GU = core('guise'), S = core('state'), F = core('flight');
const { mulberry } = core('math');
const dt = 1 / 60;
const ctxOf = id => ({ regionId: id, solidAt: (x, z) => CI.solidAt(id, x, z, 0.4), solidHit: (x, z) => CI.hit(id, x, z, 0.4) });

// 1. walking: forward on a street, blocked by a house wall, never into the river; jump and land; running tires
{
  const sq = CI.build('bend').squares.find(q => q.name === 'oldsq'), ctx = ctxOf('bend');
  const h = H.create('prince', [sq.x, T.surfaceAt('bend', sq.x, sq.z), sq.z], 0);
  for (let i = 0; i < 60; i++) H.step(h, { sy: 1 }, dt, ctx);
  ok(Math.hypot(h.pos[0] - sq.x, h.pos[2] - sq.z) > 2.5 && Math.abs(h.pos[1] - T.surfaceAt('bend', h.pos[0], h.pos[2])) < 1e-6, 'walks on the square, feet on the ground');
  const l = CI.build('bend').lots.find(q => q.district === 'staromark' && q.kind === 'house');
  const fx = l.x + Math.sin(l.yaw) * (l.d / 2 + 4), fz = l.z + Math.cos(l.yaw) * (l.d / 2 + 4);
  const w = H.create('wizard', [fx, T.surfaceAt('bend', fx, fz), fz], l.yaw + Math.PI);
  for (let i = 0; i < 240; i++) H.step(w, { sy: 1, run: true }, dt, ctx);
  ok(CI.sd(l, w.pos[0], w.pos[2]).d > 0, 'a house front stops the walker');
  ok(w.st < 100, 'running uses breath: ' + w.st.toFixed(0));
  const j = H.create('princess', [sq.x, T.surfaceAt('bend', sq.x, sq.z), sq.z], 0);
  const ev = H.step(j, { jump: true }, dt, ctx);
  ok(ev.some(e => e.e === 'hero:jump') && !j.ground, 'jumps');
  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) landed = H.step(j, {}, dt, ctx).some(e => e.e === 'hero:land');
  ok(landed && j.ground, 'lands again');
  // the river: walk west from the Staromark bank toward the Veltava - stops on the shore
  const r = H.create('prince', [340, T.surfaceAt('bend', 340, -60), -60], Math.PI / 2);
  for (let i = 0; i < 60 * 30; i++) H.step(r, { sy: 1 }, dt, ctx);
  ok(!T.liquidAt('bend', r.pos[0], r.pos[2]), 'never walks into the river');
  // the gift picks the target in front
  const g = H.create('wizard', [0, 0, 0], 0);
  const out = H.step(g, { act: true }, dt, { regionId: 'bend', targets: [{ id: 'a', pos: [0, 0, 20] }, { id: 'b', pos: [20, 0, 0] }] });
  ok(out.some(e => e.e === 'hero:gift' && e.target === 'a' && e.kind === 'bolt'), 'the spell flies at what is in front');
  ok(H.step(g, { act: true }, dt, { regionId: 'bend', targets: [] }).every(e => e.e !== 'hero:gift'), 'the gift has a cooldown');
}

// 2. the Guise: locked for a hatchling, only on the ground, guards do not see the person, back to a dragon
{
  const cs = S.create({ regionId: 'bend', rng: mulberry(5) });
  ok(GU.can(cs).why === 'locked', 'a hatchling has not learned the Guise');
  Object.assign(cs.dragon, { stage: 1, foodXp: D.stages[1].foodFrom, hp: D.stages[1].hp, hunger: 90 });
  const sq = CI.build('bend').squares.find(q => q.name === 'horse');
  cs.dragon.pilot = F.newPilot([sq.x, T.surfaceAt('bend', sq.x, sq.z) + 40, sq.z], 0, 30);
  S.step(cs, { guise: true }, dt);
  ok(cs.form !== 'human', 'not in the air');
  cs.dragon.pilot.pos[1] = T.surfaceAt('bend', sq.x, sq.z); cs.dragon.pilot.mode = 'ground';
  const ev = S.step(cs, { guise: true }, dt);
  ok(cs.form === 'human' && cs.hero && cs.hero.kind === 'dragonkin' && ev.some(e => e.e === 'guise:human'), 'on the ground the dragon takes human form');
  for (let i = 0; i < 120; i++) S.step(cs, { sy: 1 }, dt);
  ok(Math.hypot(cs.hero.pos[0] - sq.x, cs.hero.pos[2] - sq.z) > 3 && cs.dragon.pilot.pos[0] === cs.hero.pos[0], 'the person walks, the pilot follows');
  ok(!cs.watch || cs.watch.list.every(d => !(d.seen > 0)), 'no guard sees a dragon');
  for (let i = 0; i < 60 * 3; i++) S.step(cs, {}, dt);
  ok(S.step(cs, { guise: true }, dt).some(e => e.e === 'guise:blocked' && e.why === 'cramped') || cs.form === 'dragon', 'among houses there is no room for wings');
  if (cs.form === 'human') cs.hero.pos = [sq.x, T.surfaceAt('bend', sq.x, sq.z), sq.z];   // back in the middle of the Horse Market
  const back = S.step(cs, { guise: true }, dt);
  ok(cs.form === 'dragon' && back.some(e => e.e === 'guise:dragon') && cs.dragon.pilot.mode === 'ground', 'back to a dragon, standing: ' + JSON.stringify(back.filter(e => /guise/.test(e.e))));
}

// 3. every tale to its end: the hero stands at each objective and uses the gift where it is needed
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'i18n.js'), 'utf8');
const csAt = src.indexOf('\n    cs: {');
const keysIn = text => new Set([...text.matchAll(/'([a-zA-Z0-9_.]+)':/g)].map(m => m[1]));
const EN = keysIn(src.slice(0, csAt)), CS = keysIn(src.slice(csAt));
for (const id of Object.keys(D.tales)) {
  const def = D.tales[id], ts = TL.create(id);
  const st = def.start, h = H.create(def.hero, [st.x, T.surfaceAt('bend', st.x, st.z), st.z], st.yaw);
  ok(CI.solidAt('bend', st.x, st.z, 0.5) == null && !T.liquidAt('bend', st.x, st.z), id + ': starts on open ground');
  const keys = [];
  let ev = TL.start(ts, h);
  ok(ev[0].e === 'tale:card' && ts.card, id + ': opens with a card');
  let guard = 0, seen = 0;
  const log = e => { for (const x of e) { if (x.key) keys.push(x.key); for (const k of x.lines || []) keys.push(k); if (typeof x.end === 'string') keys.push(x.end); if (x.prev) keys.push(x.prev); if (x.e === 'tale:seen') seen++; } };
  log(ev);
  while (!ts.done && guard++ < 400) {
    if (ts.card) { log(TL.closeCard(ts, h)); continue; }
    const o = TL.objective(ts);
    keys.push(o.key);
    const goal = TL.nearestGoal(ts, h.pos[0], h.pos[2]);
    ok(goal && CI.solidAt('bend', goal[0], goal[2], 0) == null || o.type === 'gift', id + ': objective ' + o.key + ' on open ground');
    // stand next to it, facing it
    const tgt = TL.targetsFor(ts).find(q => Math.hypot(q.pos[0] - goal[0], q.pos[2] - goal[2]) < 0.1);
    const away = o.type === 'gift' ? Math.min(D.hero.kinds[def.hero].giftRange * 0.6, 2.4) : 0.5;
    h.pos = [goal[0] - Math.sin(h.yaw) * away, T.surfaceAt('bend', goal[0], goal[2]), goal[2] - Math.cos(h.yaw) * away];
    if (o.type === 'escort') {
      const f = ts.npcs.find(n => n.follow);
      for (let i = 0; i < 40; i++) log(TL.step(ts, h, [], dt));
      f.pos = [goal[0], goal[1], goal[2]];
    }
    if (o.type === 'gift' || o.type === 'talk') {
      const t2 = tgt || TL.targetsFor(ts)[0];
      h.yaw = Math.atan2(t2.pos[0] - h.pos[0], t2.pos[2] - h.pos[2]);
      if (o.type === 'talk') h.pos = [t2.pos[0] - Math.sin(h.yaw) * 1.5, t2.pos[1], t2.pos[2] - Math.cos(h.yaw) * 1.5];
      const g = H.step(h, { act: true }, dt, { regionId: 'bend', targets: TL.targetsFor(ts) }).filter(e => e.e === 'hero:gift');
      h.cool = 0; h.actT = 0;
      log(TL.step(ts, h, g, dt));
      continue;
    }
    log(TL.step(ts, h, [], dt));
  }
  ok(ts.done, id + ': the tale ends (' + guard + ' steps)');
  ok(seen === 0, id + ': standing at the goal is not being seen');
  const missEn = [...new Set(keys)].filter(k => !EN.has(k)), missCs = [...new Set(keys)].filter(k => !CS.has(k));
  ok(missEn.length === 0, id + ': English texts: ' + missEn.join(', '));
  ok(missCs.length === 0, id + ': Czech texts: ' + missCs.join(', '));
}

// 4. sneaking: walking into a guard's sight sends the hero back; a charmed guard looks away
{
  const ts = TL.create('princess'), def = D.tales.princess, st = def.start;
  const h = H.create('princess', [st.x, T.surfaceAt('bend', st.x, st.z), st.z], st.yaw);
  TL.start(ts, h); TL.closeCard(ts, h);
  const g = ts.guards[0], from = h.pos.slice();
  h.pos = [g.pos[0] + Math.sin(g.yaw) * 4, g.pos[1], g.pos[2] + Math.cos(g.yaw) * 4];
  const ev = TL.step(ts, h, [], dt);
  ok(ev.some(e => e.e === 'tale:seen') && Math.hypot(h.pos[0] - from[0], h.pos[2] - from[2]) < 1e-6, 'seen: back to the start of the step');
  for (const q of ts.guards) q.charmed = 0;
  TL.step(ts, h, [{ e: 'hero:gift', kind: 'charm', target: g.id }], dt);
  ok(g.charmed > 0, 'the charm turns the guard away');
}
