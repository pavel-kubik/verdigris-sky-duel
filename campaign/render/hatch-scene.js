/*
 * Verdigris campaign - the hatching scene that opens a new campaign (T15, from the approved preview).
 * The mother lies curled around her small egg in the volcano lair; a heartbeat, glowing cracks, the shell bursts,
 * the hatchling climbs out, she nuzzles it, it breathes its first fire. Built from the game's own dragon model.
 * Its own scene and camera, drawn with the game's renderer while the campaign is in the 'hatch' state.
 *   VRender.hatch.build() -> { scene, camera, update(dt) -> { line, card, t }, resize(w, h), skip(), dispose() }
 *   line: caption key ('c.hatch.p1' .. 'c.hatch.p4') or ''; card: true once the hatching card should show
 * The mother's flight / bolt path (P, momPos, bolts) is kept switched off here: her death scene comes in phase 4.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  if (!THREE || !root.VDragon) return;
  const VDragon = root.VDragon, V3 = THREE.Vector3;
  const VR = root.VRender = root.VRender || {};

  function build() {
  const reduce = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  /* ---------- scene, lair lighting ---------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x140c09);
  scene.fog = new THREE.Fog(0x2a1a12, 9, 30);
  const FOG = { near: 9, far: 30 }, FOG_OPEN = { near: 40, far: 240 };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x0e1418) }, mid: { value: new THREE.Color(0x3a2c28) }, bot: { value: new THREE.Color(0x9a4a26) }, dim: { value: 1 } },
    vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 top,mid,bot;uniform float dim;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.?mix(mix(bot,mid,smoothstep(0.,.18,h)),top,smoothstep(.18,.7,h)):bot*.6;gl_FragColor=vec4(c*dim,1.);}',
  }));
  scene.add(sky);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 700);
  scene.add(new THREE.HemisphereLight(0x5f7f86, 0x2a160c, 0.55));
  const lava = new THREE.PointLight(0xff6a1f, 2.2, 14, 1.6); lava.position.set(-2.5, 0.6, 2.2); scene.add(lava);
  const lava2 = new THREE.PointLight(0xff4a10, 1.4, 12, 1.6); lava2.position.set(3, 0.4, -1.5); scene.add(lava2);
  const rim = new THREE.DirectionalLight(0x8fb7c8, 0.55); rim.position.set(-3, 6, -6); scene.add(rim);
  const key = new THREE.DirectionalLight(0xffc68c, 0.5); key.position.set(4, 5, 5); scene.add(key);
  const heart = new THREE.PointLight(0xffa04a, 0, 5, 2); heart.position.set(0, 0.7, 0.8); scene.add(heart);
  const flash = new THREE.PointLight(0xffd8a0, 0, 12, 1.5); flash.position.set(0, 2.4, 0.4); scene.add(flash);

  const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
  /* ---------- seeded randomness so every replay looks the same ---------- */
  const rnd = (() => { let a = 41; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let q = Math.imul(a ^ a >>> 15, 1 | a); q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q; return ((q ^ q >>> 14) >>> 0) / 4294967296; }; })();
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- ground: ash floor, nest of basalt, lava seams ---------- */
  {
    const r = mulberry(7);
    const g = new THREE.PlaneGeometry(320, 320, 110, 110); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
      const rimK = Math.min(1, Math.max(0, (d - 12) / 40)), rim = rimK * rimK * (3 - 2 * rimK) * (17 + 5 * Math.sin(Math.atan2(z, x) * 5));
      const y = (r() - 0.5) * (d < 12 ? 0.18 : 1.2) + Math.min(Math.max(0, d - 6) * 0.08, 0.5) + rim + (d < 2.6 ? -0.08 * (1 - d / 2.6) : 0);
      p.setY(i, y);
      const k = 0.16 + r() * 0.05 - (d < 2.4 ? 0.05 : 0);
      col.push(k * 1.15, k * 0.95, k * 0.85);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g.toNonIndexed(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })));
    const basalt = new THREE.MeshStandardMaterial({ color: 0x2a2523, flatShading: true, roughness: 0.9 });
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + r() * 0.2, d = 1.55 + r() * 0.5, s = 0.25 + r() * 0.3;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), basalt);
      m.position.set(Math.cos(a) * d, s * 0.35, Math.sin(a) * d); m.rotation.set(r() * 3, r() * 3, r() * 3); m.scale.y = 0.7;
      scene.add(m);
    }
    const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff6a1f, fog: true });
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d0 = 3.4 + r() * 2.5, len = 1.5 + r() * 3;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07 + r() * 0.08, 0.02, len), lavaMat);
      m.position.set(Math.cos(a) * (d0 + len / 2), 0.03, Math.sin(a) * (d0 + len / 2)); m.rotation.y = -a + Math.PI / 2 + (r() - 0.5) * 0.6;
      scene.add(m);
    }
  }

  /* ---------- the egg: verdigris patina, glowing crack texture, cut into a cup + 14 shards ---------- */
  const EGG_H = 2.3, CUP_Y = 0.82;
  function patina() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), r = mulberry(3);
    g.fillStyle = '#3f8f73'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const x = r() * 256, y = r() * 256, s = 3 + r() * 16;
      g.fillStyle = ['rgba(176,112,58,.55)', 'rgba(36,86,70,.6)', 'rgba(143,211,178,.35)', 'rgba(98,60,36,.4)'][i % 4];
      g.beginPath(); g.ellipse(x, y, s, s * (0.5 + r() * 0.6), r() * 3, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
  }
  const crackC = document.createElement('canvas'); crackC.width = 512; crackC.height = 512;
  const crackG = crackC.getContext('2d');
  const crackTex = new THREE.CanvasTexture(crackC); crackTex.wrapS = THREE.RepeatWrapping;
  /* cracks as polylines in texture space (x = around the egg, y = down from the top); a ring along the cup line breaks last */
  const cracks = [];
  {
    const r = mulberry(19), vCup = 1 - CUP_Y / EGG_H;
    function walk(x, y, ang, n, step, t0, depth) {
      const pts = [[x, y]];
      for (let i = 0; i < n; i++) {
        ang += (r() - 0.5) * 1.1; x += Math.cos(ang) * step; y += Math.sin(ang) * step * 0.7;
        y = Math.min(512 * vCup, Math.max(40, y)); pts.push([x, y]);
        if (depth < 2 && r() < 0.18) walk(x, y, ang + (r() < 0.5 ? 1 : -1) * (0.9 + r()), 3 + (r() * 5 | 0), step * 0.8, t0 + i / n * 0.5, depth + 1);
      }
      cracks.push({ pts, t0, t1: Math.min(1, t0 + 0.45) });
    }
    for (let k = 0; k < 6; k++) walk(r() * 512, 150 + r() * 120, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5), 9 + (r() * 6 | 0), 18, k * 0.08, 0);
    const ring = []; for (let x = 0; x <= 512; x += 14) ring.push([x, 512 * vCup - 4 + (r() - 0.5) * 18]);
    cracks.push({ pts: ring, t0: 0.55, t1: 1 });
  }
  let crackDrawn = -1;
  function drawCracks(p, glow) {
    const key = Math.round(p * 60) + ':' + Math.round(glow * 20);
    if (key === crackDrawn) return; crackDrawn = key;
    const g = crackG;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgb(' + Math.round(26 * glow) + ',' + Math.round(9 * glow) + ',0)'; g.fillRect(0, 0, 512, 512);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const c of cracks) {
      const f = Math.max(0, Math.min(1, (p - c.t0) / (c.t1 - c.t0))); if (f <= 0) continue;
      const n = (c.pts.length - 1) * f;
      for (const pass of [[7, 'rgba(255,90,16,.35)'], [2.6, '#ffc070']]) {
        g.lineWidth = pass[0]; g.strokeStyle = pass[1];
        for (const off of [-512, 0, 512]) {
          g.beginPath(); g.moveTo(c.pts[0][0] + off, c.pts[0][1]);
          for (let i = 1; i <= Math.ceil(n); i++) {
            const a = c.pts[i - 1], b = c.pts[i], k = Math.min(1, n - (i - 1));
            g.lineTo(a[0] + (b[0] - a[0]) * k + off, a[1] + (b[1] - a[1]) * k);
          }
          g.stroke();
        }
      }
    }
    crackTex.needsUpdate = true;
  }
  const eggMat = new THREE.MeshStandardMaterial({ map: patina(), emissiveMap: crackTex, emissive: 0xffffff, emissiveIntensity: 1, flatShading: true, roughness: 0.55, metalness: 0.3 });
  const egg = new THREE.Group(); scene.add(egg);
  const shards = [];
  let cup = null;
  {
    const prof = [];
    for (let i = 0; i <= 11; i++) {
      const t = i / 11, y = EGG_H * t;
      prof.push(new THREE.Vector2(i === 0 || i === 11 ? 0.001 : 0.88 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.8) * (1 - 0.12 * t), y));
    }
    const full = new THREE.LatheGeometry(prof, 14).toNonIndexed();
    const P = full.attributes.position, U = full.attributes.uv;
    const groups = {}; const cupPos = [], cupUv = [];
    for (let f = 0; f < P.count; f += 3) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += P.getX(f + k); cy += P.getY(f + k); cz += P.getZ(f + k); }
      cx /= 3; cy /= 3; cz /= 3;
      const pos = [], uv = [];
      for (let k = 0; k < 3; k++) { pos.push(P.getX(f + k), P.getY(f + k), P.getZ(f + k)); uv.push(U.getX(f + k), U.getY(f + k)); }
      if (cy < CUP_Y) { cupPos.push(...pos); cupUv.push(...uv); continue; }
      const sector = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 7) % 7, band = cy < 1.6 ? 0 : 1;
      const id = band ? 7 + (sector >> 1) : sector;
      (groups[id] = groups[id] || { pos: [], uv: [] }); groups[id].pos.push(...pos); groups[id].uv.push(...uv);
    }
    const mk = (pos, uv) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g; };
    cup = new THREE.Mesh(mk(cupPos, cupUv), eggMat); egg.add(cup);
    for (const id in groups) {
      const g = mk(groups[id].pos, groups[id].uv); g.computeBoundingBox();
      const c = new V3(); g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, -c.z);
      const m = new THREE.Mesh(g, eggMat); m.position.copy(c); egg.add(m);
      shards.push({ m, home: c.clone(), v: new V3(), w: new V3(), rest: false });
    }
  }

  /* ---------- the hatchling (the game's own model, shared/dragon.js) ---------- */
  const hero = VDragon.makeDragon(VDragon.GREEN);
  scene.add(hero.root);
  const mouthW = new V3();

  /* ---------- the mother: same model, older bronze-green scales, curled around the egg ---------- */
  const MOTHER = { body: 0x2c6450, dark: 0x173a30, belly: 0xb09c66, wing: 0x346e5a, horn: 0xd8c9a8, eye: 0xffb43a };
  const mom = VDragon.makeDragon(MOTHER);
  scene.add(mom.root);
  const MOM_S = 0.78, REST = new V3(-0.2, 0.78, -2.5);
  const EGG_K = 0.5;                                   // the egg is small next to her
  /* her path (deterministic, so the bolts can aim at it): rest, lift off, climb out of the crater, hit, fall behind the rim */
  const P = { rise: 1e9, fly: 1e9, hit: 1e9, gone: 1e9 };   // she does not leave in this scene (her death comes at the end of Act 1)
  function momPos(tt, out) {
    if (tt < P.rise) return out.copy(REST);
    if (tt < P.fly) { const k = ease((tt - P.rise) / (P.fly - P.rise)); return out.set(REST.x * (1 - k), REST.y + k * 5.5, REST.z - k * 4); }
    const u = Math.min(tt, P.hit) - P.fly;
    out.set(Math.sin(u * 0.7) * 3, REST.y + 5.5 + u * 4.6, REST.z - 4 - u * 11.5);
    if (tt > P.hit) { const f = tt - P.hit; out.x += f * 2; out.y += f * 3 - 6.5 * f * f; out.z -= f * 9; }
    return out;
  }
  const BOLTS = [[P.hit - 0.75, new V3(-34, 16, -118), new V3(4, 2.5, 0)], [P.hit - 0.4, new V3(26, 15, -122), new V3(-3, -2, 1)], [P.hit, new V3(-8, 17, -128), new V3(0, 0, 0)]];
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, fog: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, fog: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const blast = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffb060, fog: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(blast);
  const bolts = BOLTS.map(([th, from, miss]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 9, 5), boltMat); m.visible = false; scene.add(m);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.04, 14, 6), glowMat); glow.position.y = -6; m.add(glow);
    const to = momPos(th, new V3()).add(miss);
    return { m, th, from, to, launch: th - 1.1 };
  });
  const upY = new V3(0, 1, 0), tmpA = new V3(), tmpB = new V3();
  function poseMother(tt, dt) {
    const out = tt > P.gone;
    mom.root.visible = !out;
    if (out) return;
    momPos(tt, tmpA);
    mom.root.position.copy(tmpA);
    mom.root.scale.setScalar(MOM_S);
    const flying = tt >= P.rise, falling = tt > P.hit;
    if (!flying) {
      // curled: lying on her side of the nest, head swung round to the egg, slow breathing, a nuzzle
      const breath = Math.sin(tt * 1.6);
      mom.root.rotation.set(0.05, Math.PI / 2 + 0.25, 0, 'YXZ');
      mom.anim(tt, dt, { phase: 0, amp: 0, mouth: false, turn: 0, look: 0 });
      mom.body.position.y = -0.55 + breath * 0.04;
      const nz = (a, b) => (tt > a && tt < b ? Math.max(0, Math.sin((tt - a) * Math.PI / (b - a))) : 0);
      const nuzzle = nz(1.8, 4) + 1.6 * nz(T.burst + 1.6, T.burst + 4.4);
      mom.jaw.rotation.x = nz(T.roar + 1.6, T.roar + 2.6) * 0.5;
      mom.neck.forEach((j, i) => { j.rotation.y = -0.3 - (i === 0 ? 0.15 : 0); j.rotation.x = j.userData.bx + 0.05 + nuzzle * 0.05; });
      mom.tail.forEach((j, i) => { j.rotation.y = 0.24 + Math.sin(tt * 0.9 - i * 0.4) * 0.03; });
      for (const w of mom.wings) { w.arm.rotation.z = 0.45; w.fore.rotation.z = -2.9; w.wr.rotation.y = -w.s * 0.5; w.wr.scale.setScalar(0.6); }
    } else {
      // flying: heading along her path, wings beating, then struck: wings fold, she tumbles
      momPos(tt + 0.05, tmpB).sub(tmpA);
      const yaw = Math.atan2(tmpB.x, tmpB.z), pitch = Math.atan2(tmpB.y, Math.hypot(tmpB.x, tmpB.z));
      const f = falling ? tt - P.hit : 0;
      mom.root.rotation.set(-pitch * (falling ? 1 : 0.6), yaw, falling ? f * 2.6 : Math.sin(tt * 1.2) * 0.15, 'YXZ');
      const unfold = ease((tt - P.rise) / 1.2), amp = falling ? Math.max(0.1, 1 - f * 2) : 0.3 + 0.7 * unfold;
      mom.anim(tt, dt, { phase: tt * (falling ? 3 : 7.5), amp, mouth: falling && f < 0.6, turn: 0, look: falling ? -0.8 : 0 });
      const fold = (1 - unfold) + (falling ? ease(f / 0.8) * 0.7 : 0);
      for (const w of mom.wings) { w.arm.rotation.z += 1.25 * fold; w.fore.rotation.z -= 2.4 * fold; }
      if (falling) mom.flash = Math.max(mom.flash, f < 0.25 ? 0.8 : 0);
    }
    mom.root.updateMatrixWorld(true);
  }
  function poseBolts(tt) {
    const bk = (tt - P.hit) / 0.8;
    blast.visible = bk > 0 && bk < 1;
    if (blast.visible) { momPos(P.hit, blast.position); blast.scale.setScalar(0.6 + bk * 3); blast.material.opacity = 0.75 * (1 - bk) * (1 - bk); }
    for (const b of bolts) {
      const k = (tt - b.launch) / (b.th - b.launch);
      b.m.visible = k > 0 && k < (b === bolts[2] ? 1 : 1.6);
      if (!b.m.visible) continue;
      b.m.position.lerpVectors(b.from, b.to, k);
      tmpB.subVectors(b.to, b.from).normalize();
      b.m.quaternion.setFromUnitVectors(upY, tmpB);
      if (rnd() < 0.9) spawn(b.m.position.x, b.m.position.y, b.m.position.z, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, 0.6, 3);
    }
  }

  /* ---------- embers and first fire (additive points) ---------- */
  const PN = 700, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN), pKind = new Uint8Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const pMat = new THREE.PointsMaterial({ size: 0.16, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; scene.add(pts);
  let pNext = 0;
  function spawn(x, y, z, vx, vy, vz, life, kind) { const i = pNext; pNext = (pNext + 1) % PN; pPos.set([x, y, z], i * 3); pVel.set([vx, vy, vz], i * 3); pLife[i] = pMax[i] = life; pKind[i] = kind; }
  function stepParticles(dt) {
    for (let i = 0; i < PN; i++) {
      const j = i * 3;
      if (pLife[i] <= 0) { pPos[j + 1] = -99; continue; }
      pLife[i] -= dt;
      const drag = pKind[i] === 2 ? 2.2 : pKind[i] === 3 ? 1.5 : 0.5;
      pVel[j] *= 1 - drag * dt; pVel[j + 2] *= 1 - drag * dt;
      pVel[j + 1] = pVel[j + 1] * (1 - drag * dt) + (pKind[i] === 1 ? -6 : 0.6) * dt;
      pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
      const age = 1 - Math.max(0, pLife[i]) / pMax[i], f = Math.pow(1 - age, 1.4);
      pCol[j] = f; pCol[j + 1] = f * (pKind[i] === 2 ? 0.9 - age * 0.6 : 0.5 - age * 0.3); pCol[j + 2] = f * Math.max(0, 0.4 - age * 1.5);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  }

  /* ---------- timeline (seconds) ---------- */
  /* prologue (the mother) runs 0-S, then the hatching (the old 10 s timeline shifted by S) */
  const S = 6, HEART = 3.6;
  const T = { crack: S + 2.2, burst: S + 4.3, roar: S + 7.2, lift: S + 8.6, card: S + 11.6, end: S + 13 };
  const LINES = [['p1', 0.4, 4.6], ['p2', 5.0, T.burst - 0.2], ['p3', T.burst + 0.9, T.burst + 3.8], ['p4', T.roar + 0.6, T.card - 0.2]];
  let hitDone = false, snap = 0;
  let t = 0, burst = false, ambientAcc = 0, fireAcc = 0;
  function reset() {
    t = 0; burst = false; crackDrawn = -1; fireAcc = 0; mom.flash = 0;
    for (const s of shards) { s.m.position.copy(s.home); s.m.rotation.set(0, 0, 0); s.m.visible = true; s.rest = false; }
    egg.rotation.set(0, 0, 0); egg.position.set(0, 0, 0); egg.scale.setScalar(EGG_K);
    hero.root.visible = false; flash.intensity = 0; eggMat.emissiveIntensity = 1;
    pLife.fill(0);
  }
  function doBurst() {
    burst = true; flash.intensity = 7;
    const r = mulberry(5);
    for (const s of shards) {
      const out = new V3(s.home.x, 0, s.home.z).normalize();
      const k = 2.2 + r() * 2.2;
      s.v.set(out.x * k + (r() - 0.5), 2.8 + r() * 2.8 + (s.home.y > 1.6 ? 1.5 : 0), out.z * k + (r() - 0.5));
      s.w.set((r() - 0.5) * 12, (r() - 0.5) * 12, (r() - 0.5) * 12);
    }
    for (let i = 0; i < 160; i++) { const a = rnd() * Math.PI * 2, sp = 1 + rnd() * 4; spawn(0, 0.8, 0, Math.cos(a) * sp * 0.6, 1.5 + rnd() * 3, Math.sin(a) * sp * 0.6, 0.8 + rnd() * 1.2, 1); }
    hero.root.visible = true;
  }


  /* ---------- camera ---------- */
  let portrait = false;
  function resize(w, h) { portrait = w < h; camera.aspect = w / h; camera.fov = w < h ? 58 : 42; camera.updateProjectionMatrix(); }
  const look = new V3(0, 1.2, 0), lookT = new V3();

  /* ---------- one step of the scene ---------- */
  function update(dt) {
    t += dt;
    // heartbeat, then cracks, wobble before the break
    const beat = t < HEART ? 0 : (Math.pow(Math.max(0, Math.sin(t * 5.2)), 12) + Math.pow(Math.max(0, Math.sin(t * 5.2 - 0.6)), 12) * 0.6) * ease((t - HEART) / 1.5);
    const pre = t < T.burst;
    const crackP = ease((t - T.crack) / (T.burst - T.crack - 0.15));
    if (pre) {
      drawCracks(crackP, 0.25 + 0.15 * ease((t - HEART) / 2) + beat * (0.8 + crackP));
      heart.intensity = beat * (0.8 + crackP * 2.5);
      const wob = (t > HEART + 1 ? 0.04 : 0) + crackP * 0.12, k = Math.sin(t * (9 + crackP * 14)) * wob * (0.4 + beat);
      egg.rotation.z = k; egg.rotation.x = Math.sin(t * 7.3) * wob * 0.5;
      egg.scale.setScalar(EGG_K * (1 + beat * 0.015));
      if (crackP > 0 && rnd() < dt * 18 * crackP) spawn((rnd() - 0.5) * 0.7, 0.45 + rnd() * 0.6, 0.3 + rnd() * 0.15, (rnd() - 0.5) * 1.5, 1 + rnd(), 0.5 + rnd(), 0.5 + rnd() * 0.4, 1);
    } else if (!burst) doBurst();

    if (burst) {
      egg.rotation.set(0, 0, 0); egg.scale.setScalar(EGG_K);
      heart.intensity = Math.max(0, heart.intensity - dt * 3);
      flash.intensity = Math.max(0, flash.intensity - dt * 6);
      eggMat.emissiveIntensity = Math.max(0.25, eggMat.emissiveIntensity - dt * 0.4);
      for (const s of shards) {
        if (s.rest) continue;
        s.v.y -= 9.8 * dt; s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
        if (s.m.position.y < 0.15) {
          s.m.position.y = 0.15; s.v.y *= -0.3; s.v.x *= 0.5; s.v.z *= 0.5; s.w.multiplyScalar(0.5);
          if (Math.abs(s.v.y) < 0.4) { s.rest = true; s.m.rotation.x = Math.round(s.m.rotation.x / Math.PI) * Math.PI + 0.3; }
        }
      }
      // hatchling: climbs out nose up, unfolds its wings, first breath, lifts off
      const u = t - T.burst;
      const rise = ease(u / 1.6), lift = ease((t - T.lift) / 1.8);
      const sc = 0.085 + 0.04 * ease(u / 2.5);
      hero.root.scale.setScalar(sc);
      hero.root.position.set(lift * -0.3, 0.25 + rise * 0.5 + lift * 0.7 + Math.sin(t * 3) * 0.04 * lift, 0.05 - lift * 0.4);
      const pitch = 1.25 - rise * 0.75 - lift * 0.25;
      hero.root.rotation.set(-pitch, 0.35 + Math.sin(t * 0.8) * 0.15 - lift * 0.9, Math.sin(t * 1.3) * 0.08, 'YXZ');
      const fold = 1 - ease((u - 0.4) / 1.8), amp = 0.15 + 0.85 * ease((u - 1.2) / 2);
      const roar = t > T.roar && t < T.roar + 1.1;
      hero.anim(t, dt, { phase: t * (4 + amp * 4), amp, mouth: roar, turn: 0, look: -0.6 });
      for (const w of hero.wings) { w.arm.rotation.z += 1.25 * fold; w.fore.rotation.z -= 2.4 * fold; }
      hero.root.updateMatrixWorld(true);
      if (roar) {
        hero.mouth.getWorldPosition(mouthW);
        const dir = new V3(0, 0, 1).applyQuaternion(hero.head.getWorldQuaternion(new THREE.Quaternion()));
        fireAcc += dt * 140;
        while (fireAcc >= 1) { fireAcc--; const j = 0.25; spawn(mouthW.x, mouthW.y, mouthW.z, (dir.x + (rnd() - 0.5) * j) * 4, (dir.y + (rnd() - 0.5) * j) * 4, (dir.z + (rnd() - 0.5) * j) * 4, 0.35 + rnd() * 0.2, 2); }
        heart.position.copy(mouthW); heart.intensity = 1.5;
      } else heart.position.set(0, 0.7, 0.8);
    }

    poseMother(t, dt); poseBolts(t);
    if (Math.abs(t - P.hit) < dt * 1.5 && !hitDone) { hitDone = true; for (let i = 0; i < 60; i++) { const q = momPos(P.hit, tmpA); spawn(q.x, q.y, q.z, (rnd() - 0.5) * 9, (rnd() - 0.5) * 9, (rnd() - 0.5) * 9, 0.7 + rnd() * 0.6, 3); } }
    if (t < P.hit) hitDone = false;
    // fog opens while the camera looks out of the crater, closes again over the egg
    const open = 0;
    scene.fog.near = FOG.near + (FOG_OPEN.near - FOG.near) * open; scene.fog.far = FOG.far + (FOG_OPEN.far - FOG.far) * open;
    // the lair grows cold after she is gone, until the heartbeat starts
    const cold = 0;
    sky.material.uniforms.dim.value = 1 - cold * 0.45;
    sky.position.copy(camera.position);
    // drifting embers from the lava seams
    ambientAcc += dt * 14;
    while (ambientAcc >= 1) { ambientAcc--; const a = rnd() * Math.PI * 2, d = 3.5 + rnd() * 5; spawn(Math.cos(a) * d, 0.1, Math.sin(a) * d, (rnd() - 0.5) * 0.3, 0.4 + rnd() * 0.6, (rnd() - 0.5) * 0.3, 2.5 + rnd() * 2, 0); }
    stepParticles(dt);
    lava.intensity = (2.2 + Math.sin(t * 1.7) * 0.25 + Math.sin(t * 4.1) * 0.1) * (1 - cold * 0.6);
    lava2.intensity = 1.4 * (1 - cold * 0.6);

    // camera: slow orbit, pulls back and follows the hatchling after the burst
    const orbit = reduce ? 0.75 : 0.75 + t * 0.03;
    const back = burst ? ease((t - T.burst) / 3) : 0, up = ease((t - T.lift) / 2.5);
    const R = (7.2 + back * 0.4 - (pre ? crackP * 0.8 : 0)) * (portrait ? 1.45 : 1);
    camera.position.set(Math.sin(orbit) * R, (2.6 + back * 0.4 + up * 0.4) * (portrait ? 1.4 : 1), Math.cos(orbit) * R);
    lookT.set(0, 0.7, -0.5 - (pre ? 0 : 0.4));
    if (burst) lookT.lerp(hero.root.position, ease((t - T.burst) / 1.5) * 0.5);
    if (portrait) lookT.y -= 0.45;   // tall screen: keep the nest in the lower half, the card sits at the bottom
    if (t < S) {
      // opening: wide on the curled mother and the egg (the follow terms stay 0 while she does not fly)
      const pr = portrait ? 1.35 : 1;
      const follow = ease((t - P.rise) / 1.5) * (1 - ease((t - P.gone + 0.6) / 1.6));
      const settle = ease((t - P.gone) / 4);
      const a = 0.95 + t * 0.03;
      const Rp = 8.2 * pr;
      camera.position.set(Math.sin(a) * Rp, (3.2 - follow * 1.4 - settle * 0.9) * (portrait ? 1.3 : 1), Math.cos(a) * Rp);
      lookT.set(0, 0.8, -1.1);
      if (follow > 0) { momPos(Math.min(t, P.gone), tmpA); lookT.lerp(tmpA, follow); }
      if (portrait && follow < 0.5) lookT.y -= 0.6 * (1 - follow * 2);
      // hand over smoothly to the hatching camera
      const hand = ease((t - (S - 1.5)) / 1.5);
      if (hand > 0) { camera.position.lerp(tmpB.set(Math.sin(orbit) * R, 2.6 * (portrait ? 1.4 : 1), Math.cos(orbit) * R), hand); }
    }
    look.lerp(lookT, snap > 0 ? 1 : 1 - Math.exp(-dt * (t < S ? 2.2 : 3))); if (snap > 0) snap--;
    if (!reduce && burst && t - T.burst < 0.5) camera.position.y += (rnd() - 0.5) * 0.08 * (1 - (t - T.burst) / 0.5);
    camera.lookAt(look);

    let line = '';
    for (const [k, a, b] of LINES) if (t > a && t < b) line = 'c.hatch.' + k;
    return { line, card: t > T.card, t };
  }
  /** Jump to the end: the shell bursts at once, the card shows. */
  function skip() {
    if (!burst) { t = T.burst; doBurst(); }
    t = Math.max(t, T.card + 0.01); snap = 3;
  }
  /** Frees GPU memory; the dragon segment geometry is shared with the game's own dragon, so it is kept. */
  function dispose() {
    scene.traverse(o => {
      if (o.geometry && o.geometry.type !== 'IcosahedronGeometry') o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); }
    });
  }
  reset();
  return { scene, camera, update, resize, skip, dispose, get t() { return t; }, T };
  }

  VR.hatch = { build };
})(typeof self !== 'undefined' ? self : this);
