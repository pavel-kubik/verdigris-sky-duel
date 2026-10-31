/*
 * Verdigris campaign - perception debug view (Phase 2 T14): the sight of every watching post (cs.watch).
 *   VRender.watch.build() -> { group, update(watch, ctx), dispose(), info }
 *   update(watch, { regionId, spot, light, alt, show }): one flat sight fan (faint fill + outline) per post (radius = its current range,
 *     angle = fov, turned to its yaw) on the ground at the post (hills cut it), white idle / yellow suspicious / red alert, brighter while it
 *     sees the dragon; a '?' or '!' sprite over a suspicious or alert post. Hidden when show is false.
 * Shown with ?debug (button / key 7 'sight'); the defenders of T15 get their own awareness marks, the guard sight
 * upgrade (T20) can reuse the fans.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const PC = C.need('perception'), T = C.need('terrain');
  const COL = { idle: 0xe9e1cc, suspicious: 0xffc94a, alert: 0xff4a36 };
  const SEG = 24;

  function fanGeo(fov) {
    const a = Math.min(fov, Math.PI * 2 - 1e-3), pos = [0, 0, 0];
    for (let i = 0; i <= SEG; i++) { const t = -a / 2 + a * i / SEG; pos.push(Math.sin(t), 0, Math.cos(t)); }
    const idx = [];
    for (let i = 1; i <= SEG; i++) idx.push(0, i, i + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  function markTex(ch, col) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(10,10,8,.75)'; x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fill();
    x.fillStyle = col; x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 32, 35);
    return new THREE.CanvasTexture(c);
  }

  function build() {
    const group = new THREE.Group();
    group.name = 'watchView';
    const marks = { suspicious: markTex('?', '#ffc94a'), alert: markTex('!', '#ff4a36') };
    const items = new Map();                       // watcher id -> { fan, mark }
    const info = { posts: 0, shown: 0 };
    let list = null;

    function item(v) {
      let it = items.get(v.id);
      if (it) return it;
      const fan = new THREE.Mesh(fanGeo(v.fov), new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      fan.renderOrder = 3;
      const edge = new THREE.LineLoop(fanGeo(v.fov), new THREE.LineBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.9, depthWrite: false }));
      edge.geometry.setIndex(null);
      fan.add(edge);
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: marks.suspicious, depthTest: false, transparent: true }));
      mark.scale.set(5, 5, 1); mark.renderOrder = 4;
      group.add(fan, mark);
      it = { fan, mark, edge };
      items.set(v.id, it);
      return it;
    }

    function clear() {
      for (const it of items.values()) { group.remove(it.fan, it.mark); it.fan.geometry.dispose(); it.fan.material.dispose(); it.edge.geometry.dispose(); it.edge.material.dispose(); it.mark.material.dispose(); }
      items.clear();
    }

    function update(watch, ctx) {
      group.visible = !!(ctx && ctx.show && watch);
      if (!watch) { info.posts = 0; return; }
      if (watch.list !== list) { clear(); list = watch.list; }
      info.posts = list.length; info.shown = 0;
      if (!group.visible) return;
      for (const v of list) {
        const it = item(v), r = Math.max(1, PC.range(v, ctx));
        it.fan.position.set(v.pos[0], T.surfaceAt(ctx.regionId, v.pos[0], v.pos[2]) + 1.5, v.pos[2]);   // on the post's ground, so it reads from above
        it.fan.rotation.y = v.yaw;
        it.fan.scale.set(r, 1, r);
        it.fan.material.color.setHex(COL[v.state] || COL.idle);
        it.edge.material.color.setHex(COL[v.state] || COL.idle);
        it.fan.material.opacity = v.seen > 0 ? 0.12 : 0.05;
        it.mark.visible = v.state !== 'idle';
        if (it.mark.visible) { it.mark.material.map = marks[v.state] || marks.suspicious; it.mark.position.set(v.pos[0], v.pos[1] + 6, v.pos[2]); }
        info.shown++;
      }
    }

    function dispose() { clear(); marks.suspicious.dispose(); marks.alert.dispose(); }

    return { group, update, dispose, info };
  }

  VR.watch = { build };
})(typeof self !== 'undefined' ? self : this);
