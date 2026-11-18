// River Farmlands (Phase 2 T11, one world): the real Vltava valley north of Prahold - the world's river (a channel with a
// falling level), the road network between the villages (core/roads.js), plateaus, fields, the Drake-only edge from Wildwood.
'use strict';
const { ok, core } = require('./harness.js');
const RG = core('region'), S = core('state'), T = core('terrain'), D = core('data'), F = core('flight'), PR = core('prey'), WK = core('walk'), NV = core('nav');
const { mulberry } = core('math');
const dt = 1 / 60;
const R = T.region('farm');
const feat = type => R.terrain.features.filter(f => f.type === type);
const loc = (X, Z) => T.toLocal('farm', X, Z);
const inFarm = (x, z, pad) => T.inZone('farm', x, z, pad || 0);

// 1. the region is registered with three plateaus and the world's river and roads cross it
ok(R && R.nameKey === 'c.region.farm' && R.palette === 'farm', 'farm region registered');
ok(feat('plateau').length === 3, 'farm features: 3 plateaus');
const rv = T.worldRiver();
const riverHere = rv.pts.map(p => loc(p[0], p[1])).filter(p => inFarm(p[0], p[1], 60));
ok(riverHere.length >= 5, 'the Vltava flows through the Farmlands (' + riverHere.length + ' points)');
const roadsHere = T.worldRoads().list.filter(r => r.pts.some(p => inFarm(...loc(p[0], p[1]), 0)));
ok(roadsHere.length >= 6, 'roads cross the Farmlands: ' + roadsHere.length);

// 2. river: water along the channel, the bed below the level, not landable, not walkable; the level falls downstream
{
  let wet = 0, n = 0;
  for (let i = 0; i + 1 < rv.pts.length; i++) {
    const a = rv.pts[i], b = rv.pts[i + 1];
    for (let k = 0; k <= 10; k++) {
      const [x, z] = loc(a[0] + (b[0] - a[0]) * k / 10, a[1] + (b[1] - a[1]) * k / 10);
      if (!inFarm(x, z, 40) || T.deckAt('farm', x, z, 4)) continue;
      n++;
      const q = T.riverAt('farm', x, z);
      if (T.liquidAt('farm', x, z) === 'water' && q && T.surfaceAt('farm', x, z) < q.level - rv.depth * 0.5) wet++;
    }
  }
  ok(n > 30 && wet === n, 'river centre line is deep water everywhere inside the region (' + wet + ' / ' + n + ')');
  ok(rv.level.every((v, i) => i === 0 || v <= rv.level[i - 1] + 1e-9), 'river level never rises downstream');
  const p = riverHere[Math.floor(riverHere.length / 2)];
  const pilot = F.newPilot([p[0], T.surfaceAt('farm', p[0], p[1]) + 4, p[1]], 0, 20);
  pilot.speed = 20;
  const land = WK.canLand(pilot, 'farm');
  ok(!land.ok && land.why === 'water', 'landing on the river is refused: water');
  ok(!T.dryAt('farm', p[0], p[1]), 'river is not dry ground for prey or trees');
}

// 3. the surface is continuous across the river, the roads and the plateau edges (no cliffs from the features)
{
  let worst = 0;
  const lines = [[[-200, -400], [-200, 400]], [[600, -200], [600, 400]], [[-300, -300], [300, -300]], [[380, 120], [380, 420]], [[640, -700], [640, -340]], [[-420, -600], [-420, -320]]];
  for (const [a, b] of lines) {
    let prev = null;
    for (let k = 0; k <= 400; k++) {
      const x = a[0] + (b[0] - a[0]) * k / 400, z = a[1] + (b[1] - a[1]) * k / 400, h = T.heightAt('farm', x, z);
      const step = Math.hypot(b[0] - a[0], b[1] - a[1]) / 400;
      if (prev != null) worst = Math.max(worst, Math.abs(h - prev) / step);
      prev = h;
    }
  }
  ok(worst < 1.6, 'no cliff across the river, roads or plateau edges (max rise per unit ' + worst.toFixed(2) + ')');
}

// 4. roads: levelled across, dry away from the river (they cross it on bridges only)
{
  let maxCross = 0, n = 0, dry = 0, wet = 0, tilted = 0;
  for (const r of roadsHere) for (let i = 0; i + 1 < r.pts.length; i++) {
    const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    for (let s = 2; s < L - 2; s += 12) {
      const [x, z] = loc(a[0] + ux * s, a[1] + uz * s);
      if (!inFarm(x, z, 30)) continue;
      if (T.liquidAt('farm', x, z) === 'water') wet++;
      if (T.lineDist('farm', 'river', x, z) < 70 || T.deckAt('farm', x, z, 6)) continue;
      n++;
      const l = T.heightAt('farm', x - uz * 2.5, z + ux * 2.5), rr = T.heightAt('farm', x + uz * 2.5, z - ux * 2.5);
      maxCross = Math.max(maxCross, Math.abs(l - rr));
      if (Math.abs(l - rr) > 1.2) tilted++;
      if (T.dryAt('farm', x, z)) dry++;
    }
  }
  ok(n > 60, 'road samples: ' + n);
  // level across, but where two roads fork on a hillside the ground between them follows both
  ok(tilted <= n * 0.03 && maxCross < 6, 'road is level across its width (' + tilted + ' of ' + n + ' tilted, max ' + maxCross.toFixed(2) + ' over 5 units)');
  ok(dry === n, 'road is dry away from the river (' + dry + ' / ' + n + ')');
  ok(wet === 0, 'no road runs through the water (' + wet + ')');
  const br = feat('bridge');
  ok(br.length === 2 && br.every(f => f.snapped && T.deckAt('farm', f.x, f.z) && T.dryAt('farm', f.x, f.z) && T.lineDist('farm', 'river', f.x, f.z) < 2), 'two bridges sit across the Vltava (Roztoky, Kralupy)');
}

// 5. plateaus: flat, dry, landable; every settlement of every region sits on one
for (const f of feat('plateau')) {
  let lo = Infinity, hi = -Infinity, okLand = true;
  for (let k = 0; k < 24; k++) {
    const rr = (k % 3) / 3 * f.r * 0.9, a = k * 0.9, x = f.x + Math.sin(a) * rr, z = f.z + Math.cos(a) * rr, h = T.surfaceAt('farm', x, z);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
    const p = F.newPilot([x, h + 4, z], 0, 20); p.speed = 20;
    if (!WK.canLand(p, 'farm').ok) okLand = false;
  }
  ok(hi - lo < 0.3, 'plateau at ' + f.x + ',' + f.z + ' is flat (' + (hi - lo).toFixed(2) + ')');
  ok(okLand, 'plateau at ' + f.x + ',' + f.z + ' is landable');
  ok(T.dryAt('farm', f.x, f.z), 'plateau above the water');
}
for (const id of Object.keys(D.regions)) {
  for (const st of D.regions[id].settlements || []) ok(T.plateauAt(id, st.x, st.z), id + ': settlement ' + st.type + ' sits on a plateau');
}
ok((D.regions.wild.settlements || []).length === 2, 'Wildwood has the hamlet and the small outpost sites');

// 6. fields: deterministic, enough of them, on dry flat ground, off roads, rivers and plateaus, inside their region
for (const id of T.zones()) {
  const fs = T.fields(id), Q = T.region(id);
  ok(fs.length >= Math.min(12, Q.flora.fields) && fs.length <= Q.flora.fields, id + ' fields placed: ' + fs.length + ' of ' + Q.flora.fields);
  for (const f of fs) {
    ok(T.dryAt(id, f.x, f.z) && !T.plateauAt(id, f.x, f.z) && T.lineDist(id, 'road', f.x, f.z) > 6 && !T.cityAt(id, f.x, f.z), id + ': field on dry open ground');
    ok(T.inZone(id, f.x, f.z, 20), id + ': field inside its region (not across an edge)');
    ok(T.fieldAt(id, f.x, f.z).f === f, 'fieldAt finds the field at its centre');
    ok(f.crop >= 0 && f.crop < 5, 'crop kind (4 = corn)');
  }
}
{
  const fs = T.fields('farm'), f = fs[0], s = Math.sin(f.yaw), c = Math.cos(f.yaw), u = f.w / 2 - 1, v = f.l / 2 - 1;
  ok(fs.length >= 40, 'the Farmlands are the most farmed: ' + fs.length);
  ok(T.fieldAt('farm', f.x + u * c + v * s, f.z - u * s + v * c), 'fieldAt: inside a corner');
  ok(!T.fieldAt('farm', f.x + (f.w / 2 + 3) * c, f.z - (f.w / 2 + 3) * s), 'fieldAt: just outside the long side');
}

// 7. every village is on the road network, and the network is one piece
{
  const N = core('roads').network(), deg = {};
  for (const r of N.roads) { deg[r.a] = (deg[r.a] || 0) + 1; deg[r.b] = (deg[r.b] || 0) + 1; }
  for (const id of T.zones()) for (const v of D.regions[id].city.villages) ok(deg[v.id] >= 1, 'village ' + v.id + ' has a road to a neighbour');
  const par = {}, find = k => (par[k] === undefined || par[k] === k ? (par[k] = k) : (par[k] = find(par[k])));
  for (const r of N.roads) par[find(r.a)] = find(r.b);
  ok(new Set(N.nodes.map(n => find(n.id))).size === 1, 'the road network connects every place');
  ok(N.roads.every(r => r.pts.length >= 2 && r.pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))), 'roads are finite polylines');
}

// 8. prey in the Farmlands spawn on dry ground
{
  const field = PR.spawnRegion('farm', mulberry(5), [0, 30, -900]);
  ok(field.list.length > 0, 'Farmlands prey spawned');
  ok(field.list.every(q => T.dryAt('farm', q.pos[0], q.pos[2]) && !T.liquidAt('farm', q.pos[0], q.pos[2])), 'every Farmlands animal stands on dry ground');
}

// 9. the Wildwood edge to the Farmlands: a hatchling is told it is too small and turned back, a Drake flies on over it
function flyOut(stage, secs) {
  const cs = S.create({ regionId: 'wild', rng: mulberry(9) });
  cs.dragon.stage = stage;
  const z = -(T.region('wild').radius - 200);
  cs.dragon.pilot = F.newPilot([0, T.surfaceAt('wild', 0, z) + 60, z], Math.PI, 30);
  const ev = [];
  let small = null;
  for (let t = 0; t < secs && cs.region === 'wild'; t += dt) { ev.push(...S.step(cs, {}, dt)); small = small || cs.exitSmall; }
  return { cs, ev, small };
}
{
  const { cs, ev, small } = flyOut(0, 25);
  ok(small && small.to === 'farm', 'hatchling at the Farmlands edge: too small');
  ok(ev.filter(e => e.e === 'region:tooSmall' && e.to === 'farm').length >= 1, 'region:tooSmall raised');
  ok(cs.region === 'wild' && T.inZone('wild', cs.dragon.pilot.pos[0], cs.dragon.pilot.pos[2]), 'the hatchling stays in Wildwood');
  cs.dragon.pilot.pos[2] = -900; cs.dragon.pilot.yaw = Math.PI;
  const m = NV.markers(cs).find(q => q.key === 'exit:farm');
  ok(m && m.dim, 'compass marker to the Farmlands is dimmed for a hatchling');
}
{
  const { cs, ev } = flyOut(1, 20);
  ok(!ev.some(e => e.e === 'region:tooSmall'), 'no too-small event for a Drake');
  ok(cs.region === 'farm' && ev.some(e => e.e === 'region:enter' && e.region === 'farm' && e.seamless), 'a Drake flies on into the Farmlands');
  const p = cs.dragon.pilot;
  ok(p.pos[2] > R.radius - 60 && Math.abs(p.pos[0]) < 5, 'it is at the Farmlands north edge (the Wildwood side), where it crossed');
  // 5 round trips: one prey field at a time, no growth of state
  const sizes = [];
  for (let k = 0; k < 5; k++) {
    RG.enter(cs, 'wild', 'farm');
    ok(cs.region === 'wild' && cs.dragon.pilot.pos[2] < -800, 'back in Wildwood at its south edge (the Farmlands side)');
    RG.enter(cs, 'farm', 'wild');
    sizes.push(cs.field.list.length);
  }
  ok(sizes.every(n => n > 0 && n <= 30), 'round trips: one fresh, bounded Farmlands prey field each time (' + sizes.join(',') + ')');
}

// 10. the farm region height function stays fast enough for a sub-1.5 s region build
{
  const t0 = Date.now();
  for (let x = -1500; x < 1500; x += 7.5) for (let z = -1500; z < 1500; z += 15) T.heightAt('farm', x, z);
  const ms = Date.now() - t0;
  ok(ms < 1500, 'heightAt over half the mesh grid: ' + ms + ' ms');
}
