"""Bakes campaign/core/dem-bend.js (the Veltava Bend terrain, Phase 3) from real Prague terrain.

Input: Sonny's LiDAR DTM Europe, 1 arc second, tile N50E014.hgt (big-endian int16, 3601 x 3601, metres), based on
the ČÚZK DMR 5G. The copy used on 2026-10-31 came from the CzechTouristMap repo (terrain/sonny/N50E014.zip, Git LFS):
https://media.githubusercontent.com/media/pandasoft-zz/CzechTouristMap/main/terrain/sonny/N50E014.zip
Usage: python3 bake_bend_dem.py path/to/N50E014.hgt  (needs numpy, scipy)

Steps: project around 14.4325 E, 50.0905 N at 3.6 m per unit (+X east, +Z north), sample a 241 x 241 grid every
10 units (radius 1200), trace the river as the least-cost path along the valley floor from the south edge to the
north-west edge, mark water where a cell is within 170 units of the path and at most 1.2 m above the smoothed
(monotone downstream) river level, simplify the path to a polyline, write heights as metres above 170 (uint8).
"""
import sys, json, heapq, base64
import numpy as np
from scipy.ndimage import map_coordinates, gaussian_filter, gaussian_filter1d, distance_transform_edt

LON0, LAT0, S, R, CELL = 14.4325, 50.0905, 3.6, 1200, 10
N = 2 * R // CELL + 1
BASE = 170
OUT = 'campaign/core/dem-bend.js'


def load(path):
    return np.fromfile(path, '>i2').reshape(3601, 3601).astype(np.float64)


def grid(H):
    mx, my = 111320 * np.cos(np.radians(LAT0)), 111200
    xs = np.arange(N) * CELL - R
    X, Z = np.meshgrid(xs, xs)
    lon, lat = LON0 + X * S / mx, LAT0 + Z * S / my
    return xs, X, Z, map_coordinates(H, [(51 - lat) * 3600, (lon - 14) * 3600], order=1)


def river_path(G, X, Z, xs):
    inside = X ** 2 + Z ** 2 < R * R
    def edge_min(cond):
        idx = np.argwhere(cond)
        return tuple(idx[int(np.argmin([G[r, c] for r, c in idx]))])
    start = edge_min((Z < -1150) & (np.abs(X + 375) < 200) & inside)
    goal = edge_min((Z > 950) & (X < -450) & inside & (X ** 2 + Z ** 2 > 1050 ** 2))
    cost = np.exp((G - G.min()) / 6.0)
    dist = np.full(G.shape, np.inf); prev = {}; dist[start] = 0; pq = [(0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == goal: break
        if d > dist[u]: continue
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == dc == 0: continue
                v = (u[0] + dr, u[1] + dc)
                if not (0 <= v[0] < N and 0 <= v[1] < N): continue
                nd = d + cost[v] * (1.414 if dr and dc else 1)
                if nd < dist[v]: dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    path = [goal]
    while path[-1] != start: path.append(prev[path[-1]])
    return np.array(path[::-1])


def water(G, path):
    pr, pc = path[:, 0], path[:, 1]
    lvl = np.minimum.accumulate(gaussian_filter(G[pr, pc], 3))
    mask = np.zeros(G.shape, bool); mask[pr, pc] = True
    d, ind = distance_transform_edt(~mask, return_indices=True)
    idx = np.full(G.shape, -1); idx[pr, pc] = np.arange(len(path))
    return (d * CELL < 170) & (G <= lvl[idx[ind[0], ind[1]]] + 1.2)


def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; ab = b - a; q = pts - a
    d = np.abs(ab[0] * q[:, 1] - ab[1] * q[:, 0]) / np.hypot(*ab)
    i = int(np.argmax(d))
    return np.vstack([rdp(pts[:i + 1], eps)[:-1], rdp(pts[i:], eps)]) if d[i] > eps else np.array([a, b])


def main(path):
    xs, X, Z, G = grid(load(path))
    p = river_path(G, X, Z, xs)
    W = water(G, p)
    P = np.array([[xs[c], xs[r]] for r, c in p], float)
    P = np.stack([gaussian_filter1d(P[:, 0], 4), gaussian_filter1d(P[:, 1], 4)], 1)
    poly = (np.round(rdp(P, 12) / 5) * 5).astype(int).tolist()
    h = base64.b64encode(np.clip(np.round(G - BASE), 0, 255).astype(np.uint8).tobytes()).decode()
    w = base64.b64encode(np.packbits(W.astype(np.uint8).ravel()).tobytes()).decode()
    tpl = """/*
 * Verdigris campaign - baked terrain of the Veltava Bend (Phase 3, 003_task_missions.md 4.2). GENERATED, do not edit:
 * made by ai_sdlc/001_campaign/tools/bake_bend_dem.py from real Prague terrain (Sonny's LiDAR DTM Europe, tile N50E014,
 * based on the ČÚZK DMR 5G; projection around 14.4325 E, 50.0905 N at 3.6 m per unit, +X = east, +Z = north).
 *   size x size samples, `cell` units apart, x and z from -radius to +radius (row = z, column = x);
 *   h: base64 Uint8, metres above `base` (1 m steps); water: base64 bitset (row-major, MSB first), 1 = river;
 *   river: centre line polyline (units) from the south edge to the north-west edge.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  M.define('demBend', {
    size: %d, cell: %d, radius: %d, base: %d, metresPerUnit: %s,
    river: %s,
    h: '%s',
    water: '%s',
  });
})(typeof window !== 'undefined' ? window : globalThis);
"""
    open(OUT, 'w').write(tpl % (N, CELL, R, BASE, S, json.dumps(poly), h, w))
    print('wrote', OUT, 'river points', len(poly), 'water cells', int(W.sum()))


if __name__ == '__main__':
    main(sys.argv[1])
