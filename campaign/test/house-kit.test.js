// House kit (campaign/render/house-kit.js): procedural Prague-like buildings for whole cities. Runs the builder
// against a tiny THREE stub via vm (there is no three in Node): every style and kind builds sound geometry,
// deterministic per seed, varied across seeds, within the triangle budgets; chunking, LOD switching with
// hysteresis, night and dispose. Plus static checks of the preview page.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ok } = require('./harness.js');
const eq = (a, b, msg) => ok(a === b, msg + ': ' + a + ' vs ' + b);

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- the preview page loads the kit like the castle preview ---------- */
const html = read('campaign/preview/houses.html');
const at = s => html.indexOf(s);
ok(at('three.js/r128/three.min.js') > 0, 'houses.html loads three r128 from cdnjs');
const order = ['../../shared/textures.js', '../core/umd.js', '../core/data.js', '../render/house-kit.js', 'houses.js'];
for (let i = 1; i < order.length; i++) ok(at("'" + order[i - 1] + "'") > 0 && at("'" + order[i - 1] + "'") < at("'" + order[i] + "'"), 'houses.html loads ' + order[i - 1] + ' before ' + order[i]);

/* ---------- minimal THREE stub ---------- */
function makeThree() {
  const stats = { geo: 0, geoDisposed: 0, mat: 0, matDisposed: 0 };
  class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
  class Obj {
    constructor() { this.children = []; this.parent = null; this.position = new V3(); this.userData = {}; this.visible = true; }
    add(c) { c.parent = this; this.children.push(c); return this; }
    remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return this; }
    updateMatrix() {}
  }
  class Mesh extends Obj { constructor(g, m) { super(); this.isMesh = true; this.geometry = g; this.material = m; } }
  class Geo {
    constructor() { this.attributes = {}; this.index = null; this.userData = {}; stats.geo++; }
    setAttribute(n, a) { this.attributes[n] = a; return this; }
    setIndex(i) { this.index = i; return this; }
    computeBoundingSphere() { this.boundingSphere = {}; }
    dispose() { stats.geoDisposed++; }
  }
  class Attr { constructor(array, itemSize, normalized) { this.array = array; this.itemSize = itemSize; this.normalized = !!normalized; this.count = array.length / itemSize; } }
  class Mat { constructor(o) { Object.assign(this, o); this.userData = {}; stats.mat++; } dispose() { stats.matDisposed++; } }
  return { THREE: { Group: Obj, Object3D: Obj, Mesh, BufferGeometry: Geo, BufferAttribute: Attr, MeshLambertMaterial: Mat, MeshStandardMaterial: Mat, Vector3: V3 }, stats };
}

const stub = makeThree();
const sandbox = { THREE: stub.THREE, Math, Object, Array, Map, Set, Float32Array, Int8Array, Uint8Array, Uint16Array, Uint32Array, Number, JSON };
sandbox.globalThis = sandbox;
vm.runInNewContext(read('campaign/render/house-kit.js'), sandbox, { filename: 'campaign/render/house-kit.js' });
const HK = sandbox.VRender && sandbox.VRender.houseKit;
ok(HK && typeof HK.build === 'function' && typeof HK.model === 'function', 'house-kit exposes VRender.houseKit.build and model');

const STYLES = ['gothic', 'renaissance', 'baroque', 'classic', 'timber', 'cottage', 'log', 'farm', 'barn'];
const KINDS = ['house', 'church', 'cathedral', 'domechurch', 'townhall', 'tower', 'gatetower', 'palace', 'chapel', 'cottage', 'barn', 'shed'];
for (const s of STYLES) ok(HK.styles.includes(s), 'style listed: ' + s);
for (const k of KINDS) ok(HK.kinds.includes(k), 'kind listed: ' + k);

const SIZE = { church: [15, 32], cathedral: [32, 70], domechurch: [26, 40], townhall: [22, 16], tower: [10, 10], gatetower: [11, 13], palace: [44, 15], chapel: [8, 13], cottage: [8, 11], barn: [12, 8], shed: [5, 4] };
const lotOf = (o) => Object.assign({ x: 0, z: 0, y: 0, rise: 0, yaw: 0, w: 8, d: 13, floors: 3, style: 'baroque', kind: 'house', seed: 1 }, o);
const tris = g => g.index.array.length / 3;
function sound(g, name) {
  const n = g.attributes.position.count;
  ok(n > 0, name + ': has vertices');
  for (const a of ['normal', 'color', 'uv', 'hkc', 'vtk']) ok(g.attributes[a] && g.attributes[a].count === n, name + ': attribute ' + a + ' matches the vertex count');
  ok(g.attributes.position.array.every(Number.isFinite) && g.attributes.uv.array.every(Number.isFinite), name + ': finite positions and uvs');
  const idx = g.index.array;
  ok(idx.length % 3 === 0 && idx.every(i => i < n), name + ': indices in range');
  ok(g.attributes.hkc.array.every(v => v >= 0 && v < 8), name + ': atlas cells inside the 8 x 8 atlas');
  return tris(g);
}
const bounds = g => {
  const p = g.attributes.position.array, b = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9];
  for (let i = 0; i < p.length; i += 3) { b[0] = Math.min(b[0], p[i]); b[1] = Math.max(b[1], p[i]); b[2] = Math.min(b[2], p[i + 1]); b[3] = Math.max(b[3], p[i + 1]); b[4] = Math.min(b[4], p[i + 2]); b[5] = Math.max(b[5], p[i + 2]); }
  return b;
};

/* ---------- every style (as a house) and every kind builds, at every tier and as the far LOD ---------- */
const all = [];
for (const style of STYLES) all.push(lotOf({ style, w: style === 'farm' ? 20 : 8, d: style === 'farm' ? 22 : 12, floors: style === 'cottage' || style === 'log' || style === 'farm' || style === 'barn' ? 1 : 4 }));
for (const kind of KINDS.slice(1)) all.push(lotOf({ kind, style: kind === 'chapel' ? 'baroque' : 'gothic', w: SIZE[kind][0], d: SIZE[kind][1] }));
for (const lot of all) for (const tier of ['high', 'mid', 'low', 'far']) {
  const gs = HK.model(lot, tier), name = lot.kind + '/' + lot.style + '/' + tier;
  ok(Array.isArray(gs) && gs.length >= 1, name + ': model returns geometries');
  const t = gs.reduce((n, g) => n + sound(g, name), 0);
  ok(t > 0, name + ': has triangles');
}

/* ---------- determinism and variety ---------- */
const sig = g => { const p = g.attributes.position.array, c = g.attributes.color.array; let h = p.length; for (let i = 0; i < p.length; i += 7) h = (h * 31 + Math.round(p[i] * 100)) | 0; for (let i = 0; i < c.length; i += 5) h = (h * 31 + c[i]) | 0; return h; };
for (const style of STYLES.concat(KINDS.slice(1).map(k => '@' + k))) {
  const base = style[0] === '@' ? lotOf({ kind: style.slice(1), w: SIZE[style.slice(1)][0], d: SIZE[style.slice(1)][1] }) : lotOf({ style, w: style === 'farm' ? 20 : 8, d: style === 'farm' ? 22 : 12 });
  const a = HK.model(Object.assign({}, base, { seed: 4242 }), 'high')[0], b = HK.model(Object.assign({}, base, { seed: 4242 }), 'high')[0];
  eq(sig(a), sig(b), style + ': same seed, same geometry');
  const sigs = new Set();
  for (let s = 1; s <= 12; s++) sigs.add(sig(HK.model(Object.assign({}, base, { seed: s * 7919 }), 'high')[0]));
  ok(sigs.size >= 10, style + ': different seeds give different buildings (' + sigs.size + ' of 12 distinct)');
}
// neighbours in a row differ in colour and height
{
  let sameCol = 0, sameH = 0;
  for (let s = 1; s <= 40; s++) {
    const a = HK.model(lotOf({ style: 'baroque', seed: s }), 'high')[0], b = HK.model(lotOf({ style: 'baroque', seed: s + 1 }), 'high')[0];
    const ca = a.attributes.color.array, cb = b.attributes.color.array;
    if (ca[0] === cb[0] && ca[1] === cb[1] && ca[2] === cb[2]) sameCol++;
    if (Math.abs(bounds(a)[3] - bounds(b)[3]) < 0.05) sameH++;
  }
  ok(sameCol <= 2, 'neighbouring baroque houses get different wall colours (' + sameCol + ' of 40 alike)');
  ok(sameH <= 4, 'neighbouring baroque houses get different heights (' + sameH + ' of 40 alike)');
}

/* ---------- triangle budgets ---------- */
{
  const R = HK.rng(77);
  let maxHigh = 0, sumHigh = 0, sumMid = 0, sumLow = 0, maxFar = 0, n = 0;
  for (let i = 0; i < 240; i++) {
    const style = ['gothic', 'renaissance', 'baroque', 'classic', 'timber', 'cottage', 'log'][i % 7];
    const lot = lotOf({ style, w: 5 + R() * 6, d: 9 + R() * 8, floors: 1 + Math.floor(R() * 6), rise: R() * 2, seed: (R() * 4294967296) >>> 0, corner: R() < 0.2, arcade: R() < 0.2 });
    const h = tris(HK.model(lot, 'high')[0]), m = tris(HK.model(lot, 'mid')[0]), l = tris(HK.model(lot, 'low')[0]), f = tris(HK.model(lot, 'far')[0]);
    maxHigh = Math.max(maxHigh, h); maxFar = Math.max(maxFar, f); sumHigh += h; sumMid += m; sumLow += l; n++;
    ok(m <= h && l <= m, style + ': low <= mid <= high triangles (' + l + ', ' + m + ', ' + h + ')');
  }
  ok(maxHigh <= 500, 'an ordinary house stays within 500 triangles at full detail (max ' + maxHigh + ')');
  ok(sumHigh / n >= 90, 'ordinary houses carry real detail (mean ' + Math.round(sumHigh / n) + ' triangles)');
  ok(sumLow < sumHigh * 0.75, 'the low tier is clearly cheaper (' + Math.round(sumLow / n) + ' vs ' + Math.round(sumHigh / n) + ')');
  ok(maxFar >= 8 && maxFar <= 30, 'the far LOD of a house is 8..30 triangles (max ' + maxFar + ')');
  for (const kind of KINDS.slice(1)) {
    const t = tris(HK.model(lotOf({ kind, w: SIZE[kind][0], d: SIZE[kind][1] }), 'high')[0]);
    ok(t <= 3000, kind + ': landmark within 3000 triangles (' + t + ')');
  }
}

/* ---------- plinth on slopes: nothing floats or is buried ---------- */
for (const style of ['gothic', 'baroque', 'cottage', 'barn']) {
  const g = HK.model(lotOf({ style, rise: 2.5, floors: 2 }), 'high')[0], b = bounds(g);
  ok(b[2] <= -0.49 && b[2] >= -0.6, style + ': the plinth reaches down to y - 0.5 (' + b[2].toFixed(2) + ')');
  ok(b[3] > 2.5 + 3, style + ': the building stands above the highest ground');
  ok(b[0] >= -4 - 1.6 && b[1] <= 4 + 1.6, style + ': stays near its footprint across');
}
// yaw: the front faces (sin yaw, cos yaw); a chunk keeps buildings at their place
{
  const lots = [lotOf({ x: 10, z: 20, yaw: Math.PI / 2, seed: 3 })];
  const kit = HK.build(lots, { tier: 'high', chunk: 160 });
  kit.buildAll();
  const c = kit.chunks[0], g = c.near.geometry, p = g.attributes.position.array;
  let mx = -1e9;
  for (let i = 0; i < p.length; i += 3) mx = Math.max(mx, p[i] + c.ox);
  ok(mx > 10 + 6 && mx < 10 + 8.5, 'yaw = pi/2 puts the 13-unit-deep house front toward +X (max x ' + mx.toFixed(2) + ')');
  kit.dispose();
}

/* ---------- chunks, LOD with hysteresis, night, info, dispose ---------- */
{
  const lots = [];
  for (let i = 0; i < 30; i++) lots.push(lotOf({ x: 20 + (i % 10) * 10, z: 20 + Math.floor(i / 10) * 20, seed: i + 1, style: STYLES[i % 5] }));
  for (let i = 0; i < 20; i++) lots.push(lotOf({ x: 1000 + (i % 10) * 10, z: 20 + Math.floor(i / 10) * 20, seed: 100 + i, style: 'cottage', kind: 'cottage' }));
  const geo0 = stub.stats.geo;
  const kit = HK.build(lots, { tier: 'mid', chunk: 160, near: 300, far: 1600 });
  ok(kit.group && kit.group.children.length >= 2, 'kit.group holds the chunk meshes');
  let inf = kit.info();
  eq(inf.buildings, 50, 'info counts buildings');
  eq(inf.chunks, 2, 'two chunks (160 units each)');
  eq(kit.chunks.filter(c => c.near).length, 0, 'full models are built lazily');
  const A = kit.chunks.find(c => c.ox < 500), B = kit.chunks.find(c => c.ox > 500);
  const cam = (x, y, z) => ({ x, y, z });
  // chunk A spans x 15..115 (plus margins); stand to its west
  kit.update(cam(-150, 20, 40));
  eq(A.state, 'near', 'a chunk within near shows the full model');
  ok(A.near && A.near.visible && !A.far.visible, 'near: the detailed mesh is shown, the far LOD hidden');
  eq(B.state, 'far', 'a chunk 1000 units away shows the far LOD');
  ok(B.far.visible && !B.near, 'far: only the far LOD mesh exists and is shown');
  inf = kit.info();
  eq(inf.calls, 2, 'one draw call per shown chunk');
  ok(inf.tris === A.near.userData.tris + B.far.userData.tris, 'info sums the shown triangles');
  ok(A.near.userData.tris > A.far.userData.tris * 4, 'the far LOD is far cheaper than the full model');
  // hysteresis on the near switch
  const dA = x => A.x0 - x;                                // distance from a camera west of the chunk, at its z
  kit.update(cam(A.x0 - 320, 20, 40));                     // beyond near (300), inside near * 1.12
  ok(dA(A.x0 - 320) > 300, 'camera now past the near distance');
  eq(A.state, 'near', 'hysteresis: stays detailed just past near');
  kit.update(cam(A.x0 - 350, 20, 40));
  eq(A.state, 'far', 'switches to the far LOD past near + 12 %');
  ok(!A.near.visible && A.far.visible, 'far LOD shown after switching');
  kit.update(cam(A.x0 - 310, 20, 40));
  eq(A.state, 'far', 'hysteresis: stays far until back inside near');
  kit.update(cam(A.x0 - 290, 20, 40));
  eq(A.state, 'near', 'back to the full model inside near');
  // hidden beyond far, with hysteresis
  kit.update(cam(A.x0 - 1700, 20, 40));
  eq(A.state, 'far', 'still shown just past far');
  kit.update(cam(A.x0 - 1850, 20, 40));
  eq(A.state, 'hidden', 'hidden past far + 12 %');
  ok(!A.far.visible && (!A.near || !A.near.visible), 'a hidden chunk draws nothing');
  kit.update(cam(A.x0 - 1700, 20, 40));
  eq(A.state, 'hidden', 'hysteresis: stays hidden until back inside far');
  kit.update(cam(A.x0 - 1550, 20, 40));
  eq(A.state, 'far', 'shown again inside far');
  // lazy build budget: two chunks wanted at once, one per update with buildPerUpdate 1
  const kit2 = HK.build(lots, { tier: 'low', near: 5000, far: 9000, buildPerUpdate: 1 });
  kit2.update(cam(500, 50, 40));
  eq(kit2.chunks.filter(c => c.near).length, 1, 'one full model built per update (buildPerUpdate 1)');
  ok(kit2.chunks.every(c => c.state === 'near') && kit2.chunks.every(c => (c.near && c.near.visible) || c.far.visible), 'chunks waiting for their model show the far LOD meanwhile');
  kit2.update(cam(500, 50, 40));
  eq(kit2.chunks.filter(c => c.near).length, 2, 'the next update builds the next one');
  kit2.dispose();
  // night
  kit.setNight(1);
  ok(kit.material.userData.hk.hkNight.value[0] > 0.9, 'setNight(1) turns the window glow on');
  kit.setNight(0);
  eq(kit.material.userData.hk.hkNight.value[0], 0, 'setNight(0) turns it off');
  // dispose
  const scene = new stub.THREE.Group(); scene.add(kit.group);
  const made = stub.stats.geo - geo0, disposed0 = stub.stats.geoDisposed, mats0 = stub.stats.matDisposed;
  kit.dispose();
  ok(kit.group.parent === null, 'dispose removes the group from the scene');
  ok(stub.stats.geoDisposed - disposed0 >= 3, 'dispose frees the chunk geometries');
  ok(stub.stats.matDisposed - mats0 >= 1, 'dispose frees the material');
  ok(made >= 3, 'chunk geometries were made');
  // no DOM: no textures, but the material still exists
  ok(!kit.material.map, 'without a DOM the kit builds without textures');
}
