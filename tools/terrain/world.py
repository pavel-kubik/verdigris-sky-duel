"""The whole kingdom in one terrain model: Mount Rip in the north, the Wildwood and the River Farmlands on the Vltava
valley between, the Veltava Bend with Prahold in the south (campaign/core/dem-world.js).

Usage (from the repo root, needs numpy, scipy, pillow; matplotlib for the preview):
  python3 tools/terrain/world.py crop      cut sources/world_dtm.png out of the raw tile (after fetch_sources.py)
  python3 tools/terrain/world.py bake      write campaign/core/dem-world.js from the committed crop
  python3 tools/terrain/world.py places    print the game positions (world and zone) of the real places in world.json
  python3 tools/terrain/world.py preview   hillshade + river + zones + places -> ai_sdlc/001_campaign/img/world-terrain.png

The warp (config `warp`): Prahold (Z <= south.z) and Mount Rip (Z >= north.z) keep 3.6 m per unit around their own
centres (so the Bend and Rip modules and this one agree), the land between is drawn at a scale that rises and falls
smoothly (a cosine bump) so that Rip lies due north of Prahold at north.z0 units; the centre line moves smoothly from
Prague's longitude to Rip's. +X = west, +Z = north (the game's axes).
"""
import base64, heapq, json, math, os, sys
import numpy as np
from PIL import Image
import terrain_lib as T

MY = 111200.0                       # metres per degree of latitude (as terrain_lib)
CFG = None


def cfg():
    global CFG
    if CFG is None: CFG = T.region('world')
    return CFG


def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)


class Warp:
    def __init__(self, w):
        s, n = w['south'], w['north']
        self.s, self.n, self.mpu = s, n, w['metresPerUnit']
        self.zs, self.zn = s['z'], n['z']
        self.L = self.zn - self.zs
        D = (n['lat0'] - s['lat0']) * MY                           # real metres from Prague's centre north to Rip's
        self.a = 2 * (D - self.mpu * n['z0']) / self.L             # height of the scale bump (m per unit)

    def t(self, Z): return np.clip((np.asarray(Z, float) - self.zs) / self.L, 0, 1)

    def scale(self, Z):
        """Metres per unit at Z."""
        t = self.t(Z); inside = (np.asarray(Z) > self.zs) & (np.asarray(Z) < self.zn)
        return self.mpu + np.where(inside, self.a * (1 - np.cos(2 * np.pi * t)) / 2, 0)

    def north(self, Z):
        """Metres north of Prague's centre."""
        Z = np.asarray(Z, float); m = self.mpu
        mid = np.clip(Z, self.zs, self.zn) - self.zs
        bump = self.a / 2 * (mid - self.L / (2 * np.pi) * np.sin(2 * np.pi * mid / self.L))
        return m * Z + bump

    def lonlat(self, X, Z):
        X, Z = np.asarray(X, float), np.asarray(Z, float)
        lat = self.s['lat0'] + self.north(Z) / MY
        k = smooth(self.t(Z))
        lonc = self.s['lon0'] + (self.n['lon0'] - self.s['lon0']) * k
        latc = self.s['lat0'] + (self.n['lat0'] - self.s['lat0']) * k
        mx = 111320 * np.cos(np.radians(latc))
        return lonc - X * self.scale(Z) / mx, lat

    def game(self, lon, lat):
        """Inverse: (lon, lat) -> (X, Z) by bisection on Z (north() is monotone)."""
        target = (lat - self.s['lat0']) * MY
        lo, hi = -20000.0, 30000.0
        for _ in range(80):
            mid = (lo + hi) / 2
            if self.north(mid) < target: lo = mid
            else: hi = mid
        Z = (lo + hi) / 2
        lon0, _ = self.lonlat(0, Z)
        k = smooth(self.t(Z)); latc = self.s['lat0'] + (self.n['lat0'] - self.s['lat0']) * k
        X = (lon0 - lon) * 111320 * math.cos(math.radians(latc)) / float(self.scale(Z))
        return float(X), float(Z)


def crop():
    from fetch_sources import CACHE
    c = cfg(); src = json.load(open(os.path.join(T.HERE, 'sources.json')))[c['tile']]
    lat0, lon0 = int(c['tile'][1:3]), int(c['tile'][4:7]); st = c['crop']['step']
    H = np.fromfile(os.path.join(CACHE, src['hgt']), '>i2').reshape(3601, 3601)
    (w, e), (s, n) = c['crop']['lon'], c['crop']['lat']
    r0, r1 = round((lat0 + 1 - n) * 3600), round((lat0 + 1 - s) * 3600)
    c0, c1 = round((w - lon0) * 3600), round((e - lon0) * 3600)
    a = H[r0:r1 + 1:st, c0:c1 + 1:st].astype(np.float64)
    png, meta = T.crop_paths('world')
    Image.fromarray(np.round(a * 10).astype(np.uint16)).save(png, optimize=True)
    json.dump({'tile': c['tile'], 'lon': [lon0 + c0 / 3600, lon0 + c1 / 3600], 'lat': [lat0 + 1 - r1 / 3600, lat0 + 1 - r0 / 3600],
               'perDegree': 3600 / st, 'scale': 10, 'offset': 0, 'shape': list(a.shape),
               'source': src['what'] + ', every %d. sample' % st, 'licence': src['licence']}, open(meta, 'w'), indent=2)
    print('wrote', png, a.shape)


def heights():
    """Heights (m) on the world grid: rows = Z (south -> north), cols = X (east -> west)."""
    from scipy.ndimage import map_coordinates
    c = cfg(); H, m = T.load_crop('world'); g = c['grid']; W = Warp(c['warp'])
    xs = np.arange(g['x'][0], g['x'][1] + 1, g['cell']); zs = np.arange(g['z'][0], g['z'][1] + 1, g['cell'])
    X, Z = np.meshgrid(xs, zs)
    lon, lat = W.lonlat(X, Z)
    row = (m['lat'][1] - lat) * m['perDegree']; col = (lon - m['lon'][0]) * m['perDegree']
    return xs, zs, X, Z, map_coordinates(H, [row, col], order=1, mode='nearest')


def river(xs, zs, X, Z, G):
    """The Vltava from the Bend's north-west edge downstream to the world's east edge: least-cost path on the valley floor."""
    from scipy.ndimage import gaussian_filter1d
    rc = cfg()['river']; cell = cfg()['grid']['cell']
    near = lambda x, z: (int(round((z - zs[0]) / cell)), int(round((x - xs[0]) / cell)))
    r0, c0 = near(*rc['start'])
    win = G[r0 - 4:r0 + 5, c0 - 4:c0 + 5]; dr, dc = np.unravel_index(np.argmin(win), win.shape)
    start = (r0 - 4 + dr, c0 - 4 + dc)
    gl = rc['goal']
    cand = np.argwhere((X < gl['xBelow']) & (Z > gl['z'][0]) & (Z < gl['z'][1]))
    goals = set(map(tuple, cand))
    cost = np.exp((G - G.min()) / rc['costScale'])
    dist = np.full(G.shape, np.inf); prev = {}; dist[start] = 0; pq = [(0, start)]; end = None
    while pq:
        d, u = heapq.heappop(pq)
        if u in goals: end = u; break
        if d > dist[u]: continue
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == dc == 0: continue
                v = (u[0] + dr, u[1] + dc)
                if not (0 <= v[0] < G.shape[0] and 0 <= v[1] < G.shape[1]): continue
                nd = d + cost[v] * (1.414 if dr and dc else 1)
                if nd < dist[v]: dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    path = [end]
    while path[-1] != start: path.append(prev[path[-1]])
    path = np.array(path[::-1])
    P = np.array([[xs[c], zs[r]] for r, c in path], float)
    P = np.stack([gaussian_filter1d(P[:, 0], rc['smooth']), gaussian_filter1d(P[:, 1], rc['smooth'])], 1)
    lv = np.minimum.accumulate(gaussian_filter1d(G[path[:, 0], path[:, 1]], 3))
    keep = rdp_idx(P, rc['simplify'])
    return [[int(round(P[i, 0] / 5) * 5), int(round(P[i, 1] / 5) * 5), round(float(lv[i]), 1)] for i in keep]


def rdp_idx(P, eps, lo=0, hi=None):
    hi = len(P) - 1 if hi is None else hi
    if hi - lo < 2: return [lo, hi]
    a, b = P[lo], P[hi]; ab = b - a; q = P[lo:hi + 1] - a
    d = np.abs(ab[0] * q[:, 1] - ab[1] * q[:, 0]) / max(1e-9, np.hypot(*ab))
    i = int(np.argmax(d)) + lo
    if d[i - lo] <= eps: return [lo, hi]
    return rdp_idx(P, eps, lo, i)[:-1] + rdp_idx(P, eps, i, hi)


TPL = """/*
 * Verdigris campaign - baked terrain of the %(title)s. GENERATED by tools/terrain/world.py bake, do not edit
 * (config tools/terrain/regions/world.json, source tools/terrain/sources/world_dtm.png).
 * Source: %(source)s.
 * Licence: %(licence)s.
 * World axes: +X = west, +Z = north, units; Prahold (the Bend) is centred on 0, 0 and Mount Rip on 0, 7200. The land
 * between is warped (tools/terrain/world.py Warp): Prahold and Rip keep 3.6 m per unit, the Vltava valley between is
 * drawn smaller (up to %(peak).1f m per unit) so that Rip lies due north of the city.
 *   nx x nz samples, `cell` units apart, x from x0, z from z0 (row = z, column = x);
 *   h: base64 Uint8, (metres - base) / step; scale: metres per unit along z (one value per row, for the exaggeration);
 *   river: the Vltava's centre line in flow direction, [x, z, level in metres].
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  M.define('demWorld', {
    nx: %(nx)d, nz: %(nz)d, cell: %(cell)d, x0: %(x0)d, z0: %(z0)d, base: %(base)d, step: %(step)s, metresPerUnit: %(mpu)s,
    scale: %(scale)s,
    river: %(river)s,
    h: '%(h)s',
  });
})(typeof window !== 'undefined' ? window : globalThis);
"""


def bake():
    c = cfg(); g = c['grid']; H, m = T.load_crop('world')
    xs, zs, X, Z, G = heights()
    rv = river(xs, zs, X, Z, G)
    W = Warp(c['warp'])
    sc = [round(float(W.scale(z)), 3) for z in zs]
    out = os.path.join(T.ROOT, c['out'])
    q = np.clip(np.round((G - g['base']) / g['step']), 0, 255).astype(np.uint8)
    open(out, 'w').write(TPL % {
        'title': c['title'], 'source': m['source'], 'licence': m['licence'], 'peak': max(sc),
        'nx': len(xs), 'nz': len(zs), 'cell': g['cell'], 'x0': g['x'][0], 'z0': g['z'][0], 'base': g['base'], 'step': g['step'],
        'mpu': c['warp']['metresPerUnit'], 'scale': json.dumps(sc[::5]), 'river': json.dumps(rv),
        'h': base64.b64encode(q.tobytes()).decode()})
    print('wrote', c['out'], len(xs), 'x', len(zs), 'river points', len(rv), 'heights', round(G.min(), 1), '-', round(G.max(), 1))


ZONES = [('bend', 0), ('farm', 2400), ('wild', 4800), ('ash', 7200)]


def places():
    c = cfg(); W = Warp(c['warp'])
    for name, lon, lat in c['places']:
        X, Z = W.game(lon, lat)
        zid, oz = min(ZONES, key=lambda zz: abs(Z - zz[1]))
        print('%-12s world %6d %6d   %s %6d %6d' % (name, X, Z, zid, X, Z - oz))


def preview(out=None):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt, matplotlib.patheffects as pe
    c = cfg(); g = c['grid']; W = Warp(c['warp'])
    xs, zs, X, Z, G = heights()
    rv = np.array(river(xs, zs, X, Z, G))
    gy, gx = np.gradient(G * 1.8, g['cell'] * 3.6); gx = -gx
    sh = np.clip((-gx * 0.7 + gy * 0.7 + 1) / np.sqrt(gx ** 2 + gy ** 2 + 1), 0, 1)
    n = np.clip((G - 160) / 260, 0, 1)
    rgb = np.stack([96 + 110 * n, 128 + 80 * n, 72 + 56 * n], -1) * (0.45 + 0.65 * sh[..., None])
    f, a = plt.subplots(figsize=(5, 14), dpi=110)
    a.imshow(np.clip(rgb, 0, 255).astype(np.uint8), origin='lower', extent=[xs[0], xs[-1], zs[0], zs[-1]])
    a.set_xlim(xs[-1], xs[0])
    a.plot(rv[:, 0], rv[:, 1], color='#2d5faa', lw=2.5)
    for zid, oz in ZONES:
        a.add_patch(plt.Rectangle((-1200, oz - 1200), 2400, 2400, fill=False, ec='w', lw=1, ls='--'))
        a.text(1150, oz + 1080, zid, color='w', fontsize=9, path_effects=[pe.withStroke(linewidth=2, foreground='k')])
    for name, lon, lat in c['places']:
        x, z = W.game(lon, lat)
        a.plot(x, z, 'o', color='k', ms=4, mec='w')
        a.annotate(name, (x, z), xytext=(4, 3), textcoords='offset points', fontsize=7, color='w', path_effects=[pe.withStroke(linewidth=2, foreground='k')])
    a.set_xticks([]); a.set_yticks([]); a.set_title('Mount Rip to Prahold - real terrain')
    plt.tight_layout()
    out = out or os.path.join(T.ROOT, 'ai_sdlc/001_campaign/img/world-terrain.png')
    plt.savefig(out); print('wrote', out)


if __name__ == '__main__':
    {'crop': crop, 'bake': bake, 'places': places, 'preview': preview}[sys.argv[1]](*sys.argv[2:])
