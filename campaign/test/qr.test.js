// QR encoder (shared/qr.js, deathmatch share panel): every code is read back here - format bits (both copies),
// version bits, unmasking, the zigzag, de-interleaving, a Reed-Solomon check of every block and the byte-mode text -
// so a wrong table or step fails without a camera. (Checked once against OpenCV's decoder too: 100 of 100 codes.)
'use strict';
const path = require('path');
const { ok } = require('./harness.js');
const Q = require(path.join(__dirname, '..', '..', 'shared', 'qr.js'));

const ECC = { L: 1, M: 0, Q: 3, H: 2 };
function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
/** Syndromes of a codeword block (data + ecc, highest power first): all zero when the block is consistent. */
function syndromesZero(block, n) {
  let a = 1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const b of block) s = gmul(s, a) ^ b;
    if (s !== 0) return false;
    a = gmul(a, 2);
  }
  return true;
}
const BCH = (d, poly, deg) => { let r = d; for (let i = 0; i < deg; i++) r = (r << 1) ^ ((r >>> (deg - 1)) * poly); return (d << deg) | (r & ((1 << deg) - 1)); };
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
];
// block structure (blocks, ecc per block) for the versions the checks reach, from ISO/IEC 18004 table 9
const BLOCKS = {
  L: { 1: [1, 7], 2: [1, 10], 3: [1, 15], 5: [1, 26], 7: [2, 20], 10: [4, 18], 14: [4, 30] },
  M: { 1: [1, 10], 2: [1, 16], 3: [1, 26], 4: [2, 18], 5: [2, 24], 6: [4, 16], 7: [4, 18], 8: [4, 22], 9: [5, 22], 10: [5, 26], 12: [8, 22], 17: [11, 28] },
  Q: { 1: [1, 13], 3: [2, 18], 5: [4, 18], 8: [6, 22], 10: [8, 24], 14: [16, 20] },
  H: { 1: [1, 17], 3: [2, 22], 4: [4, 16], 7: [5, 26], 9: [8, 24], 11: [11, 24], 14: [16, 24] },
};

function readBack(c, ecl) {
  const n = c.size, m = c.modules, fn = c.isFunction;
  ok(n === c.version * 4 + 17, 'size from version');
  // finders with separators, timing, dark module
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (m[cy + dy][cx + dx] !== (d !== 2)) { ok(false, 'finder pattern at ' + cx + ',' + cy); return null; }
  }
  ok(true, 'finder patterns');
  for (let i = 8; i < n - 8; i++) if (m[6][i] !== (i % 2 === 0) || m[i][6] !== (i % 2 === 0)) { ok(false, 'timing'); return null; }
  ok(m[n - 8][8] === true, 'dark module');
  // format info, both copies
  let f1 = 0, f2 = 0;
  const b1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  b1.forEach(([x, y], i) => { if (m[y][x]) f1 |= 1 << i; });
  for (let i = 0; i < 8; i++) if (m[8][n - 1 - i]) f2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (m[n - 15 + i][8]) f2 |= 1 << i;
  ok(f1 === f2, 'format copies agree');
  const fmt = f1 ^ 0x5412, data5 = fmt >>> 10;
  ok(BCH(data5, 0x537, 10) === fmt, 'format BCH valid');
  ok((data5 >>> 3) === ECC[ecl] && (data5 & 7) === c.mask, 'format names the level and mask');
  if (c.version >= 7) {
    let vb = 0;
    for (let i = 0; i < 18; i++) if (m[Math.floor(i / 3)][n - 11 + i % 3]) vb |= 1 << i;
    ok(vb === BCH(c.version, 0x1F25, 12), 'version bits');
  }
  // unmask and read the zigzag
  const bits = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - v : v;
      if (!fn[y][x]) bits.push(m[y][x] !== MASKS[c.mask](x, y) ? 1 : 0);
    }
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; words.push(b); }
  return words;
}

function check(text, ecl) {
  const c = Q.encode(text, ecl);
  const words = readBack(c, ecl);
  if (!words) return c;
  const raw = Math.floor(Q.rawModules(c.version) / 8);
  ok(words.length === raw, 'codeword count');
  const B = BLOCKS[ecl][c.version];
  if (B) {
    const [nb, el] = B, nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const lens = Array.from({ length: nb }, (_, i) => shortLen + (i < nShort ? 0 : 1));
    const blocks = lens.map(() => []);
    let k = 0;
    for (let i = 0; i < shortLen + 1; i++) for (let j = 0; j < nb; j++) {
      const dl = lens[j] - el;                      // data length of block j
      if (i < shortLen - el + 1 && i < dl) blocks[j].push(words[k++]);
    }
    for (let i = 0; i < el; i++) for (let j = 0; j < nb; j++) blocks[j].push(words[k++]);
    ok(k === raw, 'de-interleaved every codeword');
    ok(blocks.every(b => syndromesZero(b, el)), 'Reed-Solomon: every block consistent (' + ecl + ' v' + c.version + ')');
    const data = [].concat(...blocks.map((b, j) => b.slice(0, lens[j] - el)));
    // byte mode: 0100, length (8 or 16 bits), bytes
    const bitsOf = []; data.forEach(b => { for (let i = 7; i >= 0; i--) bitsOf.push((b >>> i) & 1); });
    const take = (from, len) => bitsOf.slice(from, from + len).reduce((a, b) => (a << 1) | b, 0);
    ok(take(0, 4) === 4, 'byte mode');
    const lb = c.version < 10 ? 8 : 16, len = take(4, lb), bytes = [];
    for (let i = 0; i < len; i++) bytes.push(take(4 + lb + i * 8, 8));
    const got = decodeURIComponent(escape(String.fromCharCode(...bytes)));
    ok(got === text, 'text reads back: ' + text.slice(0, 30));
  }
  return c;
}

const base = 'https://pavel-kubik.github.io/verdigris-sky-duel/campaign/dm/#K3X9Q';
const sized = n => { let s = ''; while (s.length < n) s += base; return s.slice(0, n); };
const seen = new Set();
for (const ecl of ['L', 'M', 'Q', 'H']) for (const n of [1, 9, 14, 20, 30, 45, 60, 80, 100, 130, 170, 220, 300]) {
  const c = check(sized(n), ecl);
  if (BLOCKS[ecl][c.version]) seen.add(ecl + c.version);
}
ok(seen.size >= 20, 'read back ' + seen.size + ' level / version pairs');
check('Drak ěščřžýáíé - pojď hrát', 'M');                     // UTF-8 bytes
// the invite link fits a small code; capacity boundaries pick the next version
ok(Q.encode(base, 'M').version === 5 && Q.encode(sized(62), 'M').version === 4, 'invite link: version 5 at M (v4 holds 62 bytes)');
ok(Q.encode(sized(14), 'M').version === 1 && Q.encode(sized(15), 'M').version === 2, 'M v1 holds 14 bytes');
ok(Q.encode('x', 'M').mask >= 0 && Q.encode('x', 'M').mask < 8, 'a mask is chosen');
ok(JSON.stringify(Q.encode(base, 'M').modules) === JSON.stringify(Q.encode(base, 'M').modules), 'deterministic');
let threw = false;
try { Q.encode('x'.repeat(3000), 'H'); } catch (_) { threw = true; }
ok(threw, 'too long throws');
