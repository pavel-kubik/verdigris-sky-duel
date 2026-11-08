// Intercept mission bot (Phase 3 T19): a Drake accepts a2_caravan at the board in the cave of the Ashen Crags, flies
// through the Wildwood and the Farmlands into the Veltava Bend (the tithe wagon sets out when it arrives), finds the
// wagon on the road (the gold marker), makes breath passes at it from behind along the road until it stops, then the
// raid bot (test/raid-bot.js) lands by the dropped chest, takes it on foot and flies home or into a found aerie.
// Like the destroy bot it flies as a careful player: high to the run-in point behind the wagon, a shallow dive along
// the road with the breath held, a climb out, `miss` of the passes with the breath too late (comes round again).
// Uses only CampaignState input (S.missionAct, S.lairLeave, S.step), never edits the state.
'use strict';
const RB = require('./raid-bot.js');
const M = require('../core/umd.js');
const WK = M.need('walk');
const S = M.need('state'), D = M.need('data'), T = M.need('terrain'), MS = M.need('missions'), CV = M.need('caravan');
const { clamp, wrap, mulberry } = M.need('math');

const HIGH = 110;           // height over the ground on the way to the run-in point (out of bow range of the escort)
const RUNIN = 30;           // height over the wagon on the last of the run-in and the line-up
const AVOID = 330;          // keep this far from the castle (bastion ballistae)
const AHEAD = 110;          // the ambush spot lies at least this far ahead of the wagon along its road
const PROFILES = {
  careful: { miss: 0.3, think: 0.25 },
  expert: { miss: 0, think: 0 },
};

function steer(p, to, alt) {
  const dx = to[0] - p.pos[0], dz = to[2] - p.pos[2], d = Math.hypot(dx, dz);
  const turn = wrap(Math.atan2(dx, dz) - p.yaw);
  const pitch = Math.atan2(alt - p.pos[1], Math.max(8, d));
  return { sx: clamp(-turn * 2.5, -1, 1), sy: clamp(pitch / 0.75, -1, 1), d, turn };
}

const wagon = (cs, m) => cs.caravans && cs.caravans[m.caravan];
const chestOf = (cs, m) => { const cv = wagon(cs, m); return cv && cv.chest && !cv.chest.taken ? cv.chest : null; };

function setPhase(bot, ph) { if (bot.phase !== ph) { bot.phase = ph; bot.phaseT = 0; bot.log.push([+(bot.t / 60).toFixed(2), ph]); } }

/** Steer around the castle (its bastion ballistae reach `ballista.range`): a waypoint on a circle AVOID out. */
function around(cs, to) {
  const pl = cs.town && cs.town.places.find(q => q.castle), p = cs.dragon.pilot;
  if (!pl) return to;
  const vx = p.pos[0] - pl.x, vz = p.pos[2] - pl.z, d = Math.hypot(vx, vz);
  const tx = to[0] - pl.x, tz = to[2] - pl.z;
  // the straight line to `to` passes the castle closer than AVOID: go round on the side nearer the target
  const lx = to[0] - p.pos[0], lz = to[2] - p.pos[2], ll = Math.hypot(lx, lz) || 1;
  const u = clamp(-(vx * lx + vz * lz) / (ll * ll), 0, 1), cx = vx + lx * u, cz = vz + lz * u;
  if (Math.hypot(cx, cz) > AVOID) return to;
  const a = Math.atan2(vx, vz), side = Math.sign(wrap(Math.atan2(tx, tz) - a)) || 1, b = a + side * 0.7, r = Math.max(AVOID + 40, d);
  return [pl.x + Math.sin(b) * r, 0, pl.z + Math.cos(b) * r];
}

/** A dry, flat spot on the road AHEAD..AHEAD+100 units in front of the wagon (an ambush: it drives into the fire). */
function ambushSpot(cs, cv) {
  for (let a = AHEAD; a <= AHEAD + 100; a += 10) {
    if (cv.s + a > cv.end - 10) break;
    const q = CV.at(cv, cv.s + a);
    if (!T.liquidAt(cs.region, q.x, q.z) && T.surfaceSlope(cs.region, q.x, q.z) <= D.land.maxSlope * 0.8) return q;
  }
  return null;
}

/**
 * The attack while the wagon drives: an ambush on the road. Fly (round the castle) to a spot on the road ahead of the
 * wagon, set down there facing back along the road, breathe while the wagon is in range; once it has passed (or the
 * fire bar is empty and it is close), take off and go round to the next spot ahead.
 */
function attack(bot, dt) {
  const cs = bot.cs, p = cs.dragon.pilot, cv = wagon(cs, bot.m);
  const ground = T.surfaceAt(cs.region, p.pos[0], p.pos[2]);
  const dw = Math.hypot(cv.pos[0] - p.pos[0], cv.pos[2] - p.pos[2]);
  if (p.mode === 'landing' || p.mode === 'takeoff') return {};
  if (p.mode === 'ground') {
    // facing the wagon; breathe while it is in range; it has passed (or the stand took too long): fly
    const fx = Math.sin(cv.yaw), fz = Math.cos(cv.yaw);
    const passed = (p.pos[0] - cv.pos[0]) * fx + (p.pos[2] - cv.pos[2]) * fz < -2;
    if (passed || bot.phaseT > 40) { setPhase(bot, 'takeoff'); bot.spot = null; return { land: true }; }
    setPhase(bot, 'stand');
    const turn = wrap(Math.atan2(cv.pos[0] - p.pos[0], cv.pos[2] - p.pos[2]) - p.yaw);
    const near = dw < D.breath.range * S.scaleOf(cs) * 0.85;
    if (near && !bot.firing) { bot.firing = true; bot.botch = bot.rng() < bot.prof.miss; bot.fireT = 0; }
    if (bot.firing) bot.fireT += dt;
    const fire = near && Math.abs(turn) < 0.35 && p.st > 5 && !(bot.botch && bot.fireT < 1.5);   // a botch: fires late
    return { sx: clamp(-turn * 2.5, -1, 1), sy: 0, breath: fire };
  }
  bot.firing = false;
  if (bot.phase === 'takeoff') { if (bot.phaseT < 2) return { sx: 0, sy: 1 }; setPhase(bot, 'approach'); }
  if (!bot.spot || bot.spotS < cv.s + 40) {
    const q = ambushSpot(cs, cv);
    if (!q) { setPhase(bot, 'approach'); const s = steer(p, around(cs, cv.pos), cv.pos[1] + HIGH); return { sx: s.sx, sy: s.sy }; }
    bot.spot = q; bot.spotS = cv.s + Math.hypot(q.x - cv.pos[0], q.z - cv.pos[2]);
    bot.passes++;
  }
  setPhase(bot, 'approach');
  const sp = [bot.spot.x, bot.spot.y, bot.spot.z], ds = Math.hypot(sp[0] - p.pos[0], sp[2] - p.pos[2]);
  // come in along the road from the castle side (so the dragon lands facing the wagon): a point past the spot first
  const back = [sp[0] + Math.sin(bot.spot.yaw) * 60, 0, sp[2] + Math.cos(bot.spot.yaw) * 60];
  const fromFront = (p.pos[0] - sp[0]) * Math.sin(bot.spot.yaw) + (p.pos[2] - sp[2]) * Math.cos(bot.spot.yaw) > 20;
  if (!fromFront && !bot.final) {
    const s = steer(p, around(cs, back), Math.max(ground, sp[1]) + (ds > 200 ? HIGH : RUNIN));
    if (Math.hypot(back[0] - p.pos[0], back[2] - p.pos[2]) < 25) bot.final = true;
    return { sx: s.sx, sy: s.sy };
  }
  bot.final = true;
  if (ds > 250) { bot.final = false; }
  const s = steer(p, around(cs, sp), Math.max(ground, sp[1]) + clamp(ds * 0.3, 2, HIGH));
  if (ds < 18 && WK.canLand(p, cs.region, S.solids(cs, S.scaleOf(cs)).solidAt).ok) { bot.final = false; return { sx: s.sx, sy: s.sy, land: true }; }
  if (ds < 8) { bot.final = false; bot.spot = null; }        // overshot the spot without landing: pick the next one
  return { sx: s.sx, sy: s.sy };
}

function input(bot, dt) {
  const cs = bot.cs, cv = wagon(cs, bot.m);
  const fighting = cs.region === bot.m.region && cv && (cv.state === 'moving' || cv.state === 'waiting') && !cs.inLair && !cs.inAerie;
  if (!fighting) {
    // stopped next to the dragon on the road: walk to the chest and take it (the raid bot's walk), then home
    const ch = chestOf(cs, bot.m), rb = bot.rb, p = cs.dragon.pilot;
    if (ch && p && p.mode === 'ground' && rb.phase !== 'walk' && rb.phase !== 'takeoff' && rb.phase !== 'home') {
      rb.item = ch; rb.phase = 'walk'; rb.phaseT = 0; rb.walkBest = null; rb.log.push([+(rb.t / 60).toFixed(2), 'walk']);
    }
    return RB.input(rb, dt);
  }               // to the Bend, the chest and home: the raid bot
  bot.t += dt; bot.phaseT += dt; bot.thinkT = (bot.thinkT || 0) - dt;
  if (bot.prof.think && bot.held && bot.thinkT > 0) return bot.held;
  const r = attack(bot, bot.prof.think || dt);
  bot.thinkT = bot.prof.think; bot.held = r;
  return r;
}

/**
 * Fly mission `id` (an intercept mission) from the cave. Returns { accepted, minutes, success, failed, died, hpLeft,
 * log, passes, stoppedAt (minutes), arrived (the wagon reached the gate), banked }.
 */
function fly(cs, id, opts) {
  const o = Object.assign({ dt: 1 / 30, maxMin: 15 }, opts);
  const m = MS.def(id);
  const accepted = S.missionAct(cs, 'accept', id).some(e => e.e === 'mission:accepted');
  const bot = { cs, m, phase: 'out', t: 0, phaseT: 0, log: [], passes: 0, prof: PROFILES[o.profile || 'careful'],
    rng: mulberry(((o.seed || 1) * 15485863 + 11) | 0),
    rb: RB.createBot(cs, { dest: m.region, pick: c => chestOf(c, m), escape: o.escape, seed: o.seed, profile: o.profile }) };
  S.lairLeave(cs);
  let t = 0, success = null, failed = null, died = null, stoppedAt = null, arrived = false, banked = null;
  const steps = Math.round(o.maxMin * 60 / o.dt);
  for (let i = 0; i < steps && accepted; i++) {
    const ev = S.step(cs, input(bot, o.dt), o.dt);
    t += o.dt;
    for (const e of ev) {
      if (e.e === 'bolt:aim' && bot.rb.aimAt == null) bot.rb.aimAt = bot.rb.t + bot.rb.prof.dodgeLate;
      if (e.e === 'caravan:stopped') stoppedAt = t / 60;
      else if (e.e === 'caravan:arrived') arrived = true;
      else if (e.e === 'hoard:banked') banked = e;
      else if (e.e === 'mission:success') success = e;
      else if (e.e === 'mission:failed') failed = e;
      else if (e.e === 'dragon:died') died = e.cause || true;
    }
    if (o.check) o.check(cs, ev, bot);
    if (failed || died || cs.inLair || cs.inAerie) break;
  }
  return { accepted, minutes: t / 60, success, failed, died, hpLeft: cs.dragon.hp, log: bot.log.concat(bot.rb.log), passes: bot.passes,
           stoppedAt, arrived, banked };
}

module.exports = { fly, PROFILES };
