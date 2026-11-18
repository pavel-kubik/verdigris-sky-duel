// Rule: every bridge leads somewhere on both banks. For each end of each bridge in every zone: a road or a street starts
// at the deck end, and walking from the deck along paths (roads, streets, squares, decks) without going through a
// building gets far from the bridge. Where an end lies in or by Prahold or a village (city.js bridge approaches), a
// street joins it to the town's own streets. Roads (and so the tithe wagon) never run through a building.
'use strict';
const { ok, core } = require('./harness.js');
const T = core('terrain'), CI = core('city'), SE = core('settlement');

const PAD = 0.42;                                  // the hero's radius (hero/game.js)
for (const id of T.zones()) {
  const R = T.region(id), town = SE.build(id), city = CI.build(id);
  const solid = (x, z) => CI.solidAt(id, x, z, PAD) != null || SE.solidAt(town, x, z, PAD) != null;
  const road = (x, z) => T.lineDist(id, 'road', x, z) < 3;
  const path = (x, z) => {
    const dk = T.deckAt(id, x, z);
    if (dk) return true;
    return (road(x, z) || CI.pavedAt(id, x, z) > 0) && !T.liquidAt(id, x, z) && !solid(x, z);
  };
  for (const f of R.terrain.features) {
    if (f.type !== 'bridge') continue;
    const s = Math.sin(f.yaw), c = Math.cos(f.yaw), tag = id + ' bridge at ' + Math.round(f.x) + ',' + Math.round(f.z);
    for (const sg of [-1, 1]) {
      const ex = f.x + sg * s * f.len / 2, ez = f.z + sg * c * f.len / 2, side = tag + (sg < 0 ? ' end A' : ' end B');
      // 1. a road or a street at the deck end
      let at = false;
      for (let e = 0; e <= 4 && !at; e += 1) { const x = ex + sg * s * e, z = ez + sg * c * e; at = road(x, z) || CI.pavedAt(id, x, z) > 0; }
      ok(at, side + ': a road or a street starts at the deck end');
      // 2. walk out along the paths (1-unit cells, 4-neighbours) from just past the deck end
      const seen = new Set(), q = [[Math.round(ex + sg * s * 2), Math.round(ez + sg * c * 2)]];
      let far = 0, street = 0;
      while (q.length && seen.size < 40000) {
        const [x, z] = q.shift(), k = x + ',' + z;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!path(x, z)) continue;
        const d = Math.hypot(x - ex, z - ez), off = T.deckAt(id, x, z) == null;
        if (off) far = Math.max(far, d);
        if (off && CI.pavedAt(id, x, z) > 0) street = Math.max(street, d);
        if (d > 160) break;
        q.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
      }
      ok(far >= 120, side + ': the paths lead on from the bridge (' + Math.round(far) + ' units walked)');
      const part = city && city.districts.concat(city.villages).find(d => Math.hypot(ex - d.x, ez - d.z) < d.r + 60);
      if (part) {
        ok(city.streets.some(st => st.bridge && Math.hypot(st.pts[0][0] - ex, st.pts[0][1] - ez) < 4), side + ': a street from the bridge into ' + part.id);
        ok(street >= 40, side + ': the bridge joins the streets of ' + part.id + ' (' + Math.round(street) + ' units in)');
      }
    }
  }
  // roads never run through a building (the settlements' own ground at a road's end aside: roads end at gates)
  for (const fr of R.terrain.features) {
    if (fr.type !== 'road') continue;
    let hits = 0;
    for (let i = 0; i + 1 < fr.points.length; i++) {
      const [ax, az] = fr.points[i], [bx, bz] = fr.points[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t < L; t += 2) { const x = ax + (bx - ax) * t / L, z = az + (bz - az) * t / L; if (CI.solidAt(id, x, z, PAD) != null) hits++; }
    }
    ok(hits === 0, id + ' road from ' + fr.points[0].map(Math.round) + ': no town building on it (' + hits + ' samples)');
  }
}
// Prahold's Karlsbridge in particular: streets on both banks
{
  const city = CI.build('bend'), app = city.streets.filter(st => st.bridge);
  ok(app.length >= 2, 'Karlsbridge has streets on both banks: ' + app.length);
}
