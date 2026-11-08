/*
 * Verdigris campaign - the mission objective in the world (Phase 3 T12, Pavel's feedback on T11).
 * While a mission has a target in the current region (missions.target), a pulsing gold ring lies on the ground around
 * it (radius target.r) and a soft gold light beam rises over it, so the objective is easy to find from the air; the beam
 * fades out as the dragon comes close (data.mission.ring fadeNear .. fadeFar) so it never blocks the view of the target.
 * Gone once the objective is done (fly home), in the cave and in an aerie. 3 meshes, additive, no lights.
 *   VRender.target.build() -> { group, update(cs, dragonPos, time), dispose() }
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data'), MS = C.need('missions'), TR = C.need('terrain');

  function build() {
    const group = new THREE.Group(); group.name = 'missionTarget'; group.visible = false;
    const R = D.mission.ring;
    const gold = 0xffd34d;
    const ringMat = new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), ringMat);
    ring.rotation.x = -Math.PI / 2; group.add(ring);
    const innerMat = ringMat.clone(); innerMat.opacity = 0.35;
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.66, 48), innerMat);
    inner.rotation.x = -Math.PI / 2; group.add(inner);
    // the beam: an open cylinder whose alpha fades from the ground up (vertex colours on an additive material)
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 6, true);
    beamGeo.translate(0, 0.5, 0);
    const pos = beamGeo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(gold);
    for (let i = 0; i < pos.count; i++) { const k = Math.pow(1 - pos.getY(i), 1.6); col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k; }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    const beam = new THREE.Mesh(beamGeo, beamMat); group.add(beam);
    let at = null;

    function update(cs, dpos, time) {
      const tg = cs && !cs.inLair && !cs.inAerie ? MS.target(cs) : null;
      const on = !!(tg && tg.region === cs.region);
      group.visible = on;
      if (!on) { at = null; return; }
      const key = tg.region + ':' + tg.x.toFixed(1) + ':' + tg.z.toFixed(1);
      if (key !== at) {                                    // the ground height once per spot (a wagon moves: every frame it moves)
        at = key;
        const y = TR.surfaceAt(tg.region, tg.x, tg.z);
        group.position.set(tg.x, y + 0.4, tg.z);
      }
      const pulse = 1 + 0.05 * Math.sin(time * 3);
      ring.scale.setScalar(tg.r * pulse); inner.scale.setScalar(tg.r);
      ringMat.opacity = 0.65 + 0.25 * Math.sin(time * 3);
      const bw = Math.max(2.5, tg.r * 0.18);
      beam.scale.set(bw, R.beam, bw);
      const d = dpos ? Math.hypot(dpos[0] - tg.x, dpos[2] - tg.z) : Infinity;
      const f = Math.min(1, Math.max(0, (d - R.fadeNear) / (R.fadeFar - R.fadeNear)));
      beamMat.opacity = 0.55 * f; beam.visible = f > 0.01;
    }
    function dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      if (group.parent) group.parent.remove(group);
    }
    return { group, update, dispose };
  }

  VR.target = { build };
})(typeof self !== 'undefined' ? self : this);
