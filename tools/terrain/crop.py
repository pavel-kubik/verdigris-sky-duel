"""Cuts a region's window out of a raw tile and stores it in sources/ as a lossless 16-bit PNG + JSON bounds.

Usage: python3 tools/terrain/crop.py REGION        (after fetch_sources.py)
The crop is committed, so later bakes do not depend on the upstream download staying online.
"""
import json, os, sys
import numpy as np
from PIL import Image
import terrain_lib as T
from fetch_sources import CACHE

SCALE, OFFSET = 10, 0           # 0.1 m steps, so 0..6553 m fits uint16


def main(rid):
    cfg = T.region(rid)
    src = json.load(open(os.path.join(T.HERE, 'sources.json')))[cfg['tile']]
    lat0, lon0 = int(cfg['tile'][1:3]), int(cfg['tile'][4:7])
    H = np.fromfile(os.path.join(CACHE, src['hgt']), '>i2').reshape(3601, 3601)
    (w, e), (s, n) = cfg['crop']['lon'], cfg['crop']['lat']
    r0, r1 = round((lat0 + 1 - n) * 3600), round((lat0 + 1 - s) * 3600)
    c0, c1 = round((w - lon0) * 3600), round((e - lon0) * 3600)
    a = H[r0:r1 + 1, c0:c1 + 1].astype(np.float64)
    png, meta = T.crop_paths(rid)
    Image.fromarray(np.round((a - OFFSET) * SCALE).astype(np.uint16)).save(png, optimize=True)
    json.dump({'tile': cfg['tile'], 'lon': [lon0 + c0 / 3600, lon0 + c1 / 3600], 'lat': [lat0 + 1 - r1 / 3600, lat0 + 1 - r0 / 3600],
               'perDegree': 3600, 'scale': SCALE, 'offset': OFFSET, 'shape': list(a.shape),
               'source': src['what'], 'licence': src['licence']}, open(meta, 'w'), indent=2)
    print('wrote', png, a.shape, 'min', a.min(), 'max', a.max())


if __name__ == '__main__':
    main(sys.argv[1])
