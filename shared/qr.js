/*
 * Verdigris - QR code encoder (byte mode, versions 1-40, error correction L / M / Q / H, best of the 8 masks).
 * No dependencies and no network, so invite codes work offline in the installed app. Runs in the browser
 * (window.VQR) and in Node (require('shared/qr.js')) for tests. Follows ISO/IEC 18004 (the same steps as
 * Project Nayuki's reference encoder).
 *   VQR.encode(text, ecl = 'M', forceMask?) -> { size, version, mask, ecl, get(x, y) -> true for a dark module }
 *   VQR.draw(canvas, code, { px, quiet = 4, dark, light }) -> paints it (px = module size in canvas pixels)
 */
(function (root) {
  'use strict';
  const ECL = { L: { i: 0, bits: 1 }, M: { i: 1, bits: 0 }, Q: { i: 2, bits: 3 }, H: { i: 3, bits: 2 } };
  const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[e][v] * NUM_BLOCKS[e][v];

  function utf8(s) {
    const out = [];
    const b = unescape(encodeURIComponent(String(s)));
    for (let i = 0; i < b.length; i++) out.push(b.charCodeAt(i));
    return out;
  }

  /* Reed-Solomon over GF(256), polynomial 0x11D */
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function divisor(deg) {
    const r = new Array(deg).fill(0); r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) { r[j] = mul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
      root = mul(root, 0x02);
    }
    return r;
  }
  function remainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift(); r.push(0);
      div.forEach((c, i) => { r[i] ^= mul(c, f); });
    }
    return r;
  }

  /** Data codewords -> interleaved data + ECC codewords. */
  function addEcc(data, v, e) {
    const nb = NUM_BLOCKS[e][v], el = ECC_PER_BLOCK[e][v], raw = Math.floor(rawModules(v) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = divisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);                              // placeholder so every block has the same length
      blocks.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) out.push(b[i]); });
    return out;
  }

  function alignPos(v, size) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, r = [6];
    for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
  ];

  /** Penalty score of a finished grid (lower reads better): runs, 2x2 blocks, finder look-alikes, dark balance. */
  function penalty(m, size) {
    let p = 0, dark = 0;
    const line = get => {
      let run = 1, s = '';
      for (let i = 0; i < size; i++) {
        const c = get(i); s += c ? '1' : '0';
        if (i > 0 && c === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
      const pad = '0000' + s + '0000';
      for (let i = pad.indexOf('1011101'); i >= 0; i = pad.indexOf('1011101', i + 1)) {
        if (pad.substr(i - 4, 4) === '0000' || pad.substr(i + 7, 4) === '0000') p += 40;
      }
    };
    for (let y = 0; y < size; y++) line(x => m[y][x]);
    for (let x = 0; x < size; x++) line(y => m[y][x]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
    const total = size * size;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  function encode(text, ecl, forceMask) {
    const E = ECL[ecl] || ECL.M, e = E.i, bytes = utf8(text);
    let v = 1;
    for (; v <= 40; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v, e) * 8) break;
    if (v > 40) throw new Error('VQR: text too long');
    // bit stream: byte mode, length, data, terminator, pad
    const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(v, e) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    const words = addEcc(data, v, e);

    const size = v * 4 + 17;
    const grid = () => Array.from({ length: size }, () => new Array(size).fill(false));
    const mod = grid(), fn = grid();
    const set = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignPos(v, size), last = al.length - 1;
    al.forEach((ax, i) => al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const format = mask => {
      const d = (E.bits << 3) | mask;
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
      return b;
    };
    format(0);
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, d); set(c, a, d); }
    }
    // codewords in the zigzag
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < words.length * 8) { mod[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    // the best mask
    const apply = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) mod[y][x] = !mod[y][x]; };
    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) {
      if (forceMask != null && k !== forceMask) continue;
      apply(k); format(k);
      const p = penalty(mod, size);
      if (p < bestP) { bestP = p; best = k; }
      apply(k);
    }
    apply(best); format(best);
    return { size, version: v, mask: best, ecl: ecl in ECL ? ecl : 'M', modules: mod, isFunction: fn, get: (x, y) => mod[y][x] };
  }

  function draw(canvas, code, o) {
    o = o || {};
    const q = o.quiet == null ? 4 : o.quiet, n = code.size + q * 2, px = Math.max(1, Math.floor(o.px || 4));
    canvas.width = canvas.height = n * px;
    const g = canvas.getContext('2d');
    g.fillStyle = o.light || '#ffffff'; g.fillRect(0, 0, n * px, n * px);
    g.fillStyle = o.dark || '#000000';
    for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) if (code.get(x, y)) g.fillRect((x + q) * px, (y + q) * px, px, px);
    return canvas;
  }

  const api = { encode, draw, dataCodewords, rawModules };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VQR = api;
})(typeof self !== 'undefined' ? self : this);
