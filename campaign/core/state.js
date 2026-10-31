/*
 * Verdigris campaign - CampaignState: one object for the whole run and the per-frame orchestration.
 *   create({ regionId, rng }) -> cs
 *   enterRegion(cs, regionId, pilotPos?, yaw?)   new prey field (+ pilot placement)
 *   step(cs, input, dt) -> events[]               flight -> hunger -> prey -> grab -> eat -> lair -> region
 *                                                 (inside the lair the dragon walks in the cave hall, core/cave.js T10, and
 *                                                 the larder spoils; the station panels call caveAct / lair*)
 *                                                 HP at 0 (a boar's charge, debug damage) -> death: lair.respawn
 *                                                 then the mother (core/mother.js, T05) reads the frame's events
 *                                                 and nav.step (T09) re-reads the scents for the compass (cs.nav)
 * input: { sx, sy, breath, boost, grab, eat, confirm, enter, land } (sx / sy in -1..1, the rest booleans;
 *        confirm = travel through the offered exit, enter = the Move slot's "Enter cave",
 *        land = one-shot Land / Fly (F or the Move slot): lands when walk.canLand allows it, takes off on the ground).
 * Locomotion (T06): pilot.mode air -> flight.step, ground -> walk.step, landing / takeoff -> walk.blend.
 *        On the ground there is no swoop, roll or region travel.
 * Breath pressed while no fire is possible emits breath:blocked { why: 'starving' | 'tired' } once per press (T08).
 * Ground actions (T08): Grab picks up the prey or roast in front (walk.inFront, ground.reach), carried in the jaws;
 *        Eat on the ground takes ground.eatTime and stands still (a boar's hit cancels it); the breath aims
 *        ground.breathPitch lower so it sweeps the ground in front.
 * Settlements (T12): cs.town = settlement.build of the current region (rebuilt when the region changes); its buildings
 *        are solids for flight (floor, walls), walking (walls, roofs) and landing (no landing on a roof, 'roof').
 *        cs.discovered = { placeId: true } (nav.step, 'place:discovered'), saved per region.
 * Building fire (T13): the breath cone (cs.breath) sets buildings alight (settlement.burn, after the prey cook); a burned
 *        down building is a ruin until fire.rebuild s of play later (settlement.rebuild, now = stats.played). Ruins are kept
 *        in cs.regionStates[region].ruins [{ id, at }] (saved, so they survive a region change and a reload);
 *        stats.civilBurned / orderBurned count burned buildings (future Renown, alert in T17).
 * Corn (Pavel's request): cs.crops = crops.build of the region's corn fields; the breath sets them alight, a fire front
 *        pops the corn (popcorn drawn by render/corn-view.js), burned fields are in cs.regionStates[region].corn (saved).
 * Perception (T14) and defenders (T15): cs.squad = defenders.spawn of the town (peasants, archers on the towers, a
 *        ballista with its crew on each platform (T16: aim line, bolt 'bolt:aim' / 'bolt:fire' / 'bolt:hit'); cs.watch is the same object), fed with this frame's noises; cs.light (null =
 *        day; T21's clock sets it) scales their sight. 'aware:state', 'bell:ring', 'arrow:hit' (HP, cancels a meal,
 *        death cause 'arrows'), 'defender:killed'. cs.danger = where archers shoot (the mother keeps out).
 * The renderer reads cs; save.js serialises the durable parts of it (autosave: a 'save' event, see autosave()). See 001_task_survival.md 5.8.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), F = M.need('flight'), G = M.need('growth'), HN = M.need('hunger'), PR = M.need('prey'), RG = M.need('region'), LR = M.need('lair'), MO = M.need('mother'), WK = M.need('walk'), NV = M.need('nav'), DF = M.need('defenders'), CV = M.need('cave'), SE = M.need('settlement'), CR = M.need('crops');
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
      inLair: false,                 // inside the cave (T10: the dragon walks in the hall, core/cave.js); location reads it
      station: null,                 // T10: the cave station in reach ('nest' | 'larder' | 'exit'), the Action slot / E
      flags: { introSeen: false, heavyT: 0 },
      stats: { played: 0, eaten: 0, food: 0, civilBurned: 0, orderBurned: 0 },
      regionStates: {},              // T13: { regionId: { ruins: [{ id, at }] } } (T17 adds heat, T19 taken loot), saved
      nav: null,                     // compass and smell (core/nav.js, T09): { t, next, scents, range }, not saved
      town: null,                    // T12: settlements of the region (core/settlement.js build), rebuilt on region change
      discovered: {},                // T12: settlement ids seen once (compass markers), saved
      story: { act: 1, mother: null }, // mother: { lesson, at } once the hatching scene hands over to her (T04), driven by core/mother.js (T05)
      hint: null,                    // 'swoop' | 'grab' | 'heavy' | 'eat' | 'near' | null, for the HUD prompt
      swoop: null,                   // id of the prey a held grab is diving at
      target: null,                  // id of the prey a grab would swoop at (for the target ring)
      breath: null,                  // the breath cone this frame (aimed), or null
      fire: null,                    // fire target { id, inRange, cook 0..1, kept? } (orange ring, roast progress), or null
      fireMem: null,                 // id of the last prey that got heat: stays the fire target while warm (kept: true)
      exit: null,                    // the region exit on offer (prompt "Fly to ..."), or null
      exitT: 0,
      exitSmall: null,               // T11: an exit the dragon is too small for (prompt "Too small for ..."), or null
      exitSmallT: 0,
      landOk: false,                 // landing allowed right now (walk.canLand), the Move slot offers Land                      // seconds the offer stays after the dragon turns back from the edge
      saveT: 0,                      // seconds since the last autosave
      rng: (opts && opts.rng) || Math.random,
      bus: createBus(),
    };
    Object.defineProperty(cs, 'location', { get() { return this.inLair ? 'cave' : 'field'; }, enumerable: false });
    enterRegion(cs, regionId);
    return cs;
  }

  function enterRegion(cs, regionId, pos, yaw) {
    cs.region = regionId;
    cs.field = PR.spawnRegion(regionId, cs.rng, pos || null);
    ensureTown(cs);
    cs.dragon.carried = null; cs.dragon.eatT = 0;
    if (pos) cs.dragon.pilot = F.newPilot(pos, yaw || 0, G.statsOf(cs.dragon.stage).cruise);
  }

  /** cs.town for the current region (T12); region.enter and save.apply only switch cs.region. */
  function ensureTown(cs) {
    if (!cs.town || cs.town.region !== cs.region) cs.town = SE.build(cs.region, cs.regionStates ? cs.regionStates[cs.region] : null);
    return cs.town;
  }
  /** cs.crops for the current region (corn fields, core/crops.js), rebuilt on a region change or a load. */
  function ensureCrops(cs) {
    if (!cs.crops || cs.crops.region !== cs.region) cs.crops = CR.build(cs.region, cs.regionStates ? cs.regionStates[cs.region] : null);
    return cs.crops;
  }
  /** Building solids for a dragon of this scale: { solidAt, solidHit } with the body pad (settlement.pad x scale). */
  function solids(cs, scale) {
    const town = ensureTown(cs), pad = D.settlement.pad * (scale || 1);
    return { solidAt: (x, z) => SE.solidAt(town, x, z, pad), solidHit: (x, z) => SE.hit(town, x, z, pad) };
  }

  const scaleOf = cs => cs.debugScale || G.scaleOf(cs.dragon.foodXp, cs.dragon.stage);   // debugScale: ?debug B (Elder size test, T10)
  const carriedPrey = cs => (cs.dragon.carried == null ? null : PR.byId(cs.field, cs.dragon.carried));

  function emit(cs, ev, e) { ev.push(e); cs.bus.emit(e.e, e); }

  /** One frame; ends with the autosave check (a 'save' event the client stores, see save.js). */
  function step(cs, inp, dt) {
    const ev = [];
    if (!cs.dragon.pilot) return ev;
    ensureTown(cs);
    run(cs, inp, dt, ev);
    defend(cs, ev, dt);                                          // T15: peasants and archers see, hear, ring, hide and shoot
    for (const e of NV.step(cs, dt)) emit(cs, ev, e);           // smell: scent markers for the compass (T09); discovery (T12)
    for (const e of MO.step(cs, ev, dt, cs.danger ? { danger: cs.danger } : null)) emit(cs, ev, e);   // the mother (T05) reacts to this frame
    return autosave(cs, ev, dt);
  }

  /**
   * Autosave triggers (5.9): rest, region change, death (wake in the lair), a discovered settlement (T12) and every save.every s of play.
   * Core only emits { e: 'save', why }; game.js writes it to localStorage (and on visibilitychange to hidden).
   */
  const SAVE_ON = { 'lair:rest': 'rest', 'region:enter': 'region', 'dragon:died': 'death', 'place:discovered': 'discovered' };   // T12: a new place
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
    if (cs.inLair) {                                            // in the cave (T10): walking only; hunger, prey and flight are paused
      cs.stats.played += dt;
      for (const e of CV.step(cs, inp, dt)) emit(cs, ev, e);
      return ev;
    }
    if (d.hp <= 0) return die(cs, ev, 'wounds');
    const stats = G.statsOf(d.stage), eff = HN.effects(d.hunger), scale = scaleOf(cs), sol = solids(cs, scale);
    let carried = carriedPrey(cs);
    if (!carried) d.carried = null;
    const eating = !!carried && !!inp.eat;
    cs.stats.played += dt;

    // locomotion mode (T06): Land / Fly one-shot, then the mode decides what moves the dragon
    if (!p.mode) p.mode = 'air';
    if (inp.land) landToggle(cs, p, stats, eff, ev, sol);
    // Breath pressed but no fire (T08 feedback): say why once per press - starving (hunger.starving.breath) or the fire bar is empty
    if (inp.breath && !cs.breathHeld && (p.mode || 'air') !== 'landing' && p.mode !== 'takeoff') {
      if (!eff.canBreath) emit(cs, ev, { e: 'breath:blocked', why: 'starving' });
      else if (p.st <= 8) emit(cs, ev, { e: 'breath:blocked', why: 'tired' });
    }
    cs.breathHeld = !!inp.breath;
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

    if (air) F.step(p, fly, dt, { regionId: cs.region, stats, effects: eff, eating, softEdge: RG.softEdgeAt(cs.region, p.pos, F.SOFT_EDGE), solidAt: sol.solidAt, solidHit: sol.solidHit });
    else {
      const wctx = { regionId: cs.region, stats, effects: eff, eating, scale, solidAt: sol.solidAt, solidHit: sol.solidHit };
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
    const aim = p.mode === 'ground' ? Object.assign({}, p, { pitch: p.pitch + D.ground.breathPitch }) : p;   // T08: fire along the ground
    const ft = PR.fireTarget(cs.field, aim, scale, cs.fire ? cs.fire.id : null);
    const warm = cs.fireMem != null ? PR.byId(cs.field, cs.fireMem) : null;
    if (!warm || !(warm.cook > 0) || warm.state === 'roast') cs.fireMem = null;
    if (ft && (!carried || ft.id !== carried.id)) cs.fire = ft;
    else if (cs.fireMem != null && !carried) cs.fire = { id: cs.fireMem, inRange: false, cook: 0, kept: true };
    else cs.fire = null;
    cs.breath = p.breathing ? PR.breathCone(aim, scale, cs.field, cs.fire ? cs.fire.id : null) : null;   // the renderer aims the stream along cs.breath.dir
    for (const e of PR.cook(cs.field, cs.breath, dt, cs.rng)) emit(cs, ev, e);
    fireStep(cs, dt, ev, scale);                                // T13: buildings catch fire, burn down, come back
    if (cs.fire) { const q = PR.byId(cs.field, cs.fire.id); if (q && q.state !== 'roast') cs.fire.cook = Math.min(1, q.cook / D.roast.cookTime); else cs.fire = null; }
    if (cs.fire && cs.fire.cook > 0 && cs.fire.cook < 1) cs.fireMem = cs.fire.id;

    // starving claws cannot hold anything bigger than small prey
    const limit = Math.min(stats.carry, HN.effects(d.hunger).carryMax);
    if (carried && carried.size > limit) {
      PR.release(cs.field, carried, p.pos);
      emit(cs, ev, { e: 'prey:dropped', type: carried.type });
      d.carried = null; d.eatT = 0; carried = null;
    }

    // carried prey hangs under the claws in the air, in the jaws on the ground (the renderer draws it at the anchor)
    if (carried) carried.pos = air ? [p.pos[0], p.pos[1] - D.grab.clawDrop * scale - 1, p.pos[2]] : jawPos(p, scale);

    // grab
    cs.flags.heavyT = Math.max(0, cs.flags.heavyT - dt);
    const r = air ? PR.reach(cs.field, p, stats, eff, scale) : { best: null };
    if (!carried && inp.grab && air) {
      const g = PR.tryGrab(cs.field, p, stats, eff, scale);
      if (g.prey) { d.carried = g.prey.id; carried = g.prey; emit(cs, ev, { e: 'prey:grabbed', type: g.prey.type, id: g.prey.id }); }
      else if (g.heavy && cs.flags.heavyT === 0) { cs.flags.heavyT = D.grab.heavyCooldown; emit(cs, ev, { e: 'prey:tooHeavy', type: g.heavy.type }); }
    }
    // pick up (T08): on the ground Grab takes the prey or roast in front of the head
    const front = !carried && p.mode === 'ground' ? PR.inFront(cs.field, items => WK.inFront(p, scale, items), stats, eff) : { best: null };
    if (!carried && inp.grab && p.mode === 'ground') {
      if (front.best) {
        carried = PR.lift(cs.field, front.best); d.carried = carried.id; carried.pos = jawPos(p, scale);
        emit(cs, ev, { e: 'prey:grabbed', type: carried.type, id: carried.id, ground: true });
        front.best = null;
      } else if (front.heavy && cs.flags.heavyT === 0) { cs.flags.heavyT = D.grab.heavyCooldown; emit(cs, ev, { e: 'prey:tooHeavy', type: front.heavy.type }); }
    }
    if (!air) cs.target = front.best ? front.best.id : null;      // the green ring marks what Grab would pick up

    // eat: hold for eat.time (ground.eatTime on the ground) while carrying; releasing restarts the meal
    if (carried && inp.eat && !hit && p.mode !== 'takeoff') {
      d.eatT += dt;
      if (d.eatT >= eatTime(cs)) {
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
      cs.exit = null; cs.exitT = 0; cs.exitSmall = null; cs.exitSmallT = 0;
      return ev;
    }

    // region edge: offer the exit while near it heading outward (and a moment after); confirm travels
    let ex = air ? RG.exitAt(cs.region, p.pos, p.yaw) : null;
    if (ex && ex.minStage != null && d.stage < ex.minStage) {     // T11: too small for that region - a prompt, no travel
      if (!cs.exitSmall || cs.exitSmall.to !== ex.to) emit(cs, ev, { e: 'region:tooSmall', from: cs.region, to: ex.to, minStage: ex.minStage });
      cs.exitSmall = ex; cs.exitSmallT = D.travel.promptHold; ex = null;
    } else if (cs.exitSmall && (cs.exitSmallT -= dt) <= 0) { cs.exitSmall = null; cs.exitSmallT = 0; }
    if (ex) {
      if (!cs.exit || cs.exit.to !== ex.to) emit(cs, ev, { e: 'region:exit', from: cs.region, to: ex.to });
      cs.exit = ex; cs.exitT = D.travel.promptHold;
    } else if (cs.exit && (cs.exitT -= dt) <= 0) { cs.exit = null; cs.exitT = 0; }
    if (cs.exit && inp.confirm) {
      const from = cs.region;
      for (const e of RG.enter(cs, cs.exit.to, from)) emit(cs, ev, e);
      carried = carriedPrey(cs);
    }

    cs.landOk = air && WK.canLand(p, cs.region, sol.solidAt).ok;                // the Move slot offers Land (controls.slots)
    if (!air) cs.hint = carried ? 'eat' : p.mode !== 'ground' ? null : front.best ? 'grab' : front.heavy ? 'heavy' : 'walk';
    else cs.hint = carried ? (LR.near(cs) ? 'lairStore' : 'eat') : LR.near(cs) ? 'lair' : r.best ? 'grab' : target ? 'swoop' : r.heavy || r.nearHeavy ? 'heavy' : r.near ? 'near' : cs.landOk ? 'land' : null;
    return ev;
  }

  /** Defenders (T15, T16): perception, bell, volleys, ballista bolts; a hit costs HP, cancels a meal and can kill
   *  (cause 'arrows' / 'bolt'). */
  function defend(cs, ev, dt) {
    const d = cs.dragon;
    for (const e of DF.step(cs, ev, dt, { scale: scaleOf(cs), spot: G.statsOf(d.stage).spot })) {
      emit(cs, ev, e);
      if ((e.e !== 'arrow:hit' && e.e !== 'bolt:hit') || cs.inLair || d.hp <= 0) continue;
      d.hp = Math.max(0, d.hp - e.damage);
      if (d.eatT > 0) emit(cs, ev, { e: 'eat:cancel' });
      d.eatT = 0;
      if (d.hp <= 0) die(cs, ev, e.e === 'bolt:hit' ? 'bolt' : 'arrows');
    }
  }

  /** Building fire (T13): burn under the breath, spread, ruins (stats, region state), rebuild after fire.rebuild. */
  function fireStep(cs, dt, ev, scale) {
    const town = ensureTown(cs), now = cs.stats.played, p = cs.dragon.pilot, pad = D.settlement.pad * (scale || 1);
    const rs = cs.regionStates[cs.region] = cs.regionStates[cs.region] || {};
    for (const e of SE.burn(town, cs.breath, dt, { rng: cs.rng, now })) {
      emit(cs, ev, e);
      if (e.e !== 'building:ruined') continue;
      if (e.civil) cs.stats.civilBurned = (cs.stats.civilBurned || 0) + 1;
      if (e.order) cs.stats.orderBurned = (cs.stats.orderBurned || 0) + 1;
      rs.ruins = (rs.ruins || []).filter(r => r.id !== e.id).concat([{ id: e.id, at: e.at }]);
    }
    ensureCrops(cs);                                            // corn fields: burn and pop
    for (const e of CR.step(cs.crops, cs.breath, dt, now)) {
      emit(cs, ev, e);
      if (e.e === 'corn:burned') rs.corn = (rs.corn || []).filter(r => r.id !== e.id).concat([{ id: e.id, at: e.at }]);
      if (e.e === 'corn:regrown' && rs.corn) rs.corn = rs.corn.filter(r => r.id !== e.id);
    }
    const blocked = b => SE.sd(b, p.pos[0], p.pos[2]).d < pad;  // never rebuild a house around the dragon
    for (const e of SE.rebuild(town, now, blocked)) {
      emit(cs, ev, e);
      if (rs.ruins) rs.ruins = rs.ruins.filter(r => r.id !== e.id);
    }
  }

  /** Seconds of holding Eat for one meal: eat.time in the air, ground.eatTime on the ground (T08). */
  function eatTime(cs) {
    const p = cs.dragon.pilot;
    return p && p.mode && p.mode !== 'air' ? D.ground.eatTime : D.eat.time;
  }

  /** Where a prey held in the jaws is (the head is about ground.reach / 2 in front of a standing dragon). */
  function jawPos(p, scale) {
    const f = D.ground.reach * 0.5 * scale;
    return [p.pos[0] + Math.sin(p.yaw) * f, p.pos[1] - D.walk.stand * scale * 0.5, p.pos[2] + Math.cos(p.yaw) * f];
  }

  /** Land / Fly one-shot: lands when allowed (else says why), takes off on the ground (else says why). */
  function landToggle(cs, p, stats, eff, ev, sol) {
    if (p.mode === 'air') {
      const c = WK.canLand(p, cs.region, sol && sol.solidAt);
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
  /** Cave station action (T10): nest = rest (autosaves), larder = eat item arg, exit = leave. */
  const caveAct = (cs, id, arg) => (id === 'nest' ? lairRest(cs) : relay(cs, CV.act(cs, id, arg)));

  M.define('state', { create, enterRegion, ensureTown, ensureCrops, solids, step, autosave, scaleOf, carriedPrey, eatTime, lairRest, lairEat, lairLeave, caveAct });
})(typeof self !== 'undefined' ? self : this);
