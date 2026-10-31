"""Renders a region preview (hillshade, water, place names) from the committed crop, for specs and reviews.

Usage: python3 tools/terrain/preview.py REGION [out.png]     (needs matplotlib)
"""
import os, sys
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt, matplotlib.patheffects as pe
import terrain_lib as T
from bake import bake


def main(rid, out=None):
    cfg, m, G, W, poly = bake(rid)
    pv, R, C = cfg['preview'], cfg['grid']['radius'], cfg['grid']['cell']
    gy, gx = np.gradient(G * pv['exag'], C * cfg['projection']['metresPerUnit'])
    sh = np.clip((-gx * 0.7 + gy * 0.7 + 1) / np.sqrt(gx ** 2 + gy ** 2 + 1), 0, 1)
    n = (G - G.min()) / (G.max() - G.min())
    rgb = np.stack([90 + 110 * n, 125 + 85 * n, 70 + 60 * n], -1) * (0.45 + 0.65 * sh[..., None]); rgb[W] = [45, 95, 170]
    f, a = plt.subplots(figsize=(8, 8), dpi=100)
    e = R + C / 2
    a.imshow(np.clip(rgb, 0, 255).astype(np.uint8), origin='lower', extent=[-e, e, -e, e])
    t = np.linspace(0, 2 * np.pi, 200); a.plot(R * np.cos(t), R * np.sin(t), 'k', lw=1)
    stroke = [pe.withStroke(linewidth=2.5, foreground='k')]
    for pl in pv['places']:
        name, x, z = pl[:3]
        a.plot(x, z, 'o', color='#b0242a' if len(pl) > 3 and pl[3] == 'order' else 'k', ms=6, mec='w')
        a.annotate(name, (x, z), xytext=(7, 4), textcoords='offset points', fontsize=9, color='w', weight='bold', path_effects=stroke)
    if 'label' in pv:
        lb = pv['label']; a.text(*lb['at'], lb['text'], color='#dfeaff', fontsize=11, style='italic', rotation=lb.get('rotate', 0),
                                 path_effects=[pe.withStroke(linewidth=2, foreground='#234')])
    if 'entry' in pv:
        en = pv['entry']; a.annotate(en['text'], tuple(en['at']), xytext=(en['at'][0] + 250, en['at'][1] - 35), color='w', fontsize=9,
                                     arrowprops=dict(arrowstyle='->', color='w'), path_effects=[pe.withStroke(linewidth=2, foreground='k')])
    a.text(R * 0.79, R * 0.9, 'N', fontsize=14, weight='bold'); a.set_xticks([]); a.set_yticks([])
    a.set_title('%s - real terrain (height x%s)' % (cfg['title'], pv['exag']))
    plt.tight_layout()
    out = out or os.path.join(T.ROOT, pv['out'])
    plt.savefig(out); print('wrote', out)


if __name__ == '__main__':
    main(*sys.argv[1:])
