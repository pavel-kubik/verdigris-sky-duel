// Scripted raid bot for test/raid.test.js (Phase 2 T24). A Drake leaves the cave in the Ashen Crags, flies through the
// Wildwood into the River Farmlands, lands in front of the loot it wants (the outpost's strongbox, else the nearest
// tithe chest), picks it up on foot, takes off, flies home the same way and banks it by flying into the cave mouth.
// It flies like a careful player: high over the countryside (altitude shortens the defenders' sight), a steep drop
// onto the vault, no boost with the box (the stamina is kept for the climb out), a weave while the archers shoot.
// Uses only CampaignState input (S.step, S.lairLeave, S.lairRest), never edits the state.
'use strict';
const M = require('../core/umd.js');
const S = M.need('state'), D = M.need('data'), T = M.need('terrain'), LR = M.need('lair'), RG = M.need('region'),
  WK = M.need('walk'), SE = M.need('settlement'), G = M.need('growth'), HN = M.need('hunger'), PR = M.need('prey');
const { clamp, wrap, dist2, mulberry } = M.need('math');

const ROUTE = { ash: 'wild', wild: 'farm' };        // outward; home is the reverse
const BACK = { farm: 'wild', wild: 'ash' };
const CRUISE = 70;                                   // height over the ground between the regions
const HIGH = 150;                                    // height over the ground for the approach to the settlement
const HUNT = { region: 'wild', below: 88, full: 92, sight: 450, giveUp: 120 };   // a meal in the Wildwood on the way out
/**
 * Pilots. "careful" stands for a player on a phone (the T24 raid-time target): botches `miss` of the swoops (pulls up
 * and comes round for `recover` s) and circles the settlement once at HIGH (`scout` laps, radius `scoutR`) to find the
 * vault before the drop, sees prey only within `sight`, aborts `goRound` of the landings (overshoots, comes round
 * again) and thinks every `think` s (holds the input between). "expert" knows the way and the vault: a lower bound for a raid.
 */
const PROFILES = {
  careful: { miss: 0.4, recover: 4, scout: 1, scoutR: 170, sight: 320, goRound: 0.35, think: 0.25 },
  expert: { miss: 0, recover: 0, scout: 0, scoutR: 0, sight: 450, goRound: 0, think: 0 },
};

function steer(p, to, alt) {
  const dx = to[0] - p.pos[0], dz = to[2] - p.pos[2], d = Math.hypot(dx, dz);
  const turn = wrap(Math.atan2(dx, dz) - p.yaw);
  const pitch = Math.atan2(alt - p.pos[1], Math.max(8, d));
  return { sx: clamp(-turn * 2.5, -1, 1), sy: clamp(pitch / 0.75, -1, 1), d, turn };
}

/** The loot the bot goes for in the Farmlands: the strongbox when it lies there, else the nearest tithe chest. */
function pickLoot(cs, kind) {
  const items = (cs.town.items || []).filter(it => !it.taken);
  const want = kind ? items.filter(it => it.kind === kind) : items;
  if (!want.length) return null;
  const box = want.find(it => it.kind === 'strongbox');
  if (box) return box;
  const p = cs.dragon.pilot;
  return want.slice().sort((a, b) => Math.hypot(a.pos[0] - p.pos[0], a.pos[2] - p.pos[2]) - Math.hypot(b.pos[0] - p.pos[0], b.pos[2] - p.pos[2]))[0];
}

/** Where to stand to pick the item up: in front of it, on the side away from its building (as in loot.test.js). */
function standPoint(cs, it) {
  const b = cs.town.buildings.find(q => q.id === it.building), sc = S.scaleOf(cs);
  let dx = it.pos[0] - b.pos[0], dz = it.pos[2] - b.pos[2];
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const f = 1.5 + D.settlement.pad * sc;
  return { pos: [it.pos[0] + dx * f, 0, it.pos[2] + dz * f], out: [dx, dz] };
}

function createBot(cs, opts) {
  const o = opts || {};
  return { cs, phase: 'out', kind: o.kind || null, item: null, t: 0, phaseT: 0, log: [], huntT: 0,
           hunt: Object.assign({}, HUNT, o.hunt), prof: PROFILES[o.profile || 'careful'], rng: mulberry(((o.seed || 1) * 7919 + 29) | 0),
           missT: 0, seenId: null, seenT: 0, botch: false, lap: 0, lapA: null };
}

function setPhase(bot, ph) { if (bot.phase !== ph) { bot.phase = ph; bot.phaseT = 0; bot.log.push([+(bot.t / 60).toFixed(2), ph]); } }

/** Fly to the exit arc toward region `to` and confirm the travel. */
function travel(cs, to) {
  const p = cs.dragon.pilot, R = T.region(cs.region), ex = R.exits.find(e => e.to === to);
  if (cs.exit && cs.exit.to === to) return { confirm: true };
  const a = RG.arcMid(ex), r = R.radius + 50, goal = [Math.sin(a) * r, 0, Math.cos(a) * r];
  const ground = T.surfaceAt(cs.region, p.pos[0], p.pos[2]);
  const s = steer(p, goal, ground + CRUISE);
  return { sx: s.sx, sy: s.sy, boost: false };
}

/** Wild prey a Drake can lift (never livestock: taking it raises the alert). */
function quarry(cs, sight) {
  const p = cs.dragon.pilot, lim = Math.min(G.statsOf(cs.dragon.stage).carry, HN.effects(cs.dragon.hunger).carryMax);
  let best = null, bd = Infinity;
  for (const q of cs.field.list) {
    if (q.state === 'carried' || q.size > lim || (D.prey[q.type] && D.prey[q.type].livestock)) continue;
    const d = Math.sqrt(dist2(q.pos, p.pos));
    if (d < sight && d < bd) { bd = d; best = q; }
  }
  return best;
}

/** The meal on the way out: in HUNT.region while hungrier than HUNT.below, swoop (hold Grab) and eat in flight. */
function hunt(bot, dt) {
  const cs = bot.cs, d = cs.dragon, p = d.pilot, H = bot.hunt;
  const carried = S.carriedPrey(cs);
  if (carried) { setPhase(bot, 'hunt'); return { sx: 0, sy: steer(p, p.pos, T.surfaceAt(cs.region, p.pos[0], p.pos[2]) + 40).sy, eat: true }; }
  const want = bot.phase === 'hunt' ? d.hunger < H.full : d.hunger < H.below;
  if (cs.region !== H.region || !want || bot.huntT > H.giveUp) { if (bot.phase === 'hunt') setPhase(bot, 'out'); return null; }
  setPhase(bot, 'hunt');
  bot.huntT += dt;
  if (bot.missT > 0) { bot.missT -= dt; return { sx: 0.3, sy: 0.4 }; }   // a botched swoop: pull up and come round
  const tg = cs.target != null ? PR.byId(cs.field, cs.target) : null;
  if (tg && !(D.prey[tg.type] && D.prey[tg.type].livestock)) {
    if (bot.seenId !== tg.id) { bot.seenId = tg.id; bot.seenT = 0; bot.botch = bot.rng() < bot.prof.miss; }
    bot.seenT += dt;
    if (bot.botch && bot.seenT > 1.2) { bot.missT = bot.prof.recover; bot.seenId = null; return { sx: 0.3, sy: 0.4 }; }
    return { grab: true };
  }
  const q = quarry(cs, Math.min(H.sight, bot.prof.sight));
  if (!q) return null;                                     // nothing near: fly on along the route (it may cross a herd)
  const s = steer(p, q.pos, q.pos[1] + 30);
  return { sx: s.sx, sy: s.sy };
}

/** One frame of input (a careful pilot keeps it for `think` s, except for one-shot Land / Fly and the travel confirm). */
function input(bot, dt) {
  bot.thinkT = (bot.thinkT || 0) - dt;
  bot.t += dt; bot.phaseT += dt;
  if (bot.prof.think && bot.held && bot.thinkT > 0) return bot.held;
  const r = decide(bot, bot.prof.think && bot.held ? bot.prof.think : dt);
  bot.thinkT = bot.prof.think;
  bot.held = r.land || r.confirm ? Object.assign({}, r, { land: false, confirm: false }) : r;
  return r;
}

function decide(bot, dt) {
  const cs = bot.cs, p = cs.dragon.pilot;
  if (cs.carriedLoot && bot.phase !== 'takeoff' && bot.phase !== 'home') setPhase(bot, 'takeoff');
  if (!cs.carriedLoot && bot.phase === 'home' && cs.region === 'farm' && !bot.item) setPhase(bot, 'out');

  if (bot.phase === 'out' || bot.phase === 'hunt') {
    const h = hunt(bot, dt);
    if (h) return h;
    if (cs.region !== 'farm') return travel(cs, ROUTE[cs.region]);
    bot.item = pickLoot(cs, bot.kind);
    if (!bot.item) return travel(cs, BACK[cs.region]);
    setPhase(bot, 'approach');
  }

  if (bot.phase === 'approach' || bot.phase === 'drop') {
    if (!bot.item || bot.item.taken) { bot.item = null; setPhase(bot, 'out'); return {}; }
    const sp = standPoint(cs, bot.item);
    // aim a little past the stand point along the item's outward side, so the dragon arrives facing the building
    const aim = [sp.pos[0] - sp.out[0] * 2, 0, sp.pos[2] - sp.out[1] * 2];
    const dx = aim[0] - p.pos[0], dz = aim[2] - p.pos[2], d = Math.hypot(dx, dz);
    const ground = T.surfaceAt(cs.region, p.pos[0], p.pos[2]);
    if (bot.phase === 'approach') {
      // high and fast until the drop; then circle out to come in from the item's open side
      if (d > bot.prof.scoutR + 20 && bot.lapA == null || d > 140 && !bot.prof.scout) {
        const s = steer(p, aim, ground + HIGH);
        return { sx: s.sx, sy: s.sy };
      }
      if (bot.lap < bot.prof.scout) {                     // scouting: one lap round the settlement, high up
        const a = Math.atan2(p.pos[0] - aim[0], p.pos[2] - aim[2]);
        if (bot.lapA != null) bot.lapDone = (bot.lapDone || 0) + Math.abs(wrap(a - bot.lapA));
        bot.lapA = a;
        if ((bot.lapDone || 0) >= 2 * Math.PI) { bot.lap++; bot.lapDone = 0; }
        else {
          const r = bot.prof.scoutR, b = a + 0.5;                          // a point ahead on the circle
          const s = steer(p, [aim[0] + Math.sin(b) * r, 0, aim[2] + Math.cos(b) * r], ground + HIGH);
          return { sx: s.sx, sy: s.sy };
        }
      }
      if (d > 140) { const s = steer(p, aim, ground + HIGH); return { sx: s.sx, sy: s.sy }; }
      setPhase(bot, 'drop');
    }
    // the drop: a steep glide that ends on the stand point; landing as soon as it is allowed close by
    const gate = [sp.pos[0] + sp.out[0] * 30, 0, sp.pos[2] + sp.out[1] * 30];   // in front of the item, on the open side
    const dg = Math.hypot(gate[0] - p.pos[0], gate[2] - p.pos[2]);
    const head = bot.gated || dg < 14 ? sp.pos : gate;
    if (dg < 14 && !bot.gated) { bot.gated = true; bot.gatedAt = bot.t; bot.overshoot = false; }
    const dh = Math.hypot(head[0] - p.pos[0], head[2] - p.pos[2]);
    const floor = T.surfaceAt(cs.region, head[0], head[2]);
    const alt = Math.max(ground, floor) + (bot.gated ? clamp(dh * 0.35, 3, 40) : clamp(dg * 0.35 + 8, 10, 60));
    const s = steer(p, head, alt);
    const land = bot.gated && dh < 9 && WK.canLand(p, cs.region, S.solids(cs, S.scaleOf(cs)).solidAt).ok;
    if (bot.gated && dh > 60 && !bot.long) bot.gated = false;   // missed the stand point: go round again
    if (land && bot.landTry !== bot.gatedAt) {             // one landing decision per pass
      bot.landTry = bot.gatedAt;
      if (bot.rng() < bot.prof.goRound) bot.overshoot = true;
    }
    if (land && !bot.overshoot) { bot.walkBest = null; setPhase(bot, 'walk'); return { sx: s.sx, sy: s.sy, land: true }; }
    if (bot.overshoot && bot.gated && dh < 9) bot.long = true;
    if (bot.long) {                                         // landed long: glide on past the item, set down where it can
      const okHere = WK.canLand(p, cs.region, S.solids(cs, S.scaleOf(cs)).solidAt).ok;
      bot.longT = (bot.longT || 0) + dt;
      if (okHere && bot.longT > 0.6) { bot.long = false; bot.longT = 0; bot.walkBest = null; setPhase(bot, 'walk'); return { land: true }; }
      return { sx: 0, sy: steer(p, p.pos, Math.max(ground, floor) + 4).sy };
    }
    return { sx: s.sx, sy: s.sy };
  }

  if (bot.phase === 'walk') {
    if (p.mode === 'landing') return {};
    if (p.mode === 'takeoff') return {};
    if (p.mode === 'air') { bot.gated = false; setPhase(bot, 'drop'); return {}; }
    if (!bot.item || bot.item.taken) { setPhase(bot, 'takeoff'); return {}; }
    if (cs.lootTarget === bot.item.id) return { grab: true };
    const sp = standPoint(cs, bot.item);
    const dx = sp.pos[0] - p.pos[0], dz = sp.pos[2] - p.pos[2], d = Math.hypot(dx, dz);
    // stuck (a wall between the dragon and the item): fly up and try the drop again
    if (bot.walkBest == null || d < bot.walkBest - 0.5) { bot.walkBest = d; bot.walkT = 0; }
    else if ((bot.walkT += dt) > 2.5) { bot.walkBest = null; bot.walkT = 0; return { land: true }; }
    // walk to the stand point, then turn to face the item
    const want = d > 1.2 ? Math.atan2(dx, dz) : Math.atan2(bot.item.pos[0] - p.pos[0], bot.item.pos[2] - p.pos[2]);
    const turn = wrap(want - p.yaw);
    return { sx: clamp(-turn * 2.5, -1, 1), sy: d > 1.2 && Math.abs(turn) < 0.6 ? 1 : 0, boost: d > 12 };
  }

  if (bot.phase === 'takeoff') {
    if (p.mode === 'ground') return { land: true };         // Fly
    if (p.mode === 'takeoff') return {};
    bot.item = null;
    setPhase(bot, 'home');
  }

  if (bot.phase === 'home') {
    if (cs.region !== LR.home()) {
      const r = travel(cs, BACK[cs.region]);
      // weave while archers or a ballista may be aiming (the first 25 s out of the settlement)
      if (cs.region === 'farm' && bot.phaseT < 25 && r.sx != null) r.sx = clamp(r.sx + Math.sin(bot.phaseT * 2.2) * 0.6, -1, 1);
      if (cs.region === 'farm' && bot.phaseT < 6 && r.sy != null) r.sy = 1;   // climb out first
      return r;
    }
    const m = LR.mouthPos(cs.region);
    const dm = Math.hypot(p.pos[0] - m[0], p.pos[2] - m[2]);
    const s = steer(p, m, dm > 60 ? m[1] + Math.min(40, dm * 0.25) : m[1]);
    return { sx: s.sx, sy: s.sy };
  }
  return {};
}

/** Is the dragon (flying or walking) inside a building's footprint below its roof? */
function insideSolid(cs) {
  const p = cs.dragon.pilot;
  if (cs.inLair || !p || !cs.town) return false;
  for (const b of cs.town.buildings) {
    if (b.ruin) continue;
    if (SE.sd(b, p.pos[0], p.pos[2]).d < -0.5 && p.pos[1] < b.pos[1] + b.h - 0.5) return true;
  }
  return false;
}

/**
 * One raid from the cave: leave, fly to the Farmlands, take the loot, fly home, bank. Ends in the cave (banked),
 * on death or after maxMin. Returns { minutes, banked, gold, died, hpLeft, log, stats }.
 */
function raid(cs, opts) {
  const o = Object.assign({ dt: 1 / 30, maxMin: 20 }, opts);
  const ev0 = S.lairLeave(cs);
  if (o.check) o.check(cs, ev0);
  const bot = createBot(cs, o);
  const stats = { meals: 0, arrowHits: 0, boltHits: 0, damage: 0, bells: 0, sighted: 0, maxArrows: 0, taken: null };
  let t = 0, banked = null, died = null;
  const steps = Math.round(o.maxMin * 60 / o.dt);
  for (let i = 0; i < steps; i++) {
    const ev = S.step(cs, input(bot, o.dt), o.dt);
    t += o.dt;
    for (const e of ev) {
      if (e.e === 'arrow:hit') { stats.arrowHits++; stats.damage += e.damage; }
      else if (e.e === 'bolt:hit') { stats.boltHits++; stats.damage += e.damage; }
      else if (e.e === 'bell:ring') stats.bells++;
      else if (e.e === 'loot:taken') stats.taken = e.kind;
      else if (e.e === 'hoard:banked') banked = e;
      else if (e.e === 'prey:eaten') stats.meals++;
      else if (e.e === 'dragon:died') died = e.cause || true;
    }
    if (cs.squad) stats.maxArrows = Math.max(stats.maxArrows, cs.squad.arrows.length + (cs.squad.bolts || []).length);
    if (o.check) o.check(cs, ev);
    if (banked || died || cs.inLair) break;
  }
  return { minutes: t / 60, banked, gold: banked ? banked.gold : 0, died, hpLeft: cs.dragon.hp, log: bot.log, stats };
}

module.exports = { raid, input, createBot, insideSolid, pickLoot, standPoint, PROFILES };
