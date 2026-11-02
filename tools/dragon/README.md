# Dragon asset build

This directory contains the reproducible Blender asset generator for the Verdigris dragon.

## Build

Requires Blender 4.x. From the repository root:

```sh
blender -b -P tools/dragon/build_dragon.py
```

The script writes:
- `assets/dragon/verdigris_dragon.glb` — skinned GLB with named armature and embedded material textures
- `assets/dragon/dragon_basecolor.png`
- `assets/dragon/dragon_roughness.png`
- `assets/dragon/dragon_normal.png`

## Rig contract

The armature includes `root`, `pelvis`, `spine_01`, `spine_02`, `neck_01`, `neck_02`, `head`, `jaw`, a four-bone tail chain, bilateral `shoulder` / `wing_elbow` / `wing_wrist`, and bilateral leg chains.

## Important quality note

This is an automated high-density starter asset, not a human sculpt, retopology pass, hand-painted texture set, or animation-polished production character. The script gives the project a reproducible skinned GLB and editable source maps to iterate on. A character artist should still refine anatomy, topology, UVs, facial forms, wing attachment, weights, and paint final 1K/4K maps before calling it final-game quality.
