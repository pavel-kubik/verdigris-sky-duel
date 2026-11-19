// Shared dragon model (phase 2 T03): solo (index.html), co-op (mp/) and the campaign all build the dragon
// from shared/dragon.js. Static checks on the pages plus a run of the builder against a tiny THREE stub
// (structure, toes option, dispose), so it stays Node-testable without WebGL.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ok } = require('./harness.js');
const eq = (a, b, msg) => ok(a === b, msg + ': ' + a + ' vs ' + b);

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- pages load the shared model and carry no copy of their own ---------- */
const solo = read('index.html'), mpHtml = read('mp/index.html'), mpGame = read('mp/game.js');
ok(!/function\s+makeDragon\s*\(/.test(solo), 'index.html has no inline makeDragon');
ok(!/function\s+makeDragon\s*\(/.test(mpGame), 'mp/game.js has no inline makeDragon');
const at = (s, needle) => s.indexOf(needle);
ok(at(solo, 'three.min.js') > 0 && at(solo, 'three.min.js') < at(solo, 'src="shared/dragon.js"'), 'index.html loads shared/dragon.js after Three.js');
ok(at(solo, 'src="shared/dragon.js"') < at(solo, 'VDragon'), 'index.html loads shared/dragon.js before the game script uses VDragon');
ok(at(mpHtml, 'three.min.js') < at(mpHtml, 'src="../shared/dragon.js"') && at(mpHtml, 'src="../shared/dragon.js"') < at(mpHtml, 'src="game.js"'), 'mp/index.html loads shared/dragon.js between Three.js and game.js');
ok(/VDragon\.makeDragon\(c\)/.test(mpGame) && /VDragon\.makeDragon\(c\)/.test(read('campaign/dm/game.js')), 'co-op and deathmatch use the full model (toes and claws), as the campaign does');
for (const f of ['index.html', 'mp/index.html', 'campaign/index.html', 'campaign/dm/index.html']) { const h = read(f); ok(at(h, 'shared/textures.js') > 0 && at(h, 'shared/textures.js') < at(h, 'shared/dragon.js'), f + ' loads shared/textures.js before the dragon'); }
ok(read('sw.js').includes("'shared/dragon.js'"), 'sw.js precaches shared/dragon.js');

/* ---------- minimal THREE stub ---------- */
function makeThree() {
  let disposedGeo = 0, disposedMat = 0;
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    clone() { return new V3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
    lerp(v, k) { this.x += (v.x - this.x) * k; this.y += (v.y - this.y) * k; this.z += (v.z - this.z) * k; return this; }
    setScalar(s) { return this.set(s, s, s); }
  }
  class Euler extends V3 {}
  class Obj {
    constructor() { this.children = []; this.parent = null; this.position = new V3(); this.rotation = new Euler(); this.scale = new V3(1, 1, 1); this.quaternion = { setFromUnitVectors() { return this; } }; this.userData = {}; }
    add(c) { c.parent = this; this.children.push(c); return this; }
    remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return this; }
    traverse(f) { f(this); this.children.forEach(c => c.traverse(f)); }
  }
  class Mesh extends Obj { constructor(g, m) { super(); this.isMesh = true; this.geometry = g; this.material = m; } }
  class Geo { constructor() { this.attributes = {}; } translate() { return this; } setAttribute(n, a) { this.attributes[n] = a; return this; } setIndex(i) { this.index = i; return this; } computeVertexNormals() {} computeBoundingSphere() {} dispose() { disposedGeo++; } }
  class Mat { constructor(o) { Object.assign(this, o); this.emissive = { setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } }; } dispose() { disposedMat++; } }
  const THREE = {
    Vector3: V3, Object3D: Obj, Group: Obj, Mesh,
    IcosahedronGeometry: Geo, CylinderGeometry: Geo, ConeGeometry: Geo, BoxGeometry: Geo, SphereGeometry: Geo, OctahedronGeometry: Geo, BufferGeometry: Geo,
    Float32BufferAttribute: function (a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; }, MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, DoubleSide: 2,
  };
  return { THREE, stats: () => ({ disposedGeo, disposedMat }) };
}

const stub = makeThree();
const sandbox = { THREE: stub.THREE, Math, Set, Object };
sandbox.self = sandbox;
vm.runInNewContext(read('shared/dragon.js'), sandbox, { filename: 'shared/dragon.js' });
const VD = sandbox.VDragon;
ok(VD && typeof VD.makeDragon === 'function' && VD.GREEN && VD.CRIMSON, 'shared/dragon.js exposes VDragon with GREEN and CRIMSON');

const full = VD.makeDragon(VD.GREEN), light = VD.makeDragon(VD.CRIMSON, { toes: false });
for (const k of ['root', 'body', 'neck', 'tail', 'jaw', 'head', 'mouth', 'wings', 'claws', 'mats', 'anim', 'dispose']) ok(full[k] != null, 'model has ' + k);
eq(full.neck.length, 6, 'neck has 6 joints');
eq(full.tail.length, 12, 'tail has 12 joints');
eq(full.wings.length, 2, 'two wings');
eq(full.meshes - light.meshes, 4, 'toes: false drops the claws (one merged mesh per foot)');
ok(full.meshes <= 100, 'draw calls of one dragon stay in budget: ' + full.meshes);
// geometry is sound: every part has positions, normals, uvs and colours of the same length, finite, indexed in range
let tris = 0;
full.root.traverse(o => {
  if (!o.isMesh) return;
  const g = o.geometry, n = g.attributes.position.count;
  ok(n > 0 && g.attributes.normal.count === n && g.attributes.uv.count === n && g.attributes.color.count === n, 'attributes match');
  ok(g.attributes.position.array.every(Number.isFinite) && g.attributes.normal.array.every(Number.isFinite), 'finite geometry');
  ok(g.index.length % 3 === 0 && g.index.every(i => i >= 0 && i < n), 'indices in range');
  tris += g.index.length / 3;
});
ok(tris > 4000 && tris < 16000, 'a detailed but phone-friendly model: ' + tris + ' triangles');

// anim runs and the hit flash fades
full.flash = 1;
full.anim(1, 0.1, { phase: 1, amp: 1, look: 0.5, turn: 0.2, mouth: true });
ok(full.flash < 1 && full.flash >= 0, 'hit flash fades in anim');
ok(full.jaw.rotation.x > 0.04, 'mouth opens with o.mouth');

// dispose removes from the parent and frees the dragon's materials; the geometry is shared by every dragon
const scene = new stub.THREE.Group();
scene.add(full.root);
let geos = new Set(), mats = new Set();
full.root.traverse(o => { if (o.isMesh) { geos.add(o.geometry); mats.add(o.material); } });
full.dispose();
ok(full.root.parent === null && scene.children.length === 0, 'dispose removes the root from the scene');
eq(stub.stats().disposedGeo, 0, 'dispose keeps the shared geometry');
eq(stub.stats().disposedMat, mats.size, 'dispose frees every material');
ok(VD.makeDragon(VD.CRIMSON).body.children[0].geometry === [...geos][0] || geos.has(VD.makeDragon(VD.CRIMSON).body.children[0].geometry), 'a second dragon reuses the geometry');

/* ---------- phase 4 T04: stage looks (opts.stage) ---------- */
const D4 = require('./harness.js').core('data');
const count = d => { let v = 0, t = 0, m = 0; d.root.traverse(o => { if (o.isMesh) { m++; v += o.geometry.attributes.position.count; t += o.geometry.index.length / 3; } }); return { v, t, m }; };
const base = count(VD.makeDragon(VD.GREEN)), baseOpt = count(VD.makeDragon(VD.GREEN, {})), baseNull = count(VD.makeDragon(VD.GREEN, { stage: null }));
eq(base.v, 7810, 'without a stage the model is exactly the duel model (vertex count)');
ok(baseOpt.v === base.v && baseNull.v === base.v && baseOpt.t === base.t, 'opts {} and stage: null build the same model');
ok(D4 && D4.stageLook, 'data has stageLook');
for (const st of D4.stages) ok(D4.stageLook[st.id], 'stageLook has a row for stage ' + st.id);
ok(D4.stageLook.elder && D4.stageLook.wyrm, 'stageLook has the wyrm and the elder (preview)');
const looks = {};
for (const id of ['hatchling', 'drake', 'wyrm', 'elder']) {
  const L = Object.assign({ id }, D4.stageLook[id]), d = VD.makeDragon(VD.GREEN, { stage: L }), c = count(d);
  looks[id] = { d, c, L };
  eq(c.m, base.m, id + ': no extra draw calls (parts merge into the horn meshes)');
  ok(d.look === L, id + ': the model keeps its look');
}
// the spec's "under 6k" was written before the Phase 3 model grew to about 10k triangles: the budget is now the
// stage parts, under 1000 triangles on top of the base model for the Wyrm (004_task_highlands.md section 9)
ok(looks.wyrm.c.t - base.t < 1000, 'Wyrm stage parts under 1000 triangles: +' + (looks.wyrm.c.t - base.t) + ' over ' + base.t);
ok(looks.wyrm.c.t < 12000, 'Wyrm model under 12k triangles: ' + looks.wyrm.c.t);
ok(looks.elder.c.t - base.t < 1600, 'Elder stage parts under 1600 triangles: +' + (looks.elder.c.t - base.t));
ok(looks.hatchling.c.v === base.v && looks.drake.c.v === base.v, 'hatchling and drake keep the base vertex count (shorter / same horns only)');
ok(looks.wyrm.c.v > looks.drake.c.v && looks.elder.c.v > looks.wyrm.c.v, 'each older stage adds parts: ' + [looks.drake.c.v, looks.wyrm.c.v, looks.elder.c.v]);
// horn length: the main horn tip reaches further back on older stages
const hornReach = d => { let minZ = 0; d.head.children.forEach(o => { if (o.isMesh && o.material === d.mats[3]) { const a = o.geometry.attributes.position.array; for (let i = 2; i < a.length; i += 3) minZ = Math.min(minZ, a[i]); } }); return minZ; };
ok(hornReach(looks.hatchling.d) > hornReach(looks.drake.d) && hornReach(looks.drake.d) > hornReach(looks.wyrm.d) && hornReach(looks.wyrm.d) > hornReach(looks.elder.d), 'horns grow longer with the stage');
// crest plates on the torso and neck (horn meshes have more vertices), tint, span
const partVerts = (d, grp) => grp.children.filter(o => o.isMesh).reduce((n, o) => n + o.geometry.attributes.position.count, 0);
ok(partVerts(looks.wyrm.d, looks.wyrm.d.body) > partVerts(looks.drake.d, looks.drake.d.body), 'the Wyrm has crest plates on the back');
ok(partVerts(looks.wyrm.d, looks.wyrm.d.neck[5]) > partVerts(looks.drake.d, looks.drake.d.neck[5]) && partVerts(looks.wyrm.d, looks.wyrm.d.neck[0]) === partVerts(looks.drake.d, looks.drake.d.neck[0]), 'Wyrm neck crest starts at the head');
ok(partVerts(looks.wyrm.d, looks.wyrm.d.jaw) > partVerts(looks.drake.d, looks.drake.d.jaw), 'the Wyrm has jaw spikes');
const bodyCol = d => d.mats[0].color;
eq(bodyCol(looks.hatchling.d), VD.GREEN.body, 'hatchling (tint 1) keeps the palette colour');
ok(bodyCol(looks.wyrm.d) < bodyCol(looks.drake.d) && ((bodyCol(looks.wyrm.d) >> 8) & 255) < ((VD.GREEN.body >> 8) & 255), 'older stages have darker scales');
eq(VD.GREEN.body, 0x2f7f50, 'tint does not change the shared palette');
ok(Math.abs(looks.wyrm.d.wings[0].wr.scale.x - 1.12) < 1e-9 && looks.hatchling.d.wings[0].wr.scale.x === 1, 'wing span follows the stage');
ok(VD.makeDragon(VD.GREEN, { stage: looks.wyrm.L }).head.children[0].geometry === looks.wyrm.d.head.children[0].geometry, 'two Wyrms share the stage geometry');
looks.wyrm.d.anim(1, 0.1, { phase: 1, amp: 1, ground: 1, gait: 1, stride: 1 });
ok(true, 'a Wyrm animates');
