/*
 * Verdigris campaign - the mother dragon (Phase 2 T05): she flies with the hatchling and teaches it to hunt.
 * Her lessons are rows in data.mother.lessons: each row says where she leads (goal) and what completes it (done).
 *
 *   lesson(cs) -> row | null            the current lesson (null: no mother, or every lesson done)
 *   step(cs, ev, dt, ctx?) -> events[]  ev = this frame's events (lesson completion, lair / region changes);
 *                                       moves her; ctx.danger = [{ x, z, r }] zones she keeps out of (defenders, later)
 *   goalPos(cs) -> [x, y, z] | null     where she is leading right now (null: she flies ahead of the hatchling)
 *   line(cs) -> i18n key | null         her caption (game.js uses key + 'Touch' on touch when that key exists)
 *   dangerZones(cs, ctx) -> zones       data.regions[id].danger plus ctx.danger
 *   skip(cs) -> events[]                debug: completes the current lesson
 *
 * Saved: cs.story.mother = { lesson, at } (at: 'lair' with the hatchling in the cave, 'air' outside, 'done' after
 * the last lesson). Runtime only: cs.mom = { pos, vel, yaw, pitch, phase, t, prog, ... } (rebuilt next to the dragon).
 * Phases: lead (flies ahead toward the goal), show (a demonstration over the goal), wait (circles over the goal until
 * the hatchling copies her), praise (wing to wing for a moment), away (flies off, hidden), visit (after the lessons).
 * She is never hit and never fights: nothing in core targets her.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), HN = M.need('hunger'), PR = M.need('prey'), RG = M.need('region'), LR = M.need('lair');
  const { clamp, wrap } = M.need('math');
  const MO = D.mother;

  const lessons = () => MO.lessons;
  function lesson(cs) {
    const st = cs.story && cs.story.mother;
    return st && st.lesson < MO.lessons.length ? MO.lessons[st.lesson] : null;
  }
  const scaleOf = cs => G.scaleOf(cs.dragon.foodXp, cs.dragon.stage);
  const carryLimit = cs => Math.min(G.statsOf(cs.dragon.stage).carry, HN.effects(cs.dragon.hunger).carryMax);
  const carrying = cs => cs.dragon.carried != null && !!cs.field && !!PR.byId(cs.field, cs.dragon.carried);

  function dangerZones(cs, ctx) {
    const R = D.regions[cs.region] || {};
    return (R.danger || []).concat((ctx && ctx.danger) || []);
  }
  const inZone = (zones, x, z, pad) => zones.some(q => Math.hypot(x - q.x, z - q.z) < q.r + (pad || 0));

  /** A point inside the exit arc toward a region that passes test(regionId), or null. One hop is enough for now. */
  function exitToward(regionId, test) {
    const R = T.region(regionId);
    for (const e of R.exits || []) {
      if (!test(e.to)) continue;
      const a = RG.arcMid(e), r = R.radius - MO.exitInset, x = Math.sin(a) * r, z = Math.cos(a) * r;
      return { pos: [x, T.surfaceAt(regionId, x, z) + MO.alt, z], route: e.to };
    }
    return null;
  }

  /** Nearest prey that passes test, outside every danger zone (she never leads into defender range). */
  function nearestPrey(cs, zones, test) {
    const p = cs.dragon.pilot;
    let best = null, bd = Infinity;
    for (const q of cs.field.list) {
      if (q.type === 'roast' || q.state === 'carried' || !test(q)) continue;
      if (inZone(zones, q.pos[0], q.pos[2], MO.dangerPad)) continue;
      const d = Math.hypot(q.pos[0] - p.pos[0], q.pos[2] - p.pos[2]);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  /** What the current lesson leads to: { pos, kind, prey?, route? } or null (fly ahead of the hatchling). */
  function goal(cs, ctx) {
    const L = lesson(cs);
    if (!L || !cs.field || !cs.dragon.pilot) return null;
    const zones = dangerZones(cs, ctx);
    let kind = L.goal;
    if (L.needPrey && !carrying(cs)) kind = 'herd';           // eat / carry: first catch something
    if (kind === 'herd' || kind === 'heavy') {
      const lim = carryLimit(cs);
      const test = kind === 'herd' ? q => D.prey[q.type] && D.prey[q.type].size <= lim
                                   : q => D.prey[q.type] && D.prey[q.type].size > lim;
      const q = nearestPrey(cs, zones, test);
      if (q) return { pos: q.pos.slice(), kind, prey: q.id };
      const ex = exitToward(cs.region, to => (D.regions[to].herds || []).some(h => (kind === 'herd' ? D.prey[h.type].size <= lim : D.prey[h.type].size > lim)));
      return ex ? { pos: ex.pos, kind: 'route', route: ex.route } : null;
    }
    if (kind === 'lair') {
      const m = LR.mouthPos(cs.region);
      if (m) return { pos: m.slice(), kind };
      const ex = exitToward(cs.region, to => to === LR.home());
      return ex ? { pos: ex.pos, kind: 'route', route: ex.route } : null;
    }
    return null;                                                // 'self': she flies ahead, the hatchling follows
  }
  const goalPos = (cs, ctx) => { const g = goal(cs, ctx); return g ? g.pos : null; };

  /** Puts her beside and a little ahead of the dragon, in the chase camera's view (lair exit, region change, return). */
  function placeBeside(cs, phase) {
    const p = cs.dragon.pilot, k = Math.max(1, scaleOf(cs));
    const bx = Math.sin(p.yaw), bz = Math.cos(p.yaw), rx = -bz, rz = bx;
    const x = p.pos[0] + bx * MO.spawnAhead * k + rx * MO.side * k, z = p.pos[2] + bz * MO.spawnAhead * k + rz * MO.side * k;
    const y = Math.max(p.pos[1] + 4, T.surfaceAt(cs.region, x, z) + MO.minAlt);
    cs.mom = { pos: [x, y, z], vel: [bx * 25, 0, bz * 25], yaw: p.yaw, pitch: 0, phase: phase || 'lead', t: 0, prog: 0,
               shown: false, from: null, circle: 0, praise: null, praiseT: 0, breath: false, hidden: false };
    return cs.mom;
  }

  /** The current lesson is complete: next lesson (or done), praise, events. */
  function complete(cs, ev) {
    const st = cs.story.mother, L = lesson(cs), m = cs.mom;
    st.lesson++;
    ev.push({ e: 'mother:lesson', id: L.id, next: st.lesson < MO.lessons.length ? MO.lessons[st.lesson].id : null });
    if (m) { m.praise = L.id; m.praiseT = MO.praiseTime; m.prog = 0; m.shown = false; m.breath = false; if (m.phase !== 'away') m.phase = 'praise'; m.t = 0; }
    if (st.lesson >= MO.lessons.length) { st.at = 'done'; ev.push({ e: 'mother:done' }); }
  }

  /** Lesson rules: event rows complete on their event; 'follow' and 'dive' count seconds of the right flying. */
  function checkDone(cs, ev, dt, out) {
    const L = lesson(cs), m = cs.mom;
    if (!L) return;
    const dn = L.done;
    if (dn.event && ev.some(e => dn.event.indexOf(e.e) >= 0)) return complete(cs, out);
    if (!m || cs.inLair || m.phase === 'praise' || m.phase === 'away') return;
    const p = cs.dragon.pilot, k = Math.max(1, scaleOf(cs));
    if (dn.follow) {
      const d = Math.hypot(p.pos[0] - m.pos[0], p.pos[1] - m.pos[1], p.pos[2] - m.pos[2]);
      if (d < MO.followRange * k) m.prog += dt;
      if (m.prog >= dn.follow) complete(cs, out);
    } else if (dn.dive) {
      if (p.pitch < MO.divePitch) m.prog += dt;
      if (m.prog >= dn.dive) complete(cs, out);
    }
  }

  /** Where she wants to be this frame (and phase changes on the way). */
  function desired(cs, ctx, dt) {
    const m = cs.mom, p = cs.dragon.pilot, L = lesson(cs), k = Math.max(1, scaleOf(cs));
    const bx = Math.sin(p.yaw), bz = Math.cos(p.yaw), rx = -bz, rz = bx;
    const beside = () => [p.pos[0] + rx * MO.side * k + bx * MO.spawnAhead * k, p.pos[1] + 3, p.pos[2] + rz * MO.side * k + bz * MO.spawnAhead * k];
    m.t += dt; m.breath = false;
    if (m.praiseT > 0) m.praiseT -= dt;
    if (m.phase === 'praise') {
      if (m.praiseT > 0) return beside();
      const st = cs.story.mother;
      if (st.at === 'done') { m.phase = 'away'; m.t = 0; m.awayT = MO.visit[cs.dragon.stage >= 1 ? 1 : 0].away; }
      else if (cs.dragon.stage >= 1) { m.phase = 'away'; m.t = 0; m.awayT = MO.drakeGap; }   // a Drake is left alone more often
      else { m.phase = 'lead'; m.t = 0; }
    }
    if (m.phase === 'visit') {
      if (m.t > MO.visit[cs.dragon.stage >= 1 ? 1 : 0].stay) { m.phase = 'away'; m.t = 0; m.awayT = MO.visit[cs.dragon.stage >= 1 ? 1 : 0].away; }
      else return beside();
    }
    if (m.phase === 'away') {
      if (m.t > MO.leaveFade) m.hidden = true;
      if (m.t > (m.awayT || MO.drakeGap)) {
        const done = cs.story.mother.at === 'done';
        placeBeside(cs, done ? 'visit' : 'lead');
        if (done) cs.mom.praise = null;
        return cs.mom.pos.slice();
      }
      const hx = m.vel[0], hz = m.vel[2], hl = Math.hypot(hx, hz) || 1;   // she climbs away along her heading
      return [m.pos[0] + hx / hl * 80, m.pos[1] + 30, m.pos[2] + hz / hl * 80];
    }
    const g = goal(cs, ctx);
    if (!g) { m.phase = 'lead'; return [p.pos[0] + bx * MO.ahead * k + rx * MO.side * 0.5 * k, p.pos[1] + 4, p.pos[2] + bz * MO.ahead * k + rz * MO.side * 0.5 * k]; }
    const dx = g.pos[0] - p.pos[0], dz = g.pos[2] - p.pos[2], dG = Math.hypot(dx, dz) || 1, ux = dx / dG, uz = dz / dG;
    const ground = (x, z) => T.surfaceAt(cs.region, x, z);
    if (m.phase === 'wait' || m.phase === 'show') {
      if (dG > MO.loseRange) { m.phase = 'lead'; m.t = 0; m.shown = false; }
    }
    if (m.phase === 'lead') {
      const arrive = g.kind === 'route' || g.kind === 'lair' ? MO.arrive : MO.showRange;
      if (dG < arrive) {
        if (L && L.show && !m.shown && g.prey != null) { m.phase = 'show'; m.t = 0; m.from = m.pos.slice(); }
        else { m.phase = 'wait'; m.t = 0; }
      } else {
        const a = Math.min(MO.ahead * k, dG);
        const x = p.pos[0] + ux * a + uz * MO.side * 0.5 * k, z = p.pos[2] + uz * a - ux * MO.side * 0.5 * k;
        return [x, Math.max(p.pos[1] + 4, ground(x, z) + MO.alt), z];
      }
    }
    if (m.phase === 'show') {
      const u = m.t / MO.showTime;
      if (u >= 1) { m.shown = true; m.phase = 'wait'; m.t = 0; }
      else if (L.show === 'breath') {                          // hover short of the heavy prey and breathe at it
        const x = g.pos[0] - ux * MO.breathStand, z = g.pos[2] - uz * MO.breathStand;
        m.breath = u > 0.3 && u < 0.85;
        return [x, ground(x, z) + MO.breathAlt, z];
      } else {                                                 // dive onto the prey, skim it, pull up beyond it
        const f = m.from, low = [g.pos[0], g.pos[1] + MO.skim, g.pos[2]];
        if (u < 0.55) { const s = u / 0.55; return [f[0] + (low[0] - f[0]) * s, f[1] + (low[1] - f[1]) * s * s, f[2] + (low[2] - f[2]) * s]; }
        const s = (u - 0.55) / 0.45;
        return [low[0] + ux * 60 * s, low[1] + 35 * s, low[2] + uz * 60 * s];
      }
    }
    // wait: circle over the goal until the hatchling copies her
    m.circle += dt * MO.circleRate;
    const x = g.pos[0] + Math.sin(m.circle) * MO.circleR, z = g.pos[2] + Math.cos(m.circle) * MO.circleR;
    return [x, Math.max(g.pos[1], ground(x, z)) + MO.circleAlt, z];
  }

  /** Kinematic flight toward the desired point; never inside a danger zone, never under the floor. */
  function move(cs, want, dt, zones) {
    const m = cs.mom;
    const vx = (want[0] - m.pos[0]) * MO.gain, vy = (want[1] - m.pos[1]) * MO.gain, vz = (want[2] - m.pos[2]) * MO.gain;
    const l = Math.hypot(vx, vy, vz), s = l > MO.speed ? MO.speed / l : 1;
    const a = 1 - Math.exp(-dt * MO.accel);
    m.vel[0] += (vx * s - m.vel[0]) * a; m.vel[1] += (vy * s - m.vel[1]) * a; m.vel[2] += (vz * s - m.vel[2]) * a;
    m.pos[0] += m.vel[0] * dt; m.pos[1] += m.vel[1] * dt; m.pos[2] += m.vel[2] * dt;
    for (const q of zones) {                                   // push out to the edge of any zone (plus padding)
      const dx = m.pos[0] - q.x, dz = m.pos[2] - q.z, d = Math.hypot(dx, dz) || 1, R = q.r + MO.dangerPad;
      if (d < R) { m.pos[0] = q.x + dx / d * R; m.pos[2] = q.z + dz / d * R; }
    }
    const R = T.region(cs.region);
    m.pos[1] = clamp(m.pos[1], T.surfaceAt(cs.region, m.pos[0], m.pos[2]) + MO.minAlt, R.ceiling - 10);
    const hs = Math.hypot(m.vel[0], m.vel[2]);
    if (hs > 2) m.yaw += wrap(Math.atan2(m.vel[0], m.vel[2]) - m.yaw) * Math.min(1, dt * 4);
    m.pitch = clamp(Math.atan2(m.vel[1], Math.max(hs, 1)), -0.9, 0.7);
  }

  function step(cs, ev, dt, ctx) {
    const st = cs.story && cs.story.mother, out = [];
    if (!st) return out;
    for (const e of ev) {
      if (e.e === 'lair:enter' && st.at !== 'done') { st.at = 'lair'; cs.mom = null; }
      else if (e.e === 'lair:leave' && st.at !== 'done' && cs.dragon.pilot) { st.at = 'air'; placeBeside(cs, 'lead'); }
      else if (e.e === 'region:enter' && !e.respawn && cs.mom && cs.dragon.pilot) {
        const ph = cs.mom.phase === 'away' ? null : cs.mom.phase === 'praise' ? 'praise' : 'lead', pr = cs.mom.praise, pt = cs.mom.praiseT;
        if (ph) { placeBeside(cs, ph); cs.mom.praise = pr; cs.mom.praiseT = pt; } else cs.mom = null;
      }
    }
    checkDone(cs, ev, dt, out);
    const p = cs.dragon.pilot;
    if (cs.inLair || !p || dt <= 0 || st.at === 'lair') return out;
    // outside: a run that started outside (or 'done' and between visits) gets her next to the dragon
    if (!cs.mom || !cs.mom.pos) placeBeside(cs, st.at === 'done' ? 'away' : 'lead');
    if (st.at === 'done' && !cs.mom.awayT && cs.mom.phase === 'away') { cs.mom.awayT = MO.visit[cs.dragon.stage >= 1 ? 1 : 0].away; cs.mom.hidden = true; }
    const m = cs.mom;
    if (Math.hypot(m.pos[0] - p.pos[0], m.pos[2] - p.pos[2]) > MO.teleport && m.phase !== 'away') placeBeside(cs, m.phase === 'praise' ? 'praise' : 'lead');
    const zones = dangerZones(cs, ctx);
    move(cs, desired(cs, ctx, dt), dt, zones);
    return out;
  }

  /** Her caption right now (an i18n key). */
  function line(cs) {
    const st = cs.story && cs.story.mother;
    if (!st) return null;
    const m = cs.mom, L = lesson(cs);
    if (m && m.praiseT > 0 && m.praise) return 'c.mother.good.' + m.praise;
    if (st.at === 'done') return m && m.phase === 'visit' && !m.hidden ? 'c.mother.visit' : null;
    if (cs.inLair || st.at === 'lair') return L && L.id === 'rest' ? 'c.mother.rest' : 'c.mother.lair';
    if (!m || m.phase === 'away') return null;
    if (L && L.needPrey && !carrying(cs)) return L.id === 'carry' ? 'c.mother.carry' : 'c.mother.catch';
    if (m.phase === 'lead') { const g = goal(cs); if (g && g.kind === 'route') return 'c.mother.route'; }
    return L ? 'c.mother.' + L.id : null;
  }

  /** Debug: complete the current lesson now. */
  function skip(cs) {
    const out = [];
    if (lesson(cs)) complete(cs, out);
    return out;
  }

  M.define('mother', { lessons, lesson, step, goal, goalPos, line, dangerZones, skip, placeBeside });
})(typeof self !== 'undefined' ? self : this);
