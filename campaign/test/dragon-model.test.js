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
ok(/VDragon\.makeDragon\(c, \{ toes: false \}\)/.test(mpGame), 'co-op keeps its model without toe claws');
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
  class Geo { translate() { return this; } setAttribute() { return this; } computeVertexNormals() {} dispose() { disposedGeo++; } }
  class Mat { constructor(o) { Object.assign(this, o); this.emissive = { setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } }; } dispose() { disposedMat++; } }
  const THREE = {
    Vector3: V3, Object3D: Obj, Group: Obj, Mesh,
    IcosahedronGeometry: Geo, CylinderGeometry: Geo, ConeGeometry: Geo, BoxGeometry: Geo, SphereGeometry: Geo, OctahedronGeometry: Geo, BufferGeometry: Geo,
    Float32BufferAttribute: function () {}, MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, DoubleSide: 2,
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
eq(full.meshes - light.meshes, 12, 'toes: false drops the 12 toe claws (3 per foot)');

// anim runs and the hit flash fades
full.flash = 1;
full.anim(1, 0.1, { phase: 1, amp: 1, look: 0.5, turn: 0.2, mouth: true });
ok(full.flash < 1 && full.flash >= 0, 'hit flash fades in anim');
ok(full.jaw.rotation.x > 0.04, 'mouth opens with o.mouth');

// dispose removes from the parent and frees everything except the shared segment geometry
const scene = new stub.THREE.Group();
scene.add(full.root);
let geos = new Set(), mats = new Set();
full.root.traverse(o => { if (o.isMesh) { geos.add(o.geometry); mats.add(o.material); } });
const seg = VD.makeDragon(VD.GREEN).body.children[0].geometry;   // torso uses the shared segment geometry
full.dispose();
ok(full.root.parent === null && scene.children.length === 0, 'dispose removes the root from the scene');
eq(stub.stats().disposedGeo, geos.size - (geos.has(seg) ? 1 : 0), 'dispose frees every geometry except the shared segment');
eq(stub.stats().disposedMat, mats.size, 'dispose frees every material');
