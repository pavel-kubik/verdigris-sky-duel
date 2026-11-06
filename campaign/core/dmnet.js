/*
 * Verdigris deathmatch - rooms over PeerJS (campaign/dm/). Pure: no DOM; PeerJS, the clock and the randomness come in
 * as options, so tests run it on a simulated network (campaign/test/fake-net.js) and the page on the real one.
 *
 * A room is the PeerJS id data.dm.peerPrefix + code. Whoever holds that id is the host and owns the world
 * (core/dm.js); guests connect to it. enterRoom(code) joins the room, or claims the code when nobody holds it.
 * The host sends a snapshot 20 times a second and the room record (scores by seat key) every recEvery s; guests
 * keep the record. A guest that hears nothing for hostTimeout s looks for the next host (successorOf).
 * One world per code: the code at the server decides who hosts. A host that loses it (its socket dropped while the
 * screen was locked or the network was gone, and a guest took the code over) steps down - it tells its guests the
 * room has moved and joins the new host with its room record; every joining player sends its record and the host
 * merges it (DM.mergeRoom), so no scores are lost when two copies of a room meet. A host checks its claim every
 * claimCheck s (reconnects a dropped socket). A player rejoining a saved room claims the code only when it was
 * missing claimAfter times in a row (not during a host's short reconnect).
 *
 *   NET.session({ Peer, peerOptions, clock: { now, setTimeout, clearTimeout }, random, rng, key, name(), pose(), emit(ev), offline })
 *     -> { host(), practice(), join(code, savedRec?), rejoin(code, rec), leave(), tick(dt), shoot(from, dir), crash(dmg, kind),
 *          startMatch(), restart(), setSettings(o), state getters: role, code, world, myId, migrating, ... }
 *   emit: { t: 'hosted', code, me, resume, restored } | { t: 'joined', code, welcome, resume } | { t: 'snap', s, e }
 *         | { t: 'record', rec } | { t: 'migrating', why } | { t: 'migrateSlow' } | { t: 'enterFailed', err, code }
 *         | { t: 'hostFailed', err }: no room could be opened (the server is unreachable); nothing starts by itself -
 *           the player tries again or picks practice() (a game nobody can join)
 *   A take-over never gives up (the player may be the one who was offline): after migrateWait s it emits
 *   'migrateSlow' once and keeps trying until it is back in the room or the player leaves.
 *   tick(dt) on the host steps the world and returns { events, snap } for its own view; on a guest it sends the pose.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), DM = M.need('dm');
  const X = D.dm, NET_DT = 1 / 20, GUEST_TIMEOUT = 15000, CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CLAIM_CHECK = 2, CLAIM_AFTER = 2, HOST_TRIES = 3, FIRST_OPEN = 20000;

  function session(o) {
    const clock = o.clock, rnd = o.random || Math.random;
    const S = {
      role: null, code: '', world: null, myId: 0, migrating: false, inGame: false, peer: null, hostConn: null,
      guests: new Map(), rows: [], hid: 1, ph: null, tl: 0, lastRec: null, lastSnapAt: 0, nextId: 2, outbox: [],
      netT: 0, recT: 0, checkT: 0, entering: 0,
    };
    const emit = ev => { if (o.emit) o.emit(ev); };
    const later = (fn, ms) => clock.setTimeout(fn, ms);
    const destroy = p => { try { if (p) p.destroy(); } catch (_) { } };
    const makeCode = () => { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)]; return s; };

    /** Claims the room id: done(null, peer) or done(errorType). */
    const peerOpts = () => Object.assign({ debug: 1 }, o.peerOptions || {});
    function claimRoom(code, done, waitMs) {
      if (!o.Peer) { done('nolib'); return; }
      let fin = false;
      const p = new o.Peer(X.peerPrefix + code, peerOpts());
      const end = err => {
        if (fin) return; fin = true; clock.clearTimeout(timer);
        if (err) { destroy(p); done(err); } else done(null, p);
      };
      const timer = later(() => end('timeout'), waitMs || 10000);
      p.on('open', () => end(null));
      p.on('error', e => { if (!fin) end((e && e.type) || 'error'); });
    }
    /** Joins the room: done(null, { peer, conn, welcome }) or done(errorType). */
    function joinRoom(code, hello, done) {
      if (!o.Peer) { done('nolib'); return; }
      let fin = false;
      const p = new o.Peer(undefined, peerOpts());
      const end = (err, c, m) => {
        if (fin) return; fin = true; clock.clearTimeout(timer);
        if (err) { destroy(p); done(err); } else done(null, { peer: p, conn: c, welcome: m });
      };
      const timer = later(() => end('timeout'), 9000);
      p.on('open', () => {
        const c = p.connect(X.peerPrefix + code, { reliable: true, serialization: 'json' });
        c.on('open', () => c.send(hello));
        c.on('data', m => { if (fin || !m) return; if (m.k === 'w') end(null, c, m); else if (m.k === 'full') end('full'); });
        c.on('close', () => end('closed'));
      });
      p.on('error', e => { if (!fin) end((e && e.type) || 'error'); });
    }
    const hello = rec => ({ k: 'hi', name: o.name(), key: o.key, pose: S.inGame && o.pose ? o.pose() : null, r: rec || null });

    /**
     * Into room `code`: join it; when nobody holds it (opt.hostIfEmpty) claim it and host from opt.rec. opt.preferHost
     * claims first. Retries until opt.wait s are over, then opt.fail(lastError). opt.failFast: errors that end it at once.
     */
    function enterRoom(code, opt) {
      const run = ++S.entering, until = clock.now() + (opt.wait || 15) * 1000;
      let lastErr = '', missing = 0;
      const live = () => run === S.entering;
      let slow = false;
      const next = (step, ms) => {
        if (!live()) return;
        if (clock.now() > until) {
          if (!opt.forever) { S.entering++; opt.fail(lastErr); return; }
          if (!slow) { slow = true; if (opt.slow) opt.slow(); }
        }
        later(() => attempt(step), ms);
      };
      function attempt(step) {
        if (!live()) return;
        if (step === 'claim') {
          claimRoom(code, (err, p) => {
            if (!live()) { destroy(p); return; }
            if (!err) { S.entering++; hosted(p, code, opt.rec); return; }
            lastErr = err;
            if (err === 'nolib') { S.entering++; if (opt.fail) opt.fail(err); return; }
            next(err === 'unavailable-id' ? 'join' : 'claim', err === 'unavailable-id' ? 400 : 1500);
          });
        } else {
          joinRoom(code, hello(opt.rec), (err, r) => {
            if (!live()) { if (r) destroy(r.peer); return; }
            if (!err) { S.entering++; joined(r, code); return; }
            lastErr = err;
            if ((err === 'full' && !opt.forever) || (opt.failFast && opt.failFast.indexOf(err) >= 0)) { S.entering++; opt.fail(err); return; }
            missing = err === 'peer-unavailable' ? missing + 1 : 0;
            const claim = err === 'peer-unavailable' && opt.hostIfEmpty && missing >= (opt.claimAfter || 1);
            next(claim ? 'claim' : 'join', err === 'peer-unavailable' ? 400 : 1500);
          });
        }
      }
      if (opt.delay) next(opt.preferHost ? 'claim' : 'join', opt.delay * 1000); else attempt(opt.preferHost ? 'claim' : 'join');
    }

    /** This client hosts room `code` (p = its peer, null offline), from record rec (or a fresh lobby). */
    function hosted(p, code, rec) {
      const resume = S.inGame;
      dropNet();
      Object.assign(S, { peer: p, code, role: 'host', migrating: false, myId: 1, nextId: 2, outbox: [], rows: [] });
      if (p) {
        p.on('connection', onGuestConn);
        p.on('disconnected', () => { if (S.peer === p) { try { p.reconnect(); } catch (_) { } } });
        p.on('error', e => { if (S.peer === p && S.role === 'host' && e && e.type === 'unavailable-id') stepDown(); });   // the code is someone else's now
      }
      S.world = (rec && DM.importRoom(rec, { code, rng: o.rng })) || DM.newWorld({ phase: 'lobby', code, rng: o.rng });
      S.world.code = code;
      const me = DM.addPlayer(S.world, 1, o.name(), null, o.key);
      S.world.ev.length = 0;
      const pose = resume && o.pose ? o.pose() : null;
      if (pose) DM.setPose(S.world, 1, pose);
      S.inGame = true;
      if (code) { S.lastRec = DM.exportRoom(S.world); emit({ t: 'record', rec: S.lastRec }); }
      emit({ t: 'hosted', code, me: { color: me.color, pos: me.pos.slice(), yaw: me.yaw }, resume, restored: !!rec });
    }
    /** This client is a guest of room `code`. */
    function joined(r, code) {
      const resume = S.inGame;
      dropNet();
      Object.assign(S, { peer: r.peer, hostConn: r.conn, role: 'guest', code, migrating: false, world: null, myId: r.welcome.id, lastSnapAt: clock.now(), rows: [] });
      const c = r.conn;
      c.on('data', m => onHostMsg(c, m));
      c.on('close', () => { if (S.hostConn === c) onHostLost({}); });
      r.peer.on('disconnected', () => { if (S.peer === r.peer) { try { r.peer.reconnect(); } catch (_) { } } });
      S.inGame = true;
      emit({ t: 'joined', code, welcome: r.welcome, resume });
    }
    function onHostMsg(c, m) {
      if (!m || typeof m !== 'object' || S.hostConn !== c) return;
      if (m.k === 's' && m.s) {
        S.lastSnapAt = clock.now();
        S.rows = m.s.P || []; S.hid = m.s.hid; S.ph = m.s.ph; S.tl = m.s.tl;
        emit({ t: 'snap', s: m.s, e: m.e || [] });
      } else if (m.k === 'r' && m.r) {
        S.lastRec = Object.assign({}, m.r, { code: S.code });
        emit({ t: 'record', rec: S.lastRec });
      } else if (m.k === 'moved') onHostLost({ why: 'moved' });   // our host stepped down: join the room's new host
    }
    /** Closes the current peer and connections (the game view stays). */
    function dropNet() {
      const p = S.peer, c = S.hostConn;
      S.peer = null; S.hostConn = null;
      S.guests.forEach(g => { try { g.conn.close(); } catch (_) { } });
      S.guests.clear();
      try { if (c) c.close(); } catch (_) { }
      destroy(p);
    }

    /** The code belongs to another host now: send the guests there and join it with this world's record (merged). */
    function stepDown() {
      if (S.role !== 'host' || !S.code || !S.world) return;
      const rec = DM.exportRoom(S.world), code = S.code, old = { peer: S.peer, guests: [...S.guests.values()] };
      S.lastRec = rec;
      emit({ t: 'record', rec });
      old.guests.forEach(g => send(g.conn, { k: 'moved' }));
      later(() => { old.guests.forEach(g => { try { g.conn.close(); } catch (_) { } }); destroy(old.peer); }, 400);
      Object.assign(S, { peer: null, guests: new Map(), hostConn: null, role: 'guest', world: null, migrating: true, rows: [] });
      emit({ t: 'migrating', why: 'stepdown' });
      enterRoom(code, { hostIfEmpty: true, delay: 0.3, wait: X.migrateWait, forever: true, slow: migrateSlow, rec });
    }

    /* ---------- host take-over: the guest that joined first claims the room, the others join it ---------- */
    function migrateSlow() { emit({ t: 'migrateSlow' }); }
    function onHostLost(opt) {
      if (S.migrating || S.role !== 'guest' || !S.code) return;
      S.migrating = true;
      const moved = !!(opt && opt.why === 'moved');
      const succ = !moved && DM.successorOf(S.rows.map(r => ({ id: r[0], seq: r[19] })), S.hid) === S.myId;
      dropNet();
      const rec = S.lastRec ? Object.assign({}, S.lastRec, { people: JSON.parse(JSON.stringify(S.lastRec.people || {})) }) : null;
      if (rec && S.ph != null) { rec.phase = DM.PHASES[S.ph] || rec.phase; rec.timeLeft = S.tl; }
      if (rec) S.rows.forEach(r => {                 // the newest scores of who is in the room, by name where the record knows them
        for (const k in rec.people) if (rec.people[k].name === r[12]) Object.assign(rec.people[k], { kills: r[14], deaths: r[15], score: r[16] });
      });
      emit({ t: 'migrating', why: opt && opt.why || 'lost' });
      enterRoom(S.code, {
        hostIfEmpty: true, preferHost: succ, delay: succ ? 0 : moved ? 0.6 : X.migrateDelay, wait: X.migrateWait, forever: true, slow: migrateSlow, rec,
      });
    }

    /** Opens a new room with a random code. A taken code: another code; no server: try again, then 'hostFailed'. */
    function host() {
      if (o.offline) { hosted(null, '', null); return; }
      if (!o.Peer) { emit({ t: 'hostFailed', err: 'nolib' }); return; }
      const run = ++S.entering;
      let taken = 0, failed = 0;
      const attempt = () => {
        if (run !== S.entering) return;
        const code = makeCode();
        claimRoom(code, (err, p) => {
          if (run !== S.entering) { destroy(p); return; }
          if (!err) { S.entering++; hosted(p, code, null); return; }
          if (err === 'unavailable-id' && taken++ < 3) attempt();
          else if (err !== 'unavailable-id' && ++failed < HOST_TRIES) later(attempt, 1500);
          else { S.entering++; emit({ t: 'hostFailed', err }); }
        }, FIRST_OPEN);
      };
      attempt();
    }
    /** A game on this device only (no room, nobody can join). */
    function practice() { S.entering++; hosted(null, '', null); }
    /** Join by code. saved = this browser's saved record of the same room: host it again when nobody does. */
    function join(code, saved) {
      enterRoom(code, {
        hostIfEmpty: !!saved, rec: saved || null, wait: 15, claimAfter: CLAIM_AFTER,
        failFast: saved ? ['nolib'] : ['peer-unavailable', 'network', 'server-error', 'socket-error', 'nolib'],
        fail: err => emit({ t: 'enterFailed', err, code }),
      });
    }
    function rejoin(code, rec) {
      enterRoom(code, { hostIfEmpty: true, rec, wait: 20, claimAfter: CLAIM_AFTER, failFast: ['nolib'], fail: err => emit({ t: 'enterFailed', err, code }) });
    }
    function leave() { S.entering++; dropNet(); S.role = null; S.world = null; S.code = ''; S.migrating = false; }

    function onGuestConn(conn) {
      conn.on('data', m => onGuestMsg(conn, m));
      conn.on('close', () => dropGuest(conn));
      conn.on('error', () => dropGuest(conn));
    }
    function onGuestMsg(conn, m) {
      const w = S.world;
      if (!m || typeof m !== 'object' || !w || S.role !== 'host') return;
      const g = S.guests.get(conn.peer);
      if (g) g.last = clock.now();
      if (m.k === 'hi') {
        if (g) return;
        const key = typeof m.key === 'string' && /^k[0-9a-z]{2,40}$/.test(m.key) ? m.key : '';
        const seated = key && DM.playerList(w).some(p => p.key === key);
        if ((!seated && DM.playerList(w).length >= X.maxPlayers) || key === o.key) { conn.send({ k: 'full' }); later(() => { try { conn.close(); } catch (_) { } }, 500); return; }
        S.guests.forEach((gg, pid) => { if (key && w.players[gg.id] && w.players[gg.id].key === key) { S.guests.delete(pid); try { gg.conn.close(); } catch (_) { } } });
        if (m.r && typeof m.r === 'object') DM.mergeRoom(w, Object.assign({}, m.r, { code: S.code }));   // its copy of the room (scores)
        const id = S.nextId++;
        const pl = DM.addPlayer(w, id, String(m.name || 'Dragon'), null, key);
        if (m.pose) DM.setPose(w, id, m.pose);
        S.guests.set(conn.peer, { conn, id, last: clock.now() });
        conn.send({ k: 'w', id, color: pl.color, p: pl.pos, y: pl.yaw, code: S.code, host: w.players[S.myId] ? w.players[S.myId].name : '' });
        try { conn.send({ k: 'r', r: DM.exportRoom(w) }); } catch (_) { }
      } else if (m.k === 'p' && g) DM.setPose(w, g.id, m);
      else if (m.k === 'b' && g) DM.shoot(w, g.id, m.f, m.d);
      else if (m.k === 'c' && g) DM.reportCrash(w, g.id, m.d, m.w);
    }
    function dropGuest(conn) {
      const g = S.guests.get(conn.peer);
      if (!g || g.conn !== conn) return;
      S.guests.delete(conn.peer);
      if (S.world) DM.removePlayer(S.world, g.id);
    }

    function send(c, m) { if (c && c.open) { try { c.send(m); } catch (_) { } } }
    function tick(dt) {
      if (S.role === 'host' && S.world) {
        const w = S.world, pose = o.pose ? o.pose() : null;
        if (pose) DM.setPose(w, S.myId, pose);
        DM.stepWorld(w, dt);
        const events = w.ev.splice(0);
        for (const e of events) S.outbox.push(e);
        S.netT += dt;
        if (S.netT >= NET_DT) {
          S.netT = 0;
          const now = clock.now();
          S.guests.forEach(g => { if (now - g.last > GUEST_TIMEOUT) { try { g.conn.close(); } catch (_) { } dropGuest(g.conn); } });
          const msg = { k: 's', s: DM.snapshot(w), e: S.outbox }; S.outbox = [];
          S.guests.forEach(g => send(g.conn, msg));
        }
        S.recT += dt;
        if (S.recT >= X.recEvery && S.code) {
          S.recT = 0;
          S.lastRec = DM.exportRoom(w);
          emit({ t: 'record', rec: S.lastRec });
          const rm = { k: 'r', r: S.lastRec };
          S.guests.forEach(g => send(g.conn, rm));
        }
        S.checkT += dt;
        if (S.checkT >= CLAIM_CHECK && S.peer && S.code) {          // still holding the code? reconnect a dropped socket
          S.checkT = 0;
          if (S.peer.destroyed) stepDown();
          else if (S.peer.disconnected) { try { S.peer.reconnect(); } catch (_) { } }
        }
        return { events, snap: DM.snapshot(w) };
      }
      if (S.role === 'guest') {
        S.netT += dt;
        if (S.netT >= NET_DT) { S.netT = 0; const p = o.pose ? o.pose() : null; if (p) send(S.hostConn, Object.assign({ k: 'p' }, p)); }
        if (!S.migrating && S.hostConn && S.lastSnapAt && clock.now() - S.lastSnapAt > X.hostTimeout * 1000) onHostLost({});
      }
      return null;
    }
    function shoot(from, dir) {
      if (S.role === 'host' && S.world) return !!DM.shoot(S.world, S.myId, from, dir);
      send(S.hostConn, { k: 'b', f: from.map(v => Math.round(v * 100) / 100), d: dir.map(v => Math.round(v * 1000) / 1000) });
      return true;
    }
    function crash(dmg, kind) {
      if (S.role === 'host' && S.world) DM.reportCrash(S.world, S.myId, dmg, kind);
      else send(S.hostConn, { k: 'c', d: dmg, w: kind });
    }
    const hostOnly = fn => (...a) => (S.role === 'host' && S.world ? fn(S.world, ...a) : false);

    return {
      host, practice, join, rejoin, leave, tick, shoot, crash,
      startMatch: hostOnly(DM.startMatch), restart: hostOnly(DM.restart), setSettings: hostOnly(DM.setSettings),
      get role() { return S.role; }, get code() { return S.code; }, get world() { return S.world; }, get myId() { return S.myId; },
      get migrating() { return S.migrating; }, get peer() { return S.peer; }, get hostConn() { return S.hostConn; },
      get guests() { return S.guests; }, get lastRec() { return S.lastRec; }, get entering() { return S.entering; }, get lastSnapAt() { return S.lastSnapAt; },
    };
  }

  M.define('dmnet', { session, NET_DT });
})(typeof self !== 'undefined' ? self : this);
