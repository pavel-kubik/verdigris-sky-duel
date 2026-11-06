/*
 * Verdigris campaign - story cards (Phase 3 T17, 003_task_missions.md 5.8 and 6). DOM + a 2D canvas, no THREE.
 *   VRender.storyCard.build(parent, { t }) -> { show(card, onDone), close(), get open() }
 *     card = { kind: 'act', id, act, scene, title, lines } (core/story.js pendingCard: full screen, painted backdrop)
 *          | { kind: 'brief', id, title, lines }            (core/story.js brief: a bottom sheet over the board panel)
 *     Lines appear one by one; Continue first shows the rest, then closes; Skip (act cards) closes at once.
 *     Enter / Space = Continue, Escape = Skip (game.js routes the keys while open). onDone(card) after closing.
 * The world pauses while a card is open (game.js). Backdrops: 'lair' - the egg in the volcano's glow; 'castle' -
 * Vyshgard on its rock over the river at dusk (painted silhouettes, not the 3D scene).
 */
(function (root) {
  'use strict';
  const VR = root.VRender = root.VRender || {};

  const CSS = `
#story{position:fixed;inset:0;z-index:60;display:grid;place-items:end center;pointer-events:auto}
#story[hidden]{display:none}
#story canvas{position:absolute;inset:0;width:100%;height:100%}
#story.brief{background:rgba(5,9,7,.45);place-items:end center}
#story .sheet{position:relative;margin:0 0 calc(16px + env(safe-area-inset-bottom,0px));width:min(560px,calc(100% - 32px));box-sizing:border-box;
  background:rgba(12,19,16,.86);border:1px solid rgba(233,225,204,.18);border-radius:8px;padding:20px 20px 16px;display:grid;gap:10px;color:#ebe3cd}
#story.act .sheet{background:linear-gradient(rgba(10,14,12,0),rgba(10,14,12,.78) 22%);border:0;margin-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
#story .kick{font:700 12px/1 var(--f-ui,system-ui);letter-spacing:.18em;text-transform:uppercase;color:#ff9447}
#story h2{margin:0;font:600 clamp(24px,6vw,34px)/1.15 var(--f-display,serif);color:#f3ead2;text-wrap:balance}
#story p{margin:0;font:400 clamp(16px,4.2vw,19px)/1.45 var(--f-display,serif);color:#e3dac2;opacity:0;transform:translateY(6px);transition:opacity .7s,transform .7s}
#story p.on{opacity:1;transform:none}
#story .row{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}
#story button{min-height:44px;min-width:44px;padding:10px 18px;border-radius:4px;font:700 16px/1 var(--f-ui,system-ui)}
#story .skip{background:transparent;color:#cfc7b1;border:1px solid rgba(233,225,204,.3)}
#story .go{background:#62c48a;color:#08130d;border:0}
`;

  function paint(canvas, scene) {
    const w = canvas.width = Math.round(canvas.clientWidth * Math.min(2, root.devicePixelRatio || 1)) || 780;
    const h = canvas.height = Math.round(canvas.clientHeight * Math.min(2, root.devicePixelRatio || 1)) || 1688;
    const g = canvas.getContext('2d');
    if (!g) return;
    const sky = g.createLinearGradient(0, 0, 0, h);
    if (scene === 'castle') { sky.addColorStop(0, '#1b2236'); sky.addColorStop(0.42, '#7a4a52'); sky.addColorStop(0.62, '#e0875a'); sky.addColorStop(1, '#2a1b18'); }
    else { sky.addColorStop(0, '#07090a'); sky.addColorStop(0.5, '#1a0f0a'); sky.addColorStop(1, '#3b1a0c'); }
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const ridge = (y0, amp, col, seed) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 40) g.lineTo(x, y0 + Math.sin(x / w * 7 + seed) * amp + Math.sin(x / w * 17 + seed * 2) * amp * 0.35);
      g.lineTo(w, h); g.closePath(); g.fill();
    };
    if (scene === 'castle') {
      const sun = g.createRadialGradient(w * 0.72, h * 0.58, 0, w * 0.72, h * 0.58, w * 0.5);
      sun.addColorStop(0, 'rgba(255,190,120,.85)'); sun.addColorStop(1, 'rgba(255,150,90,0)');
      g.fillStyle = sun; g.fillRect(0, 0, w, h);
      ridge(h * 0.6, h * 0.02, '#4a3038', 1.3);                 // far hills
      const ry = h * 0.6;                                       // the rock with its cliff over the river (left)
      g.fillStyle = '#231a1d'; g.beginPath(); g.moveTo(0, h); g.lineTo(0, ry - h * 0.02); g.lineTo(w * 0.08, ry - h * 0.03);
      g.lineTo(w * 0.52, ry - h * 0.035); g.lineTo(w * 0.58, ry + h * 0.04); g.lineTo(w * 0.62, ry + h * 0.1); g.lineTo(w * 0.66, h); g.closePath(); g.fill();
      const base = ry - h * 0.034, wall = (x0, x1, y) => g.fillRect(w * x0, base - h * y, w * (x1 - x0), h * y);
      g.fillStyle = '#1a1316';
      wall(0.03, 0.55, 0.03);                                   // curtain wall
      for (let i = 0; i < 12; i++) g.fillRect(w * (0.035 + i * 0.043), base - h * 0.036, w * 0.018, h * 0.008);   // crenels
      wall(0.06, 0.1, 0.06); wall(0.47, 0.52, 0.065);           // towers
      wall(0.22, 0.32, 0.1);                                    // keep
      const spire = (x, top) => { g.beginPath(); g.moveTo(w * (x - 0.018), base - h * 0.07); g.lineTo(w * x, base - h * top); g.lineTo(w * (x + 0.018), base - h * 0.07); g.fill(); g.fillRect(w * (x - 0.018), base - h * 0.07, w * 0.036, h * 0.04); };
      spire(0.37, 0.17); spire(0.42, 0.17);                     // the twin spires of the chapel
      g.fillStyle = '#ffcf7a';                                  // lit windows
      for (const [x, y] of [[0.25, 0.08], [0.28, 0.08], [0.27, 0.055], [0.37, 0.06], [0.42, 0.06], [0.08, 0.045], [0.49, 0.05]]) g.fillRect(w * x, base - h * y, w * 0.006, h * 0.006);
      g.fillStyle = '#a3202a'; g.fillRect(w * 0.27, base - h * 0.125, w * 0.025, h * 0.012);   // the Order banner on the keep
      g.fillRect(w * 0.268, base - h * 0.125, w * 0.003, h * 0.025);
      const river = g.createLinearGradient(0, ry, 0, h);        // the Veltava below the cliff, the sunset on the water
      river.addColorStop(0, '#c97a55'); river.addColorStop(1, '#2a1d22');
      g.fillStyle = river; g.beginPath(); g.moveTo(w * 0.56, h); g.lineTo(w * 0.6, ry + h * 0.07); g.lineTo(w, ry + h * 0.04); g.lineTo(w, h); g.closePath(); g.fill();
      ridge(h * 0.84, h * 0.012, '#120d0f', 4.1);               // near bank
    } else {
      const glow = g.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, w * 0.7);
      glow.addColorStop(0, 'rgba(255,120,40,.75)'); glow.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      ridge(h * 0.18, h * 0.05, '#0b0807', 0.4);                // cave roof (drawn from the top down)
      g.save(); g.scale(1, -1); g.translate(0, -h); ridge(h * 0.8, h * 0.05, '#0b0807', 2.2); g.restore();
      g.fillStyle = '#1a0f0a'; g.beginPath(); g.ellipse(w * 0.5, h * 0.66, w * 0.3, h * 0.035, 0, 0, Math.PI * 2); g.fill();   // the nest
      const egg = g.createRadialGradient(w * 0.47, h * 0.57, 0, w * 0.5, h * 0.6, w * 0.12);
      egg.addColorStop(0, '#9fe0b4'); egg.addColorStop(0.6, '#2f7a52'); egg.addColorStop(1, '#0f2a1d');
      g.fillStyle = egg; g.beginPath(); g.ellipse(w * 0.5, h * 0.6, w * 0.085, h * 0.065, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(10,20,14,.8)'; g.lineWidth = Math.max(2, w * 0.004); g.beginPath();   // the crack
      g.moveTo(w * 0.45, h * 0.58); g.lineTo(w * 0.48, h * 0.6); g.lineTo(w * 0.5, h * 0.585); g.lineTo(w * 0.53, h * 0.605); g.stroke();
    }
    const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = vig; g.fillRect(0, 0, w, h);
  }

  function build(parent, opts) {
    const t = opts.t;
    if (!document.getElementById('storyCss')) {
      const st = document.createElement('style'); st.id = 'storyCss'; st.textContent = CSS; document.head.appendChild(st);
    }
    const el = document.createElement('section');
    el.id = 'story'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<canvas aria-hidden="true"></canvas><div class="sheet"><div class="kick"></div><h2></h2><div class="lines" style="display:grid;gap:10px"></div>' +
      '<div class="row"><button class="skip" type="button"></button><button class="go" type="button"></button></div></div>';
    parent.appendChild(el);
    const canvas = el.querySelector('canvas'), kick = el.querySelector('.kick'), h2 = el.querySelector('h2'), box = el.querySelector('.lines');
    const skipB = el.querySelector('.skip'), goB = el.querySelector('.go');
    let card = null, done = null, shown = 0, timer = null;

    function reveal(n) {
      const ps = box.querySelectorAll('p');
      shown = Math.min(ps.length, n);
      ps.forEach((p, i) => p.classList.toggle('on', i < shown));
      goB.textContent = t('c.story.continue');
      clearTimeout(timer);
      if (shown < ps.length) timer = setTimeout(() => reveal(shown + 1), 1600);
    }
    function close() {
      if (!card) return;
      clearTimeout(timer);
      const c = card, cb = done;
      card = null; done = null; el.hidden = true;
      if (cb) cb(c);
    }
    function next() { if (!card) return; if (shown < box.children.length) reveal(box.children.length); else close(); }
    function show(c, onDone) {
      if (card) close();
      card = c; done = onDone || null;
      el.className = c.kind === 'act' ? 'act' : 'brief';
      canvas.hidden = c.kind !== 'act';
      kick.textContent = c.kind === 'act' ? t('c.story.act', { n: c.act }) : t('c.story.brief');
      h2.textContent = t(c.title);
      box.innerHTML = '';
      for (const k of c.lines) { const p = document.createElement('p'); p.textContent = t(k); box.appendChild(p); }
      skipB.textContent = t('c.story.skip'); skipB.hidden = c.kind !== 'act';
      el.hidden = false;
      if (c.kind === 'act') paint(canvas, c.scene);
      requestAnimationFrame(() => reveal(1));
      setTimeout(() => goB.focus({ preventScroll: true }), 0);
    }
    goB.addEventListener('click', e => { e.stopPropagation(); next(); });
    skipB.addEventListener('click', e => { e.stopPropagation(); close(); });
    el.addEventListener('pointerdown', e => { if (e.target === el || e.target === canvas) { e.preventDefault(); next(); } });   // a tap on the picture = Continue
    return { show, close, next, get open() { return !!card; }, get card() { return card; } };
  }

  VR.storyCard = { build, paint };
})(typeof self !== 'undefined' ? self : this);
