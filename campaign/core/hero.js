/*
 * Verdigris campaign - a person on foot: the wizard, the princess, the prince, and the dragon in human form (the
 * Guise, core/guise.js). Walks the same terrain, streets, bridges and buildings as the dragon does (terrain surface,
 * settlement and city solids), cannot wade into water or lava, can jump, run while it has breath, and use its gift:
 *   wizard     bolt   - a spark of light thrown at the target in front (lights lanterns, breaks seals, scares thugs)
 *   prince     strike - a sword cut in front (training dummies, thugs)
 *   princess   charm  - calms the person in front and makes them listen (guards look away for a while)
 *   dragonkin  ember  - a breath of warm sparks in front (lights lanterns; the dragon's own fire, small)
 *
 *   create(kind, pos, yaw) -> h          h: { kind, pos, yaw, speed, vy, ground, st, hp, act, actT, cool, gift }
 *   step(h, inp, dt, ctx) -> events[]    inp: { sx, sy, run, jump, act }; ctx: { regionId, solidAt?, solidHit?,
 *                                         walkTop?, targets?: [{ id, pos: [x, y, z], r }] }
 *                                         events: 'hero:jump', 'hero:land', 'hero:gift' { kind, target (id or null) }
 *   inFront(h, targets, range, cone) -> target | null   the nearest target within range and the cone of the facing
 *   groundY(ctx, x, z) -> height                        what the feet stand on (terrain, a bridge, a walkable top)
 * Tank steering, as the dragon on foot: sideways turns, forward walks (run with the run button), back steps back.
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');
  const { clamp, wrap } = M.need('math');

  const K = () => D.hero;

  function create(kind, pos, yaw) {
    const k = K().kinds[kind];
    if (!k) throw new Error('VCamp hero: unknown kind "' + kind + '"');
    return { kind, pos: pos.slice(), yaw: yaw || 0, speed: 0, vy: 0, ground: true, st: 100, hp: 100, act: 0, actT: 0, cool: 0,
             gift: k.gift, vel: [0, 0, 0], running: false };
  }

  function groundY(ctx, x, z) {
    let g = T.surfaceAt(ctx.regionId, x, z);
    const wt = ctx.walkTop ? ctx.walkTop(x, z) : null;
    if (wt != null && wt > g) g = wt;
    return g;
  }

  /** Can the feet move from (x0, z0) to (x1, z1)? Not into water or lava, not up a wall or too steep a slope. */
  function passable(h, ctx, x0, z0, x1, z1) {
    const R = T.region(ctx.regionId), H = K();
    if (T.edgeDist(ctx.regionId, x1, z1) < 40) return false;
    if (T.liquidAt(ctx.regionId, x1, z1) && !T.liquidAt(ctx.regionId, x0, z0)) return false;
    const roof = ctx.solidAt ? ctx.solidAt(x1, z1) : null, g1 = groundY(ctx, x1, z1);
    if (roof != null && roof > g1 + H.stepUp && roof > h.pos[1] + H.stepUp) return false;         // a wall
    const run = Math.hypot(x1 - x0, z1 - z0);
    return h.ground ? g1 - groundY(ctx, x0, z0) <= H.maxSlope * run + H.stepUp * 0.5 : g1 <= h.pos[1] + H.stepUp;
  }

  function tryMove(h, dx, dz, ctx) {
    const x0 = h.pos[0], z0 = h.pos[2];
    if (Math.hypot(dx, dz) < 1e-6) return 1;
    if (passable(h, ctx, x0, z0, x0 + dx, z0 + dz)) { h.pos[0] += dx; h.pos[2] += dz; return 1; }
    const wall = ctx.solidHit ? ctx.solidHit(x0 + dx, z0 + dz) : null;
    if (wall) {                                                            // slide along the wall
      const k = wall.depth + 1e-3, sx = dx + wall.nx * k, sz = dz + wall.nz * k;
      if (sx * dx + sz * dz > 1e-9 && passable(h, ctx, x0, z0, x0 + sx, z0 + sz)) { h.pos[0] += sx; h.pos[2] += sz; return 0.7; }
    }
    // slide along whichever axis still works (a riverbank, a steep bank)
    if (passable(h, ctx, x0, z0, x0 + dx, z0)) { h.pos[0] += dx; return 0.5; }
    if (passable(h, ctx, x0, z0, x0, z0 + dz)) { h.pos[2] += dz; return 0.5; }
    return 0;
  }

  /** Nearest target within range and cone of the facing (targets: [{ id, pos, r }]). */
  function inFront(h, targets, range, cone) {
    let best = null, bd = Infinity;
    for (const t of targets || []) {
      const dx = t.pos[0] - h.pos[0], dz = t.pos[2] - h.pos[2], d = Math.hypot(dx, dz) - (t.r || 0);
      if (d > range) continue;
      const a = Math.abs(wrap(Math.atan2(dx, dz) - h.yaw));
      if (a > cone && d > 1.2) continue;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function step(h, inp, dt, ctx) {
    const H = K(), k = H.kinds[h.kind], ev = [];
    const sx = clamp(inp.sx || 0, -1, 1), sy = clamp(inp.sy || 0, -1, 1);
    h.yaw = wrap(h.yaw - sx * H.turn * dt);
    h.running = !!inp.run && sy > 0.1 && h.st > 2;
    let want = sy > 0 ? sy * (h.running ? k.run : k.walk) : sy * H.back;
    h.speed += (want - h.speed) * Math.min(1, dt * H.accel);
    if (h.running) h.st -= H.runSt * dt; else h.st += H.stRegen * dt;
    h.st = clamp(h.st, 0, 100);

    // the gift: a short action with a cooldown; the target is what is in front when it goes off
    h.cool = Math.max(0, h.cool - dt);
    if (h.actT > 0) { h.actT = Math.max(0, h.actT - dt); h.act = h.actT > 0 ? 1 - h.actT / k.giftTime : 0; }
    if (inp.act && h.cool <= 0 && h.actT <= 0) {
      h.actT = k.giftTime; h.cool = k.giftCool; h.act = 0;
      const t = inFront(h, ctx.targets, k.giftRange, k.giftCone);
      ev.push({ e: 'hero:gift', kind: h.gift, target: t ? t.id : null, hero: h.kind });
    }

    const y0 = h.pos[1];
    const dx = Math.sin(h.yaw) * h.speed * dt, dz = Math.cos(h.yaw) * h.speed * dt;
    const moved = tryMove(h, dx, dz, ctx);
    if (moved < 1) h.speed *= Math.max(0.4, moved);

    const g = groundY(ctx, h.pos[0], h.pos[2]);
    if (h.ground) {
      if (inp.jump && h.st > 8) { h.vy = H.jump * (k.jumpMult || 1); h.ground = false; h.st -= 8; ev.push({ e: 'hero:jump' }); }
      else if (g < h.pos[1] - H.fallAt) h.ground = false;                       // walked off a ledge
      else h.pos[1] = g;
    }
    if (!h.ground) {
      h.vy -= H.gravity * (k.floatFall && h.vy < 0 && inp.jump ? 0.35 : 1) * dt;   // the wizard floats down holding jump
      h.pos[1] += h.vy * dt;
      if (h.pos[1] <= g) { h.pos[1] = g; h.ground = true; h.vy = 0; ev.push({ e: 'hero:land' }); }
    }
    const inv = dt > 0 ? 1 / dt : 0;
    h.vel = [dx * moved * inv, (h.pos[1] - y0) * inv, dz * moved * inv];
    return ev;
  }

  M.define('hero', { create, step, inFront, groundY, passable });
})(typeof self !== 'undefined' ? self : this);
