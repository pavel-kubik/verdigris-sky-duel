/*
 * Verdigris deathmatch - client: rendering, input, lobby and peer-to-peer networking (campaign/dm/).
 * Rules: campaign/core/dm.js (VCamp 'dm'). World look: the campaign's Wildwood (render/terrain.js, flora, buildings
 * from render/settlement-view.js with no defenders), plus seeded rock pillars and food animals (render/prey-view.js).
 * Netcode as the co-op (mp/game.js): every browser flies its own dragon and sends its pose 20 times a second; the
 * host's browser runs the world (hp, fireballs, breath, bumps, food, kills, the board) and broadcasts snapshots and
 * events 20 times a second. Without the matchmaking server the host plays alone (practice).
 */
(function () {
  'use strict';
  const BUILD = 'dm.5 2026-11-06 no silent practice: host retries, says why, Practice alone; ?peer= server';
  const $ = s => document.querySelector(s);
  const t = (k, p) => (window.I18N ? I18N.t(k, p) : k);
  const C = window.VCamp;
  if (!window.THREE || !C || !window.VRender || !window.VDragon) { $('#loading').textContent = t('mp.engineFail'); return; }
  const DM = C.need('dm'), NETC = C.need('dmnet'), D = C.need('data'), TR = C.need('terrain'), WK = C.need('walk'), MT = C.need('math');
  const X = D.dm, V3 = THREE.Vector3;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
  const debug = /[?&]debug\b/.test(location.search);
  const NET_DT = 1 / 20;

  const PALETTES = [
    { body: 0x2f7f50, dark: 0x1f5c3c, belly: 0xc9bf7c, wing: 0x3f936a, horn: 0xe7dcc1, eye: 0xffd23a, ui: '#62c48a' },
    { body: 0x2e6f8f, dark: 0x1d4a63, belly: 0xd4e4e6, wing: 0x4a9cc0, horn: 0xeef4f5, eye: 0x9ff3ff, ui: '#5fb3dd' },
    { body: 0x9a6a2a, dark: 0x6b4517, belly: 0xe6cf95, wing: 0xb7853f, horn: 0x3a2a18, eye: 0xfff0a0, ui: '#d9a24f' },
    { body: 0x26302c, dark: 0x161c19, belly: 0x5fbf8f, wing: 0x2f5a4a, horn: 0xb9f5d0, eye: 0x6dffb0, ui: '#8fe0b0' },
    { body: 0x5b3d8c, dark: 0x3a2660, belly: 0xd8c7ef, wing: 0x7d5bb5, horn: 0xf0e6ff, eye: 0xffd1ff, ui: '#a98be0' },
    { body: 0xcfc6ad, dark: 0x9c937a, belly: 0xf1ead6, wing: 0xe2d9bf, horn: 0x4a4436, eye: 0xff9d3a, ui: '#e8e0c8' },
    { body: 0x8c2026, dark: 0x5a1218, belly: 0xd9a07a, wing: 0xa8343a, horn: 0x2a2121, eye: 0xffe08a, ui: '#e5484f' },
    { body: 0xb8742a, dark: 0x7a4a18, belly: 0xf0d090, wing: 0xd08a3a, horn: 0x3a2412, eye: 0xff5a2a, ui: '#ff9447' },
  ];
  const pal = c => PALETTES[((c % PALETTES.length) + PALETTES.length) % PALETTES.length];

  /* ---------- renderer / scene ---------- */
  const canvas = $('#c'), hud = $('#hud'), hx = hud.getContext('2d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
  const FOG_FAR = isTouch ? 760 : 950;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x7f8a70, isTouch ? 300 : 400, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  const sunDir = new V3(-0.55, 0.36, -0.82).normalize();
  const skyU = { top: { value: new THREE.Color(0x10283a) }, mid: { value: new THREE.Color(0x4f6f72) }, bot: { value: new THREE.Color(0xd09a64) }, sun: { value: sunDir } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 top,mid,bot,sun;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.?mix(mix(bot,mid,smoothstep(0.,.2,h)),top,smoothstep(.2,.75,h)):mix(bot,mid*.55,smoothstep(0.,-.25,h));float s=max(dot(vP,sun),0.);c+=vec3(1.,.82,.55)*(pow(s,600.)*2.5+pow(s,10.)*.28);gl_FragColor=vec4(c,1.);}',
  }));
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xa6cbc4, 0x3b2a1a, 0.9));
  const sunLight = new THREE.DirectionalLight(0xffd6a0, 1.25); sunLight.position.copy(sunDir).multiplyScalar(300); scene.add(sunLight);
  const rim = new THREE.DirectionalLight(0x7fb7ff, 0.35); rim.position.set(200, 120, 250); scene.add(rim);

  /* ---------- the arena: Wildwood terrain, trees, buildings, pillars ---------- */
  const A = DM.arena();
  const region = VRender.terrain.build(X.region, { isTouch, flora: isTouch ? 0.5 : 1, far: FOG_FAR, particles: isTouch ? 0.5 : 1 });
  scene.add(region.group);
  scene.fog.color.set(region.fog);
  if (region.sky) { skyU.top.value.set(region.sky.top); skyU.mid.value.set(region.sky.mid); skyU.bot.value.set(region.sky.bot); }
  const townView = VRender.settlements.build(A.town);
  scene.add(townView.group);
  /* the living forest (shared/forest.js): the same trees and rules as in the campaign and the co-op. A dragon's own
     browser decides what it fells and sets alight and tells the host, who tells everyone (by tree number). */
  const Fo = region.forest;
  const E = DM.env(region.trees, Fo);
  const treeOut = [];
  function treeApply(k, id, dx, dz) { const i = Fo.byId.get(id); if (i != null) VForest.apply(Fo, { e: k === 'f' ? 'fell' : 'ignite', i, dx, dz, g: 0 }); }
  (function pillars() {
    const n = A.pillars.length;
    const rockG = new THREE.CylinderGeometry(0.62, 1, 1, 7, 3); rockG.translate(0, 0.5, 0);
    const capG = new THREE.CylinderGeometry(0.72, 0.62, 1, 7); capG.translate(0, -0.5, 0);
    const rockM = new THREE.MeshStandardMaterial({ color: 0x8a7d6a, flatShading: true, roughness: 1 }), capM = new THREE.MeshStandardMaterial({ color: 0x5d8a4c, flatShading: true, roughness: 1 });
    if (window.VTex) { VTex.detail(rockM, { map: 'rock', scale: 9, strength: 0.8, bump: 1.6 }); VTex.detail(capM, { map: 'ground', scale: 6, strength: 0.7, bump: 1 }); }
    const rock = new THREE.InstancedMesh(rockG, rockM, n);
    const cap = new THREE.InstancedMesh(capG, capM, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0);
    A.pillars.forEach((p, i) => {
      q.setFromAxisAngle(up, p.id * 1.7);
      // the top of the rock is r x 0.62 wide; the cap is the flat perch (r wide at the top)
      rock.setMatrixAt(i, m.compose(new V3(p.x, p.base, p.z), q, new V3(p.r / 0.62 * 1.0, p.top - p.base - 1.2, p.r / 0.62 * 1.0)));
      cap.setMatrixAt(i, m.compose(new V3(p.x, p.top, p.z), q, new V3(p.r / 0.72 * 1.0, 1.4, p.r / 0.72 * 1.0)));
    });
    [rock, cap].forEach(o => { o.instanceMatrix.needsUpdate = true; scene.add(o); });
  })();
  const preyView = VRender.prey.build();
  scene.add(preyView.group);

  /* ---------- particles (visual only) ---------- */
  const PMAX = 3000;
  const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pA = new Float32Array(PMAX), pS = new Float32Array(PMAX);
  const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pS0 = new Float32Array(PMAX), pGrow = new Float32Array(PMAX), pKind = new Uint8Array(PMAX), pDrag = new Float32Array(PMAX);
  let pN = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('pcolor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('alpha', new THREE.BufferAttribute(pA, 1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pS, 1).setUsage(THREE.DynamicDrawUsage));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 500 } },
    vertexShader: 'attribute vec3 pcolor;attribute float alpha;attribute float size;uniform float uScale;varying vec3 vC;varying float vA;void main(){vC=pcolor;vA=alpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*uScale/max(-mv.z,.1);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying vec3 vC;varying float vA;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float a=smoothstep(.5,.05,d)*vA;gl_FragColor=vec4(vC*a,a);}',
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  // kinds: 0 fire, 1 dust (pale, falls), 2 spark, 3 feathers (white)
  function spawnP(x, y, z, vx, vy, vz, life, size, grow, kind, drag) {
    if (pN >= PMAX) return; const i = pN++, k = i * 3;
    pPos[k] = x; pPos[k + 1] = y; pPos[k + 2] = z; pVel[k] = vx; pVel[k + 1] = vy; pVel[k + 2] = vz;
    pLife[i] = pMax[i] = life; pS0[i] = size; pGrow[i] = grow; pKind[i] = kind; pDrag[i] = drag || 0;
  }
  function killP(i) {
    const l = --pN; if (i === l) return; const k = i * 3, m = l * 3;
    for (let q = 0; q < 3; q++) { pPos[k + q] = pPos[m + q]; pVel[k + q] = pVel[m + q]; }
    pLife[i] = pLife[l]; pMax[i] = pMax[l]; pS0[i] = pS0[l]; pGrow[i] = pGrow[l]; pKind[i] = pKind[l]; pDrag[i] = pDrag[l];
  }
  function burst(p, n, kind, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const v = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      spawnP(p[0], p[1], p[2], v.x, v.y + (kind === 3 ? 3 : 0), v.z, life * (0.5 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), kind === 3 ? 0.2 : 1.5, kind, 1.6);
    }
  }
  function breathFx(from, f, vel, dt) {
    const n = Math.ceil(dt * 70);
    for (let i = 0; i < n; i++) {
      const sp = 0.12, s = 62 + Math.random() * 12;
      spawnP(from.x, from.y, from.z, (f[0] + (Math.random() - .5) * sp) * s + vel[0] * 0.9, (f[1] + (Math.random() - .5) * sp) * s + vel[1] * 0.9, (f[2] + (Math.random() - .5) * sp) * s + vel[2] * 0.9, 0.55 + Math.random() * 0.2, 1.1, 4.5, 0, 1.1);
    }
  }
  function updateParticles(dt) {
    for (let i = 0; i < pN; i++) {
      pLife[i] -= dt;
      if (pLife[i] <= 0) { killP(i); i--; continue; }
      const k = i * 3, dr = Math.max(0, 1 - pDrag[i] * dt), kind = pKind[i];
      pVel[k] *= dr; pVel[k + 1] *= dr; pVel[k + 2] *= dr;
      if (kind === 1 || kind === 3) pVel[k + 1] -= (kind === 3 ? 3 : 9) * dt;
      pPos[k] += pVel[k] * dt; pPos[k + 1] += pVel[k + 1] * dt; pPos[k + 2] += pVel[k + 2] * dt;
      const tt = pLife[i] / pMax[i];
      pS[i] = pS0[i] * (1 + pGrow[i] * (1 - tt));
      pA[i] = Math.min(1, tt * 1.6) * (kind === 2 ? 1 : kind === 0 ? 0.85 : 0.55);
      if (kind === 0) { pCol[k] = 1; pCol[k + 1] = 0.18 + 0.75 * tt * tt; pCol[k + 2] = 0.05 + 0.45 * tt * tt * tt; }
      else if (kind === 1) { pCol[k] = 0.62; pCol[k + 1] = 0.55; pCol[k + 2] = 0.44; }
      else if (kind === 3) { pCol[k] = 0.95; pCol[k + 1] = 0.93; pCol[k + 2] = 0.88; }
      else { pCol[k] = 1; pCol[k + 1] = 0.9 * tt + 0.4 * (1 - tt); pCol[k + 2] = 0.5 * tt; }
    }
    pGeo.setDrawRange(0, pN);
    ['position', 'pcolor', 'alpha', 'size'].forEach(n => { pGeo.attributes[n].needsUpdate = true; });
  }

  /* ---------- view state ---------- */
  const makeDragon = c => VDragon.makeDragon(c);
  const fbGeo = new THREE.IcosahedronGeometry(1, 1), fbMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const ballViews = new Map();
  const view = { players: new Map(), food: new Map(), myId: 0, myColor: 0, hp: X.hp, myDown: false, rows: [], names: {}, colors: {}, tl: X.timeLimit, fl: X.fragLimit, tm: X.timeLimit, ph: null, hid: 1, over: false, winner: 0 };
  let mode = 'lobby', pilot = DM.newPilot([0, 90, 0], 0), hero = makeDragon(PALETTES[0]);
  const heroPose = {};
  scene.add(hero.root);
  let menuOpen = false;
  let time = 0, shake = 0, hurt = 0, bannerT = 0, phase = 0, deadAt = 0, killerId = 0, promptT = 0;

  function remoteView(id, color) {
    let e = view.players.get(id);
    if (!e || e.color !== color) {
      if (e) e.d.dispose();
      const d = makeDragon(pal(color)); scene.add(d.root);
      e = { d, color, pos: new V3(), tp: new V3(), vel: new V3(), yaw: 0, pitch: 0, roll: 0, ty: 0, tpi: 0, tr: 0, t: 0, age: 0, init: false, phase: Math.random() * 6, pose: {}, md: 0 };
      view.players.set(id, e);
    }
    return e;
  }
  function setTarget(e, x, y, z, yaw, pitch, roll, tt) {
    if (!e.init) { e.pos.set(x, y, z); e.tp.set(x, y, z); e.yaw = yaw; e.pitch = pitch; e.roll = roll; e.init = true; }
    else { const dts = tt - e.t; if (dts > 0.001) e.vel.set((x - e.tp.x) / dts, (y - e.tp.y) / dts, (z - e.tp.z) / dts); e.tp.set(x, y, z); }
    e.t = tt; e.age = 0; e.ty = yaw; e.tpi = pitch; e.tr = roll;
  }
  const lerpAngle = (a, b, k) => a + MT.wrap(b - a) * k;
  const tmpV = new V3(), mouthW = new V3(), fwdV = new V3();
  function smooth(e, dt) {
    e.age += dt;
    const k = 1 - Math.exp(-dt * 14), lead = e.md === 2 ? 0 : Math.min(e.age, 0.25);
    e.pos.lerp(tmpV.copy(e.tp).addScaledVector(e.vel, lead), k);
    e.yaw = lerpAngle(e.yaw, e.ty, k); e.pitch += (e.tpi - e.pitch) * k; e.roll = lerpAngle(e.roll, e.tr, k);
    e.d.root.position.copy(e.pos); e.d.root.rotation.set(-e.pitch, e.yaw, e.roll, 'YXZ');
  }

  function applySnapshot(s) {
    view.tl = s.tl; view.fl = s.fl; view.tm = s.tm; view.ph = s.ph; view.hid = s.hid; view.rows = s.P; view.over = !!s.o;
    const seen = new Set();
    s.P.forEach(r => {
      const [id, x, y, z, yaw, pitch, roll, rx, br, hp, down, color, name, sx, , , , md, inv] = r;
      view.names[id] = name; view.colors[id] = color;
      if (id === view.myId) { view.hp = hp; view.myDown = !!down; return; }
      seen.add(id);
      const e = remoteView(id, color);
      setTarget(e, x, y, z, yaw, pitch, roll + rx, s.t);
      e.br = !!br; e.hp = hp; e.down = !!down; e.name = name; e.sx = sx; e.md = md; e.inv = !!inv;
    });
    view.players.forEach((e, id) => { if (!seen.has(id)) { e.d.dispose(); view.players.delete(id); } });
    const seenF = new Set();
    s.F.forEach(r => {
      const [id, ti, x, z, yaw, speed] = r;
      seenF.add(id);
      let f = view.food.get(id);
      if (!f) { f = { id, type: DM.FOOD_TYPES[ti] || 'chicken', state: 'graze', pos: [x, TR.surfaceAt(X.region, x, z), z], tx: x, tz: z, yaw, tyaw: yaw, speed, t: Math.random() * 5, size: 1, cook: 0 }; view.food.set(id, f); }
      f.tx = x; f.tz = z; f.tyaw = yaw; f.speed = speed; f.state = speed > 5 ? 'flee' : 'graze';
    });
    view.food.forEach((f, id) => { if (!seenF.has(id)) view.food.delete(id); });
  }
  const nameOf = id => (id === view.myId ? t('mp.you') : (view.names[id] || t('mp.aDragon')));
  function applyEvents(evs) {
    evs.forEach(ev => {
      switch (ev.e) {
        case 'ball': {
          const m = new THREE.Mesh(fbGeo, fbMat); m.scale.setScalar(0.9);
          m.position.set(ev.p[0], ev.p[1], ev.p[2]); scene.add(m);
          ballViews.set(ev.id, { m, v: new V3(ev.v[0], ev.v[1], ev.v[2]), o: ev.o, life: 5 });
          break;
        }
        case 'pop': {
          const b = ballViews.get(ev.id); if (b) { scene.remove(b.m); ballViews.delete(ev.id); }
          burst(ev.p, ev.h ? 40 : 12, 0, ev.h ? 20 : 8, 2.2, 0.6);
          VForest.blast(Fo, ev.p, X.ball.splashR);              // a bursting fireball sets the trees around it alight (in every browser)
          break;
        }
        case 'tree': treeApply(ev.k, ev.i, ev.dx, ev.dz); break;
        case 'hurt':
          if (ev.pl === view.myId) { hurt = Math.min(1, hurt + 0.6); shake = Math.max(shake, ev.k === 'breath' ? 0.15 : 0.45); hero.flash = 1; }
          else { const p = view.players.get(ev.pl); if (p) p.d.flash = 1; }
          break;
        case 'kill': {
          const mine = ev.by === view.myId, me = ev.pl === view.myId;
          const how = t('dm.how.' + ev.k);
          if (ev.by) feed(t('dm.feed.kill', { a: nameOf(ev.by), b: nameOf(ev.pl), how }), mine || me);
          else feed(t('dm.feed.crashed', { b: nameOf(ev.pl) }), me);
          if (me) {
            pilot.mode = 'down'; pilot.breathing = pilot.boosting = false; pilot.landed = false; deadAt = time; killerId = ev.by;
            showBanner(ev.by ? t('dm.killedBy', { name: ev.kn }) : t('dm.youCrashed'), t('mp.backIn', { t: ev.t }));
          } else if (mine) showBanner(t('dm.youKilled', { name: ev.name }), t('dm.plusOne'));
          const e = view.players.get(ev.pl); if (e) burst([e.pos.x, e.pos.y, e.pos.z], 30, 0, 14, 2, 0.7);
          break;
        }
        case 'spawn':
          if (ev.pl === view.myId) {
            const st = pilot.st; pilot = DM.newPilot(ev.p, ev.y); pilot.st = Math.max(st, 60); pilot.inv = X.spawnInv;
            snapCam();
          }
          break;
        case 'bump': {
          burst(ev.p, 24, 2, 14, 1.2, 0.5);
          if (ev.a === view.myId || ev.b === view.myId) {
            const other = ev.a === view.myId ? ev.b : ev.a;
            if (pilot.mode !== 'down') DM.startFall(pilot, ev.a === view.myId ? ev.pa : ev.pb, 'bump');
            shake = Math.max(shake, 0.8);
            flashPrompt(t('dm.bumped', { name: nameOf(other) }), 2);
          }
          break;
        }
        case 'eat':
          burst(ev.p.map((v, i) => (i === 1 ? v + 1 : v)), 26, 3, 6, 0.9, 1.2);
          if (ev.pl === view.myId) feed(t('dm.feed.ate', { what: t('dm.food.' + ev.type), n: ev.gain }), true);
          break;
        case 'join': if (ev.pl !== view.myId) feed(t('mp.feed.join', { name: ev.name })); break;
        case 'left': feed(t('mp.feed.left', { name: ev.name })); break;
        case 'over':
          view.over = true; view.winner = ev.winner;
          showBoard(true, ev.board);
          break;
        case 'start':
          VForest.reset(Fo);
          showBanner(t('dm.start'), t('dm.goal', { n: ev.fl }));
          feed(t('dm.feed.start'), true);
          break;
        case 'restart':
          view.over = false; view.winner = 0; VForest.reset(Fo);
          $('#boardPanel').hidden = true; boardOpen = false;
          ballViews.forEach(b => scene.remove(b.m)); ballViews.clear();
          showBanner(t('dm.newRound'), t('dm.room.waitShort'));
          break;
      }
    });
  }

  /* ---------- HUD helpers ---------- */
  const banner = $('#banner'), feedEl = $('#feed'), promptEl = $('#prompt');
  function showBanner(a, b) { banner.textContent = a; if (b) { const s = document.createElement('small'); s.textContent = b; banner.appendChild(s); } banner.style.opacity = 1; bannerT = 2.6; }
  function feed(text, mine) {
    const d = document.createElement('div'); d.textContent = text; if (mine) d.style.color = 'var(--ember)';
    feedEl.prepend(d);
    while (feedEl.children.length > 5) feedEl.lastChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, 4200);
  }
  function flashPrompt(text, s) { promptEl.textContent = text; promptEl.hidden = false; promptT = s; }
  /** Rows from the snapshot, in board order (as DM.board). */
  function boardRows() {
    return view.rows.map(r => ({ id: r[0], name: r[12], color: r[11], kills: r[14], deaths: r[15], score: r[16], down: !!r[10] }))
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
  }
  function renderMini() {
    const el = $('#mini'); el.textContent = '';
    const rows = boardRows(), meAt = rows.findIndex(r => r.id === view.myId);
    const show = rows.slice(0, isTouch ? 3 : 5);
    if (meAt >= show.length) show.push(rows[meAt]);
    show.forEach(r => {
      const i = rows.indexOf(r);
      const row = document.createElement('div'); row.className = 'brow' + (r.id === view.myId ? ' me' : '') + (r.down ? ' down' : '');
      const n = document.createElement('small'); n.textContent = (i + 1) + '.';
      const dot = document.createElement('i'); dot.style.background = pal(r.color).ui;
      const b = document.createElement('b'); b.textContent = r.name;
      const em = document.createElement('em'); em.textContent = r.score;
      row.append(n, dot, b, em); el.appendChild(row);
    });
  }
  let boardOpen = false;
  function showBoard(final, rows) {
    rows = rows || boardRows();
    boardOpen = true;
    const body = $('#boardRows'); body.textContent = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr'); if (r.id === view.myId) tr.className = 'me';
      const c0 = document.createElement('td'); c0.textContent = i + 1;
      const c1 = document.createElement('td'); const dot = document.createElement('i'); dot.style.background = pal(r.color).ui; c1.append(dot, document.createTextNode(r.name + (r.id === view.myId ? t('mp.youTag') : '')));
      const ck = document.createElement('td'); ck.className = 'n'; ck.textContent = r.kills;
      const cd = document.createElement('td'); cd.className = 'n'; cd.textContent = r.deaths;
      const cs = document.createElement('td'); cs.className = 'n'; cs.textContent = r.score;
      tr.append(c0, c1, ck, cd, cs); body.appendChild(tr);
    });
    const win = final ? rows.find(r => r.id === view.winner) : null;
    $('#boardEyebrow').textContent = final ? t('dm.board.final') : t('dm.board.title');
    $('#boardTitle').textContent = win ? (win.id === view.myId ? t('dm.youWin') : t('dm.wins', { name: win.name })) : final ? t('dm.draw') : t('dm.goal', { n: view.fl });
    $('#boardNote').textContent = final ? (N.role === 'host' ? t('dm.board.hostNote') : t('dm.board.wait')) : t('dm.board.rule');
    $('#againBtn').hidden = !(final && N.role === 'host');
    $('#leave2Btn').hidden = !final;
    $('#boardClose').hidden = final;
    $('#boardPanel').hidden = false;
  }
  function hideBoard() { if (view.over) return; boardOpen = false; $('#boardPanel').hidden = true; }

  /* ---------- input ---------- */
  const keys = {}, touch = { x: 0, y: 0, breath: false, boost: false };
  let mouseBreath = false, takeoffReq = false;
  const typing = () => document.activeElement && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
  addEventListener('keydown', e => {
    if (typing()) { if (e.code === 'Enter' && document.activeElement === $('#codeIn')) $('#joinBtn').click(); return; }
    if (mode !== 'game') return;
    if (e.code === 'Escape') { if (qrOpen) closeQr(); else if (boardOpen && !view.over) hideBoard(); else toggleMenu(); return; }
    if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) { if (boardOpen) hideBoard(); else showBoard(false); } return; }
    if (e.repeat && /^Key[FQER]$/.test(e.code)) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (menuOpen) return;
    if (e.code === 'KeyR') fireBall();
    if (e.code === 'KeyF') landOrFly();
    if (e.code === 'KeyQ') DM.tryRoll(pilot, -1);
    if (e.code === 'KeyE') DM.tryRoll(pilot, 1);
    if (debug) debugKey(e.code);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseBreath = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'game' || menuOpen || e.pointerType !== 'mouse') return;
    if (e.button === 0) mouseBreath = true;
    if (e.button === 2) fireBall();
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouseBreath = false; });
  const stick = $('#stick'), nub = $('#nub'); let stickId = null;
  function stickMove(e) { const r = stick.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const R = r.width / 2 - 10, l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } nub.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; touch.x = dx / R; touch.y = -dy / R; }
  stick.addEventListener('pointerdown', e => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; touch.x = touch.y = 0; nub.style.transform = ''; };
  stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);
  function holdBtn(id, prop) {
    const b = $(id);
    const on = e => { e.preventDefault(); touch[prop] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) { } };
    const off = () => { touch[prop] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  }
  holdBtn('#bBreath', 'breath'); holdBtn('#bBoost', 'boost');
  $('#bBall').addEventListener('pointerdown', e => { e.preventDefault(); fireBall(); });
  $('#bRoll').addEventListener('pointerdown', e => { e.preventDefault(); DM.tryRoll(pilot, touch.x < -0.2 ? -1 : 1); });
  $('#bLand').addEventListener('pointerdown', e => { e.preventDefault(); landOrFly(); });
  function readInput() {
    if (menuOpen) return { sx: 0, sy: 0, breath: false, boost: false };
    const inp = {
      sx: MT.clamp(((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) + touch.x, -1, 1),
      sy: MT.clamp(((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0) + touch.y, -1, 1),
      breath: !!(keys.Space || mouseBreath || touch.breath),
      boost: !!(keys.ShiftLeft || keys.ShiftRight || touch.boost),
      takeoff: takeoffReq,
    };
    takeoffReq = false;
    return inp;
  }
  /** F / Sit: sit down when low enough, take off when sitting. */
  function landOrFly() {
    if (mode !== 'game' || menuOpen) return;
    if (pilot.mode === 'perch') {
      if (pilot.stun > 0) flashPrompt(t('dm.prompt.stunned'), 1.2);
      else takeoffReq = true;
      return;
    }
    const why = DM.tryPerch(pilot, E);
    if (why === 'high') flashPrompt(t('dm.prompt.tooHigh'), 1.4);
    else if (why === 'water') flashPrompt(t('dm.prompt.water'), 1.4);
  }
  function fireBall() {
    if (mode !== 'game' || menuOpen || view.over || !DM.tryBall(pilot)) return;
    const f = MT.fwd(pilot.yaw, pilot.mode === 'perch' ? 0 : pilot.pitch); fwdV.set(f[0], f[1], f[2]);
    let best = null, bestA = X.ball.aim;
    view.players.forEach(e => {
      if (e.down) return;
      tmpV.subVectors(e.pos, mouthW); const d = tmpV.length(); if (d > X.ball.aimRange) return;
      const a = tmpV.normalize().angleTo(fwdV); if (a < bestA) { bestA = a; best = e; }
    });
    const dir = fwdV.clone();
    if (best) { const tt = best.pos.distanceTo(mouthW) / X.ball.speed; dir.copy(best.pos).addScaledVector(best.vel, tt).sub(mouthW).normalize(); }
    const from = [mouthW.x, mouthW.y, mouthW.z], d = [dir.x, dir.y, dir.z];
    N.shoot(from, d);
    burst(from, 14, 0, 8, 1.6, 0.35);
    hero.jaw.rotation.x = 0.7;
  }
  /** Local crash / impact damage goes to the host (the host's own: straight into the world). */
  function reportLocal(evs) {
    evs.forEach(ev => {
      if (ev.e === 'tree') { treeOut.push({ k: 'f', i: Fo.ids[ev.i], dx: ev.dx, dz: ev.dz }); return; }
      if (ev.e === 'crash') {
        shake = Math.max(shake, ev.soft ? 0.5 : 0.9);
        burst([pilot.pos[0], pilot.pos[1], pilot.pos[2]], 30, 1, 10, 2.2, 0.9);
        flashPrompt(t('dm.crash.' + ev.kind), 2);
      }
      if (ev.e === 'impact') {
        shake = Math.max(shake, ev.dmg > 0 ? 0.7 : 0.3);
        burst([pilot.pos[0], pilot.pos[1] - X.stand, pilot.pos[2]], ev.water ? 20 : 40, ev.water ? 3 : 1, 12, 2.6, 1.0);
      }
      if ((ev.e === 'crash' || ev.e === 'impact') && ev.dmg > 0) {
        N.crash(ev.dmg, ev.e);
      }
    });
  }

  /* ---------- debug (?debug): keys and window.__vdm ---------- */
  function debugKey(code) {
    if (code === 'Digit1') { pilot.pos = [A.homes[0][0], TR.surfaceAt(X.region, A.homes[0][0], A.homes[0][1]) + 6, A.homes[0][1] - 20]; pilot.yaw = 0; pilot.mode = 'air'; }
    if (code === 'Digit2') { const p = A.pillars[0]; pilot.pos = [p.x, p.top + 5, p.z - 30]; pilot.yaw = 0; pilot.pitch = 0; pilot.mode = 'air'; }
    if (code === 'Digit3') { const b = A.town.buildings[0]; pilot.pos = [b.pos[0], b.pos[1] + b.h + 5, b.pos[2] - 30]; pilot.yaw = 0; pilot.mode = 'air'; }
    const world = N.role === 'host' ? N.world : null;
    if (code === 'Digit4' && world) { const pl = world.players[view.myId]; if (pl) DM.damage(world, pl, 25, 0, 'crash'); }
    if (code === 'Digit5' && world) { if (!world.players[99]) DM.addPlayer(world, 99, 'Dummy'); const d = world.players[99]; d.sinv = 0; d.down = false; const f = MT.fwd(pilot.yaw, 0); d.pos = [pilot.pos[0] + f[0] * 40, pilot.pos[1], pilot.pos[2] + f[2] * 40]; d.yaw = pilot.yaw + Math.PI; d.mode = 2; }
    if (code === 'Digit6' && world) DM.endMatch(world);
  }

  /* ---------- networking: core/dmnet.js runs the room (join / claim, host take-over, step-down, merging);
   * this part keeps the identity and the saved room in localStorage and turns the session's events into the view. */
  const status = $('#status');
  function setStatus(s, okc) { status.textContent = s; status.className = okc ? 'ok' : ''; }
  function setBusy(b) { $('#hostBtn').disabled = b; $('#joinBtn').disabled = b; $('#rejoinBtn').disabled = b; }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { } },
  };
  function myName() {
    const n = ($('#nameIn').value || '').trim().slice(0, 16) || 'Verdigris';
    store.set(X.nameKey, n);
    return n;
  }
  const myKey = (() => {
    let tk = store.get(X.tokenKey);
    if (!tk) { tk = Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2); store.set(X.tokenKey, tk); }
    return DM.keyOf(tk);
  })();
  function inviteLink() { return location.origin + location.pathname + (peerOptions ? '?peer=' + peerParam : '') + (N.code ? '#' + N.code : ''); }

  /* the saved room: the last record from the host (or our own), kept roomKeep s */
  let recSavedAt = 0;
  function saveRoom(rec, force) {
    if (!rec || !N.code) return;
    const now = Date.now();
    if (!force && now - recSavedAt < 2000) return;
    recSavedAt = now;
    store.set(X.roomKey, JSON.stringify({ code: N.code, at: now, rec: Object.assign({}, rec, { code: N.code }) }));
  }
  function loadRoom() {
    try {
      const s = JSON.parse(store.get(X.roomKey) || 'null');
      if (s && s.rec && /^[A-Z0-9]{5}$/.test(s.code) && Date.now() - s.at < X.roomKeep * 1000) return s;
    } catch (_) { }
    return null;
  }

  const offline = /[?&]offline\b/.test(location.search);
  /* ?peer=host[:port][/path]: a PeerJS server of your own instead of the public one (it travels in the invite link) */
  const peerParam = (location.search.match(/[?&]peer=([^&#]+)/) || [])[1] || '';
  const peerOptions = (() => {
    const m = decodeURIComponent(peerParam).match(/^([a-z0-9.-]+)(?::(\d+))?(\/.*)?$/i);
    if (!m) return null;
    const port = m[2] ? +m[2] : 443;
    return { host: m[1], port, path: m[3] || '/', secure: port === 443 || location.protocol === 'https:' };
  })();
  const N = NETC.session({
    Peer: window.Peer || null, offline, peerOptions,
    clock: { now: () => performance.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: h => clearTimeout(h) },
    key: myKey, name: myName,
    pose: () => (mode === 'game' && pilot.mode !== 'down' ? DM.poseOf(pilot) : null),
    emit: onNet,
  });
  let joinCode = '';
  function onNet(ev) {
    switch (ev.t) {
      case 'hosted': {
        view.myId = N.myId;
        view.players.forEach(e => e.d.dispose()); view.players.clear();
        enterGame(ev.me.color, ev.me.pos, ev.me.yaw, ev.resume);
        if (ev.resume) showBanner(t('dm.mig.youHost'), t('dm.mig.back', { c: ev.code }));
        else if (ev.restored) showBanner(t('dm.restored', { c: ev.code }), t('dm.restoredSub'));
        else if (ev.code) showBanner(t('mp.roomBanner', { c: ev.code }), t('dm.sendLink'));
        else showBanner(t('dm.practice'), t('mp.noServerHost'));
        break;
      }
      case 'joined':
        view.myId = ev.welcome.id;
        view.players.forEach(e => e.d.dispose()); view.players.clear();
        enterGame(ev.welcome.color, ev.welcome.p, ev.welcome.y, ev.resume);
        if (ev.resume) showBanner(t('dm.mig.back', { c: ev.code }), t('dm.mig.newHost', { name: ev.welcome.host || '' }));
        else showBanner(t('mp.joined', { c: ev.code }), t('dm.room.waitShort'));
        break;
      case 'snap':
        if (mode === 'game') { applyEvents(ev.e || []); applySnapshot(ev.s); }
        break;
      case 'record': saveRoom(ev.rec); break;
      case 'forest': VForest.restore(Fo, ev.f.map(r => [Fo.byId.get(r[0]), r[1], r[2], r[3], r[4]]).filter(r => r[0] != null)); break;
      case 'migrating':
        showBanner(ev.why === 'stepdown' || ev.why === 'moved' ? t('dm.mig.moved') : t('dm.mig.lost'), t('dm.mig.finding'));
        feed(t('dm.mig.finding'));
        break;
      case 'migrateSlow':
        showBanner(t('dm.mig.slow'), t('dm.mig.slowSub'));
        feed(t('dm.mig.slow'));
        break;
      case 'hostFailed':
        setStatus(ev.err === 'nolib' ? t('mp.noLibSolo') : t('dm.hostFailed', { why: ev.err }));
        setBusy(false);
        $('#practiceBtn').hidden = false;
        try { status.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { }   // phones: below the fold
        break;
      case 'enterFailed':
        setStatus(failText(ev.err, ev.code)); setBusy(false);
        break;
    }
  }
  function failText(err, code) {
    if (err === 'full') return t('dm.full', { c: code, n: X.maxPlayers });
    if (err === 'peer-unavailable') return t('mp.noRoom', { c: code });
    if (err === 'network' || err === 'server-error' || err === 'socket-error') return t('mp.noServer');
    if (err === 'nolib') return t('mp.noLib');
    if (err === 'timeout' || err === 'closed') return t('mp.unreachable', { c: code });
    return t('mp.failed', { t: err || t('mp.unknown') });
  }

  function hostGame() {
    setBusy(true);
    $('#practiceBtn').hidden = true;
    if (!offline) setStatus(t('mp.opening'), true);
    N.host();
  }
  function joinGame() {
    const code = ($('#codeIn').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { setStatus(t('mp.badCode')); return; }
    if (!window.Peer) { setStatus(t('mp.noLib')); return; }
    setBusy(true); setStatus(t('mp.connecting', { c: code }), true);
    const saved = loadRoom();
    joinCode = code;
    N.join(code, saved && saved.code === code ? saved.rec : null);   // our saved room: host it again when it is empty
  }
  function rejoinSaved() {
    const saved = loadRoom();
    if (!saved) return;
    if (!window.Peer) { setStatus(t('mp.noLib')); return; }
    setBusy(true); setStatus(t('mp.connecting', { c: saved.code }), true);
    N.rejoin(saved.code, saved.rec);
  }

  /** Shows the game for my dragon (resume: keep flying where it is, only the colour may change). */
  function enterGame(color, pos, yaw, resume) {
    if (!resume || color !== view.myColor) {
      hero.dispose();
      hero = makeDragon(pal(color)); scene.add(hero.root);
    }
    view.myColor = color;
    view.over = false; $('#boardPanel').hidden = true; boardOpen = false;
    ballViews.forEach(b => scene.remove(b.m)); ballViews.clear();
    if (!resume || pilot.mode === 'down') {
      pilot = DM.newPilot(pos, yaw || 0);
      pilot.inv = X.spawnInv;
      snapCam();
    }
    view.myDown = false;
    mode = 'game';
    camera.clearViewOffset();
    history.replaceState(null, '', location.pathname + location.search + (N.code ? '#' + N.code : ''));
    $('#roomCode').textContent = N.code || t('mp.solo'); $('#menuCode').textContent = N.code || t('mp.solo');
    $('#roomChip').hidden = !N.code;
    $('#lobby').hidden = true; $('#hudTop').hidden = false; $('#notice').hidden = true;
    $('#legend').hidden = isTouch; $('#touch').hidden = !isTouch;
    if (!resume) menuOpen = false;
    roomSig = '';
    setStatus('');
    if (N.code) saveRoom(N.lastRec, true);
  }
  function leave() {
    N.leave();
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }
  function showNotice(title, text) {
    $('#noticeTitle').textContent = title; $('#noticeText').textContent = text;
    $('#notice').hidden = false; $('#menu').hidden = true; $('#boardPanel').hidden = true; menuOpen = true;
  }
  function toggleMenu(force) {
    menuOpen = force == null ? !menuOpen : force;
    $('#menu').hidden = !menuOpen;
    $('#linkOut').value = N.code ? inviteLink() : t('mp.soloLink');
    $('#copyBtn').disabled = !N.code;
    if (menuOpen) mouseBreath = false;
  }
  function copyLink(box) {
    const link = inviteLink();
    if (box) box.value = link;
    const fallback = () => { if (box) { box.focus(); box.select(); } feed(t('mp.feed.copyManual')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => feed(t('mp.feed.copied')), fallback);
    else fallback();
  }

  /* ---------- share via QR code (shared/qr.js): the room invite in a room, else the game's page ---------- */
  let qrOpen = false, qrUrl = '', qrMenu = false;
  function gameLink() { return location.origin + location.pathname; }
  function openQr() {
    if (!window.VQR) return;
    qrUrl = N.code ? inviteLink() : gameLink();
    $('#qrTitle').textContent = N.code ? t('dm.qr.room') : t('dm.qr.game');
    $('#qrSolo').hidden = !(mode === 'game' && !N.code);           // a practice game: the code opens the game, not this game
    $('#qrCode').textContent = N.code; $('#qrCode').hidden = !N.code;
    $('#qrLink').textContent = qrUrl;
    const code = VQR.encode(qrUrl, 'M'), cv = $('#qrCanvas'), quiet = 4;
    const cssPx = Math.min(260, innerWidth - 96, innerHeight - 330), d = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.max(2, Math.floor(Math.max(120, cssPx) * d / (code.size + quiet * 2)));
    VQR.draw(cv, code, { px, quiet, dark: '#0d1411', light: '#ffffff' });
    cv.style.width = cv.style.height = (cv.width / d) + 'px';
    $('#qrShare').hidden = !(isTouch && navigator.share);
    qrMenu = menuOpen;
    if (mode === 'game') { menuOpen = true; mouseBreath = false; $('#menu').hidden = true; }
    $('#qrPanel').hidden = false; qrOpen = true;
    $('#qrClose').focus();
  }
  function closeQr() {
    $('#qrPanel').hidden = true; qrOpen = false;
    if (mode === 'game') { menuOpen = qrMenu; $('#menu').hidden = !qrMenu; }
  }
  function copyText(link) {
    const fallback = () => feed(t('mp.feed.copyManual'));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => feed(t('mp.feed.copied')), fallback);
    else fallback();
  }
  /** Phones: the system share sheet; else copy. */
  function shareLink() {
    if (!N.code) return;
    if (isTouch && navigator.share) navigator.share({ title: t('dm.title'), text: t('dm.room.shareText', { c: N.code }), url: inviteLink() }).catch(() => { });
    else copyLink(null);
  }

  /* ---------- the room panel (lobby phase): code, invite link, who is here, host settings, Start ---------- */
  let roomSig = '', roomMin = false;
  const mins = s => Math.round(s / 60);
  (function roomSettings() {
    X.fragChoices.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; $('#setFrag').appendChild(o); });
    X.timeChoices.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = t('dm.room.min', { n: mins(n) }); $('#setTime').appendChild(o); });
    const apply = e => { N.setSettings({ fragLimit: $('#setFrag').value, timeLimit: $('#setTime').value }); e.target.blur(); roomSig = ''; };
    $('#setFrag').addEventListener('change', apply); $('#setTime').addEventListener('change', apply);
  })();
  function renderRoom() {
    const show = mode === 'game' && view.ph === 0;
    $('#room').hidden = !show;
    document.body.classList.toggle('lobbyOn', show && !roomMin);
    if (!show) return;
    const rows = view.rows.slice().sort((a, b) => a[19] - b[19]);
    const host = rows.find(r => r[0] === view.hid);
    const sig = [roomMin, N.role, N.code, view.fl, view.tm, I18N && I18N.lang, rows.map(r => r[0] + r[12] + r[11]).join()].join('|');
    if (sig === roomSig) return;
    roomSig = sig;
    $('#room').classList.toggle('min', roomMin);
    $('#roomCodeBig').textContent = N.code || t('mp.solo');
    $('#roomInvite').hidden = !N.code;
    $('#roomMinBtn').textContent = roomMin ? t('dm.room.show') : t('dm.room.hide');
    const list = $('#roomPlayers'); list.textContent = '';
    rows.forEach(r => {
      const chip = document.createElement('span'); chip.className = 'pchip' + (r[0] === view.myId ? ' me' : '');
      const dot = document.createElement('i'); dot.style.background = pal(r[11]).ui;
      chip.append(dot, document.createTextNode(r[12] + (r[0] === view.myId ? t('mp.youTag') : '')));
      if (r[0] === view.hid) { const h = document.createElement('small'); h.textContent = t('dm.room.hostTag'); chip.appendChild(h); }
      list.appendChild(chip);
    });
    const isHost = N.role === 'host';
    $('#roomSet').hidden = !isHost; $('#roomRules').hidden = isHost;
    $('#setFrag').value = String(view.fl); $('#setTime').value = String(view.tm);
    $('#roomRules').textContent = t('dm.room.rules', { f: view.fl, m: mins(view.tm) });
    $('#roomStart').hidden = !isHost;
    $('#roomNote').textContent = isHost ? (rows.length < 2 ? t('dm.room.alone') : t('dm.room.warm'))
      : t('dm.room.wait', { name: host ? host[12] : t('mp.aDragon') });
  }

  $('#hostBtn').onclick = hostGame;
  $('#joinBtn').onclick = joinGame;
  $('#rejoinBtn').onclick = rejoinSaved;
  $('#practiceBtn').onclick = () => { setBusy(true); N.practice(); };
  $('#menuBtn').onclick = () => toggleMenu();
  $('#resumeBtn').onclick = () => toggleMenu(false);
  $('#roomChip').onclick = () => { toggleMenu(true); copyLink($('#linkOut')); };
  $('#roomInvite').onclick = shareLink;
  $('#roomQr').onclick = () => openQr();
  $('#menuQr').onclick = () => openQr();
  $('#shareGameBtn').onclick = () => openQr();
  $('#qrClose').onclick = () => closeQr();
  $('#qrCopy').onclick = () => copyText(qrUrl);
  $('#qrShare').onclick = () => { navigator.share({ title: t('dm.title'), text: N.code ? t('dm.room.shareText', { c: N.code }) : t('dm.desc'), url: qrUrl }).catch(() => { }); };
  $('#roomMinBtn').onclick = () => { roomMin = !roomMin; roomSig = ''; renderRoom(); };
  $('#roomStart').onclick = () => { N.startMatch(); $('#roomStart').blur(); };
  $('#boardBtn').onclick = () => { if (boardOpen) hideBoard(); else showBoard(false); };
  $('#boardClose').onclick = hideBoard;
  $('#copyBtn').onclick = () => copyLink($('#linkOut'));
  $('#leaveBtn').onclick = leave; $('#leave2Btn').onclick = leave; $('#backBtn').onclick = leave;
  addEventListener('pagehide', () => N.leave());
  $('#againBtn').onclick = () => N.restart();

  /* ---------- resize ---------- */
  let W = 1, Hh = 1, dpr = 1;
  function updateScale() { pMat.uniforms.uScale.value = (Hh * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))); }
  function resize() {
    W = innerWidth; Hh = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setSize(W, Hh, false); camera.aspect = W / Hh; camera.updateProjectionMatrix();
    hud.width = W * dpr; hud.height = Hh * dpr; updateScale();
  }
  addEventListener('resize', resize); resize();

  /* ---------- 2D HUD: crosshair, name tags with hp, edge arrows, radar ---------- */
  const proj = new V3();
  function drawHud() {
    hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, W, Hh);
    if (mode !== 'game') return;
    const flying = pilot.mode === 'air' || pilot.mode === 'perch';
    if (flying) {
      const f = MT.fwd(pilot.yaw, pilot.mode === 'perch' ? 0 : pilot.pitch);
      proj.set(pilot.pos[0] + f[0] * 60, pilot.pos[1] + f[1] * 60, pilot.pos[2] + f[2] * 60).project(camera);
      const cx = (proj.x + 1) / 2 * W, cy = (1 - proj.y) / 2 * Hh;
      hx.strokeStyle = 'rgba(235,227,205,.75)'; hx.lineWidth = 1.5; hx.beginPath(); hx.arc(cx, cy, 9, 0, Math.PI * 2); hx.moveTo(cx - 16, cy); hx.lineTo(cx - 11, cy); hx.moveTo(cx + 11, cy); hx.lineTo(cx + 16, cy); hx.stroke();
    }
    hx.font = '600 12px "Barlow Semi Condensed",sans-serif'; hx.textAlign = 'center';
    view.players.forEach(e => {
      proj.copy(e.pos).add(tmpV.set(0, 3.6, 0)).project(camera);
      const behind = proj.z > 1;
      let x = (proj.x + 1) / 2 * W, y = (1 - proj.y) / 2 * Hh;
      const col = pal(e.color).ui;
      if (!behind && x > 0 && x < W && y > 0 && y < Hh) {
        if (e.down) return;
        const tw = Math.max(46, hx.measureText(e.name || '').width + 10);
        hx.fillStyle = 'rgba(12,19,16,.6)'; hx.fillRect(x - tw / 2, y - 19, tw, 20);
        hx.fillStyle = col; hx.fillText(e.name || '', x, y - 7);
        hx.fillStyle = 'rgba(0,0,0,.5)'; hx.fillRect(x - tw / 2 + 3, y - 3, tw - 6, 3);
        hx.fillStyle = e.hp < 30 ? '#e5484f' : '#62c48a'; hx.fillRect(x - tw / 2 + 3, y - 3, (tw - 6) * Math.max(0, e.hp / X.hp), 3);
      } else if (!e.down) {
        if (behind) { x = W - x; y = Hh - y; }
        const ang = Math.atan2(y - Hh / 2, x - W / 2), m = 36;
        const px = Math.max(m, Math.min(W - m, W / 2 + Math.cos(ang) * (W / 2 - m))), py = Math.max(m + 70, Math.min(Hh - m - (isTouch ? 170 : 40), Hh / 2 + Math.sin(ang) * (Hh / 2 - m)));
        hx.save(); hx.translate(px, py); hx.rotate(ang); hx.fillStyle = col; hx.globalAlpha = 0.85; hx.beginPath(); hx.moveTo(10, 0); hx.lineTo(-6, -7); hx.lineTo(-6, 7); hx.closePath(); hx.fill(); hx.restore();
      }
    });
    // radar: forward is up, 300 m range; dragons in their colours, food amber
    const R = 50, rx = W - R - (isTouch ? 16 : 20), ry = isTouch ? 112 + R : Hh - R - 20;
    hx.fillStyle = 'rgba(12,19,16,.6)'; hx.strokeStyle = 'rgba(235,227,205,.18)'; hx.lineWidth = 1;
    hx.beginPath(); hx.arc(rx, ry, R, 0, Math.PI * 2); hx.fill(); hx.stroke();
    hx.beginPath(); hx.arc(rx, ry, R / 2, 0, Math.PI * 2); hx.stroke();
    hx.fillStyle = pal(view.myColor).ui; hx.beginPath(); hx.moveTo(rx, ry - 6); hx.lineTo(rx - 4, ry + 4); hx.lineTo(rx + 4, ry + 4); hx.closePath(); hx.fill();
    const cs = Math.cos(pilot.yaw), sn = Math.sin(pilot.yaw);
    const dot = (x, z, color, r) => {
      const dx = x - pilot.pos[0], dz = z - pilot.pos[2];
      const lf = dx * sn + dz * cs, lr = -(dx * cs - dz * sn);
      let px = lr / 300 * R, py = -lf / 300 * R; const l = Math.hypot(px, py); if (l > R - 4) { px *= (R - 4) / l; py *= (R - 4) / l; }
      hx.fillStyle = color; hx.beginPath(); hx.arc(rx + px, ry + py, r, 0, Math.PI * 2); hx.fill();
    };
    view.food.forEach(f => dot(f.pos[0], f.pos[2], 'rgba(224,160,64,.8)', 1.8));
    view.players.forEach(e => { if (!e.down) dot(e.pos.x, e.pos.z, pal(e.color).ui, 3.4); });
    hx.fillStyle = 'rgba(235,227,205,.5)'; hx.font = '600 10px "Barlow Semi Condensed",sans-serif'; hx.fillText('300 m', rx, ry + R - 6);
  }

  /* ---------- the room tick (the host keeps ticking in background tabs) ---------- */
  /** One network step: the host steps the world (its own events and snapshot go to the view), a guest sends its pose. */
  function netTick(dt) {
    const r = N.tick(dt);
    if (r) { applyEvents(r.events); applySnapshot(r.snap); }
  }
  let bgLast = 0;
  setInterval(() => {
    // requestAnimationFrame stops in hidden tabs; keep the room (and the host's world) running
    if (!document.hidden || mode !== 'game') { bgLast = 0; return; }
    const now = performance.now();
    let el = bgLast ? Math.min(1, (now - bgLast) / 1000) : NET_DT; bgLast = now;
    while (el > 0) { const d = Math.min(0.05, el); el -= d; reportLocal(DM.step(pilot, { sx: 0, sy: 0 }, d, E)); netTick(d); }
  }, 50);
  addEventListener('visibilitychange', () => { if (!document.hidden && mode === 'game') netTick(0); });   // back: check the claim now

  /* ---------- camera ---------- */
  const camPos = new V3(0, 100, -30), camLook = new V3();
  function snapCam() {
    const b = MT.fwd(pilot.yaw, 0);
    camPos.set(pilot.pos[0] - b[0] * 22, pilot.pos[1] + 8, pilot.pos[2] - b[2] * 22);
  }
  function updateCamera(dt) {
    const m = pilot.mode, f0 = MT.fwd(pilot.yaw, 0);
    let back = 22, up = 7 - pilot.pitch * 6, lookAhead = 12, rate = 4.5;
    if (m === 'perch' || m === 'perching') { back = 21; up = 8; lookAhead = 14; rate = 3.5; }
    if (m === 'fall') { back = 26; up = 12; lookAhead = 0; rate = 2.5; }
    let yaw = pilot.yaw;
    if (m === 'down') { yaw = (time - deadAt) * 0.35 + pilot.yaw; back = 30; up = 14; lookAhead = 0; rate = 2; }
    const bx = Math.sin(yaw), bz = Math.cos(yaw);
    const desired = new V3(pilot.pos[0] - bx * back, pilot.pos[1] + up, pilot.pos[2] - bz * back);
    desired.y = Math.max(desired.y, TR.surfaceAt(X.region, desired.x, desired.z) + 3);
    const top = DM.solidTop(E, desired.x, desired.z);
    if (top != null) desired.y = Math.max(desired.y, top + 2);
    camPos.lerp(desired, 1 - Math.exp(-dt * rate));
    const f = MT.fwd(pilot.yaw, m === 'air' ? pilot.pitch : 0);
    camLook.set(pilot.pos[0] + (m === 'down' || m === 'fall' ? 0 : f[0] * lookAhead), pilot.pos[1] + (m === 'air' ? f[1] * lookAhead : 0) + 2, pilot.pos[2] + (m === 'down' || m === 'fall' ? 0 : f[2] * lookAhead));
    void f0;
    camera.position.copy(camPos);
    if (shake > 0 && !reduceMotion) { camera.position.x += (Math.random() - .5) * shake * 2; camera.position.y += (Math.random() - .5) * shake * 2; }
    shake = Math.max(0, shake - dt * 1.5);
    camera.lookAt(camLook);
    const fovT = pilot.boosting ? 72 : 60;
    if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); updateScale(); }
  }

  /* ---------- dragons ---------- */
  function poseDragon(d, p, pose, dt, ph, br, sx) {
    const m = p.mode;
    const ground = m === 'perch' || (m === 'down' && p.landed);
    WK.pose(pose, { mode: ground ? 'ground' : m === 'perching' ? 'landing' : 'air', tr: m === 'perching' ? p.tr : null, speed: 0, sx: ground ? sx : 0 }, dt, 1);
    const glide = p.pitch < -0.25 && !p.boosting;
    const amp = ground ? 0.12 : m === 'fall' ? 1.4 : m === 'down' ? 0.3 : m === 'perching' ? 0.9 : glide ? 0.35 : p.boosting ? 1.1 : 1;
    d.anim(time, dt, { phase: ph, amp, mouth: br, turn: -(sx || 0), look: 0, ground: pose.ground, fold: pose.fold, gait: pose.gait, stride: pose.stride });
  }
  const remotePilot = { mode: 'air', pitch: 0, boosting: false, tr: null, landed: true };

  /* ---------- main loop ---------- */
  let last = performance.now(), lastHp = -1, lastSt = -1, miniT = 0, lobbyTh = 0.9, fps = 0, fpsT = 0, fpsN = 0;
  const lobbyAt = A.spawns[0].pos;
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000, dt = Math.min(0.05, rawDt); last = now;
    time += dt; fpsN++; fpsT += rawDt; if (fpsT > 1) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }

    if (mode === 'lobby') {
      phase += dt * 6.2;
      hero.root.position.set(lobbyAt[0], lobbyAt[1], lobbyAt[2]); hero.root.rotation.set(0, A.spawns[0].yaw, 0);
      const breathe = Math.sin(time * 0.7) > 0.86;
      hero.anim(time, dt, { phase, amp: 1, mouth: breathe, look: Math.sin(time * 0.5) });
      hero.root.updateMatrixWorld(true); hero.mouth.getWorldPosition(mouthW);
      if (breathe) breathFx(mouthW, MT.fwd(A.spawns[0].yaw, -0.1), [0, 0, 0], dt * 0.4);
      lobbyTh += dt * 0.22;
      const tgt = new V3(lobbyAt[0], lobbyAt[1] + 0.2, lobbyAt[2]);
      camera.position.set(tgt.x + Math.sin(lobbyTh) * Math.cos(0.25) * 28, tgt.y + Math.sin(0.25) * 28, tgt.z + Math.cos(lobbyTh) * Math.cos(0.25) * 28);
      camera.lookAt(tgt);
      if (W > 720) camera.setViewOffset(W, Hh, -185, 0, W, Hh); else camera.setViewOffset(W, Hh, 0, Hh * 0.26, W, Hh);
    } else {
      if (view.myDown && pilot.mode !== 'down') { pilot.mode = 'down'; pilot.landed = false; }
      reportLocal(DM.step(pilot, readInput(), dt, E));
      hero.root.position.set(pilot.pos[0], pilot.pos[1], pilot.pos[2]);
      hero.root.rotation.set(-pilot.pitch, pilot.yaw, pilot.roll + pilot.rollX, 'YXZ');
      phase += dt * (pilot.mode === 'perch' ? 1.5 : pilot.mode === 'fall' ? 11 : pilot.mode === 'down' ? 2 : pilot.boosting ? 9 : pilot.pitch < -0.25 ? 3 : 6.2);
      poseDragon(hero, pilot, heroPose, dt, phase, pilot.breathing, pilot.sx);
      hero.root.visible = !(pilot.inv > 0 && pilot.mode === 'air' && pilot.rollT <= 0 && Math.floor(time * 12) % 2 === 0);
      hero.root.updateMatrixWorld(true); hero.mouth.getWorldPosition(mouthW);
      if (pilot.breathing) {
        const bf = MT.fwd(pilot.yaw, pilot.mode === 'perch' ? -0.12 : pilot.pitch);
        breathFx(mouthW, bf, pilot.vel, dt);
        VForest.heat(Fo, [mouthW.x, mouthW.y, mouthW.z], bf, X.breath.range, Math.cos(X.breath.cone * Math.PI / 180), dt).forEach(e => treeOut.push({ k: 'i', i: Fo.ids[e.i] }));
      }
      if (treeOut.length) { N.trees(treeOut.splice(0)); }
      if (pilot.mode === 'fall' && Math.random() < 0.5) spawnP(pilot.pos[0], pilot.pos[1], pilot.pos[2], (Math.random() - .5) * 3, 2, (Math.random() - .5) * 3, 0.8, 1.4, 1.5, 1, 0.5);

      netTick(dt);

      view.players.forEach(e => {
        smooth(e, dt);
        const md = DM.MODES[e.md] || 'air';
        e.phase += dt * (md === 'perch' ? 1.5 : md === 'fall' ? 11 : e.down ? 2 : 6.2);
        remotePilot.mode = e.down ? 'down' : md; remotePilot.pitch = e.pitch; remotePilot.landed = true;
        remotePilot.tr = md === 'perching' ? { t: 1, dur: 1 } : null;
        poseDragon(e.d, remotePilot, e.pose, dt, e.phase, e.br, e.sx);
        e.d.root.visible = !(e.inv && md === 'air' && Math.floor(time * 12) % 2 === 0);
        if (e.br && !e.down) { e.d.root.updateMatrixWorld(true); e.d.mouth.getWorldPosition(tmpV); breathFx(tmpV.clone(), MT.fwd(e.yaw, md === 'perch' ? -0.12 : e.pitch), [e.vel.x, e.vel.y, e.vel.z], dt); }
      });
      ballViews.forEach((b, id) => {
        b.m.position.addScaledVector(b.v, dt); b.life -= dt;
        const p = b.m.position;
        for (let k = 0; k < 3; k++) spawnP(p.x + (Math.random() - .5) * .6, p.y + (Math.random() - .5) * .6, p.z + (Math.random() - .5) * .6, b.v.x * 0.05, b.v.y * 0.05 + 1, b.v.z * 0.05, 0.45, 2.4, 1.2, 0, 1);
        if (b.life <= 0) { scene.remove(b.m); ballViews.delete(id); }
      });
      updateCamera(dt);

      // DOM HUD
      const hp = Math.round(view.hp), st = Math.round(pilot.st);
      if (hp !== lastHp) { $('#hpFill').style.transform = 'scaleX(' + Math.max(0, hp) / X.hp + ')'; lastHp = hp; }
      if (st !== lastSt) { $('#stFill').style.transform = 'scaleX(' + st / 100 + ')'; lastSt = st; }
      const tl = Math.max(0, view.tl | 0);
      $('#clock').textContent = Math.floor(tl / 60) + ':' + String(tl % 60).padStart(2, '0');
      miniT -= dt;
      if (miniT <= 0) {
        miniT = 0.3; renderMini(); renderRoom();
        if (boardOpen && !view.over) showBoard(false);
        if (view.over && !boardOpen && !menuOpen) showBoard(true);   // joined or took over after the end
        $('#goal').textContent = N.migrating ? t('dm.mig.short') : view.ph === 0 ? t('dm.warmup') : t('dm.goalShort', { n: view.fl });
      }
      hurt = Math.max(0, hurt - dt * 1.8);
      $('#vignette').style.opacity = Math.max(hurt, view.hp < 30 && pilot.mode !== 'down' ? 0.35 + Math.sin(time * 5) * 0.15 : 0);
      // Sit / Fly button and the prompt line
      const bl = $('#bLand');
      const label = pilot.mode === 'perch' ? t('dm.btn.fly') : t('dm.btn.land');
      if (bl.textContent !== label) bl.textContent = label;
      const canSit = pilot.mode === 'air' && !DM.perchBlock(pilot, E);
      bl.classList.toggle('ready', canSit || (pilot.mode === 'perch' && pilot.stun <= 0));
      bl.disabled = pilot.mode === 'fall' || pilot.mode === 'down' || pilot.mode === 'perching';
      if (promptT > 0) { promptT -= dt; if (promptT <= 0) promptEl.hidden = true; }
      else if (pilot.mode === 'perch' && pilot.stun > 0) { promptEl.textContent = t('dm.prompt.stunned'); promptEl.hidden = false; }
      else if (canSit && pilot.speed < 40) { promptEl.textContent = t(isTouch ? 'dm.prompt.sitTouch' : 'dm.prompt.sit'); promptEl.hidden = false; }
      else if (pilot.mode === 'perch') { promptEl.textContent = t(isTouch ? 'dm.prompt.flyTouch' : 'dm.prompt.fly'); promptEl.hidden = false; }
      else if (pilot.mode === 'down') { promptEl.textContent = t('dm.prompt.down', { n: Math.max(0, Math.ceil(X.respawn - (time - deadAt))) }); promptEl.hidden = false; }
      else promptEl.hidden = true;
    }
    // food animals: smooth toward the host's positions, on the ground
    const flist = [];
    view.food.forEach(f => {
      const k = 1 - Math.exp(-dt * 8);
      f.pos[0] += (f.tx - f.pos[0]) * k; f.pos[2] += (f.tz - f.pos[2]) * k; f.pos[1] = TR.surfaceAt(X.region, f.pos[0], f.pos[2]);
      f.yaw = lerpAngle(f.yaw, f.tyaw, k); f.t += dt;
      flist.push(f);
    });
    preyView.update({ list: flist }, time, null, null);
    VForest.step(Fo, dt);
    region.update(camera.position, time, { dt, camera, viewH: renderer.domElement.height });
    updateParticles(dt);
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) banner.style.opacity = 0; }
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    drawHud();
  }

  /* ---------- boot ---------- */
  if (debug) window.__vdm = { get world() { return N.world; }, N, get pilot() { return pilot; }, set pilot(p) { pilot = p; }, view, DM, E, A, BUILD, get fps() { return fps; }, landOrFly, fireBall, debugKey, get role() { return N.role; }, get code() { return N.code; }, get migrating() { return N.migrating; }, myKey, loadRoom };
  try { const n = localStorage.getItem(X.nameKey); if (n) $('#nameIn').value = n; } catch (_) { }
  const invited = location.hash.slice(1).toUpperCase();
  const lobbyStatus = () => {
    if (/^[A-Z0-9]{5}$/.test(invited)) setStatus(t('mp.invited', { c: invited }), true);
    if (!window.Peer && !offline) { setStatus(t('dm.noLibSolo')); $('#practiceBtn').hidden = false; }
  };
  if (/^[A-Z0-9]{5}$/.test(invited)) $('#codeIn').value = invited;
  lobbyStatus();
  function showRejoin() {
    const saved = loadRoom();
    $('#rejoinBtn').hidden = !saved;
    if (saved) $('#rejoinBtn').textContent = t('dm.rejoin', { c: saved.code });
  }
  showRejoin();
  $('#buildNote').textContent = debug ? 'build ' + BUILD : '';
  if (window.I18N) { I18N.apply(); I18N.onChange(() => { roomSig = ''; showRejoin(); if (mode === 'lobby') { setStatus(''); lobbyStatus(); } else $('#goal').textContent = t('dm.goalShort', { n: view.fl }); }); }
  $('#loading').remove();
  $('#lobby').hidden = false;
  requestAnimationFrame(frame);
})();
