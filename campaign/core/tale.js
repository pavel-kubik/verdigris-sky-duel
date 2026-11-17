/*
 * Verdigris campaign - the tales: the same story told by the wizard, the prince and the princess, played on foot in
 * Prahold (the dragon tells its own in the main campaign). A tale (data.tales[id]) is a list of chapters, a chapter a
 * story card and a list of steps; a step is one objective:
 *   reach   { at, r }                                  walk to a place (at: [x, z] or the name of a landmark lot)
 *   talk    { npcs: [{ id, kind, at, yaw, line }] }    talk to every one of them (the gift button next to them)
 *   collect { item, at: [[x, z]...] }                   pick up everything (walk over it)
 *   gift    { targets: [{ at, y, hp, kind }] }          use the hero's gift on each target until it gives (lantern lit,
 *                                                       dummy down, thug flees, seal broken, the dragon changed)
 *   sneak   { to, r, guards: [{ at, yaw, range, cone }] } get there unseen; seen = back to where the step began. The
 *                                                       princess' charm turns a guard away for data.tale.charm s
 *   escort  { npc: { id, kind, at }, to, r }           someone follows you; done when they are there
 * Every step may carry npcs (people standing there for the scene) and a `say` line shown when it starts.
 *
 *   create(id, regionId?) -> ts       ts: { id, ch, st, done, card, npcs, items, targets, guards, follower, from, t }
 *   start(ts, hero)                   the first chapter card and step (call once the hero stands at the tale start)
 *   step(ts, hero, gifts, dt) -> events[]   gifts = this frame's 'hero:gift' events; events: tale:card { key, lines },
 *                                     tale:objective, tale:progress { n, of }, tale:seen { guard }, tale:say { key },
 *                                     tale:hit { target }, tale:collect { item }, tale:chapter { ch }, tale:done
 *   closeCard(ts)                     the player read the card: play goes on
 *   objective(ts) -> { key, n, of, at: [x, y, z] | null } | null   the current objective and where it is
 *   targetsFor(ts) -> [{ id, pos, r }]  what the hero's gift can be used on now (for hero.step ctx.targets)
 *   point(regionId, at) -> [x, z]     a step point on open ground: a landmark's door, or the nearest street or square
 *                                     cell clear of buildings (so every objective can be walked to)
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), CI = M.need('city');

  const cache = new Map();
  /** An open, walkable point at or near `at` ([x, z] or a landmark lot name: the point in front of its door). */
  function point(regionId, at) {
    const key = regionId + ':' + (Array.isArray(at) ? at.join(',') : at);
    if (cache.has(key)) return cache.get(key);
    let x, z;
    if (Array.isArray(at)) { x = at[0]; z = at[1]; } else {
      const c = CI.build(regionId), lot = c && c.lots.find(l => l.name === at);
      if (!lot) throw new Error('VCamp tale: no landmark "' + at + '" in ' + regionId);
      const out = lot.d / 2 + 4;
      x = lot.x + Math.sin(lot.yaw) * out; z = lot.z + Math.cos(lot.yaw) * out;
    }
    const open = (px, pz) => !T.liquidAt(regionId, px, pz) && T.dryAt(regionId, px, pz) && CI.solidAt(regionId, px, pz, 1.2) == null;
    let best = open(x, z) ? [x, z] : null;
    for (let r = 2; !best && r < 60; r += 2) {
      for (let k = 0; k < 16 && !best; k++) {
        const a = k / 16 * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (open(px, pz) && (CI.pavedAt(regionId, px, pz) || r > 20)) best = [px, pz];
      }
    }
    best = best || [x, z];
    cache.set(key, best);
    return best;
  }

  function tale(id) {
    const t = D.tales[id];
    if (!t) throw new Error('VCamp tale: unknown tale "' + id + '"');
    return t;
  }

  function create(id, regionId) {
    const t = tale(id);
    return { id, region: regionId || t.region, hero: t.hero, ch: 0, st: -1, done: false, card: null, npcs: [], items: [], targets: [], guards: [],
             follower: null, from: null, t: 0, stepT: 0, seen: 0, said: null };
  }

  const ground = (ts, x, z) => T.surfaceAt(ts.region, x, z);
  function npcOf(ts, n) {
    const [x, z] = point(ts.region, n.at);
    return { id: n.id, kind: n.kind || 'citizen', pos: [x, ground(ts, x, z), z], yaw: n.yaw || 0, line: n.line || null, talked: false, follow: false };
  }

  /** Sets up step ts.st of chapter ts.ch: its npcs, items, targets and guards. */
  function enterStep(ts, hero, ev) {
    const S = tale(ts.id).chapters[ts.ch].steps[ts.st];
    ts.stepT = 0; ts.from = hero ? { pos: hero.pos.slice(), yaw: hero.yaw } : null;
    ts.npcs = (S.npcs || []).map(n => npcOf(ts, n));
    ts.items = []; ts.targets = []; ts.guards = [];
    if (S.type === 'talk') for (const n of S.npcs) ts.npcs.find(q => q.id === n.id).need = true;
    if (S.type === 'collect') ts.items = S.at.map((a, i) => { const [x, z] = point(ts.region, a); return { id: S.item + i, kind: S.item, pos: [x, ground(ts, x, z) + 0.9, z], taken: false }; });
    if (S.type === 'gift') ts.targets = S.targets.map((g, i) => {
      const [x, z] = g.raw ? g.at : point(ts.region, g.at);
      return { id: (g.kind || 'target') + i, kind: g.kind || 'target', pos: [x, ground(ts, x, z) + (g.y || 1), z], hp: g.hp || 1, r: g.r || 0.6, yaw: g.yaw || 0 };
    });
    if (S.type === 'sneak') ts.guards = S.guards.map((g, i) => { const [x, z] = point(ts.region, g.at); return { id: 'guard' + i, pos: [x, ground(ts, x, z), z], yaw: g.yaw || 0, range: g.range || D.tale.sight, cone: g.cone || D.tale.cone, charmed: 0, sway: g.sway || 0.6, base: g.yaw || 0 }; });
    if (S.type === 'escort') { const f = npcOf(ts, S.npc); f.follow = true; ts.npcs.push(f); ts.follower = f; } else ts.follower = ts.follower && S.keepFollower ? ts.follower : null;
    if (ts.follower && S.type !== 'escort' && !ts.npcs.includes(ts.follower)) ts.npcs.push(ts.follower);
    if (S.say) ev.push({ e: 'tale:say', key: S.say });
    ev.push({ e: 'tale:objective', key: objKey(ts) });
  }
  const objKey = ts => 'c.tale.' + ts.id + '.' + (ts.ch + 1) + '.' + (ts.st + 1);

  function cardOf(ts) {
    const C = tale(ts.id).chapters[ts.ch];
    const base = 'c.tale.' + ts.id + '.' + (ts.ch + 1);
    const lines = [];
    for (let i = 1; i <= (C.lines || 2); i++) lines.push(base + '.l' + i);
    return { key: base + '.title', lines, chapter: ts.ch + 1, of: tale(ts.id).chapters.length };
  }

  function start(ts, hero, fromCh) {
    const ev = [];
    ts.ch = Math.max(0, Math.min(fromCh || 0, tale(ts.id).chapters.length - 1)); ts.st = -1;
    ts.card = cardOf(ts);
    ev.push(Object.assign({ e: 'tale:card' }, ts.card));
    ts.pendingHero = hero;
    return ev;
  }

  function closeCard(ts, hero) {
    if (!ts.card) return [];
    const ev = [];
    const last = ts.card.end;
    ts.card = null;
    if (last) { ts.done = true; ev.push({ e: 'tale:done', id: ts.id }); return ev; }
    if (ts.st < 0) { ts.st = 0; enterStep(ts, hero || ts.pendingHero, ev); }
    return ev;
  }

  /** The step is done: the next step, the next chapter's card, or the tale's last card. */
  function advance(ts, hero, ev) {
    const C = tale(ts.id).chapters;
    if (ts.st + 1 < C[ts.ch].steps.length) { ts.st++; enterStep(ts, hero, ev); return; }
    const endKey = 'c.tale.' + ts.id + '.' + (ts.ch + 1) + '.end';
    ev.push({ e: 'tale:chapter', ch: ts.ch + 1, end: endKey });
    if (ts.ch + 1 < C.length) {
      ts.ch++; ts.st = -1;
      ts.card = cardOf(ts); ts.card.prev = endKey;
      ev.push(Object.assign({ e: 'tale:card' }, ts.card));
    } else {
      ts.card = { key: 'c.tale.' + ts.id + '.end.title', lines: ['c.tale.' + ts.id + '.end.l1', 'c.tale.' + ts.id + '.end.l2', 'c.tale.' + ts.id + '.end.l3'], end: true, prev: endKey };
      ev.push(Object.assign({ e: 'tale:card' }, ts.card));
    }
  }

  function near(a, b, r) { return Math.hypot(a[0] - b[0], a[2] - b[2]) < r; }

  function step(ts, hero, gifts, dt) {
    const ev = [];
    if (ts.done || ts.card || ts.st < 0) return ev;
    ts.t += dt; ts.stepT += dt;
    const S = tale(ts.id).chapters[ts.ch].steps[ts.st], P = D.tale;
    const gift = (gifts || []).find(g => g.e === 'hero:gift');
    // npcs turn to the hero when close; a follower keeps a few steps behind
    for (const n of ts.npcs) {
      if (n.follow) {
        const dx = hero.pos[0] - n.pos[0], dz = hero.pos[2] - n.pos[2], d = Math.hypot(dx, dz);
        if (d > P.follow) {
          const k = Math.min(1, (d - P.follow) * dt * 1.6);
          n.pos[0] += dx * k * 0.5; n.pos[2] += dz * k * 0.5; n.yaw = Math.atan2(dx, dz); n.moving = Math.min(1, (d - P.follow) / 3);
        } else n.moving = 0;
        if (d > P.lost) { n.pos[0] = hero.pos[0] - Math.sin(hero.yaw) * 2; n.pos[2] = hero.pos[2] - Math.cos(hero.yaw) * 2; }   // never lost
        n.pos[1] = T.surfaceAt(ts.region, n.pos[0], n.pos[2]);
        if (hero.pos[1] > n.pos[1] + 0.5) n.pos[1] = Math.max(n.pos[1], hero.pos[1] - 0.3);   // on a bridge deck
      } else if (near(n.pos, hero.pos, 6)) n.yaw = Math.atan2(hero.pos[0] - n.pos[0], hero.pos[2] - n.pos[2]);
    }
    let done = false;
    if (S.type === 'reach') {
      done = near(hero.pos, ptOf(ts, S.at), S.r || P.reach);
    } else if (S.type === 'talk') {
      if (gift) {
        for (const n of ts.npcs) if (n.need && !n.talked && near(n.pos, hero.pos, P.talk)) {
          n.talked = true; ev.push({ e: 'tale:say', key: n.line || objKey(ts) + '.say', who: n.id });
          ev.push({ e: 'tale:progress', n: ts.npcs.filter(q => q.need && q.talked).length, of: ts.npcs.filter(q => q.need).length });
          break;
        }
      }
      done = ts.npcs.every(n => !n.need || n.talked);
    } else if (S.type === 'collect') {
      for (const it of ts.items) if (!it.taken && near(it.pos, hero.pos, P.pick)) {
        it.taken = true; ev.push({ e: 'tale:collect', item: it.kind });
        ev.push({ e: 'tale:progress', n: ts.items.filter(q => q.taken).length, of: ts.items.length });
      }
      done = ts.items.every(it => it.taken);
    } else if (S.type === 'gift') {
      if (gift && gift.target) {
        const tg = ts.targets.find(q => q.id === gift.target && q.hp > 0);
        if (tg) {
          tg.hp--; ev.push({ e: 'tale:hit', target: tg.id, kind: tg.kind, left: tg.hp });
          if (tg.hp <= 0) ev.push({ e: 'tale:progress', n: ts.targets.filter(q => q.hp <= 0).length, of: ts.targets.length });
        }
      }
      done = ts.targets.every(q => q.hp <= 0);
    } else if (S.type === 'sneak') {
      for (const g of ts.guards) {
        g.charmed = Math.max(0, g.charmed - dt);
        if (gift && gift.target === g.id && gift.kind === 'charm') { g.charmed = P.charm; ev.push({ e: 'tale:say', key: 'c.tale.charmed', who: g.id }); }
        g.yaw = g.base + Math.sin(ts.stepT * 0.5 + g.pos[0]) * g.sway;            // they look about
        if (g.charmed > 0) continue;
        const dx = hero.pos[0] - g.pos[0], dz = hero.pos[2] - g.pos[2], d = Math.hypot(dx, dz);
        const a = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - g.yaw), Math.cos(Math.atan2(dx, dz) - g.yaw)));
        const range = g.range * (hero.running ? 1 : P.walkSight);
        if (d < range && (a < g.cone || d < P.close) && CI.solidAt(ts.region, (hero.pos[0] + g.pos[0]) / 2, (hero.pos[2] + g.pos[2]) / 2, 0) == null) {
          ts.seen++;
          ev.push({ e: 'tale:seen', guard: g.id });
          if (ts.from) { hero.pos = ts.from.pos.slice(); hero.yaw = ts.from.yaw; hero.speed = 0; }
          break;
        }
      }
      done = near(hero.pos, ptOf(ts, S.to), S.r || P.reach);
    } else if (S.type === 'escort') {
      const f = ts.follower;
      done = !!f && near(f.pos, ptOf(ts, S.to), S.r || P.reach) && near(hero.pos, ptOf(ts, S.to), (S.r || P.reach) + 4);
    }
    if (done) advance(ts, hero, ev);
    return ev;
  }

  function ptOf(ts, at) { const [x, z] = point(ts.region, at); return [x, ground(ts, x, z), z]; }

  function objective(ts) {
    if (ts.done || ts.st < 0) return null;
    const S = tale(ts.id).chapters[ts.ch].steps[ts.st];
    const o = { key: objKey(ts), type: S.type, n: 0, of: 0, at: null };
    if (S.type === 'reach') o.at = ptOf(ts, S.at);
    else if (S.type === 'sneak') o.at = ptOf(ts, S.to);
    else if (S.type === 'escort') o.at = ptOf(ts, S.to);
    else if (S.type === 'talk') { const left = ts.npcs.filter(n => n.need && !n.talked); o.of = ts.npcs.filter(n => n.need).length; o.n = o.of - left.length; o.list = left.map(n => n.pos); }
    else if (S.type === 'collect') { const left = ts.items.filter(i => !i.taken); o.of = ts.items.length; o.n = o.of - left.length; o.list = left.map(i => i.pos); }
    else if (S.type === 'gift') { const left = ts.targets.filter(q => q.hp > 0); o.of = ts.targets.length; o.n = o.of - left.length; o.list = left.map(q => q.pos); }
    return o;
  }
  /** The nearest point of the objective to (x, z) - for the arrow and the compass. */
  function nearestGoal(ts, x, z) {
    const o = objective(ts);
    if (!o) return null;
    if (o.at) return o.at;
    let best = null, bd = Infinity;
    for (const p of o.list || []) { const d = Math.hypot(p[0] - x, p[2] - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  /** Where the hero stands when the tale is resumed at chapter ch: the tale start, or the end of the chapter before. */
  function chapterStart(id, ch, regionId) {
    const t = tale(id);
    if (!ch) return [t.start.x, t.start.z, t.start.yaw || 0];
    const steps = t.chapters[ch - 1].steps, S = steps[steps.length - 1];
    const at = S.to || S.at || (S.npcs && S.npcs[0].at) || (S.targets && S.targets[0].at) || (S.npc && S.npc.at);
    const [x, z] = point(regionId || t.region, Array.isArray(at) && Array.isArray(at[0]) ? at[at.length - 1] : at);
    const [ox, oz] = point(regionId || t.region, [x + 3, z + 3]);
    return [ox, oz, 0];
  }

  function targetsFor(ts) {
    const out = [];
    for (const q of ts.targets) if (q.hp > 0) out.push({ id: q.id, pos: q.pos, r: q.r });
    for (const n of ts.npcs) if (n.need && !n.talked) out.push({ id: n.id, pos: n.pos, r: 0.5 });
    for (const g of ts.guards) out.push({ id: g.id, pos: g.pos, r: 0.5 });
    return out;
  }

  M.define('tale', { create, chapterStart, start, step, closeCard, objective, nearestGoal, targetsFor, point, tale });
})(typeof self !== 'undefined' ? self : this);
