// Deathmatch rooms (core/dmnet.js) on a simulated PeerJS network (fake-net.js): after host changes and network faults
// a room must end up as ONE world - exactly one host, holding the room code at the server, every live player
// connected to it and seated in its world - and nobody may lose kills, deaths or score.
// The failure this guards against: players split into separate worlds that share the same room code.
'use strict';
const { ok, core } = require('./harness.js');
const { createNet } = require('./fake-net.js');
const NET = core('dmnet'), DM = core('dm'), D = core('data'), { mulberry } = core('math');
const X = D.dm;

function room(seed) {
  const net = createNet({ lat: 40 }), rng = mulberry(seed), players = [], saved = {};
  /** A browser tab of player `name` (a reopened tab keeps the token and the saved room: localStorage). */
  function add(name) {
    const c = net.client(name);
    c.key = DM.keyOf('token-' + name);
    const a = rng() * Math.PI * 2;
    c.pos = [Math.cos(a) * 200, 90, Math.sin(a) * 200];
    c.events = [];
    c.N = NET.session({
      Peer: c.Peer, clock: net.clockFor(c), random: rng, rng, key: c.key, name: () => name,
      pose: () => ({ p: c.pos, v: [0, 0, 0], y: 0, pi: 0, r: 0, rx: 0, sx: 0, b: 0, i: 0, m: 0 }),
      emit: ev => { c.events.push(ev.t); if (ev.t === 'record') saved[name] = JSON.parse(JSON.stringify(ev.rec)); },
    });
    net.every(50, () => c.N.tick(0.05), c);
    players.push(c);
    return c;
  }
  return { net, add, players, saved, rng };
}

/** Is room `code` one world? { ok, why, host }. */
function oneWorld(R, code) {
  const live = R.players.filter(c => !c.dead && c.N.code === code);
  const hosts = live.filter(c => c.N.role === 'host');
  if (hosts.length !== 1) return { ok: false, why: hosts.length + ' hosts (' + hosts.map(h => h.name).join(', ') + ') for ' + live.length + ' players' };
  const h = hosts[0], holder = R.net.ids.get(X.peerPrefix + code);
  if (!h.N.peer || holder !== h.N.peer || h.N.peer.disconnected) return { ok: false, why: h.name + ' hosts but does not hold the code' };
  for (const c of live) {
    if (c === h) continue;
    const hc = c.N.hostConn;
    if (c.N.role !== 'guest' || c.N.migrating || !hc || !hc.open || !hc.remote || hc.remote.local !== h.N.peer) {
      return { ok: false, why: c.name + ' is not in ' + h.name + "'s world (" + (c.N.migrating ? 'still migrating' : c.N.role || 'out') + ')' };
    }
  }
  const seated = DM.playerList(h.N.world).map(p => p.name).sort().join(), names = live.map(c => c.name).sort().join();
  if (seated !== names) return { ok: false, why: 'seated ' + seated + ' but live ' + names };
  return { ok: true, host: h };
}
/** Runs until every phone is awake and online again, then until the room is one world (checked every 0.5 s) or maxMs
 *  passed; returns the last check (which must still hold 2 s later). */
function settle(R, code, maxMs) {
  for (let t = 0; t < 120000 && R.players.some(c => !c.dead && (c.offline || c.frozenUntil > R.net.t)); t += 500) R.net.run(500);
  let st = oneWorld(R, code);
  for (let t = 0; t < maxMs && !st.ok; t += 500) { R.net.run(500); st = oneWorld(R, code); }
  if (st.ok) { R.net.run(2000); st = oneWorld(R, code); }   // and it stays so
  return st;
}
const statsOf = (R, code) => {
  const st = oneWorld(R, code), out = {};
  if (!st.ok) return out;
  DM.playerList(st.host.N.world).forEach(p => { out[p.name] = [p.kills, p.deaths, p.score]; });
  for (const k in st.host.N.world.ledger) { const e = st.host.N.world.ledger[k]; out[e.name] = out[e.name] || [e.kills, e.deaths, e.score]; }
  return out;
};
function kill(R, code, killer, victim) {
  const h = oneWorld(R, code).host, w = h.N.world, by = n => DM.playerList(w).find(p => p.name === n);
  const v = by(victim); v.down = false; v.sinv = 0;
  DM.damage(w, v, 999, by(killer).id, 'ball');
}
/** A room: the first name hosts, the others join one by one; the match starts; a few kills. */
function setup(seed, names) {
  const R = room(seed);
  const A = R.add(names[0]);
  A.N.host(); R.net.run(500);
  const code = A.N.code;
  for (const n of names.slice(1)) { R.add(n).N.join(code); R.net.run(400); }
  R.net.run(2000);
  const st = oneWorld(R, code);
  ok(st.ok && st.host === A, 'setup: one world hosted by ' + names[0] + (st.ok ? '' : ': ' + st.why));
  A.N.startMatch(); R.net.run(500);
  kill(R, code, names[1], names[2]); kill(R, code, names[0], names[1]);
  R.net.run(1500);                                            // the room record reaches everyone
  return { R, code, A, by: n => R.players.filter(c => c.name === n && !c.dead).pop() };
}
const sameOrMore = (before, after, who) => ok(after[who] && after[who][0] >= before[who][0] && after[who][1] >= before[who][1] && after[who][2] >= before[who][2],
  'stats kept for ' + who + ': ' + JSON.stringify(before[who]) + ' -> ' + JSON.stringify(after[who]));
const results = [];
function scenario(name, fn) {
  let st;
  try { st = fn(); } catch (e) { st = { ok: false, why: 'threw ' + e.message }; }
  results.push([name, st.ok, st.why || '']);
  ok(st.ok, name + ': ' + (st.why || ''));
}

// 1. The host closes the tab: the first guest hosts, the others follow, scores stay
scenario('host closes the tab', () => {
  const { R, code, A } = setup(1, ['Ash', 'Birch', 'Cedar', 'Dogwood']);
  const before = statsOf(R, code);
  R.net.closeTab(A);
  const st = settle(R, code, 60000);
  if (st.ok) { ok(st.host.name === 'Birch', 'successor is the first guest'); const after = statsOf(R, code); ['Birch', 'Cedar', 'Dogwood'].forEach(n => sameOrMore(before, after, n)); ok(after.Ash && after.Ash[0] === 1, 'the host who left keeps its kill in the ledger'); }
  return st;
});

// 2. The host's phone dies: no close events, the server frees the code only after its heartbeat timeout
scenario('host crashes (code freed after 20 s)', () => {
  const { R, code, A } = setup(2, ['Ash', 'Birch', 'Cedar']);
  const before = statsOf(R, code);
  R.net.crash(A, 20000);
  const st = settle(R, code, 90000);
  if (st.ok) { const after = statsOf(R, code); ['Birch', 'Cedar'].forEach(n => sameOrMore(before, after, n)); }
  return st;
});

// 3. The reported bug: the host locks the screen, the server drops its socket, a guest takes the code over;
//    the host comes back still thinking it hosts the room
scenario('host screen locked 25 s, socket dropped, then back', () => {
  const { R, code, A } = setup(3, ['Ash', 'Birch', 'Cedar', 'Dogwood']);
  const before = statsOf(R, code);
  R.net.freeze(A, 25000, 3000);
  R.net.run(30000);
  const st = settle(R, code, 60000);
  if (st.ok) { ok(R.players.filter(c => !c.dead).length === 4 && DM.playerList(st.host.N.world).length === 4, 'all four in one world'); const after = statsOf(R, code); ['Ash', 'Birch', 'Cedar', 'Dogwood'].forEach(n => sameOrMore(before, after, n)); }
  return st;
});

// 4. The host's socket drops for a moment while a returning player rejoins with its saved room: it must not end up
//    hosting a second copy of the room
scenario('rejoin with a saved room while the host reconnects', () => {
  const { R, code, A, by } = setup(4, ['Ash', 'Birch', 'Cedar', 'Elm']);
  const E = by('Elm'), rec = R.saved.Elm;
  R.net.closeTab(E); R.net.run(1000);
  R.net.freeze(A, 1500); R.net.dropSignal(A, 0);              // the host is busy for a moment while its socket drops
  const E2 = R.add('Elm'); E2.N.rejoin(code, rec);
  const st = settle(R, code, 60000);
  if (st.ok) ok(R.players.filter(c => !c.dead).every(c => c.N.code === code), 'everyone in the room');
  return st;
});

// 5. The host loses the network for 40 s: a guest takes over once the server frees the code; the old host comes
//    back to a room that has a new host
scenario('host offline 40 s', () => {
  const { R, code, A } = setup(5, ['Ash', 'Birch', 'Cedar']);
  const before = statsOf(R, code);
  R.net.offline(A, 40000, 30000, 15000);
  R.net.run(42000);
  const st = settle(R, code, 60000);
  if (st.ok) { ok(DM.playerList(st.host.N.world).length === 3, 'the old host is back in'); const after = statsOf(R, code); ['Ash', 'Birch', 'Cedar'].forEach(n => sameOrMore(before, after, n)); }
  return st;
});

// 6. The host and its successor close at once: the next guest takes over
scenario('host and successor close together', () => {
  const { R, code, A, by } = setup(6, ['Ash', 'Birch', 'Cedar', 'Dogwood']);
  R.net.closeTab(A); R.net.closeTab(by('Birch'));
  return settle(R, code, 90000);
});

// 7. A guest drops off for 10 s: no take-over, it rejoins the same host
scenario('guest offline 10 s', () => {
  const { R, code, A, by } = setup(7, ['Ash', 'Birch', 'Cedar']);
  R.net.offline(by('Birch'), 10000, 10000, 8000);
  R.net.run(12000);
  const st = settle(R, code, 60000);
  if (st.ok) ok(st.host === A, 'the host stays the host');
  return st;
});

// 7b. The host crashes while a guest is offline for 60 s: the guest must not give up, it finds the new host when back
scenario('host crashes while a guest is offline 60 s', () => {
  const { R, code, A, by } = setup(9, ['Ash', 'Birch', 'Cedar']);
  R.net.offline(by('Birch'), 60000, 20000, 10000);
  R.net.run(1000);
  R.net.crash(A, 10000);
  R.net.run(62000);
  const st = settle(R, code, 60000);
  if (st.ok) ok(DM.playerList(st.host.N.world).some(p => p.name === 'Birch'), 'Birch is back in the room');
  ok(by('Birch').events.indexOf('migrateSlow') >= 0, 'Birch was told the reconnect takes long');
  return st;
});

// 8. Everyone leaves; one player reopens the game and rejoins from its saved room (hosts it), then another joins
scenario('empty room comes back from a saved record', () => {
  const { R, code } = setup(8, ['Ash', 'Birch', 'Cedar']);
  const before = statsOf(R, code);
  R.players.slice().forEach(c => R.net.closeTab(c));
  R.net.run(5000);
  const C2 = R.add('Cedar'); C2.N.rejoin(code, R.saved.Cedar);
  let st = settle(R, code, 30000);
  if (!st.ok) return st;
  const B2 = R.add('Birch'); B2.N.rejoin(code, R.saved.Birch);
  st = settle(R, code, 30000);
  if (st.ok) { const after = statsOf(R, code); ['Ash', 'Birch', 'Cedar'].forEach(n => sameOrMore(before, after, n)); }
  return st;
});

// 9. Chaos: random screen locks, socket drops, network losses, dead phones and reopened tabs; after a quiet minute: one world
for (let seed = 11; seed <= 30; seed++) scenario('chaos seed ' + seed, () => {
  const { R, code } = setup(seed, ['Ash', 'Birch', 'Cedar', 'Dogwood', 'Elm']);
  const rng = mulberry(seed * 7);
  for (let i = 0; i < 12; i++) {
    const live = R.players.filter(c => !c.dead), c = live[Math.floor(rng() * live.length)], r = rng();
    if (r < 0.08) {                                            // the phone dies; the player comes back later
      R.net.crash(c, 5000 + rng() * 40000);
      const name = c.name, rec = R.saved[name];
      R.net.after(3000 + rng() * 30000, () => { const n = R.add(name); n.N.rejoin(code, rec); });
    } else if (r < 0.3) R.net.freeze(c, 3000 + rng() * 30000, rng() < 0.5 ? 2000 : null);
    else if (r < 0.5) R.net.dropSignal(c, rng() * 5000);
    else if (r < 0.7) R.net.offline(c, 5000 + rng() * 35000, 30000, 15000);
    else {                                                     // the tab is closed and opened again a bit later
      R.net.closeTab(c);
      const name = c.name, rec = R.saved[name];
      R.net.after(2000 + rng() * 8000, () => { const n = R.add(name); n.N.rejoin(code, rec); });
    }
    R.net.run(5000 + rng() * 15000);
  }
  return settle(R, code, 90000);
});

console.log('     rooms: ' + results.map(([n, k, why]) => (k ? 'ok ' : 'SPLIT ') + n + (k ? '' : ' (' + why + ')')).join('\n            '));
