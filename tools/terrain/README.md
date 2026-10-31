# Terrain tools - real landscapes for campaign regions

Campaign regions built on real places (from Phase 3: the Veltava Bend = Prague) take their heights and rivers from a real
terrain model, not from noise. These scripts turn a raw elevation tile into a small game module
(`campaign/core/dem-<region>.js`) and a preview image. Everything needed to rebuild or extend the maps is here.

## Pipeline

```
sources.json --fetch_sources.py--> .cache/N50E014.hgt         raw tile (not committed, 26 MB)
                --crop.py REGION--> sources/REGION_dtm.png     committed 16-bit crop + REGION_dtm.json bounds
                --bake.py REGION--> campaign/core/dem-REGION.js   game module (heights, river mask, river line)
             --preview.py REGION--> ai_sdlc/001_campaign/img/REGION-terrain.png
```

| File | What |
| --- | --- |
| `sources.json` | Raw tiles: what they are, licence, download URL, sha256 of the zip and the tile |
| `regions/<id>.json` | Region config: tile, crop window, projection (centre lon / lat, metres per game unit), game grid, river tracing parameters, preview labels, the fantasy names with their Czech forms and the real places |
| `sources/<id>_dtm.png` + `.json` | Committed crop of the raw tile (lossless 16-bit PNG, 0.1 m steps, rows north -> south) with its exact bounds, so a bake never depends on the upstream download |
| `fetch_sources.py` | Downloads and checks the raw tiles (only needed for `crop.py`) |
| `crop.py` | Cuts the region window out of the raw tile |
| `bake.py` | Projects the crop onto the game grid, traces the river (least-cost path along the valley floor), marks water at river level, writes the module |
| `preview.py` | Hillshade + water + place names, for specs and reviews |
| `terrain_lib.py` | Shared: config, crop loading, projection |

Requirements: Python 3 with `numpy`, `scipy`, `pillow` (+ `matplotlib` for the preview). Run from the repo root:

```
python3 tools/terrain/bake.py bend          # rebuild campaign/core/dem-bend.js from the committed crop
python3 tools/terrain/preview.py bend       # rebuild the preview image
node campaign/test/run.js                   # dem.test.js checks the module against known Prague heights
```

## Sources and licence

- **Sonny's LiDAR Digital Terrain Model of Europe**, 1 arc second (about 30 m), SRTM `.hgt` tiles; for Czechia it is
  derived from **ČÚZK DMR 5G** (open data). Homepage: https://sonny.4lima.de/
- Tile `N50E014` (50-51 N, 14-15 E, covers Prague) was fetched on 2026-10-31 from a Git LFS copy in
  `pandasoft-zz/CzechTouristMap` (URL and checksums in `sources.json`); the official download is on Sonny's site.
- Licence: CC BY 4.0. Credit in the game and README: *Terrain: ČÚZK (DMR 5G) via Sonny's LiDAR DTM Europe*.
- Considered and not used: ASTER water bodies (`ASTWBDV001_N50E014`) - its mask had no water for the Prague river at this
  resolution, so the river is traced from the terrain instead; OpenStreetMap and tile servers - not reachable from the
  build sandbox.

## Veltava Bend (`regions/bend.json`)

- Crop 14.33-14.53 E, 50.02-50.15 N; projection around 14.4325 E, 50.0905 N at 3.6 m per unit (+X east, +Z north);
  grid 241 x 241 every 10 units, radius 1200 (8.6 km across).
- River traced from the south edge (Podolí) to the north-west edge (Troja / Podbaba), water within 170 units of the
  path and at most 1.2 m above the smoothed river level; result: the real Vltava with its loop and islands.
- Checked: Vyšehrad rock 236 m, Petřín 326 m, Letná 229 m, Vítkov 253 m, river 175-190 m.
- The game exaggerates heights 1.6x (`regions.bend.terrain.exag` in `campaign/core/data.js`) so hills read on a phone.

## Adding a region

1. Add the tile to `sources.json` if it is new (any SRTM-format 1 arc second tile works), run `fetch_sources.py`.
2. Copy `regions/bend.json`, set the crop, the centre, the scale and the river start / goal areas.
3. `crop.py <id>`, `bake.py <id>`, `preview.py <id>`; look at the preview, tune `river` until the water is right.
4. Commit the crop, the config, the module and the preview; load the module in `campaign/index.html` and `sw.js`
   when the region goes into the game.
