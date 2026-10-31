"""Shared helpers for the terrain tools: region config, the committed source crop, projection to the game grid."""
import json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def region(rid):
    return json.load(open(os.path.join(HERE, 'regions', rid + '.json')))


def crop_paths(rid):
    return os.path.join(HERE, 'sources', rid + '_dtm.png'), os.path.join(HERE, 'sources', rid + '_dtm.json')


def load_crop(rid):
    """The committed crop: 16-bit PNG, value = (metres - offset) * scale, rows north -> south, cols west -> east."""
    png, meta = crop_paths(rid)
    m = json.load(open(meta))
    a = np.array(Image.open(png)).astype(np.float64)
    return a / m['scale'] + m['offset'], m


def grid(cfg, H, m):
    """Samples heights (metres) on the game grid: rows = z (south -> north), cols = x (west -> east)."""
    from scipy.ndimage import map_coordinates
    p, g = cfg['projection'], cfg['grid']
    R, C = g['radius'], g['cell']; N = 2 * R // C + 1
    mx, my = 111320 * np.cos(np.radians(p['lat0'])), 111200
    xs = np.arange(N) * C - R
    X, Z = np.meshgrid(xs, xs)
    lon = p['lon0'] + X * p['metresPerUnit'] / mx
    lat = p['lat0'] + Z * p['metresPerUnit'] / my
    row = (m['lat'][1] - lat) * m['perDegree']
    col = (lon - m['lon'][0]) * m['perDegree']
    return xs, X, Z, map_coordinates(H, [row, col], order=1)
