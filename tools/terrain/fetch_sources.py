"""Downloads the raw terrain tiles listed in sources.json into tools/terrain/.cache and checks their sha256.

Usage: python3 tools/terrain/fetch_sources.py [TILE ...]     (default: every tile in sources.json)
Only needed to re-crop (crop.py) or to bake a new region; bake.py works from the committed crops in sources/.
"""
import hashlib, json, os, sys, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def fetch(tile, src):
    os.makedirs(CACHE, exist_ok=True)
    hgt = os.path.join(CACHE, src['hgt'])
    if os.path.exists(hgt) and sha(hgt) == src['hgtSha256']:
        print(tile, 'cached'); return hgt
    z = os.path.join(CACHE, tile + '.zip')
    if not (os.path.exists(z) and sha(z) == src['zipSha256']):
        print(tile, 'downloading', src['url'])
        urllib.request.urlretrieve(src['url'], z)
    if sha(z) != src['zipSha256']: sys.exit(tile + ': zip checksum mismatch - the source changed, check sources.json')
    with zipfile.ZipFile(z) as f: f.extract(src['hgt'], CACHE)
    if sha(hgt) != src['hgtSha256']: sys.exit(tile + ': hgt checksum mismatch')
    print(tile, 'ok', hgt); return hgt


if __name__ == '__main__':
    sources = json.load(open(os.path.join(HERE, 'sources.json')))
    for t in sys.argv[1:] or list(sources): fetch(t, sources[t])
