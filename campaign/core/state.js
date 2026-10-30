/*
 * Verdigris campaign - CampaignState: one object for the whole run and the per-frame orchestration.
 *   create({ regionId, rng }) -> cs
 *   enterRegion(cs, regionId, pilotPos?, yaw?)   new prey field (+ pilot placement)
 *   step(cs, input, dt) -> events[]               flight -> hunger -> prey -> grab -> eat -> lair -> region
 *                                                 (inside the lair only the larder spoils; lair.js handles the panel actions)
 *                                                 HP at 0 (a boar's charge, debug damage) -> death: lair.respawn
 *                                                 then the mother (core/mother.js, T05) reads the frame's events
 * input: { sx, sy, breath, boost, grab, eat, confirm, enter, land } (sx / sy in -1..1, the rest booleans;
 *        confirm = travel through the offered exit, enter = the Move slot's "Enter cave",
 *        land = one-shot Land / Fly (F or the Move slot): lands when walk.canLand allows it, takes off on the ground).
 * Locomotion (T06): pilot.mode air -> flight.step, ground -> walk.step, landing / takeoff -> walk.blend.
 *        On the ground there is no swoop, grab (pick up comes in T08), roll or region travel.
 * The renderer reads cs; save.js serialises the durable parts of it (autosave: a 'save' event, see autosave()). See 001_task_survival.md 5.8.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), F = M.need('flight'), G = M.need('growth'), HN = M.need('hunger'), PR = M.need('prey'), RG = M.need('region'), LR = M.need('lair'), MO = M.need('mother'), WK = M.need('walk');
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
      larder: [],                    // stored prey in the lair: { type, food }
      inLair: false,
      flags: { introSeen: false, heavyT: 0 },
      stats: { played: 0, eaten: 0, food: 0 },
      story: { act: 1, mother: null }, // mother: { lesson, at } once the hatching scene hands over to her (T04), driven by core/mother.js (T05)
      hint: null,                    // 'swoop' | 'grab' | 'heavy' | 'eat' | 'near' | null, for the HUD prompt
      swoop: null,                   // id of the prey a held grab is diving at
      target: null,                  // id of the prey a grab would swoop at (for the target ring)
      breath: null,                  // the breath cone this frame (aimed), or null
      fire: null,                    // fire target { id, inRange, cook 0..1, kept? } (orange ring, roast progress), or null
      fireMem: null,                 // id of the last prey that got heat: stays the fire target while warm (kept: true)
      exit: null,                    // the region exit on offer (prompt "Fly to ..."), or null
      exitT: 0,
      landOk: false,                 // landing allowed right now (walk.canLand), the Move slot offers Land                      // seconds the offer stays after the dragon turns back from the edge
      saveT: 0,                      // seconds since the last autosave
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

  /** One frame; ends with the autosave check (a 'save' event the client stores, see save.js). */
  function step(cs, inp, dt) {
    const ev = [];
    if (!cs.dragon.pilot) return ev;
    run(cs, inp, dt, ev);
    for (const e of MO.step(cs, ev, dt, cs.danger ? { danger: cs.danger } : null)) emit(cs, ev, e);   // the mother (T05) reacts to this frame
    return autosave(cs, ev, dt);
  }

  /**
   * Autosave triggers (5.9): rest, region change, death (wake in the lair) and every save.every s of play.
   * Core only emits { e: 'save', why }; game.js writes it to localStorage (and on visibilitychange to hidden).
   */
  const SAVE_ON = { 'lair:rest': 'rest', 'region:enter': 'region', 'dragon:died': 'death' };
  function autosave(cs, ev, dt) {
    cs.saveT = (cs.saveT || 0) + dt;
    let why = null;
    for (const e of ev) if (SAVE_ON[e.e]) { why = SAVE_ON[e.e]; break; }
    if (!why && cs.saveT >= D.save.every) why = 'timer';
    if (why) { cs.saveT = 0; emit(cs, ev, { e: 'save', why }); }
    return ev;
  }

  function run(cs, inp, dt, ev) {
    const d = cs.dragon, p = d.pilot;
    for (const e of LR.spoil(cs, dt)) emit(cs, ev, e);
    if (cs.inLair) { cs.stats.played += dt; return ev; }       // resting: hunger, prey and flight are paused
    if (d.hp <= 0) return die(cs, ev, 'wounds');
    const stats = G.statsOf(d.stage), eff = HN.effects(d.hunger), scale = scaleOf(cs);
    let carried = carriedPrey(cs);
    if (!carried) d.carried = null;
    const eating = !!carried && !!inp.eat;
    cs.stats.played += dt;

    // locomotion mode (T06): Land / Fly one-shot, then the mode decides what moves the dragon
    if (!p.mode) p.mode = 'air';
    if (inp.land) landToggle(cs, p, stats, eff, ev);
    const air = p.mode === 'air';

    // swoop: holding grab with liftable prey ahead steers the dive onto it (aim assist for the claws)
    let fly = inp;
    const target = !carried && air ? PR.swoopTarget(cs.field, p, stats, eff, scale) : null;
    cs.target = target ? target.id : null;
    cs.swoop = inp.grab && target ? target.id : null;
    if (cs.swoop != null) {
      const Sw = D.swoop, dx = target.pos[0] - p.pos[0], dz = target.pos[2] - p.pos[2], d = Math.hypot(dx, dz);
      const turn = wrap(Math.atan2(dx, dz) - p.yaw);
      const aimY = target.pos[1] + Sw.aimAbove * Math.max(1, scale * 0.7);
      const pitchWant = Math.atan2(aimY - p.pos[1], Math.max(4, d));
      fly = Object.assign({}, inp, { sx: clamp(-turn * Sw.steer, -1, 1), sy: clamp(pitchWant / 0.75, -1, 1), boost: false });
    }

    if (air) F.step(p, fly, dt, { regionId: cs.region, stats, effects: eff, eating, softEdge: RG.softEdgeAt(cs.region, p.pos, F.SOFT_EDGE) });
    else {
      const wctx = { regionId: cs.region, stats, effects: eff, eating, scale };
      if (p.mode === 'ground') WK.step(p, inp, dt, wctx);
      else {
        const done = WK.blend(p, dt, wctx);
        if (done === 'landed') emit(cs, ev, { e: 'dragon:landed', pos: p.pos.slice(), noise: D.land.noise });
        if (done === 'airborne') emit(cs, ev, { e: 'dragon:airborne' });
      }
    }

    const hs = HN.step(d, dt, { boosting: p.boosting, breathing: p.breathing });
    if (hs) emit(cs, ev, { e: 'hunger:state', state: hs });

    let hit = false;
    for (const e of PR.step(cs.field, { pos: p.pos, inv: p.inv }, dt, { stats, rng: cs.rng })) {
      emit(cs, ev, e);
      if (e.e === 'boar:hit') {
        hit = true;
        d.hp = Math.max(0, d.hp - e.damage);
        if (d.eatT > 0) emit(cs, ev, { e: 'eat:cancel' });
        d.eatT = 0;                                              // a hit interrupts the meal
      }
    }

    if (d.hp <= 0) return die(cs, ev, 'boar');                  // killed: wake in the lair, the carried prey is lost

    // fire: the breath cone cooks prey into roast chunks
    // fire target (orange ring + roast progress in the renderer): the stream bends onto it while it is in range
    // memory: the last prey that got heat stays the target (bar and ring) while it is still warm, even out of view
    const ft = PR.fireTarget(cs.field, p, scale, cs.fire ? cs.fire.id : null);
    const warm = cs.fireMem != null ? PR.byId(cs.field, cs.fireMem) : null;
    if (!warm || !(warm.cook > 0) || warm.state === 'roast') cs.fireMem = null;
    if (ft && (!carried || ft.id !== carried.id)) cs.fire = ft;
    else if (cs.fireMem != null && !carried) cs.fire = { id: cs.fireMem, inRange: false, cook: 0, kept: true };
    else cs.fire = null;
    cs.breath = p.breathing ? PR.breathCone(p, scale, cs.field, cs.fire ? cs.fire.id : null) : null;   // the renderer aims the stream along cs.breath.dir
    for (const e of PR.cook(cs.field, cs.breath, dt, cs.rng)) emit(cs, ev, e);
    if (cs.fire) { const q = PR.byId(cs.field, cs.fire.id); if (q && q.state !== 'roast') cs.fire.cook = Math.min(1, q.cook / D.roast.cookTime); else cs.fire = null; }
    if (cs.fire && cs.fire.cook > 0 && cs.fire.cook < 1) cs.fireMem = cs.fire.id;

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
    const r = air ? PR.reach(cs.field, p, stats, eff, scale) : { best: null };
    if (!carried && inp.grab && air) {
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

    // lair: flying into the cave mouth enters it (a carried prey goes into the larder); so does the Move slot close by
    if (LR.inMouth(cs) || (inp.enter && LR.canEnter(cs))) {
      for (const e of LR.enter(cs)) emit(cs, ev, e);
      cs.exit = null; cs.exitT = 0;
      return ev;
    }

    // region edge: offer the exit while near it heading outward (and a moment after); confirm travels
    const ex = air ? RG.exitAt(cs.region, p.pos, p.yaw) : null;
    if (ex) {
      if (!cs.exit || cs.exit.to !== ex.to) emit(cs, ev, { e: 'region:exit', from: cs.region, to: ex.to });
      cs.exit = ex; cs.exitT = D.travel.promptHold;
    } else if (cs.exit && (cs.exitT -= dt) <= 0) { cs.exit = null; cs.exitT = 0; }
    if (cs.exit && inp.confirm) {
      const from = cs.region;
      for (const e of RG.enter(cs, cs.exit.to, from)) emit(cs, ev, e);
      carried = carriedPrey(cs);
    }

    cs.landOk = air && WK.canLand(p, cs.region).ok;                // the Move slot offers Land (controls.slots)
    if (!air) cs.hint = carried ? 'eat' : p.mode === 'ground' ? 'walk' : null;
    else cs.hint = carried ? (LR.near(cs) ? 'lairStore' : 'eat') : LR.near(cs) ? 'lair' : r.best ? 'grab' : target ? 'swoop' : r.heavy || r.nearHeavy ? 'heavy' : r.near ? 'near' : cs.landOk ? 'land' : null;
    return ev;
  }

  /** Land / Fly one-shot: lands when allowed (else says why), takes off on the ground (else says why). */
  function landToggle(cs, p, stats, eff, ev) {
    if (p.mode === 'air') {
      const c = WK.canLand(p, cs.region);
      if (c.ok) { WK.startLanding(p); cs.swoop = null; emit(cs, ev, { e: 'dragon:landing', noise: D.land.noise }); }
      else emit(cs, ev, { e: 'land:refused', why: c.why });
    } else if (p.mode === 'ground') {
      const c = WK.startTakeoff(p, stats, eff);
      if (c.ok) emit(cs, ev, { e: 'dragon:takeoff' });
      else emit(cs, ev, { e: 'takeoff:refused', why: c.why });
    }
  }

  /** Death: hand over to lair.respawn (carried prey lost, wake in the lair) and end this step. */
  function die(cs, ev, cause) {
    for (const e of LR.respawn(cs, cause)) emit(cs, ev, e);
    cs.swoop = null; cs.target = null; cs.breath = null; cs.fire = null; cs.fireMem = null; cs.hint = null;
    return ev;
  }

  /** Lair panel actions (game.js buttons); each returns events and emits them on the bus. */
  const relay = (cs, list) => { const ev = []; for (const e of list) emit(cs, ev, e); for (const e of MO.step(cs, ev, 0)) emit(cs, ev, e); return ev; };
  const lairRest = cs => autosave(cs, relay(cs, LR.rest(cs).events), 0);
  const lairEat = (cs, i) => relay(cs, LR.eatFromLarder(cs, i));
  const lairLeave = cs => relay(cs, LR.leave(cs));

  M.define('state', { create, enterRegion, step, autosave, scaleOf, carriedPrey, lairRest, lairEat, lairLeave });
})(typeof self !== 'undefined' ? self : this);
