/*
 * Verdigris campaign - CampaignState: one object for the whole run and the per-frame orchestration.
 *   create({ regionId, rng }) -> cs
 *   enterRegion(cs, regionId, pilotPos?, yaw?)   new prey field (+ pilot placement)
 *   step(cs, input, dt) -> events[]               flight -> hunger -> prey -> grab -> eat -> region
 * input: { sx, sy, breath, boost, grab, eat, confirm } (sx / sy in -1..1, the rest booleans).
 * The renderer reads cs; the save (T14) serialises the durable parts of it. See 001_task_survival.md 5.8.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), F = M.need('flight'), G = M.need('growth'), HN = M.need('hunger'), PR = M.need('prey'), RG = M.need('region');
  const { createBus } = M.need('events');
  const { wrap, clamp } = M.need('math');

  function create(opts) {
    const regionId = (opts && opts.regionId) || D.startRegion;
    const cs = {
      version: D.version,
      region: regionId,
      dragon: {
        pilot: null, stage: 0, foodXp: 0, hp: D.stages[0].hp, hunger: D.hunger.start,
        carried: null,               // id of the prey in the claws
        eatT: 0, deaths: 0,
      },
      field: null,
      flags: { introSeen: false, heavyT: 0 },
      stats: { played: 0, eaten: 0, food: 0 },
      hint: null,                    // 'swoop' | 'grab' | 'heavy' | 'eat' | 'near' | null, for the HUD prompt
      swoop: null,                   // id of the prey a held grab is diving at
      target: null,                  // id of the prey a grab would swoop at (for the target ring)
      breath: null,                  // the breath cone this frame (aimed), or null
      exit: null,                    // the region exit on offer (prompt "Fly to ..."), or null
      exitT: 0,                      // seconds the offer stays after the dragon turns back from the edge
      rng: (opts && opts.rng) || Math.random,
      bus: createBus(),
    };
    enterRegion(cs, regionId);
    return cs;
  }

  function enterRegion(cs, regionId, pos, yaw) {
    cs.region = regionId;
    cs.field = PR.spawnRegion(regionId, cs.rng, pos || null);
    cs.dragon.carried = null; cs.dragon.eatT = 0;
    if (pos) cs.dragon.pilot = F.newPilot(pos, yaw || 0, G.statsOf(cs.dragon.stage).cruise);
  }

  const scaleOf = cs => G.scaleOf(cs.dragon.foodXp, cs.dragon.stage);
  const carriedPrey = cs => (cs.dragon.carried == null ? null : PR.byId(cs.field, cs.dragon.carried));

  function emit(cs, ev, e) { ev.push(e); cs.bus.emit(e.e, e); }

  function step(cs, inp, dt) {
    const ev = [], d = cs.dragon, p = d.pilot;
    if (!p) return ev;
    const stats = G.statsOf(d.stage), eff = HN.effects(d.hunger), scale = scaleOf(cs);
    let carried = carriedPrey(cs);
    if (!carried) d.carried = null;
    const eating = !!carried && !!inp.eat;
    cs.stats.played += dt;

    // swoop: holding grab with liftable prey ahead steers the dive onto it (aim assist for the claws)
    let fly = inp;
    const target = !carried ? PR.swoopTarget(cs.field, p, stats, eff, scale) : null;
    cs.target = target ? target.id : null;
    cs.swoop = inp.grab && target ? target.id : null;
    if (cs.swoop != null) {
      const Sw = D.swoop, dx = target.pos[0] - p.pos[0], dz = target.pos[2] - p.pos[2], d = Math.hypot(dx, dz);
      const turn = wrap(Math.atan2(dx, dz) - p.yaw);
      const aimY = target.pos[1] + Sw.aimAbove * Math.max(1, scale * 0.7);
      const pitchWant = Math.atan2(aimY - p.pos[1], Math.max(4, d));
      fly = Object.assign({}, inp, { sx: clamp(-turn * Sw.steer, -1, 1), sy: clamp(pitchWant / 0.75, -1, 1), boost: false });
    }

    F.step(p, fly, dt, { regionId: cs.region, stats, effects: eff, eating, softEdge: RG.softEdgeAt(cs.region, p.pos, F.SOFT_EDGE) });

    const hs = HN.step(d, dt, { boosting: p.boosting, breathing: p.breathing });
    if (hs) emit(cs, ev, { e: 'hunger:state', state: hs });

    let hit = false;
    for (const e of PR.step(cs.field, { pos: p.pos, inv: p.inv }, dt, { stats, rng: cs.rng })) {
      emit(cs, ev, e);
      if (e.e === 'boar:hit') {
        hit = true;
        d.hp = Math.max(1, d.hp - e.damage);                     // death and respawn at the lair arrive in T13
        if (d.eatT > 0) emit(cs, ev, { e: 'eat:cancel' });
        d.eatT = 0;                                              // a hit interrupts the meal
      }
    }

    // fire: the breath cone cooks prey into roast chunks
    cs.breath = p.breathing ? PR.breathCone(p, scale, cs.field) : null;   // the renderer aims the stream along cs.breath.dir
    for (const e of PR.cook(cs.field, cs.breath, dt, cs.rng)) emit(cs, ev, e);

    // starving claws cannot hold anything bigger than small prey
    const limit = Math.min(stats.carry, HN.effects(d.hunger).carryMax);
    if (carried && carried.size > limit) {
      PR.release(cs.field, carried, p.pos);
      emit(cs, ev, { e: 'prey:dropped', type: carried.type });
      d.carried = null; d.eatT = 0; carried = null;
    }

    // carried prey hangs under the claws (the renderer draws it at the claw anchor)
    if (carried) carried.pos = [p.pos[0], p.pos[1] - D.grab.clawDrop * scale - 1, p.pos[2]];

    // grab
    cs.flags.heavyT = Math.max(0, cs.flags.heavyT - dt);
    const r = PR.reach(cs.field, p, stats, eff, scale);
    if (!carried && inp.grab) {
      const g = PR.tryGrab(cs.field, p, stats, eff, scale);
      if (g.prey) { d.carried = g.prey.id; carried = g.prey; emit(cs, ev, { e: 'prey:grabbed', type: g.prey.type, id: g.prey.id }); }
      else if (g.heavy && cs.flags.heavyT === 0) { cs.flags.heavyT = D.grab.heavyCooldown; emit(cs, ev, { e: 'prey:tooHeavy', type: g.heavy.type }); }
    }

    // eat: hold for eat.time while carrying; releasing restarts the meal
    if (carried && inp.eat && !hit) {
      d.eatT += dt;
      if (d.eatT >= D.eat.time) {
        const food = carried.food;
        const ready = HN.feed(d, food);
        PR.remove(cs.field, carried.id);
        cs.stats.eaten++; cs.stats.food += food;
        emit(cs, ev, { e: 'prey:eaten', type: carried.type, food });
        if (ready) emit(cs, ev, { e: 'growth:ready', stage: G.readyStage(d.foodXp, d.stage) });
        d.carried = null; d.eatT = 0; carried = null;
      }
    } else d.eatT = 0;

    // region edge: offer the exit while near it heading outward (and a moment after); confirm travels
    const ex = RG.exitAt(cs.region, p.pos, p.yaw);
    if (ex) {
      if (!cs.exit || cs.exit.to !== ex.to) emit(cs, ev, { e: 'region:exit', from: cs.region, to: ex.to });
      cs.exit = ex; cs.exitT = D.travel.promptHold;
    } else if (cs.exit && (cs.exitT -= dt) <= 0) { cs.exit = null; cs.exitT = 0; }
    if (cs.exit && inp.confirm) {
      const from = cs.region;
      for (const e of RG.enter(cs, cs.exit.to, from)) emit(cs, ev, e);
      carried = carriedPrey(cs);
    }

    cs.hint = carried ? 'eat' : r.best ? 'grab' : target ? 'swoop' : r.heavy || r.nearHeavy ? 'heavy' : r.near ? 'near' : null;
    return ev;
  }

  M.define('state', { create, enterRegion, step, scaleOf, carriedPrey });
})(typeof self !== 'undefined' ? self : this);
