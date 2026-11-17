// Procedural people (shared/human.js): every kind builds against a tiny THREE stub (no WebGL), stays within its
// triangle budget, shares geometry between figures, is deterministic per seed, animates without NaNs, disposes its
// materials only; the crowd is a few InstancedMeshes; the shimmer is one Points object.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ok } = require('./harness.js');
const eq = (a, b, msg) => ok(a === b, msg + ': ' + a + ' vs ' + b);

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- minimal THREE stub ---------- */
function makeThree() {
  let disposedGeo = 0, disposedMat = 0;
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Obj {
    constructor() { this.children = []; this.parent = null; this.position = new V3(); this.rotation = new V3(); this.scale = new V3(1, 1, 1); this.userData = {}; this.visible = true; }
    add(...cs) { for (const c of cs) { c.parent = this; this.children.push(c); } return this; }
    remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return this; }
    traverse(f) { f(this); this.children.forEach(c => c.traverse(f)); }
  }
  class Mesh extends Obj { constructor(g, m) { super(); this.isMesh = true; this.geometry = g; this.material = m; } }
  class InstancedMesh extends Mesh { constructor(g, m, n) { super(g, m); this.isInstancedMesh = true; this.count = n; this.instanceMatrix = { array: new Float32Array(n * 16), needsUpdate: false }; } dispose() {} }
  class Points extends Obj { constructor(g, m) { super(); this.isPoints = true; this.geometry = g; this.material = m; } }
  class Geo { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; return this; } setIndex(i) { this.index = i; return this; } computeBoundingSphere() {} dispose() { disposedGeo++; } }
  class Attr { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } }
  class Mat {
    constructor(o) { Object.assign(this, o); this.userData = {}; this.color = { hex: o && o.color, setHex(h) { this.hex = h; } }; }
    dispose() { disposedMat++; }
  }
  const THREE = {
    Vector3: V3, Object3D: Obj, Group: Obj, Mesh, InstancedMesh, Points, BufferGeometry: Geo,
    Float32BufferAttribute: Attr, BufferAttribute: Attr, InstancedBufferAttribute: Attr,
    MeshStandardMaterial: Mat, MeshLambertMaterial: Mat, MeshBasicMaterial: Mat, PointsMaterial: Mat, DoubleSide: 2, AdditiveBlending: 2,
  };
  return { THREE, stats: () => ({ disposedGeo, disposedMat }) };
}

function load() {
  const stub = makeThree();
  const sandbox = { THREE: stub.THREE, Math, Set, Map, Object, Float32Array, Float64Array, Array };
  sandbox.self = sandbox;
  vm.runInNewContext(read('shared/human.js'), sandbox, { filename: 'shared/human.js' });
  return { VH: sandbox.VHuman, stub };
}
const { VH, stub } = load();
ok(VH && typeof VH.make === 'function' && typeof VH.crowd === 'function' && typeof VH.shimmer === 'function', 'shared/human.js exposes VHuman.make / crowd / shimmer');
eq(JSON.stringify(Array.from(VH.KINDS)), JSON.stringify(['wizard', 'princess', 'prince', 'dragonkin', 'guard', 'citizen']), 'KINDS');

const meshTris = m => (m.geometry.index.length || m.geometry.index.count) / 3;
function check(h, label) {
  let tris = 0, meshes = 0;
  h.root.traverse(o => {
    if (!o.isMesh || o.userData.glow) return;
    const g = o.geometry, n = g.attributes.position.count;
    if (g.attributes.hv) {
      ok(g.attributes.normal.count === n && g.attributes.color.count === n && g.attributes.hv.count === n, label + ': attributes match');
      ok(g.attributes.position.array.every(Number.isFinite) && g.attributes.normal.array.every(Number.isFinite), label + ': finite geometry');
      ok(g.index.length % 3 === 0 && g.index.every(i => i >= 0 && i < n), label + ': indices in range');
      tris += meshTris(o); meshes++;
    }
  });
  return { tris, meshes };
}

const budget = { wizard: 3000, princess: 3000, prince: 3000, dragonkin: 3000, guard: 800, citizen: 800 };
const report = [];
for (const kind of VH.KINDS) {
  for (const seed of [0, 1, 7, 12345, 0xdeadbeef]) {
    for (const detail of ['high', 'low']) {
      const h = VH.make(kind, { seed, detail });
      const { tris, meshes } = check(h, kind);
      ok(tris <= budget[kind], kind + ' (' + detail + ') within ' + budget[kind] + ' triangles: ' + tris + ' (seed ' + seed + ')');
      ok(meshes <= 24, kind + ': draw calls ' + meshes);
      ok(h.height > 1.6 && h.height < 2.3, kind + ': height ' + h.height.toFixed(2));
      eq(h.tris, tris, kind + ': h.tris');
      if (seed === 0 && detail === 'high') report.push(kind + ' ' + tris);
    }
  }
}
// default citizens (what the crowd uses: detail low) under 800 triangles for every seed
for (let s = 1; s < 200; s++) { const h = VH.make('citizen', { seed: s * 7919 }); ok(h.tris <= 800, 'citizen seed ' + s + ' tris ' + h.tris); }
for (let s = 1; s < 10; s++) { const h = VH.make('guard', { seed: s * 7919, detail: 'low' }); ok(h.tris <= 800, 'guard seed ' + s + ' tris ' + h.tris); }

// API pieces
const w = VH.make('wizard', { seed: 3 });
for (const k of ['root', 'anim', 'glow', 'setGlow', 'height', 'dispose']) ok(w[k] != null, 'figure has ' + k);
ok(w.height > 2.0, 'the wizard is taller with his hat: ' + w.height.toFixed(2));
const pr = VH.make('princess'); ok(pr.height > 1.65 && pr.height < 1.85, 'princess height ' + pr.height.toFixed(2));

// geometry is shared per kind / variant; materials are per figure
const a = VH.make('wizard', { seed: 9 }), b = VH.make('wizard', { seed: 10 });
const geos = h => { const s = []; h.root.traverse(o => { if (o.isMesh) s.push(o.geometry); }); return s; };
ok(geos(a).every((g, i) => g === geos(b)[i]), 'two wizards share all geometry');
const mats = h => { const s = new Set(); h.root.traverse(o => { if (o.isMesh) s.add(o.material); }); return s; };
ok([...mats(a)].every(m => !mats(b).has(m)), 'materials are per figure');

// deterministic per seed, varied across seeds
const sig = h => JSON.stringify([h.palette, geos(h).map(g => g.attributes.position.count)]);
eq(sig(VH.make('citizen', { seed: 42 })), sig(VH.make('citizen', { seed: 42 })), 'same seed -> same citizen');
const sigs = new Set(); for (let s = 1; s <= 30; s++) sigs.add(sig(VH.make('citizen', { seed: s })));
ok(sigs.size >= 20, 'citizens vary with the seed: ' + sigs.size + ' distinct of 30');
const pal = VH.make('princess', { seed: 5, palette: { main: 0x123456 } }).palette;
eq(pal.main, 0x123456, 'palette override');
const U = VH.make('princess', { seed: 5, palette: { main: 0xff0000 } }).materials[0].userData.hv;
ok(U.hvA.value.x === 1 && U.hvA.value.y === 0, 'main slot colour reaches the material uniform');

// animation: walk / run / cast / attack / talk / air stay finite and move the parts
for (const kind of VH.KINDS) {
  const h = VH.make(kind, { seed: 4 });
  const R = h.rig;
  let sawSwing = 0, minHip = 9, maxHip = -9;
  for (let i = 0; i < 120; i++) {
    h.anim(1 / 30, { speed: 1.4 });
    sawSwing = Math.max(sawSwing, Math.abs(R.leg[0].rotation.x));
    minHip = Math.min(minHip, R.hips.position.y); maxHip = Math.max(maxHip, R.hips.position.y);
  }
  ok(sawSwing > 0.2, kind + ': legs swing when walking ' + sawSwing.toFixed(2));
  ok(maxHip - minHip > 0.005 && maxHip <= 0.93 + 1e-9, kind + ': body bobs ' + (maxHip - minHip).toFixed(3));
  ok(R.leg[0].rotation.x * R.sh[0].rotation.x <= 1e-9 || Math.abs(R.leg[0].rotation.x) < 0.05, kind + ': arms counter-swing');
  let runSwing = 0; for (let i = 0; i < 120; i++) { h.anim(1 / 30, { speed: 4.5, run: true }); runSwing = Math.max(runSwing, Math.abs(R.leg[0].rotation.x)); }
  ok(runSwing > sawSwing, kind + ': running swings wider');
  ok(R.chest.rotation.x > 0.1, kind + ': leans forward when running');
  for (let i = 0; i < 60; i++) h.anim(1 / 30, { speed: 0, cast: 1 });
  ok(R.sh[0].rotation.x < -1, kind + ': cast raises the arms');
  ok(h.glow.visible, kind + ': cast lights the glow');
  for (let i = 0; i <= 30; i++) h.anim(1 / 30, { attack: i / 30 });
  for (let i = 0; i < 30; i++) h.anim(1 / 30, { talk: true, air: 0.5 });
  let finite = true;
  h.root.traverse(o => { for (const v of [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z]) if (!Number.isFinite(v)) finite = false; });
  ok(finite, kind + ': pose stays finite');
  for (let i = 0; i < 60; i++) h.anim(1 / 30, {});
  ok(!h.glow.visible, kind + ': the glow goes out after casting');
  h.setGlow(0.7, 0xff0000); ok(h.glow.visible, kind + ': setGlow lights it');
  h.setGlow(0); ok(!h.glow.visible, kind + ': setGlow(0) hides it');
}
// the prince draws his sword to attack
{
  const h = VH.make('prince');
  const swords = []; h.root.traverse(o => { if (o.isMesh && o.parent && o.parent.parent === h.rig.hand[1]) swords.push(o); });
  h.anim(0.1, { attack: 0.4 });
  let inHand = false; h.rig.hand[1].traverse(o => { if (o.isMesh && o.parent.visible) inHand = true; });
  ok(inHand, 'the prince holds a drawn sword while attacking');
  for (let i = 0; i < 40; i++) h.anim(0.1, {});
  inHand = false; h.rig.hand[1].traverse(o => { if (o.isMesh && o.parent.visible) inHand = true; });
  ok(!inHand, 'and sheathes it again');
}

// dispose: removes from the parent, frees every material of the figure, keeps the shared geometry
{
  const scene = new stub.THREE.Group(), h = VH.make('dragonkin', { seed: 2 });
  scene.add(h.root);
  const before = stub.stats();
  h.dispose();
  ok(h.root.parent === null && scene.children.length === 0, 'dispose removes the root');
  eq(stub.stats().disposedGeo - before.disposedGeo, 0, 'dispose keeps the shared geometry');
  eq(stub.stats().disposedMat - before.disposedMat, h.materials.length, 'dispose frees the materials');
}

// crowd: few draw calls for many people, cheap per person, animated instance matrices
{
  const c = VH.crowd(60, { seed: 9, kinds: ['citizen', 'guard'] });
  ok(c.group.children.length <= 13, 'crowd of 60 draws in ' + c.group.children.length + ' calls');
  eq(c.drawCalls, c.group.children.length, 'crowd.drawCalls');
  ok(c.tris / 60 <= 800, 'crowd: ' + Math.round(c.tris / 60) + ' triangles per person');
  ok(c.kinds.filter(k => k === 'guard').length > 0 && c.kinds.filter(k => k === 'citizen').length > 30, 'crowd mixes citizens and guards');
  let inst = 0; for (const im of c.group.children) { ok(im.isInstancedMesh, 'crowd part is an InstancedMesh'); inst += im.count; }
  ok(inst >= 60 * 5, 'every member has a body and four limbs: ' + inst);
  for (let i = 0; i < 60; i++) c.set(i, i * 2, 0, 0, i * 0.1, i % 3 ? 1.3 : 0);
  const thigh = c.group.children.find(im => im.count === 120 && im.geometry.attributes.hvIL);
  const snap = [].concat(...c.group.children.map(im => Array.from(im.instanceMatrix.array.slice(0, 16))));
  for (let i = 0; i < 10; i++) c.update(1 / 30);
  const snap2 = [].concat(...c.group.children.map(im => Array.from(im.instanceMatrix.array.slice(0, 16))));
  ok(snap.some((v, i) => Math.abs(v - snap2[i]) > 1e-4), 'crowd update moves the instances');
  ok(c.group.children.every(im => im.instanceMatrix.array.every(Number.isFinite)), 'crowd matrices finite');
  ok(thigh != null, 'limb instances (2 per member)');
  const body = c.group.children[0].instanceMatrix.array;
  ok(Math.abs(body[13] - 0.93 * 0.9) < 0.15, 'crowd body stands at hip height: ' + body[13].toFixed(2));
  const c2 = VH.crowd(60, { seed: 9, kinds: ['citizen', 'guard'] });
  eq(JSON.stringify(c2.kinds), JSON.stringify(c.kinds), 'crowd deterministic per seed');
  const before = stub.stats();
  c.dispose();
  eq(stub.stats().disposedGeo - before.disposedGeo, c.drawCalls, 'crowd dispose frees its own geometries');
  const cg = VH.crowd(5, { kinds: ['guard'] }); ok(cg.kinds.every(k => k === 'guard'), 'a crowd of guards');
  const empty = VH.crowd(0, {}); empty.update(0.1); ok(true, 'an empty crowd is harmless');
}

// shimmer: one Points object; plays, fades out
{
  const scene = new stub.THREE.Group(), s = VH.shimmer(scene);
  ok(s.root.isPoints && scene.children[0] === s.root, 'shimmer is one Points object in the scene');
  ok(!s.root.visible, 'hidden until played');
  s.play({ x: 1, y: 0, z: 2 }, 0x55ff99);
  s.update(0.2);
  ok(s.root.visible && s.root.position.x === 1, 'plays at the position');
  const col = s.root.geometry.attributes.color.array;
  ok(col.some(v => v > 0.05), 'sparkles are lit');
  for (let i = 0; i < 40; i++) s.update(0.1);
  ok(!s.root.visible, 'and fades out');
  s.dispose(); ok(scene.children.length === 0, 'shimmer dispose');
}

// the preview page loads three, textures and the model before its script
{
  const html = read('campaign/preview/humans.html'), at = n => html.indexOf(n);
  ok(at('three.min.js') > 0 && at('three.min.js') < at('shared/textures.js') && at('shared/textures.js') < at('shared/human.js') && at('shared/human.js') < at('humans.js"'), 'humans.html loads three, textures, human, humans.js in order');
}

if (process.env.HUMAN_REPORT) console.log('tris: ' + report.join(', '));
