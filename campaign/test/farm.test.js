// River Farmlands (Phase 2 T11): river, road and plateau terrain features, fields, water, the Drake-only exit from Wildwood.
'use strict';
const { ok, core } = require('./harness.js');
const RG = core('region'), S = core('state'), T = core('terrain'), D = core('data'), F = core('flight'), PR = core('prey'), WK = core('walk'), NV = core('nav');
const { mulberry } = core('math');
const dt = 1 / 60;
const R = T.region('farm');
const feat = type => R.terrain.features.filter(f => f.type === type);
const at = (id, a, inset, up) => {
  const r = T.region(id).radius - inset, x = Math.sin(a) * r, z = Math.cos(a) * r;
  return [x, T.surfaceAt(id, x, z) + (up || 40), z];
};

// 1. the region is registered with a river, a road and three plateaus
ok(R && R.nameKey === 'c.region.farm' && R.palette === 'farm', 'farm region registered');
ok(feat('river').length === 1 && feat('road').length === 1 && feat('plateau').length === 3, 'farm features: river, road, 3 plateaus');

// 2. river: water along the whole channel inside the region, a channel below the banks, not landable, not walkable
{
  const river = feat('river')[0], lv = T.riverLevel('farm', river);
  let wet = 0, n = 0;
  for (let i = 0; i + 1 < river.points.length; i++) {
    const a = river.points[i], b = river.points[i + 1];
    for (let k = 0; k <= 20; k++) {
      const x = a[0] + (b[0] - a[0]) * k / 20, z = a[1] + (b[1] - a[1]) * k / 20;
      if (Math.hypot(x, z) > R.radius - 120) continue;
      n++;
      if (T.liquidAt('farm', x, z) === 'water' && T.surfaceAt('farm', x, z) < lv - river.depth * 0.5) wet++;
    }
  }
  ok(n > 30 && wet === n, 'river centre line is deep water everywhere inside the region (' + wet + ' / ' + n + ')');
  const p = river.points[2];
  const pilot = F.newPilot([p[0], T.surfaceAt('farm', p[0], p[1]) + 4, p[1]], 0, 20);
  pilot.speed = 20;
  const land = WK.canLand(pilot, 'farm');
  ok(!land.ok && land.why === 'water', 'landing on the river is refused: water');
  ok(!T.dryAt('farm', p[0], p[1]), 'river is not dry ground for prey or trees');
  // the bank beyond the channel is dry, level valley floor
  const dz = river.width / 2 * 1.4 + 12, bx = p[0], bz = p[1] + dz;
  ok(T.liquidAt('farm', bx, bz) === null && T.dryAt('farm', bx, bz), 'river bank is dry');
  ok(Math.abs(T.surfaceAt('farm', bx, bz) - (lv + 2)) < 2.5, 'bank sits near the valley floor (level + 2)');
}

// 3. the surface is continuous across the river, the road and the plateau edges (no cliffs from the features)
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
  ok(worst < 1.2, 'no cliff across the river, road or plateau edges (max rise per unit ' + worst.toFixed(2) + ')');
}

// 4. road: levelled across, walkable, and dry everywhere except at the ford
{
  const road = feat('road')[0];
  let maxCross = 0, n = 0, dry = 0;
  for (let i = 0; i + 1 < road.points.length; i++) {
    const a = road.points[i], b = road.points[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    for (let s = 20; s < L - 20; s += 25) {
      const x = a[0] + ux * s, z = a[1] + uz * s;
      if (Math.hypot(x, z) > R.radius - 120 || T.riverAt('farm', x, z) || T.lineDist('farm', 'river', x, z) < 70) continue;
      n++;
      const l = T.heightAt('farm', x - uz * 3, z + ux * 3), r = T.heightAt('farm', x + uz * 3, z - ux * 3);
      maxCross = Math.max(maxCross, Math.abs(l - r));
      if (T.dryAt('farm', x, z)) dry++;
    }
  }
  ok(n > 30, 'road samples: ' + n);
  ok(maxCross < 0.8, 'road is level across its width (max ' + maxCross.toFixed(2) + ' over 6 units)');
  ok(dry === n, 'road is dry away from the river (' + dry + ' / ' + n + ')');
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
  ok(lo > R.waterLevel + 2.5, 'plateau above the water');
}
for (const id of Object.keys(D.regions)) {
  for (const st of D.regions[id].settlements || []) ok(T.plateauAt(id, st.x, st.z), id + ': settlement ' + st.type + ' sits on a plateau');
}
ok((D.regions.wild.settlements || []).length === 2, 'Wildwood has the hamlet and the small outpost sites');

// 6. fields: deterministic, enough of them, on dry flat ground, off roads, rivers and plateaus, not overlapping
{
  const fs = T.fields('farm');
  ok(fs.length >= 16 && fs.length <= R.flora.fields, 'farm fields placed: ' + fs.length + ' of ' + R.flora.fields);
  ok(T.fields('wild').length === 0 && T.fields('ash').length === 0, 'no fields outside the Farmlands');
  for (const f of fs) {
    ok(T.dryAt('farm', f.x, f.z) && !T.plateauAt('farm', f.x, f.z) && T.lineDist('farm', 'road', f.x, f.z) > 6, 'field on dry open ground');
    ok(T.fieldAt('farm', f.x, f.z).f === f, 'fieldAt finds the field at its centre');
    ok(f.crop >= 0 && f.crop < 4, 'crop kind');
  }
  // corners belong to the field, a point well outside does not
  const f = fs[0], s = Math.sin(f.yaw), c = Math.cos(f.yaw), u = f.w / 2 - 1, v = f.l / 2 - 1;
  ok(T.fieldAt('farm', f.x + u * c + v * s, f.z - u * s + v * c), 'fieldAt: inside a corner');
  ok(!T.fieldAt('farm', f.x + (f.w / 2 + 3) * c, f.z - (f.w / 2 + 3) * s), 'fieldAt: just outside the long side');
}

// 7. Wildwood lakes (waterLevel) are water now too: not landable, not walkable
{
  let lake = null;
  for (let x = -900; x < 900 && !lake; x += 15) for (let z = -900; z < 900 && !lake; z += 15) if (T.surfaceAt('wild', x, z) < -1) lake = [x, z];
  ok(lake, 'Wildwood has a lake hollow');
  ok(T.liquidAt('wild', lake[0], lake[1]) === 'water' && !T.dryAt('wild', lake[0], lake[1]), 'Wildwood lake is water');
}

// 8. prey in the Farmlands spawn on dry ground
{
  const field = PR.spawnRegion('farm', mulberry(5), [0, 30, -900]);
  ok(field.list.length > 0, 'Farmlands prey spawned');
  ok(field.list.every(q => T.dryAt('farm', q.pos[0], q.pos[2]) && !T.liquidAt('farm', q.pos[0], q.pos[2])), 'every Farmlands animal stands on dry ground');
}

// 9. the Wildwood exit to the Farmlands: a hatchling is told it is too small, a Drake travels
function flyOut(stage) {
  const cs = S.create({ regionId: 'wild', rng: mulberry(9) });
  cs.dragon.stage = stage;
  cs.dragon.pilot = F.newPilot(at('wild', 0.05, 200, 60), 0.05, 30);
  const ev = [];
  let t = 0;
  while (!cs.exit && !cs.exitSmall && t < 20) { ev.push(...S.step(cs, {}, dt)); t += dt; }
  return { cs, ev };
}
{
  const { cs, ev } = flyOut(0);
  ok(cs.exitSmall && cs.exitSmall.to === 'farm' && !cs.exit, 'hatchling at the Farmlands exit: too small, no travel offer');
  ok(ev.filter(e => e.e === 'region:tooSmall' && e.to === 'farm').length === 1, 'region:tooSmall raised once');
  for (let k = 0; k < 30; k++) S.step(cs, { confirm: true }, dt);
  ok(cs.region === 'wild', 'confirm does not take a hatchling to the Farmlands');
  const m = NV.markers(cs).find(q => q.key === 'exit:farm');
  ok(m && m.dim, 'compass exit marker to the Farmlands is dimmed for a hatchling');
}
{
  const { cs, ev } = flyOut(1);
  ok(cs.exit && cs.exit.to === 'farm' && !cs.exitSmall, 'Drake at the Farmlands exit: travel offered');
  ok(!ev.some(e => e.e === 'region:tooSmall'), 'no too-small event for a Drake');
  const out = S.step(cs, { confirm: true }, dt);
  ok(cs.region === 'farm' && out.some(e => e.e === 'region:enter' && e.region === 'farm'), 'Drake travels to the Farmlands');
  const p = cs.dragon.pilot;
  ok(p.pos[2] < -500 && Math.abs(p.pos[0]) < 1, 'arrives on the Farmlands south edge (the Wildwood side)');
  ok(T.dryAt('farm', p.pos[0], p.pos[2]) || p.pos[1] > T.surfaceAt('farm', p.pos[0], p.pos[2]) + 20, 'arrives above the ground');
  // 5 round trips: one prey field at a time, no growth of state
  let sizes = [];
  for (let k = 0; k < 5; k++) {
    RG.enter(cs, 'wild', 'farm');
    ok(cs.region === 'wild' && Math.hypot(cs.dragon.pilot.pos[0], cs.dragon.pilot.pos[2] - 880) < 5, 'back in Wildwood at its north edge');
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
