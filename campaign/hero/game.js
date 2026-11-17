/*
 * Verdigris - Tales of Prahold (campaign/hero/): the story of the last dragon told by the wizard, the prince and the
 * princess, played on foot in the streets of Prahold (the Veltava Bend of the campaign: real Prague terrain, the town
 * of core/city.js, Vyshgard and the settlements). Rules are core: core/hero.js (walking, jumping, the gift),
 * core/tale.js (chapters, objectives); this file draws, reads the input and shows the story.
 *   ?tale=wizard|prince|princess starts that telling at once; ?q=low|mid|high picks the detail; ?debug shows numbers.
 * Progress per telling (the chapter reached, finished) is kept in localStorage 'vsd-tales'.
 */
(function () {
  'use strict';
  const t = (k, p) => (window.I18N ? I18N.t(k, p) : k);
  const $ = s => document.querySelector(s);
  const C = window.VCamp, D = C.need('data'), TR = C.need('terrain'), SE = C.need('settlement'), CI = C.need('city'), H = C.need('hero'), TL = C.need('tale');
  const V3 = THREE.Vector3;
  const params = new URLSearchParams(location.search), debug = params.has('debug');
  const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const REGION = 'bend', PAD = 0.42;
  const tier = ['low', 'mid', 'high'].includes(params.get('q')) ? params.get('q') : isTouch ? 'mid' : 'high';
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { return null; } };
  let progress = {};
  try { progress = JSON.parse(store('vsd-tales') || '{}') || {}; } catch (_) { progress = {}; }
  const saveProgress = () => store('vsd-tales', JSON.stringify(progress));
  // clock time per chapter (0 midnight, 0.5 noon): the wizard's star at night, meetings at dusk, errands by day
  const LIGHT = { wizard: [0.92, 0.42, 0.78, 0.76, 0.5], prince: [0.4, 0.55, 0.78, 0.84, 0.6], princess: [0.86, 0.38, 0.72, 0.8, 0.93] };

  /* ---------- renderer, scene, sky ---------- */
  const canvas = $('#c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'high' ? 2 : 1.5));
  const scene = new THREE.Scene();
  const FOG = { near: tier === 'low' ? 160 : 260, far: tier === 'low' ? 560 : tier === 'mid' ? 760 : 950 };
  scene.fog = new THREE.Fog(0x9fb4b0, FOG.near, FOG.far);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2600);
  const sunDir = new V3(-0.55, 0.16, -0.82).normalize();
  const hemi = new THREE.HemisphereLight(0xa6cbc4, 0x3b2a1a, 0.85); scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffc68c, 1.3); sunLight.position.copy(sunDir).multiplyScalar(300); scene.add(sunLight);
  const rim = new THREE.DirectionalLight(0x7fb7ff, 0.35); rim.position.set(200, 120, 250); scene.add(rim);
  const skyView = VRender.sky.build({ hemi, sun: sunLight, rim, fog: scene.fog, sunDir });
  scene.add(skyView.mesh);
  const fireLights = [0, 1].map(() => { const L = new THREE.PointLight(0xff7a2a, 0, 70, 2); scene.add(L); return L; });
  const glowLight = new THREE.PointLight(0x9cf0b8, 0, 26, 2); scene.add(glowLight);       // the objective's glow (one light)
  if (window.VTex) VTex.quality(tier === 'low' ? 0 : 1);
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  /* ---------- the world: built once, on the first telling ---------- */
  let world = null;
  function buildWorld() {
    if (world) return world;
    const region = VRender.terrain.build(REGION, { isTouch, flora: tier === 'low' ? 0.4 : tier === 'mid' ? 0.65 : 1, far: FOG.far, particles: tier === 'low' ? 0.4 : 1, detail: tier !== 'low' });
    scene.add(region.group);
    skyView.setRegion(region); scene.fog.color.set(region.fog);
    const town = SE.build(REGION);
    const townView = VRender.settlements.build(town); scene.add(townView.group);
    const castleView = VRender.castleView ? VRender.castleView.build(town, { tier }) : null;
    if (castleView) scene.add(castleView.group);
    const cityView = VRender.cityView ? VRender.cityView.build(REGION, { tier }) : null;
    if (cityView) scene.add(cityView.group);
    const sol = {
      solidAt: (x, z) => { const a = SE.solidAt(town, x, z, PAD), b = CI.solidAt(REGION, x, z, PAD); return a == null ? b : b == null ? a : Math.max(a, b); },
      solidHit: (x, z) => { const a = SE.hit(town, x, z, PAD), b = CI.hit(REGION, x, z, PAD); return !a ? b : !b ? a : (b.depth > a.depth ? b : a); },
      walkTop: (x, z) => SE.surfaceAt(town, x, z),
    };
    world = { region, town, townView, castleView, cityView, sol };
    return world;
  }

  /* ---------- figures ---------- */
  const figs = new Map();                                        // npc / target id -> { obj, kind, h (VHuman) | dragon }
  let heroFig = null, ts = null, me = null, heroKind = null;
  const shimmer = VHuman.shimmer(scene);
  function makeFig(kind, seed) {
    if (kind === 'dragon') {
      const d = VDragon.makeDragon(VDragon.GREEN);
      d.root.scale.setScalar(2.4); scene.add(d.root);
      return { obj: d.root, dragon: d, kind };
    }
    const palette = kind === 'thug' ? { main: 0x6e1c20, trim: 0x2a2626 } : undefined;
    const h = VHuman.make(kind === 'thug' ? 'guard' : kind, { seed: seed || 1, palette, detail: tier === 'low' ? 'low' : 'high' });
    scene.add(h.root);
    return { obj: h.root, h, kind };
  }
  function dropFig(id) { const f = figs.get(id); if (!f) return; if (f.h) f.h.dispose(); else if (f.dragon) f.dragon.dispose(); else { scene.remove(f.obj); f.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } figs.delete(id); }

  /* props: lanterns, dummies, pages, scorch marks, the ledger; a beacon over what the objective needs */
  const M = {
    unlit: new THREE.MeshLambertMaterial({ color: 0x3b3f36 }), lit: new THREE.MeshBasicMaterial({ color: 0x8cff9e }),
    straw: new THREE.MeshLambertMaterial({ color: 0xc9a764 }), wood: new THREE.MeshLambertMaterial({ color: 0x6b4a2c }),
    page: new THREE.MeshBasicMaterial({ color: 0xf3ead2, side: THREE.DoubleSide }), soot: new THREE.MeshBasicMaterial({ color: 0x1c1410, transparent: true, opacity: 0.85 }),
    book: new THREE.MeshLambertMaterial({ color: 0x5a2a1c }), glass: new THREE.MeshBasicMaterial({ color: 0x5cff8a }),
    beam: new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.22, depthWrite: false }),
    cone: new THREE.MeshBasicMaterial({ color: 0xe5484f, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    coneOff: new THREE.MeshBasicMaterial({ color: 0x6aa0ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  };
  const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true).translate(0, 30, 0);
  function prop(kind) {
    const g = new THREE.Group();
    if (kind === 'lantern') {
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), M.unlit); body.name = 'glass'; g.add(body);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.7, 6), M.wood); cap.position.y = 1; g.add(cap);
    } else if (kind === 'dummy') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6).translate(0, 1.1, 0), M.wood); g.add(post);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.1, 8).translate(0, 1.35, 0), M.straw); body.name = 'body'; g.add(body);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.16).translate(0, 1.6, 0), M.wood); g.add(arm);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6).translate(0, 2.15, 0), M.straw); g.add(head);
      g.position.y = -1;                                        // targets float at y = 1: the dummy stands on the ground
    } else if (kind === 'page') {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), M.page); g.add(p);
    } else if (kind === 'scorch') {
      const s = new THREE.Mesh(new THREE.CircleGeometry(1.3, 14).rotateX(-Math.PI / 2), M.soot); s.position.y = -0.82; g.add(s);
      const e = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: 0xff8a3a })); g.add(e);
    } else if (kind === 'ledger') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 1.05), M.book); g.add(b);
    } else {
      const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), M.glass); g.add(b);
    }
    scene.add(g);
    return g;
  }

  /* ---------- tale start / cards / save ---------- */
  const storyCard = VRender.storyCard.build(document.body, { t });
  let state = 'intro';
  function begin(kind, restart) {
    $('#loading').hidden = false;
    setTimeout(() => {
      buildWorld();
      $('#loading').hidden = true;
      heroKind = kind;
      const pr = progress[kind] || {};
      const ch = restart || pr.done ? 0 : pr.ch || 0;
      for (const id of [...figs.keys()]) dropFig(id);
      if (heroFig) heroFig.dispose();
      heroFig = VHuman.make(kind, { seed: 3, detail: tier === 'low' ? 'low' : 'high' }); scene.add(heroFig.root);
      ts = TL.create(kind, REGION);
      const [x, z, yaw] = TL.chapterStart(kind, ch, REGION);
      me = H.create(kind, [x, H.groundY(Object.assign({ regionId: REGION }, world.sol), x, z), z], yaw);
      snapCam();
      setState('play');
      onEvents(TL.start(ts, me, ch));
    }, 30);
  }
  function showCard(e) {
    const lines = (e.prev ? [e.prev] : []).concat(e.lines);
    storyCard.show({ kind: 'act', scene: 'castle', kick: e.end ? t('c.hero.done') : t('c.hero.chapter', { n: e.chapter, of: e.of }), title: e.key, lines }, () => {
      const ev = TL.closeCard(ts, me);
      onEvents(ev);
    });
  }
  function setState(s) {
    state = s;
    $('#intro').hidden = s !== 'intro';
    $('#pause').hidden = s !== 'paused';
    const play = s === 'play' || s === 'paused';
    $('#top').hidden = !play; $('#stBar').hidden = !play;
    $('#touch').hidden = !(play && isTouch); $('#legend').hidden = !(play && !isTouch);
    $('#arrow').hidden = true;
    if (s === 'intro') renderIntro();
    for (const k in keys) keys[k] = false;
    touch.x = touch.y = 0; touch.run = false;
  }

  /* ---------- events: lines, objectives, progress ---------- */
  let sayT = 0, hurtT = 0;
  function say(text, secs) {
    const p = $('#say p');
    p.textContent = text; p.classList.add('on'); sayT = secs || Math.min(8, 2.5 + text.length / 18);
  }
  function onEvents(ev) {
    for (const e of ev) {
      if (e.e === 'tale:card') showCard(e);
      else if (e.e === 'tale:say') say(t(e.key));
      else if (e.e === 'tale:collect') say(t('c.hero.item.' + e.item), 2.5);
      else if (e.e === 'tale:hit') {
        const f = figs.get(e.target);
        if (f) shimmer.play(f.obj.position.clone().add(new V3(0, 1, 0)), e.kind === 'lantern' ? 0x8cff9e : e.kind === 'dragon' ? 0x8cf0b0 : 0xffd36a);
        if (e.left <= 0) say(t('c.hero.hit.' + (['dummy', 'thug', 'lantern', 'dragon'].includes(e.kind) ? e.kind : 'target')), 2.5);
      } else if (e.e === 'tale:seen') { say(t('c.hero.seen'), 2.5); hurtT = 0.6; snapCam(); }
      else if (e.e === 'tale:chapter') { progress[heroKind] = { ch: e.ch, done: false }; saveProgress(); }
      else if (e.e === 'tale:done') { progress[heroKind] = { ch: 0, done: true }; saveProgress(); setState('intro'); }
      else if (e.e === 'hero:gift') giftFx(e);
    }
  }

  /* gift effects: the wizard's spark flies, the sword flashes, the charm and the sparks glitter */
  const bolts = [];
  const boltGeo = new THREE.SphereGeometry(0.28, 8, 6), boltMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff });
  function giftFx(e) {
    const hand = new V3(me.pos[0] + Math.sin(me.yaw) * 0.6, me.pos[1] + 1.6, me.pos[2] + Math.cos(me.yaw) * 0.6);
    const tg = e.target ? TL.targetsFor(ts).find(q => q.id === e.target) : null;
    const to = tg ? new V3(tg.pos[0], tg.pos[1], tg.pos[2]) : hand.clone().add(new V3(Math.sin(me.yaw) * 14, 0.5, Math.cos(me.yaw) * 14));
    if (e.kind === 'bolt' || e.kind === 'ember') {
      const m = new THREE.Mesh(boltGeo, e.kind === 'ember' ? new THREE.MeshBasicMaterial({ color: 0xff9447 }) : boltMat);
      m.position.copy(hand); scene.add(m);
      bolts.push({ m, from: hand, to, t: 0, dur: Math.max(0.15, hand.distanceTo(to) / 60), col: e.kind === 'ember' ? 0xff9447 : 0xbfe6ff });
    } else shimmer.play(e.kind === 'charm' ? hand.clone().add(new V3(Math.sin(me.yaw) * 2, 0, Math.cos(me.yaw) * 2)) : to, e.kind === 'charm' ? 0xff9ad0 : 0xfff2c0);
    if (!tg) say(t('c.hero.nothing'), 1.2);
  }

  /* ---------- input ---------- */
  const keys = {}, touch = { x: 0, y: 0, run: false };
  let giftQ = false, jumpQ = false;
  addEventListener('keydown', e => {
    if (storyCard.open) {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') storyCard.next();
      else if (e.code === 'Escape') storyCard.close();
      e.preventDefault(); return;
    }
    if (e.code === 'Escape') { if (state === 'play') setState('paused'); else if (state === 'paused') setState('play'); return; }
    if (state !== 'play') return;
    if ((e.code === 'KeyE' || e.code === 'Enter' || e.code === 'KeyF') && !e.repeat) giftQ = true;
    if (e.code === 'Space' && !e.repeat) jumpQ = true;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  canvas.addEventListener('pointerdown', e => { if (state === 'play' && e.pointerType === 'mouse' && e.button === 0) giftQ = true; });
  const stick = $('#stick'), nub = $('#nub'); let stickId = null;
  function stickMove(e) {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const R = r.width / 2 - 10, l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    nub.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; touch.x = dx / R; touch.y = -dy / R;
  }
  stick.addEventListener('pointerdown', e => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; touch.x = touch.y = 0; nub.style.transform = ''; };
  stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);
  $('#bGift').addEventListener('pointerdown', e => { e.preventDefault(); giftQ = true; });
  $('#bJump').addEventListener('pointerdown', e => { e.preventDefault(); jumpQ = true; touch.jump = true; });
  $('#bJump').addEventListener('pointerup', () => { touch.jump = false; });
  const bRun = $('#bRun');
  bRun.addEventListener('pointerdown', e => { e.preventDefault(); touch.run = true; bRun.classList.add('on'); try { bRun.setPointerCapture(e.pointerId); } catch (_) { } });
  const runOff = () => { touch.run = false; bRun.classList.remove('on'); };
  bRun.addEventListener('pointerup', runOff); bRun.addEventListener('pointercancel', runOff); bRun.addEventListener('lostpointercapture', runOff);
  $('#pauseBtn').onclick = () => { if (state === 'play') setState('paused'); };
  $('#resumeBtn').onclick = () => setState('play');
  $('#restartBtn').onclick = () => { progress[heroKind] = { ch: 0, done: false }; saveProgress(); begin(heroKind, true); };
  $('#menuBtn').onclick = () => setState('intro');
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setState('paused'); });
  const c1 = v => Math.max(-1, Math.min(1, v));
  function readInput() {
    const i = {
      sx: c1(((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) + touch.x),
      sy: c1(((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0) + touch.y),
      run: !!(keys.ShiftLeft || keys.ShiftRight || touch.run || Math.hypot(touch.x, touch.y) > 0.97 && isTouch && touch.run),
      jump: jumpQ || !!keys.Space || !!touch.jump, act: giftQ,
    };
    giftQ = false; jumpQ = false;
    return i;
  }

  /* ---------- intro: the three tellings and the dragon's ---------- */
  const ICON = {
    wizard: '<svg viewBox="0 0 44 44"><path d="M22 3 L33 30 H11 Z" fill="#3b4aa0" stroke="#d8b25a" stroke-width="1.5"/><path d="M7 31 H37 L33 35 H11 Z" fill="#2c3878"/><circle cx="27" cy="16" r="1.6" fill="#ffe28a"/><circle cx="19" cy="23" r="1.2" fill="#ffe28a"/></svg>',
    prince: '<svg viewBox="0 0 44 44"><path d="M22 4 v26" stroke="#cfd6dc" stroke-width="3"/><path d="M14 30 h16" stroke="#d8b25a" stroke-width="3"/><path d="M22 30 v8" stroke="#6b4a2c" stroke-width="3"/><path d="M10 8 l4 5 4-6 4 6 4-6 4 6 4-5 v5 H10z" fill="#d8b25a"/></svg>',
    princess: '<svg viewBox="0 0 44 44"><path d="M12 14 l5 6 5-9 5 9 5-6 -2 10 H14z" fill="#d8b25a"/><path d="M14 26 C14 34 30 34 30 26" stroke="#62c48a" stroke-width="3" fill="none"/><circle cx="22" cy="10" r="2" fill="#ff9ad0"/></svg>',
    dragon: '<svg viewBox="0 0 44 44"><path d="M6 30 C14 10 22 18 22 18 C22 18 30 10 38 30 C30 24 26 26 22 32 C18 26 14 24 6 30Z" fill="#3d8a5a" stroke="#1d3b2a" stroke-width="1.2"/><circle cx="22" cy="20" r="1.5" fill="#ffb43a"/></svg>',
  };
  function renderIntro() {
    const box = $('#heroes'); box.innerHTML = '';
    for (const kind of ['wizard', 'prince', 'princess', 'dragon']) {
      const b = document.createElement(kind === 'dragon' ? 'a' : 'button');
      b.className = 'hero';
      if (kind === 'dragon') { b.href = '../'; b.style.textDecoration = 'none'; b.style.color = 'inherit'; }
      const pr = progress[kind] || {};
      const state2 = kind === 'dragon' ? '' : pr.done ? '&#10003;' : pr.ch ? t('c.hero.chapter', { n: pr.ch + 1, of: D.tales[kind].chapters.length }) : '';
      b.innerHTML = ICON[kind] + '<span><b></b><small></small></span><i>' + state2 + '</i>';
      b.querySelector('b').textContent = t('c.hero.' + kind); b.querySelector('small').textContent = t('c.hero.' + kind + '.sub');
      if (kind !== 'dragon') b.onclick = () => begin(kind, false);
      box.appendChild(b);
    }
    const langs = $('#langs'); langs.innerHTML = '';
    if (window.I18N) for (const L of I18N.LANGS) {
      const b = document.createElement('button'); b.textContent = L.code.toUpperCase(); b.className = I18N.lang === L.code ? 'on' : '';
      b.onclick = () => { I18N.setLang(L.code); renderIntro(); }; langs.appendChild(b);
    }
    if (window.I18N && I18N.apply) I18N.apply(document);
  }

  /* ---------- camera ---------- */
  const camPos = new V3(), camLook = new V3(), tmp = new V3();
  function camWant(out) {
    const back = 6.6, up = 3.1, bx = Math.sin(me.yaw), bz = Math.cos(me.yaw);
    let k = 1;
    for (; k > 0.25; k -= 0.15) {                                // closer in a narrow lane: never behind a wall
      const x = me.pos[0] - bx * back * k, z = me.pos[2] - bz * back * k, y = me.pos[1] + up * (0.6 + 0.4 * k);
      const top = world.sol.solidAt(x, z);
      if (top == null || top < y - 0.5) break;
    }
    out.set(me.pos[0] - bx * back * k, me.pos[1] + up * (0.6 + 0.4 * k), me.pos[2] - bz * back * k);
    out.y = Math.max(out.y, TR.surfaceAt(REGION, out.x, out.z) + 1.2);
    return out;
  }
  function snapCam() { if (me && world) { camWant(camPos); camera.position.copy(camPos); } }

  /* ---------- HUD ---------- */
  const objEl = $('#obj'), arrowEl = $('#arrow'), stFill = $('#stBar i');
  let objShown = '';
  function hud(dt) {
    const o = TL.objective(ts);
    const key = o ? o.key + '|' + o.n + '|' + (I18N && I18N.lang) : 'none';
    if (key !== objShown) {
      objShown = key;
      objEl.querySelector('.k').textContent = o ? t('c.hero.chapter', { n: ts.ch + 1, of: D.tales[ts.id].chapters.length }) : '';
      objEl.querySelector('.t').textContent = o ? t(o.key) : '';
      objEl.querySelector('.p').textContent = o && o.of > 1 ? t('c.hero.progress', { n: o.n, of: o.of }) : '';
    }
    const goal = o ? TL.nearestGoal(ts, me.pos[0], me.pos[2]) : null;
    arrowEl.hidden = !goal || storyCard.open;
    if (goal) {
      const dx = goal[0] - me.pos[0], dz = goal[2] - me.pos[2], d = Math.hypot(dx, dz);
      const camYaw = Math.atan2(camLook.x - camera.position.x, camLook.z - camera.position.z);
      let rel = Math.atan2(dx, dz) - camYaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      arrowEl.querySelector('svg').style.transform = 'rotate(' + (-rel * 180 / Math.PI).toFixed(1) + 'deg)';
      arrowEl.querySelector('span').textContent = t('c.hero.distance', { d: Math.round(d) });
      glowLight.position.set(goal[0], goal[1] + 3, goal[2]); glowLight.intensity = d < 60 ? 1.2 : 0;
    } else glowLight.intensity = 0;
    stFill.style.width = me.st.toFixed(0) + '%';
    const gb = $('#bGift'), gk = 'c.hero.gift.' + me.gift;
    if (gb.dataset.k !== gk + (I18N && I18N.lang)) { gb.dataset.k = gk + (I18N && I18N.lang); gb.textContent = t(gk); $('#legend').textContent = t('c.hero.legend', { gift: t(gk) }); }
    sayT -= dt; if (sayT <= 0) $('#say p').classList.remove('on');
    hurtT -= dt; $('#vig').classList.toggle('on', hurtT > 0);
  }

  /* ---------- per-frame sync of npcs, targets, items, guards ---------- */
  const want = new Set();
  function syncFigs(dt, time) {
    want.clear();
    for (const n of ts.npcs) {
      want.add(n.id);
      let f = figs.get(n.id);
      if (!f) { f = makeFig(n.kind, n.id.length * 13 + 5); figs.set(n.id, f); }
      f.obj.position.set(n.pos[0], n.pos[1], n.pos[2]); f.obj.rotation.y = n.yaw;
      if (f.h) f.h.anim(dt, { speed: (n.moving || 0) * 3.5, talk: n.need && !n.talked && Math.hypot(n.pos[0] - me.pos[0], n.pos[2] - me.pos[2]) < 6 });
      if (f.dragon) { f.obj.position.y += VDragon.STAND * 2.4; f.dragon.anim(time, dt, { phase: time * 1.5, amp: 0.12, ground: 1, fold: 1, gait: 0, stride: 0, look: 0, turn: 0 }); }
    }
    for (const q of ts.targets) {
      want.add(q.id);
      let f = figs.get(q.id);
      if (!f) {
        if (q.kind === 'thug') f = makeFig('thug', 9);
        else if (q.kind === 'dragon') f = makeFig('dragon');
        else f = { obj: prop(q.kind), kind: q.kind };
        figs.set(q.id, f);
      }
      const p = q.pos;
      if (f.h) {
        const gone = q.hp <= 0;
        if (gone) { q.fled = (q.fled || 0) + dt; const a = Math.atan2(p[0] - me.pos[0], p[2] - me.pos[2]); p[0] += Math.sin(a) * 5 * dt; p[2] += Math.cos(a) * 5 * dt; f.obj.rotation.y = a; }
        else f.obj.rotation.y = Math.atan2(me.pos[0] - p[0], me.pos[2] - p[2]);
        f.obj.position.set(p[0], TR.surfaceAt(REGION, p[0], p[2]), p[2]);
        f.obj.visible = !(q.fled > 3);
        f.h.anim(dt, { speed: gone ? 5 : 0, run: gone, attack: !gone && Math.hypot(p[0] - me.pos[0], p[2] - me.pos[2]) < 3 ? (time * 1.3) % 1 : 0 });
      } else if (f.dragon) {
        f.obj.position.set(p[0], TR.surfaceAt(REGION, p[0], p[2]) + VDragon.STAND * 2.4, p[2]); f.obj.rotation.y = Math.atan2(me.pos[0] - p[0], me.pos[2] - p[2]);
        f.obj.visible = q.hp > 0;
        f.dragon.anim(time, dt, { phase: time * 1.5, amp: 0.12, ground: 1, fold: 1, gait: 0, stride: 0, look: 0, turn: 0 });
      } else {
        f.obj.position.set(p[0], p[1], p[2]);
        const glass = f.obj.getObjectByName('glass');
        if (glass) { glass.material = q.hp <= 0 ? M.lit : M.unlit; glass.rotation.y = time; }
        const body = f.obj.getObjectByName('body');
        if (body) f.obj.rotation.z = q.hp <= 0 ? Math.min(1.3, (f.obj.rotation.z || 0) + dt * 3) : 0.08 * Math.sin(time * 9) * (q.hp < 2 ? 1 : 0);
      }
      beacon(q.id + ':b', p, q.hp > 0);
    }
    for (const it of ts.items) {
      want.add(it.id);
      let f = figs.get(it.id);
      if (!f) { f = { obj: prop(it.kind), kind: it.kind }; figs.set(it.id, f); }
      f.obj.visible = !it.taken;
      f.obj.position.set(it.pos[0], it.pos[1] + 0.15 * Math.sin(time * 2.4), it.pos[2]); f.obj.rotation.y = time * 1.4;
      beacon(it.id + ':b', it.pos, !it.taken);
    }
    for (const g of ts.guards) {
      want.add(g.id); want.add(g.id + ':cone');
      let f = figs.get(g.id);
      if (!f) { f = makeFig('guard', 4); figs.set(g.id, f); }
      f.obj.position.set(g.pos[0], g.pos[1], g.pos[2]); f.obj.rotation.y = g.yaw; f.h.anim(dt, { speed: 0 });
      let c = figs.get(g.id + ':cone');
      const range = g.range * D.tale.walkSight;
      if (!c) {
        const geo = new THREE.CircleGeometry(1, 20, Math.PI / 2 - g.cone, g.cone * 2).rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, M.cone); scene.add(mesh); c = { obj: mesh, kind: 'cone' }; figs.set(g.id + ':cone', c);
      }
      c.obj.position.set(g.pos[0], g.pos[1] + 0.25, g.pos[2]); c.obj.rotation.y = g.yaw - Math.PI / 2; c.obj.scale.set(range, 1, range);
      c.obj.material = g.charmed > 0 ? M.coneOff : M.cone;
    }
    const goal = TL.objective(ts);
    if (goal && goal.at) beacon('goal:b', goal.at, true);
    for (const id of [...figs.keys()]) if (!want.has(id) && !beams.has(id)) dropFig(id);
    for (const [id, b] of beams) { if (!wantBeam.has(id)) { scene.remove(b); beams.delete(id); } }
    wantBeam.clear();
  }
  const beams = new Map(), wantBeam = new Set();
  function beacon(id, p, on) {
    if (!on) return;
    wantBeam.add(id);
    let b = beams.get(id);
    if (!b) { b = new THREE.Mesh(beamGeo, M.beam); scene.add(b); beams.set(id, b); }
    b.position.set(p[0], TR.surfaceAt(REGION, p[0], p[2]), p[2]);
  }

  /* ---------- frame ---------- */
  let last = performance.now(), time = 0, fpsAcc = 0, fpsN = 0, fps = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    fpsAcc += dt; fpsN++; if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    if (state !== 'play' || storyCard.open) dt = 0;
    time += reduceMotion ? dt * 0.4 : dt;
    if (!world || !ts) {                                          // the menu: a slow drift over the city
      if (world) { const a = now / 40000; camera.position.set(260 + Math.sin(a) * 380, 160, -150 + Math.cos(a) * 380); camera.lookAt(260, 30, -120); }
      else { camera.position.set(0, 50, 0); camera.lookAt(1, 50, 0); }
      skyView.update(0.45);
      if (world) world.region.update(camera.position, time, { dt, camera, viewH: renderer.domElement.height });
      renderer.render(scene, camera);
      return;
    }
    if (dt > 0) {
      const inp = readInput();
      const targets = TL.targetsFor(ts);
      const hev = H.step(me, inp, dt, Object.assign({ regionId: REGION, targets }, world.sol));
      onEvents(hev);
      onEvents(TL.step(ts, me, hev, dt));
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i]; b.t += dt;
        const k = Math.min(1, b.t / b.dur);
        b.m.position.lerpVectors(b.from, b.to, k); b.m.position.y += Math.sin(k * Math.PI) * 1.2;
        if (k >= 1) { shimmer.play(b.to, b.col); scene.remove(b.m); bolts.splice(i, 1); }
      }
    }
    heroFig.root.position.set(me.pos[0], me.pos[1], me.pos[2]); heroFig.root.rotation.y = me.yaw;
    heroFig.anim(dt, { speed: Math.abs(me.speed), run: me.running, air: me.ground ? 0 : 1, attack: me.gift === 'strike' ? me.act : 0, cast: me.gift !== 'strike' ? me.act : 0 });
    syncFigs(dt, time);
    shimmer.update(dt);
    camWant(tmp);
    camPos.lerp(tmp, dt > 0 ? 1 - Math.exp(-dt * 6) : 0);
    camLook.set(me.pos[0] + Math.sin(me.yaw) * 3, me.pos[1] + 1.5, me.pos[2] + Math.cos(me.yaw) * 3);
    camera.position.copy(camPos); camera.lookAt(camLook);
    const L = LIGHT[ts.id] || [];
    skyView.update(L[ts.ch] != null ? L[ts.ch] : 0.45);
    skyView.mesh.position.copy(camera.position);
    const night = 1 - (skyView.state ? skyView.state.light : 1);
    world.region.update(camera.position, time, { dt, camera, viewH: renderer.domElement.height });
    world.townView.update(world.town, dt, { cam: camera.position, particles: tier === 'low' ? 0.4 : 1, pxScale: renderer.domElement.height * 0.5, lights: fireLights, time });
    if (world.castleView) world.castleView.update(dt, { town: world.town, cam: camera.position, time, night });
    if (world.cityView) world.cityView.update(camera.position, dt, night);
    if (window.VTex) VTex.tick(time);
    if (state === 'play') hud(dt);
    renderer.render(scene, camera);
    if (debug && fpsN === 0) console.log('fps', fps.toFixed(0), 'calls', renderer.info.render.calls, 'tris', renderer.info.render.triangles, 'pos', me.pos.map(v => v.toFixed(0)).join(','));
  }

  /* ---------- go ---------- */
  if (window.I18N && I18N.onChange) I18N.onChange(() => { objShown = ''; if (state === 'intro') renderIntro(); });
  setState('intro');
  requestAnimationFrame(frame);
  const direct = params.get('tale');
  if (direct && D.tales[direct]) begin(direct, params.has('restart'));
  else setTimeout(() => { if (!world) { buildWorld(); } }, 400);   // Prahold behind the menu
  window.__vhero = { get ts() { return ts; }, get me() { return me; }, get world() { return world; }, begin, renderer };
})();
