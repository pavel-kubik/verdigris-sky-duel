// A simulated PeerJS network on a virtual clock, for room tests (campaign/test/dmnet.test.js).
// It behaves as the PeerJS cloud does for what the deathmatch uses:
//   - new Peer(id): registers the id at the signalling server after `lat` ms -> 'open', or 'error' unavailable-id when
//     another peer holds it (the new peer is then destroyed); a random id when none is given;
//   - peer.connect(id): the offer goes through the server; no such id -> 'error' peer-unavailable on the peer; the id
//     held by a peer that is dead or offline -> the connection never opens (no error); else both ends 'open';
//   - conn.send: delivered after `lat` ms while both sides are online; conn.close: 'close' at both ends;
//   - peer.reconnect() after 'disconnected': re-registers the same id, or 'error' unavailable-id when somebody took it
//     meanwhile (the peer stays disconnected, as PeerJS does once it had an id);
//   - every callback runs on its client's clock: a frozen client (a phone with the screen locked) runs nothing until
//     it thaws, then catches up in order.
// Faults: closeTab, crash (no close events, the id freed later), freeze, dropSignal (the server loses the socket,
// data channels go on), offline (no traffic at all; the server frees ids later, data channels die after iceAfter).
'use strict';

function createNet(opts) {
  opts = opts || {};
  const net = { t: 0, lat: opts.lat == null ? 40 : opts.lat, n: 0, q: [], ids: new Map(), clients: [] };

  /* ---------- the event queue (time, then insertion order) ---------- */
  function push(it) {
    let lo = 0, hi = net.q.length;
    while (lo < hi) { const m = (lo + hi) >> 1; const o = net.q[m]; if (o.time < it.time || (o.time === it.time && o.seq < it.seq)) lo = m + 1; else hi = m; }
    net.q.splice(lo, 0, it);
    return it;
  }
  net.after = (ms, fn, owner) => push({ time: net.t + Math.max(0, ms || 0), seq: net.n++, fn, owner: owner || null, dead: false });
  net.every = (ms, fn, owner) => { const loop = () => { fn(); net.after(ms, loop, owner); }; return net.after(ms, loop, owner); };
  net.run = ms => {
    const end = net.t + ms;
    while (net.q.length && net.q[0].time <= end) {
      const it = net.q.shift();
      if (it.dead) continue;
      const c = it.owner;
      if (c && c.dead) continue;
      if (c && c.frozenUntil > it.time) { it.time = c.frozenUntil; it.seq = net.n++; push(it); continue; }
      net.t = it.time;
      it.fn();
    }
    net.t = end;
  };
  net.clockFor = c => ({ now: () => net.t, setTimeout: (fn, ms) => net.after(ms, fn, c), clearTimeout: h => { if (h) h.dead = true; } });

  /* ---------- clients, peers and connections ---------- */
  net.client = name => {
    const c = { name, dead: false, frozenUntil: 0, offline: false, peers: new Set() };
    c.Peer = function (id) { return new FakePeer(c, id); };
    net.clients.push(c);
    return c;
  };
  const reachable = c => !c.dead && !c.offline;

  function Emitter() { this.h = {}; }
  Emitter.prototype.on = function (ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return this; };
  Emitter.prototype.emit = function (ev, a) { (this.h[ev] || []).slice().forEach(f => f(a)); };

  function FakePeer(client, id) {
    Emitter.call(this);
    this.client = client; this.id = typeof id === 'string' ? id : 'r' + (net.n++).toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    this.open = false; this.disconnected = false; this.destroyed = false; this.everOpen = false; this.conns = new Set();
    client.peers.add(this);
    net.after(net.lat, () => this.register(false), client);
  }
  FakePeer.prototype = Object.create(Emitter.prototype);
  FakePeer.prototype.register = function (re) {
    if (this.destroyed) return;
    if (this.client.offline) { this.emit('error', { type: 'network' }); if (!re) this.destroy(); return; }
    const holder = net.ids.get(this.id);
    if (holder && holder !== this) {
      this.emit('error', { type: 'unavailable-id' });
      if (!re) this.destroy();                               // PeerJS: a peer that never had the id is destroyed
      return;
    }
    net.ids.set(this.id, this);
    this.open = true; this.disconnected = false; this.everOpen = true;
    this.emit('open', this.id);
  };
  FakePeer.prototype.connect = function (to) {
    const c = new FakeConn(this, to);
    this.conns.add(c);
    const from = this;
    net.after(net.lat, () => {                               // the offer reaches the signalling server
      if (from.destroyed || !reachable(from.client) || from.disconnected) return;
      const target = net.ids.get(to);
      if (!target) { from.emit('error', { type: 'peer-unavailable' }); c.end(); return; }
      if (!reachable(target.client) || target.destroyed) return;            // dead or offline holder: never opens
      net.after(net.lat, () => {                             // the target's browser takes the call
        if (target.destroyed || c.closed || !reachable(target.client)) return;
        const rc = new FakeConn(target, from.id);
        rc.remote = c; c.remote = rc;
        target.conns.add(rc);
        target.emit('connection', rc);
        net.after(net.lat, () => { if (!rc.closed && !c.closed) { rc.open = true; rc.emit('open'); } }, target.client);
        net.after(net.lat * 2, () => { if (!c.closed && !rc.closed) { c.open = true; c.emit('open'); } }, from.client);
      }, target.client);
    }, from.client);
    return c;
  };
  FakePeer.prototype.reconnect = function () {
    if (this.destroyed || !this.disconnected) return;
    net.after(net.lat, () => this.register(true), this.client);
  };
  FakePeer.prototype.unregister = function () { if (net.ids.get(this.id) === this) net.ids.delete(this.id); };
  FakePeer.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true; this.open = false; this.disconnected = true;
    this.unregister();
    [...this.conns].forEach(c => c.close());
    this.client.peers.delete(this);
  };
  /** The server loses this peer's socket: 'disconnected' now (on the client's clock), the id is free after freeAfter. */
  FakePeer.prototype.lose = function (freeAfter) {
    if (this.destroyed || this.disconnected) return;
    this.disconnected = true; this.open = false;
    const self = this;
    net.after(freeAfter || 0, () => { if (self.disconnected) self.unregister(); });
    net.after(0, () => { if (!self.destroyed) self.emit('disconnected', self.id); }, this.client);
  };

  function FakeConn(peer, remoteId) {
    Emitter.call(this);
    this.local = peer; this.peer = remoteId; this.open = false; this.closed = false; this.remote = null; this.broken = false;
  }
  FakeConn.prototype = Object.create(Emitter.prototype);
  FakeConn.prototype.send = function (d) {
    const r = this.remote;
    if (!this.open || this.closed || !r || this.broken || r.broken || !reachable(this.local.client) || !reachable(r.local.client)) return;
    const data = JSON.parse(JSON.stringify(d));
    net.after(net.lat, () => { if (!r.closed && r.open && !r.broken) r.emit('data', data); }, r.local.client);
  };
  FakeConn.prototype.end = function () {
    if (this.closed) return;
    this.closed = true; this.open = false; this.local.conns.delete(this);
    const self = this;
    net.after(0, () => self.emit('close'), this.local.client);
  };
  FakeConn.prototype.close = function () {
    if (this.closed) return;
    this.end();
    const r = this.remote;
    if (r && !this.broken && reachable(this.local.client)) net.after(net.lat, () => r.end(), r.local.client);
  };

  /* ---------- faults ---------- */
  /** The tab is closed: sockets close cleanly, so the server frees the ids and the other ends see 'close'. */
  net.closeTab = c => {
    [...c.peers].forEach(p => { p.unregister(); [...p.conns].forEach(x => { const r = x.remote; x.closed = true; if (r) net.after(net.lat, () => r.end(), r.local.client); }); p.destroyed = true; });
    c.dead = true;
  };
  /** The phone dies: nobody hears anything; the server frees the ids after freeAfter (its heartbeat timeout). */
  net.crash = (c, freeAfter) => {
    c.dead = true;
    [...c.peers].forEach(p => { p.destroyed = true; net.after(freeAfter || 0, () => p.unregister()); [...p.conns].forEach(x => { x.broken = true; }); });
  };
  /** The screen locks: nothing runs for ms (messages wait); loseSignalAfter: the server drops the socket meanwhile. */
  net.freeze = (c, ms, loseSignalAfter) => {
    c.frozenUntil = net.t + ms;
    if (loseSignalAfter != null) net.after(loseSignalAfter, () => [...c.peers].forEach(p => p.lose(0)));
  };
  /** The server drops this client's sockets (data channels go on); ids free after freeAfter. */
  net.dropSignal = (c, freeAfter) => [...c.peers].forEach(p => p.lose(freeAfter || 0));
  /** No network for ms: sockets lost (ids free after freeAfter), data channels die after iceAfter (both ends close). */
  net.offline = (c, ms, freeAfter, iceAfter) => {
    c.offline = true;
    [...c.peers].forEach(p => {
      p.lose(freeAfter == null ? 30000 : freeAfter);
      [...p.conns].forEach(x => {
        x.broken = true; const r = x.remote; if (r) r.broken = true;
        net.after(iceAfter == null ? 15000 : iceAfter, () => { x.end(); if (r) r.end(); });
      });
    });
    net.after(ms, () => { c.offline = false; });
  };
  return net;
}

module.exports = { createNet };
