/*
 * Verdigris campaign - HUD compass strip (Phase 2 T09). A 2D canvas, no THREE.
 *   VRender.compass.build(canvas, { t, fov }) -> { update(markers, yaw, dt), tap(clientX, clientY) -> marker | null, select(key) }
 * markers come from core/nav.js (world bearings); the strip shows heading ticks, N / E / S / W, and the markers
 * within fov of the heading; markers outside stick to the edges as arrows. The lair always shows its distance,
 * so does the selected (tapped) marker. Marker positions ease (no jumps when a scent updates).
 * Bearings: 0 = +Z = north; yaw grows to the left (stick right lowers yaw), so right of the heading = yaw - bearing > 0.
 */
(function (root) {
  'use strict';
  const VR = root.VRender = root.VRender || {};
  const TAU = Math.PI * 2;
  const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  const COL = { bg: 'rgba(12,19,16,.62)', line: 'rgba(233,225,204,.22)', tick: 'rgba(233,225,204,.55)', text: '#ebe3cd', mute: '#a9ae9b',
                lair: '#ff9447', exit: '#62c48a', dim: '#7d8278', scent: '#e0a040', livestock: '#e6d6a8', settlement: '#c9d4e8', north: '#ff9447' };
  const ORDER = { scent: 0, scentLivestock: 0, exit: 1, settlement: 2, lair: 3 };

  function icon(g, kind, x, y, s, col, alpha) {
    g.save(); g.translate(x, y); g.globalAlpha = alpha; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.8; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 3;
    if (kind === 'lair') {                                   // cave arch
      g.beginPath(); g.moveTo(-s, s * 0.7); g.quadraticCurveTo(-s, -s, 0, -s); g.quadraticCurveTo(s, -s, s, s * 0.7); g.closePath(); g.fill();
      g.fillStyle = '#1a0e06'; g.beginPath(); g.moveTo(-s * 0.4, s * 0.7); g.quadraticCurveTo(-s * 0.4, -s * 0.2, 0, -s * 0.2); g.quadraticCurveTo(s * 0.4, -s * 0.2, s * 0.4, s * 0.7); g.closePath(); g.fill();
    } else if (kind === 'exit') {                            // a path through a gap: two posts and an arrow up
      g.beginPath(); g.moveTo(-s, s * 0.8); g.lineTo(-s, -s * 0.5); g.moveTo(s, s * 0.8); g.lineTo(s, -s * 0.5);
      g.moveTo(0, s * 0.8); g.lineTo(0, -s * 0.8); g.moveTo(-s * 0.45, -s * 0.3); g.lineTo(0, -s * 0.85); g.lineTo(s * 0.45, -s * 0.3); g.stroke();
    } else if (kind === 'settlement') {                       // T12: a house (gable roof)
      g.beginPath(); g.moveTo(-s, -s * 0.05); g.lineTo(0, -s * 0.95); g.lineTo(s, -s * 0.05); g.closePath(); g.fill();
      g.fillRect(-s * 0.7, -s * 0.05, s * 1.4, s * 0.9);
      g.fillStyle = '#1a1410'; g.fillRect(-s * 0.18, s * 0.3, s * 0.36, s * 0.55);
    } else if (kind === 'scentLivestock') {                   // scent over a fence rail
      g.beginPath(); g.arc(-s * 0.35, -s * 0.15, s * 0.42, 0, TAU); g.arc(s * 0.35, -s * 0.3, s * 0.38, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-s, s * 0.75); g.lineTo(s, s * 0.75); g.moveTo(-s * 0.6, s * 0.35); g.lineTo(-s * 0.6, s * 0.95); g.moveTo(s * 0.6, s * 0.35); g.lineTo(s * 0.6, s * 0.95); g.stroke();
    } else {                                                  // scent: three rising wisps
      g.beginPath();
      for (const dx of [-0.6, 0, 0.6]) { g.moveTo(dx * s, s * 0.9); g.bezierCurveTo(dx * s - s * 0.4, s * 0.3, dx * s + s * 0.4, -s * 0.2, dx * s, -s * 0.9); }
      g.stroke();
    }
    g.restore();
  }

  function build(canvas, opts) {
    const t = (opts && opts.t) || (k => k), fov = (opts && opts.fov) || 2.4;
    const g = canvas.getContext('2d');
    const eased = {};                                        // key -> displayed heading-relative angle
    let W = 0, H = 0, dpr = 1, selected = null, laid = [];

    function size() {
      const w = canvas.clientWidth, h = canvas.clientHeight, r = Math.min(2, root.devicePixelRatio || 1);
      if (w === W && h === H && r === dpr) return;
      W = w; H = h; dpr = r;
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
    }
    const xOf = rel => W / 2 + (rel / (fov / 2)) * (W / 2 - 16);

    function distText(d) { return t('c.nav.dist', { d: d >= 1000 ? (d / 1000).toFixed(1) + ' k' : String(Math.round(d / 10) * 10) }); }

    function update(markers, yaw, dt) {
      size();
      if (!W || !H) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // body
      g.fillStyle = COL.bg; g.strokeStyle = COL.line; g.lineWidth = 1;
      const r = H / 2;
      g.beginPath(); g.moveTo(r, 0.5); g.lineTo(W - r, 0.5); g.arc(W - r, r, r - 0.5, -Math.PI / 2, Math.PI / 2); g.lineTo(r, H - 0.5); g.arc(r, r, r - 0.5, Math.PI / 2, Math.PI * 1.5); g.closePath(); g.fill(); g.stroke();
      g.save(); g.beginPath(); g.rect(10, 0, W - 20, H); g.clip();
      // heading ticks every 15 deg, letters every 90
      const step = Math.PI / 12, half = fov / 2 + step;
      g.font = '600 10px "Barlow Semi Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k < 24; k++) {
        const b = k * step, rel = wrap(yaw - b);
        if (Math.abs(rel) > half) continue;
        const x = xOf(rel);
        if (k % 6 === 0) {
          const L = ['c.nav.n', 'c.nav.w', 'c.nav.s', 'c.nav.e'][k / 6];   // bearing 0 = N, +90 deg = to the left = W
          g.fillStyle = k === 0 ? COL.north : COL.mute; g.fillText(t(L), x, H - 8);
        } else {
          g.strokeStyle = COL.tick; g.globalAlpha = k % 3 === 0 ? 0.8 : 0.4; g.beginPath(); g.moveTo(x, H - (k % 3 === 0 ? 9 : 6)); g.lineTo(x, H - 2); g.stroke(); g.globalAlpha = 1;
        }
      }
      g.restore();
      // markers, back to front (lair on top)
      const list = markers.slice().sort((a, b) => (ORDER[a.kind] || 0) - (ORDER[b.kind] || 0));
      const k = 1 - Math.exp(-(dt || 0) * 8), seen = {};
      laid = [];
      for (const m of list) {
        const want = wrap(yaw - m.bearing);
        let rel = eased[m.key];
        rel = rel == null || !dt ? want : wrap(rel + wrap(want - rel) * k);
        eased[m.key] = rel; seen[m.key] = true;
        const edge = Math.abs(rel) > fov / 2, x = edge ? (rel > 0 ? W - 14 : 14) : xOf(rel), y = H / 2 - 3;
        const col = m.dim ? COL.dim : COL[m.kind === 'scentLivestock' ? 'livestock' : m.kind] || COL.text;
        const alpha = m.kind.indexOf('scent') === 0 ? 0.55 + 0.45 * Math.min(1, (m.strength || 1) / 3) : 1;
        const s = m.kind === 'lair' ? 7 : 6;
        if (edge) {                                           // behind: an arrow at the edge pointing the way to turn
          g.save(); g.fillStyle = col; g.globalAlpha = alpha; g.beginPath();
          const d = rel > 0 ? 1 : -1;
          g.moveTo(x + d * 9, y); g.lineTo(x + d * 2, y - 6); g.lineTo(x + d * 2, y + 6); g.closePath(); g.fill(); g.restore();
          icon(g, m.kind, x - (rel > 0 ? 6 : -6), y, s * 0.8, col, alpha * 0.85);
        } else icon(g, m.kind, x, y, s, col, alpha);
        const showD = m.kind === 'lair' || m.key === selected;
        if (showD) {                                          // the lair's distance even at the edge (on the inner side)
          g.save(); g.font = '700 10px "Barlow Semi Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillStyle = col; g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 3;
          const tx = distText(m.dist);
          const right = edge ? rel < 0 : x + s + 3 + g.measureText(tx).width < W - 12;
          g.textAlign = right ? 'left' : 'right'; const pad = edge ? 16 : s + 3;
          g.fillText(tx, right ? x + pad : x - pad, y + 1); g.restore();
        }
        if (m.key === selected) { g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, s + 4, 0, TAU); g.stroke(); }
        laid.push({ m, x });
      }
      for (const key in eased) if (!seen[key]) delete eased[key];
      // heading notch
      g.fillStyle = COL.north; g.beginPath(); g.moveTo(W / 2 - 5, 0); g.lineTo(W / 2 + 5, 0); g.lineTo(W / 2, 6); g.closePath(); g.fill();
    }

    /** The marker under a tap (nearest within 36 px, finger sized), selected until select(null). */
    function tap(clientX) {
      const rc = canvas.getBoundingClientRect(), x = clientX - rc.left;
      let best = null, bd = 36;
      for (const l of laid) { const d = Math.abs(l.x - x); if (d < bd) { bd = d; best = l.m; } }
      selected = best ? best.key : null;
      return best;
    }
    function select(key) { selected = key; }

    return { update, tap, select, get selected() { return selected; } };
  }

  VR.compass = { build };
})(typeof self !== 'undefined' ? self : this);
