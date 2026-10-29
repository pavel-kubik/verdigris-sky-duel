// Scripted hunter bot for the long campaign simulation (test/sim.test.js, T16).
// It plays like a careful new player: hunts the closest liftable prey with the swoop (hold grab), eats in flight,
// carries spare prey home when the larder has room, travels to the other region when the home herds are empty,
// and flies back to the lair to rest once a stage-up is ready. Uses only CampaignState input, never edits state.
'use strict';
const M = require('../core/umd.js');
const S = M.need('state'), D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), LR = M.need('lair'),
  RG = M.need('region'), HN = M.need('hunger'), F = M.need('flight');
const { clamp, wrap, dist2, mulberry } = M.need('math');

const CRUISE_ALT = 32;
const LARDER_EAT_BELOW = 50;      // in the lair, eat stored prey only when hungrier than this

/** Steering toward a world point: sx / sy for the flight input (yaw grows with -sx, pitch with sy). */
function steer(p, to, alt) {
  const dx = to[0] - p.pos[0], dz = to[2] - p.pos[2], d = Math.hypot(dx, dz);
  const turn = wrap(Math.atan2(dx, dz) - p.yaw);
  const y = alt != null ? alt : to[1];
  const pitch = Math.atan2(y - p.pos[1], Math.max(8, d));
  return { sx: clamp(-turn * 2.5, -1, 1), sy: clamp(pitch / 0.75, -1, 1), d, turn };
}

/**
 * Player profiles. "novice" stands for a new player (the 30 min target in 001_task_survival.md): sees prey only
 * within `sight`, holds grab `react` s after a target shows up, botches `miss` of the swoops (pulls up and circles
 * back for `recover` s), thinks every `think` s (holds the input between). "expert" is a perfect pilot that
 * knows where every animal is: a lower bound for how fast growth can go.
 */
const PROFILES = {
  novice: { sight: 320, react: 0.8, miss: 0.4, recover: 5, think: 0.25, giveUp: 90 },
  expert: { sight: Infinity, react: 0, miss: 0, recover: 0, think: 0, giveUp: Infinity },
};

function createBot(cs, opts) {
  const o = opts || {};
  return { cs, prof: PROFILES[o.profile || 'novice'], rng: mulberry(((o.seed || 1) * 7919 + 13) | 0), mode: 'hunt',
           wanderTo: null, travelTo: null, searchT: 0, seenT: 0, seenId: null, missT: 0, decided: null, thinkT: 0 };
}

function liftable(cs, p) {
  const st = G.statsOf(cs.dragon.stage), lim = Math.min(st.carry, HN.effects(cs.dragon.hunger).carryMax);
  return p.state !== 'carried' && p.size <= lim;
}

/** The closest liftable prey within sight (roast chunks a little preferred, they do not run). */
function quarry(cs, sight) {
  const p = cs.dragon.pilot;
  let best = null, bd = Infinity;
  for (const q of cs.field.list) {
    if (!liftable(cs, q)) continue;
    const d = dist2(q.pos, p.pos);
    if (d > (sight == null ? Infinity : sight)) continue;
    const sc = d * (q.state === 'roast' ? 0.7 : 1) * (q.state === 'flee' ? 1.3 : 1);
    if (sc < bd) { bd = sc; best = q; }
  }
  return best;
}

const ready = cs => G.readyStage(cs.dragon.foodXp, cs.dragon.stage) > cs.dragon.stage;
const anyLiftable = cs => cs.field.list.some(q => liftable(cs, q));

/** One frame of input for the bot (dt: the frame time, for its reaction timers). */
function input(bot, dt) {
  dt = dt || 1 / 30;
  bot.missT = Math.max(0, bot.missT - dt);
  if (bot.prof.think && bot.decided && (bot.thinkT -= dt) > 0) return bot.decided;
  bot.thinkT = bot.prof.think;
  bot.decided = decide(bot, bot.prof.think || dt);
  return bot.decided;
}

function decide(bot, dt) {
  const cs = bot.cs, d = cs.dragon, p = d.pilot, prof = bot.prof;
  const ground = T.surfaceAt(cs.region, p.pos[0], p.pos[2]);
  const carried = S.carriedPrey(cs);
  const home = LR.home();
  const goHome = ready(cs) || (carried && cs.larder.length < D.lair.larderSize && d.hunger > 85);

  // carrying: eat in flight (level, slow), turning back inward near the edge
  if (carried && !goHome) {
    bot.mode = 'eat';
    const s = steer(p, [0, 0, 0], ground + CRUISE_ALT);
    return { sx: Math.hypot(p.pos[0], p.pos[2]) > T.region(cs.region).radius - 250 ? s.sx : 0, sy: s.sy, eat: true };
  }

  if (goHome) {
    bot.mode = 'home';
    if (cs.region !== home) return travel(bot, home);
    const m = LR.mouthPos(home);
    // approach the mouth from above while far, straight in when close
    const dm = Math.hypot(p.pos[0] - m[0], p.pos[2] - m[2]);
    const s = steer(p, m, dm > 60 ? m[1] + Math.min(40, dm * 0.25) : m[1]);
    return { sx: s.sx, sy: s.sy };
  }

  if (bot.travelTo === cs.region) { bot.travelTo = null; bot.searchT = 0; }
  if (bot.travelTo) { bot.mode = 'travel'; return travel(bot, bot.travelTo); }
  bot.mode = 'hunt';
  // a botched swoop: pull up and fly on before trying again
  if (bot.missT > 0) return { sx: 0, sy: 0.5 };
  if (cs.target != null) {
    if (bot.seenId !== cs.target) { bot.seenId = cs.target; bot.seenT = 0; bot.botch = bot.rng() < prof.miss; }
    bot.seenT += dt;
    if (bot.seenT >= prof.react) {
      if (bot.botch && bot.seenT >= prof.react + 1.2) { bot.missT = prof.recover; bot.seenId = null; return { sx: 0, sy: 0.5 }; }
      if (!bot.botch) return { grab: true };              // the swoop steers the dive onto the target
    }
  } else bot.seenId = null;

  const q = quarry(cs, prof.sight);
  if (!q) {
    // nothing in sight: search; after `giveUp` s of searching (or with no liftable prey left) try the other region
    bot.searchT += dt;
    if (!anyLiftable(cs) || bot.searchT > prof.giveUp) {
      bot.travelTo = Object.keys(D.regions).find(r => r !== cs.region);
      bot.mode = 'travel';
      return travel(bot, bot.travelTo);
    }
    return wander(bot, ground);
  }
  bot.wanderTo = null; bot.searchT = 0;
  const s = steer(p, q.pos, q.pos[1] + CRUISE_ALT);
  return { sx: s.sx, sy: s.sy, grab: false };
}

/** Searching: a sweep over the region (8 bearings, inner and outer ring) at a look-out height. */
function wander(bot, ground) {
  const cs = bot.cs, p = cs.dragon.pilot, R = T.region(cs.region);
  bot.mode = 'search';
  if (!bot.wanderTo || bot.wanderTo.region !== cs.region || dist2(bot.wanderTo.pos, p.pos) < 80) {
    bot.sweep = bot.sweep == null ? Math.floor(bot.rng() * 8) : bot.sweep + 1;
    const n = bot.sweep, a = n * 3 * Math.PI / 4;                 // bearings 135 degrees apart, every 8th repeats
    const r = (n + Math.floor(n / 8)) % 2 ? R.radius * 0.4 : R.radius * 0.75;   // and the next lap swaps the rings
    bot.wanderTo = { region: cs.region, pos: [Math.sin(a) * r, 0, Math.cos(a) * r] };
  }
  const s = steer(p, bot.wanderTo.pos, ground + 55);
  return { sx: s.sx, sy: s.sy, boost: p.st > 60 && cs.dragon.hunger > 50 };
}

/** Fly to the exit arc toward region `to` and confirm. */
function travel(bot, to) {
  const cs = bot.cs, p = cs.dragon.pilot, R = T.region(cs.region);
  const ex = R.exits.find(e => e.to === to);
  if (cs.exit && cs.exit.to === to) return { confirm: true };
  const a = RG.arcMid(ex), r = R.radius + 50;
  const goal = [Math.sin(a) * r, 0, Math.cos(a) * r];
  const ground = T.surfaceAt(cs.region, p.pos[0], p.pos[2]);
  const s = steer(p, goal, ground + 60);
  return { sx: s.sx, sy: s.sy, boost: p.st > 40 };
}

/**
 * Runs the bot from a fresh hatchling (hatch in the lair, rest, leave) until it grows to `untilStage`
 * or `maxMin` simulated minutes pass. Calls check(cs, ev) after every step when given.
 * idleUntil: first just circle (no hunting) until hunger drops to this value (the starve-and-recover run).
 * Returns { minutes, grew, cs, stats }; stats.wokeAt is the minute the idle start ended.
 */
function run(opts) {
  const o = Object.assign({ seed: 1, dt: 1 / 30, maxMin: 60, untilStage: 1 }, opts);
  const cs = S.create({ rng: o.rng || mulberry(o.seed) });
  LR.hatch(cs);
  const bot = createBot(cs, o);
  const stats = { modes: {}, meals: 0, grabs: 0, deaths: 0, rests: 0, travels: 0, starvingS: 0, hungryS: 0, stored: 0, roasted: 0, food: 0, wokeAt: null };
  let t = 0, grewAt = null;
  const steps = Math.round(o.maxMin * 60 / o.dt);
  for (let i = 0; i < steps; i++) {
    if (cs.inLair) {
      const ev = [];
      const before = cs.dragon.stage;
      while (cs.larder.length && cs.dragon.hunger < LARDER_EAT_BELOW) ev.push(...S.lairEat(cs, 0));   // keep the larder for lean times
      ev.push(...S.lairRest(cs)); stats.rests++;
      if (cs.dragon.stage > before && grewAt == null) grewAt = t;
      if (cs.dragon.stage < o.untilStage) ev.push(...S.lairLeave(cs));
      for (const e of ev) if (e.e === 'prey:eaten') { stats.meals++; stats.food += e.food; }
      if (o.check) o.check(cs, ev);
      if (cs.dragon.stage >= o.untilStage) break;
      continue;
    }
    const idle = o.idleUntil != null && stats.wokeAt == null;
    if (idle && cs.dragon.hunger <= o.idleUntil) stats.wokeAt = t / 60;
    if (idle) bot.mode = 'idle';
    const ev = S.step(cs, idle && stats.wokeAt == null ? { sx: 0.25, sy: 0 } : input(bot, o.dt), o.dt);
    t += o.dt;
    stats.modes[bot.mode] = (stats.modes[bot.mode] || 0) + o.dt;
    const hs = HN.stateOf(cs.dragon.hunger);
    if (hs === 'starving') stats.starvingS += o.dt; else if (hs === 'hungry') stats.hungryS += o.dt;
    for (const e of ev) {
      if (e.e === 'prey:eaten') { stats.meals++; stats.food += e.food; }
      else if (e.e === 'prey:grabbed') stats.grabs++;
      else if (e.e === 'dragon:died') stats.deaths++;
      else if (e.e === 'region:enter' && !e.respawn) stats.travels++;
      else if (e.e === 'lair:stored') stats.stored++;
      else if (e.e === 'prey:roasted') stats.roasted++;
    }
    if (o.check) o.check(cs, ev);
  }
  return { minutes: (grewAt == null ? t : grewAt) / 60, grew: cs.dragon.stage >= o.untilStage, cs, stats };
}

module.exports = { run, input, createBot, steer, quarry, PROFILES };
