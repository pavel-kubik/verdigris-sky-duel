// Destroy mission bot (Phase 3 T14): a Drake accepts a2_workshop at the board in the cave of the Ashen Crags, flies
// through the Wildwood and the Farmlands into the Veltava Bend, sets the castle siege workshop alight with a breath pass,
// circles high out of bow range until it is a ruin, then flies home and into the cave mouth (the mission's success).
// Like the raid bot (test/raid-bot.js) it flies as a careful player: high between the regions, a steep dive onto the
// target with the breath held, a hard climb out, `miss` of the passes with the breath too late (comes round for another).
// Uses only CampaignState input (S.missionAct, S.lairLeave, S.step), never edits the state.
'use strict';
const RB = require('./raid-bot.js');
const M = require('../core/umd.js');
const S = M.need('state'), D = M.need('data'), T = M.need('terrain'), LR = M.need('lair'), RG = M.need('region'),
  MS = M.need('missions');
const { clamp, wrap, mulberry } = M.need('math');

const ROUTE = { ash: 'wild', wild: 'farm', farm: 'bend' };
const BACK = { bend: 'farm', farm: 'wild', wild: 'ash' };
const CRUISE = 70;          // height over the ground between the regions
const HIGH = 140;           // height over the target while approaching and circling (out of bow range)
const PASS = 8;             // the dive aims this far above the target's roof
const RUNIN = 45;           // height over the target's roof on the run-in (the dive is a glide of about 0.4)
const RUN_BEARING = 0.75;   // run-in bearing from the workshop (over the courtyard, between bastion2 and the keep)
const RUN = 300;            // the dive starts this far out (a long glide: the flight model limits the pitch)
// careful: botches `miss` of the passes (breathes too late), thinks every `think` s, turns away from a ballista's aim line
// `dodgeLate` s after it shows (for `dodge` s); circles `circleR` out while the target burns (out of ballista range)
const PROFILES = {
  careful: { miss: 0.35, think: 0.25, circleR: 280, dodge: 1.4, dodgeLate: 0.8 },
  expert: { miss: 0, think: 0, circleR: 260, dodge: 1.4, dodgeLate: 0 },
};

function steer(p, to, alt) {
  const dx = to[0] - p.pos[0], dz = to[2] - p.pos[2], d = Math.hypot(dx, dz);
  const turn = wrap(Math.atan2(dx, dz) - p.yaw);
  const pitch = Math.atan2(alt - p.pos[1], Math.max(8, d));
  return { sx: clamp(-turn * 2.5, -1, 1), sy: clamp(pitch / 0.75, -1, 1), d, turn };
}

function travel(cs, to, alt) {
  const p = cs.dragon.pilot, R = T.region(cs.region), ex = R.exits.find(e => e.to === to);
  if (cs.exit && cs.exit.to === to) return { confirm: true };
  const a = RG.arcMid(ex), r = R.radius + 50, goal = [Math.sin(a) * r, 0, Math.cos(a) * r];
  const s = steer(p, goal, T.surfaceAt(cs.region, p.pos[0], p.pos[2]) + (alt || CRUISE));
  return { sx: s.sx, sy: s.sy };
}

function createBot(cs, id, opts) {
  const o = opts || {};
  return { cs, id, rb: RB.createBot(cs, o), m: MS.def(id), phase: 'out', t: 0, phaseT: 0, log: [], prof: PROFILES[o.profile || 'careful'],
           rng: mulberry(((o.seed || 1) * 104729 + 7) | 0), lit: false, commit: () => false, ruined: false, passes: 0, botch: false };
}
function setPhase(bot, ph) { if (bot.phase !== ph) { bot.phase = ph; bot.phaseT = 0; bot.log.push([+(bot.t / 60).toFixed(2), ph]); } }

function targetB(cs, id) { return cs.town && cs.town.buildings.find(b => b.id === id); }

function decide(bot, dt) {
  const cs = bot.cs, p = cs.dragon.pilot, m = bot.m;
  if (bot.phase === 'out') {
    const h = RB.hunt(bot.rb, dt);                             // meals in the Wildwood on the way, as the raid bot
    if (h) return h;
    if (cs.region !== m.region) return travel(cs, ROUTE[cs.region]);
    setPhase(bot, 'approach');
  }
  const b = cs.region === m.region ? targetB(cs, m.target) : null;
  if (b && (bot.phase === 'approach' || bot.phase === 'dive' || bot.phase === 'climb' || bot.phase === 'circle')) {
    const top = b.pos[1] + b.h, ground = T.surfaceAt(cs.region, p.pos[0], p.pos[2]);
    const dx = b.pos[0] - p.pos[0], dz = b.pos[2] - p.pos[2], d = Math.hypot(dx, dz);
    if (bot.ruined) { setPhase(bot, 'home'); return { sx: 0, sy: 1 }; }
    if (bot.phase === 'circle') {
      if (bot.lit) {                                           // let it burn: a wide circle high over the castle
        const a = Math.atan2(p.pos[0] - b.pos[0], p.pos[2] - b.pos[2]) + 0.45, r = bot.prof.circleR;
        const s = steer(p, [b.pos[0] + Math.sin(a) * r, 0, b.pos[2] + Math.cos(a) * r], Math.max(ground, top) + HIGH);
        return { sx: s.sx, sy: s.sy };
      }
      setPhase(bot, 'approach');                               // not alight: another pass
    }
    if (bot.phase === 'climb') {
      if (bot.phaseT < 4) return { sx: 0, sy: 1, boost: true };
      setPhase(bot, bot.lit ? 'circle' : 'approach');
      return {};
    }
    if (bot.phase === 'approach') {
      // to the run-in point RUN out on the courtyard side (bearing `RUN_BEARING` from the target: the run crosses
      // the courtyard, not the gatehouse or a bastion), high; there turn in and dive
      const a0 = (bot.m.runIn != null ? bot.m.runIn : RUN_BEARING) + (bot.passes % 2 ? 0.25 : -0.25) * Math.min(1, bot.passes);
      const st = [b.pos[0] + Math.sin(a0) * RUN, 0, b.pos[2] + Math.cos(a0) * RUN];
      const ds = Math.hypot(st[0] - p.pos[0], st[2] - p.pos[2]);
      if (ds > 40 && !bot.turning) {
        // round the castle at RUN out (never across it) until the run-in bearing, then straight to the run-in point
        const ab = Math.atan2(p.pos[0] - b.pos[0], p.pos[2] - b.pos[2]), da = wrap(a0 - ab);
        if (Math.abs(da) > 0.5) {
          const a1 = ab + Math.sign(da) * 0.5, r1 = RUN + 40;
          const s = steer(p, [b.pos[0] + Math.sin(a1) * r1, 0, b.pos[2] + Math.cos(a1) * r1], Math.max(ground, top) + HIGH);
          return { sx: s.sx, sy: s.sy };
        }
        const s = steer(p, st, Math.max(ground, top) + (ds > 200 ? HIGH : RUNIN)); return { sx: s.sx, sy: s.sy };
      }
      bot.turning = true;
      const s = steer(p, b.pos, top + RUNIN);
      if (Math.abs(s.turn) < 0.2) { bot.turning = false; setPhase(bot, 'dive'); bot.passes++; bot.botch = bot.rng() < bot.prof.miss; bot.fireT = 0; }
      return { sx: s.sx, sy: s.sy };
    }
    if (bot.phase === 'dive') {
      const s = steer(p, b.pos, top + PASS);
      const d3 = Math.hypot(d, p.pos[1] - (b.pos[1] + b.h * 0.5));
      const near = d3 < D.breath.range * S.scaleOf(cs) + b.r;
      if (near) bot.fireT += dt;
      // over or past the target (or alight and the stream held a moment longer): climb out
      bot.commit = () => bot.phase === 'dive' && d < 100;   // the last of the dive: no dodging
      const past = dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw) < 0;
      if (d < 12 || past && d < 60 || bot.lit && bot.fireT > 0.8 || bot.phaseT > 30) { setPhase(bot, 'climb'); return { sx: 0, sy: 1 }; }
      return { sx: s.sx, sy: s.sy, breath: near && !bot.botch, boost: !near && d < RUN * 0.8 };   // a botched pass: the breath comes too late
    }
  }
  if (bot.phase === 'home') {
    if (cs.region !== LR.home()) {
      const r = travel(cs, BACK[cs.region]);
      if (cs.region === m.region && bot.phaseT < 6 && r.sy != null) r.sy = 1;
      if (cs.region === m.region && bot.phaseT < 25 && r.sx != null) r.sx = clamp(r.sx + Math.sin(bot.phaseT * 2.2) * 0.6, -1, 1);
      return r;
    }
    const mo = LR.mouthPos(cs.region), dm = Math.hypot(p.pos[0] - mo[0], p.pos[2] - mo[2]);
    const s = steer(p, mo, dm > 60 ? mo[1] + Math.min(40, dm * 0.25) : mo[1]);
    return { sx: s.sx, sy: s.sy };
  }
  return {};
}

/** A ballista's aim line makes the pilot break off: a hard climbing turn for `dodge` s (not on the last of the dive). */
function dodge(bot, r) {
  const cs = bot.cs, p = cs.dragon.pilot;
  if (bot.aimSeen && p.mode === 'air' && !bot.commit()) { bot.dodgeT = bot.prof.dodge; bot.dodgeSide = -(bot.dodgeSide || 1); }
  bot.aimSeen = false;
  if (!(bot.dodgeT > 0) || r.confirm || bot.commit()) return r;
  return Object.assign({}, r, { sx: bot.dodgeSide, sy: 0.7, breath: false });
}

function input(bot, dt) {
  bot.t += dt; bot.phaseT += dt; bot.thinkT = (bot.thinkT || 0) - dt; bot.dodgeT = (bot.dodgeT || 0) - dt;
  if (bot.aimAt != null && bot.t >= bot.aimAt) { bot.aimSeen = true; bot.aimAt = null; }
  if (bot.prof.think && bot.held && bot.thinkT > 0 && !bot.aimSeen) return bot.held;
  const r = dodge(bot, decide(bot, bot.prof.think || dt));
  bot.thinkT = bot.prof.think;
  bot.held = r.confirm ? Object.assign({}, r, { confirm: false }) : r;
  return r;
}

/**
 * Fly mission `id` (a destroy mission) from the cave. Returns { accepted, minutes, success, failed, died, hpLeft, log,
 * passes, litAt, ruinedAt (minutes from leaving the cave), rebuiltDuring (the target stood again before the end) }.
 */
function fly(cs, id, opts) {
  const o = Object.assign({ dt: 1 / 30, maxMin: 15 }, opts);
  const accepted = S.missionAct(cs, 'accept', id).some(e => e.e === 'mission:accepted');
  const bot = createBot(cs, id, o);
  S.lairLeave(cs);
  let t = 0, success = null, failed = null, died = null, litAt = null, ruinedAt = null, rebuiltDuring = false;
  const steps = Math.round(o.maxMin * 60 / o.dt);
  for (let i = 0; i < steps && accepted; i++) {
    const ev = S.step(cs, input(bot, o.dt), o.dt);
    t += o.dt;
    for (const e of ev) {
      if (e.e === 'bolt:aim' && bot.aimAt == null) bot.aimAt = bot.t + bot.prof.dodgeLate;
      if (e.e === 'building:burning' && e.id === bot.m.target) { bot.lit = true; if (litAt == null) litAt = t / 60; }
      else if (e.e === 'building:ruined' && e.id === bot.m.target) { bot.ruined = true; ruinedAt = t / 60; }
      else if (e.e === 'building:rebuilt' && e.id === bot.m.target && ruinedAt != null) rebuiltDuring = true;
      else if (e.e === 'mission:success') success = e;
      else if (e.e === 'mission:failed') failed = e;
      else if (e.e === 'dragon:died') died = e.cause || true;
    }
    if (o.check) o.check(cs, ev, bot);
    if (success || failed || died || cs.inLair) break;
  }
  return { accepted, minutes: t / 60, success, failed, died, hpLeft: cs.dragon.hp, log: bot.log, passes: bot.passes,
           litAt, ruinedAt, rebuiltDuring };
}

module.exports = { fly, createBot, input, PROFILES };
