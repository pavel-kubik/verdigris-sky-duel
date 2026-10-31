/*
 * Verdigris campaign - the cave interior (Phase 2 T10, 002_task_kingdom.md 4.7 and 5.7).
 * The lair is a walkable dome hall in its own local coordinates (floor at data.cave.floor, the tunnel leads out
 * at +Z). While cs.inLair the pilot is a ground pilot in these coordinates; lair.leave puts it back in the air
 * of the region. Pure: no DOM, no THREE.
 *   place(cs, at)                  pilot standing in the cave: at 'tunnel' (flying in, facing into the hall) or 'nest'
 *                                  (death, hatching, a save inside); sets cs.station
 *   walkable(x, z, scale) -> bool  on the floor circle (bounds - pad x scale) or in the tunnel
 *   clampPos(pos, scale) -> pos    nearest walkable point (the dragon slides along the wall)
 *   stationAt(cs) -> id | null     the nearest station in reach (radius + reach x scale ^ 0.5)
 *   step(cs, input, dt) -> events  walk.step on the flat floor, clamp to the walls, cs.station; walking out of the
 *                                  tunnel (z > tunnel.out) leaves the lair (lair.leave, events tagged via: 'tunnel')
 *   act(cs, id, arg) -> events     nest: rest; larder: eat item arg; exit: leave (lair.js does the rules); hoard (T19): none;
 *                                  altar (T20): buy upgrade arg (core/upgrades.js)
 *   inside(p, pad) -> bool         a point inside the dome or the tunnel, pad away from the rock
 *   camera(pos, yaw, scale) -> { pos, look }   chase camera that never leaves the dome / tunnel
 * state.step runs step() while cs.inLair; hunger, prey and the mother are paused, the larder spoils (lair.spoil).
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), G = M.need('growth'), HN = M.need('hunger'), WK = M.need('walk'), UP = M.need('upgrades');
  const K = D.cave;

  const scaleOf = cs => cs.debugScale || G.scaleOf(cs.dragon.foodXp, cs.dragon.stage);   // debugScale: ?debug B
  const floor = () => K.floor;
  const standY = scale => K.floor + D.walk.stand * scale;
  const hallR = scale => K.bounds - K.pad * Math.max(1, scale);
  const laneX = () => K.tunnel.w / 2 - K.camera.pad - 1;                  // the centre line band (the camera fits behind)

  function walkable(x, z, scale) {
    const s = scale || 1;
    if (Math.hypot(x, z) <= hallR(s) + 1e-9) return true;
    return Math.abs(x) <= laneX(s) + 1e-9 && z >= 0 && z <= K.tunnel.len;
  }

  function clampPos(pos, scale) {
    const s = scale || 1, x = pos[0], z = pos[2];
    if (walkable(x, z, s)) return pos;
    const R = hallR(s), r = Math.hypot(x, z) || 1;
    const cx = x * R / r, cz = z * R / r;                                    // nearest point on the hall circle
    const lx = Math.max(-laneX(s), Math.min(laneX(s), x)), lz = Math.max(0, Math.min(K.tunnel.len, z));   // nearest in the tunnel
    if (Math.hypot(x - cx, z - cz) <= Math.hypot(x - lx, z - lz)) { pos[0] = cx; pos[2] = cz; } else { pos[0] = lx; pos[2] = lz; }
    return pos;
  }

  function place(cs, at) {
    const p = cs.dragon.pilot, scale = scaleOf(cs);
    if (!p) return;
    const n = K.stations.nest, e = K.entry;
    const nest = at === 'nest';
    const x = nest ? n[0] : e[0], z = nest ? n[1] + n[2] * 0.25 : e[1];
    Object.assign(p, {
      pos: [x, standY(scale), z], vel: [0, 0, 0], yaw: nest ? 0 : Math.PI, pitch: 0, roll: 0, rollX: 0, sx: 0,
      speed: 0, rollT: 0, boosting: false, breathing: false, mode: 'ground', tr: null,
    });
    cs.station = stationAt(cs);
  }

  function stationAt(cs) {
    const p = cs.dragon.pilot;
    if (!cs.inLair || !p) return null;
    const reach = K.reach * Math.sqrt(scaleOf(cs));
    let best = null, bd = Infinity;
    for (const id in K.stations) {
      const s = K.stations[id], d = Math.hypot(p.pos[0] - s[0], p.pos[2] - s[1]);
      if (d <= s[2] + reach && d - s[2] < bd) { best = id; bd = d - s[2]; }
    }
    return best;
  }

  function step(cs, inp, dt) {
    const d = cs.dragon, p = d.pilot, scale = scaleOf(cs);
    if (!p) return [];
    if (p.mode !== 'ground') { p.mode = 'ground'; p.tr = null; p.speed = 0; }   // e.g. a test that sets cs.inLair directly
    WK.step(p, inp || {}, dt, { regionId: cs.region, scale, stats: G.statsOf(d.stage), effects: HN.effects(d.hunger), surface: floor });
    clampPos(p.pos, scale);
    p.pos[1] = standY(scale); p.pitch = 0;
    cs.station = stationAt(cs);
    cs.hint = cs.station ? 'station' : 'cave';
    if (p.pos[2] > K.tunnel.out) return act(cs, 'exit').map(e => Object.assign(e, { via: 'tunnel' }));
    return [];
  }

  function act(cs, id, arg) {
    if (!cs.inLair) return [];
    const LR = M.need('lair');                                  // lazy: lair.js loads after cave.js (lair.enter places the dragon here)
    if (id === 'nest') return LR.rest(cs).events;
    if (id === 'larder') return LR.eatFromLarder(cs, arg | 0);
    if (id === 'exit') { cs.station = null; return LR.leave(cs); }
    if (id === 'hoard') return [];                               // T19: the panel only shows the gold
    if (id === 'altar') return UP.buy(cs, arg).events;           // T20: buy upgrade arg with hoard gold ('upgrade:bought')
    return [];
  }

  /** Inside the dome (an ellipsoid r x h over the floor) or the tunnel box, at least pad from the rock. */
  function inside(q, pad) {
    const a = pad || 0, y = q[1] - K.floor;
    if (y < a * 0.5) return false;
    const r = K.room.r - a, h = K.room.h - a;
    if ((q[0] * q[0] + q[2] * q[2]) / (r * r) + (y * y) / (h * h) <= 1) return true;
    return Math.abs(q[0]) <= K.tunnel.w / 2 - a && q[2] >= 0 && q[2] <= K.tunnel.len + 30 && y <= K.tunnel.h - a;
  }

  /**
   * Chase camera in the cave: behind and above the dragon (x scale ^ 0.75), pulled in toward the dragon's back
   * until it is inside the rock with camera.pad to spare (bisection along the line, so it never pops through a wall).
   */
  function camera(pos, yaw, scale) {
    const C = K.camera, k = Math.pow(scale || 1, 0.75), bx = Math.sin(yaw), bz = Math.cos(yaw);
    const anchor = [pos[0], pos[1] + 1.2 * k, pos[2]];
    const want = [pos[0] - bx * C.dist * k, pos[1] + C.height * k, pos[2] - bz * C.dist * k];
    const look = [pos[0] + bx * C.look * k, pos[1] + 1.5 * k, pos[2] + bz * C.look * k];
    if (inside(want, C.pad)) return { pos: want, look };
    if (!inside(anchor, C.pad)) anchor[1] = Math.min(anchor[1], K.floor + K.tunnel.h - C.pad - 0.1);
    let lo = 0, hi = 1;
    const at = f => [anchor[0] + (want[0] - anchor[0]) * f, anchor[1] + (want[1] - anchor[1]) * f, anchor[2] + (want[2] - anchor[2]) * f];
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (inside(at(m), C.pad)) lo = m; else hi = m; }
    return { pos: at(lo), look };
  }

  M.define('cave', { place, walkable, clampPos, stationAt, step, act, inside, camera, standY });
})(typeof self !== 'undefined' ? self : this);
