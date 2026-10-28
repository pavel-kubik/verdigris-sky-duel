// Terrain: deterministic, collides with the drawn surface, volcano and lair shaped as specified.
'use strict';
const { ok, near, core } = require('./harness.js');
const T = core('terrain'), D = core('data'), { mulberry } = core('math');

const rng = mulberry(11);
const ids = Object.keys(D.regions);

// Deterministic and finite everywhere a dragon can be, including past the rim
for (const id of ids) {
  for (let i = 0; i < 4000; i++) {
    const x = (rng() * 2 - 1) * 1500, z = (rng() * 2 - 1) * 1500;
    const h = T.heightAt(id, x, z), s = T.surfaceAt(id, x, z);
    ok(Number.isFinite(h) && Number.isFinite(s), 'finite height: ' + id);
    ok(h === T.heightAt(id, x, z), 'deterministic: ' + id);
  }
}

// surfaceAt is the drawn mesh: exact at grid corners, continuous across cell edges and the diagonal
for (const id of ids) {
  for (let i = 0; i < 2000; i++) {
    const gx = Math.round((rng() * 2 - 1) * 140) * T.GRID, gz = Math.round((rng() * 2 - 1) * 140) * T.GRID;
    near(T.surfaceAt(id, gx, gz), T.heightAt(id, gx, gz), 1e-9, 'surface exact at grid corner');
    const x = gx + rng() * T.GRID, z = gz + rng() * T.GRID, e = 1e-6;
    // stepping a hair in any direction moves the surface by at most a hair times the steepest slope seen
    ok(Math.abs(T.surfaceAt(id, x + e, z) - T.surfaceAt(id, x, z)) < 1e-3 && Math.abs(T.surfaceAt(id, x, z + e) - T.surfaceAt(id, x, z)) < 1e-3, 'surface continuous');
  }
  // crossing a cell boundary exactly: both sides agree
  const xb = 10 * T.GRID;
  for (let k = 0; k < 200; k++) {
    const z = (rng() * 2 - 1) * 900;
    near(T.surfaceAt(id, xb - 1e-9, z), T.surfaceAt(id, xb, z), 1e-5, 'no seam at a cell edge: ' + id);
  }
  // the mesh never drifts far from the true height (it is only a sampling of it)
  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const x = (rng() * 2 - 1) * 1000, z = (rng() * 2 - 1) * 1000;
    worst = Math.max(worst, Math.abs(T.surfaceAt(id, x, z) - T.heightAt(id, x, z)));
  }
  ok(worst < 4, 'mesh within 4 units of the height function: ' + id + ' worst ' + worst.toFixed(2));
}

// clampToRegion keeps a position inside the region, above the surface and under the ceiling
for (const id of ids) {
  const R = D.regions[id];
  for (let i = 0; i < 2000; i++) {
    const p = [(rng() * 2 - 1) * 2000, (rng() * 2 - 1) * 600, (rng() * 2 - 1) * 2000];
    T.clampToRegion(id, p);
    ok(Math.hypot(p[0], p[2]) <= R.radius + 1e-6, 'inside radius');
    ok(p[1] >= Math.min(R.ceiling, T.surfaceAt(id, p[0], p[2]) + D.flight.minAlt) - 1e-6 && p[1] <= R.ceiling + 1e-9, 'altitude bounds');
  }
}

// Ash Wastes: a volcano with a crater and lava below its rim, the lair on its flank, a dry plain
{
  const f = D.regions.ash.terrain.features.find(ff => ff.type === 'cone');
  const rimH = T.heightAt('ash', f.x + f.crater.r, f.z), centre = T.heightAt('ash', f.x, f.z);
  ok(rimH > 100, 'volcano rim stands above the plain: ' + rimH.toFixed(1));
  near(rimH - centre, f.crater.depth, 2, 'crater depth');
  ok(T.lavaLevel('ash') > centre && T.lavaLevel('ash') < rimH - 10, 'lava sits inside the crater');
  let higher = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.1) if (T.heightAt('ash', Math.cos(a) * 200, Math.sin(a) * 200) > rimH) higher++;
  ok(higher === 0, 'nothing near the volcano is taller than its rim');
  const L = D.regions.ash.lair, lp = T.lairPos('ash');
  near(lp[1] - T.surfaceAt('ash', L.x, L.z), L.above, 1e-9, 'lair mouth sits on the slope');
  ok(T.slopeAt('ash', L.x, L.z) > 0.2, 'lair is on the volcano flank, not the plain');
  let wet = 0, n = 0;
  for (let x = -1000; x <= 1000; x += 25) for (let z = -1000; z <= 1000; z += 25) { if (Math.hypot(x, z) > 1000) continue; n++; if (T.heightAt('ash', x, z) < 0.6) wet++; }
  ok(wet / n < 0.02, 'ash plain is dry: ' + (100 * wet / n).toFixed(1) + '% below water level');
  ok(T.lavaLevel('wild') === null && T.lairPos('wild') === null, 'Wildwood has no volcano and no lair');
}

// Wildwood: some lakes, mostly land
{
  let wet = 0, n = 0;
  for (let x = -1000; x <= 1000; x += 25) for (let z = -1000; z <= 1000; z += 25) { if (Math.hypot(x, z) > 1000) continue; n++; if (T.heightAt('wild', x, z) < 0.6) wet++; }
  ok(wet / n > 0.03 && wet / n < 0.25, 'Wildwood has lakes but is mostly land: ' + (100 * wet / n).toFixed(1) + '%');
}

// The rim rises outside the region radius (natural boundary)
for (const id of ids) {
  const R = D.regions[id];
  const inside = T.heightAt(id, 0, R.radius - 60), outside = T.heightAt(id, 0, R.radius + 300);
  ok(outside > inside + 100, 'rim rises beyond the edge: ' + id);
}

let threw = false;
try { T.heightAt('nowhere', 0, 0); } catch (_) { threw = true; }
ok(threw, 'unknown region throws');
