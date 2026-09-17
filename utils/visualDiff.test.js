// utils/visualDiff.test.js — pixel-diff engine unit tests (Feature 3).
//
// Tiny PNGs are synthesized in-memory with the pngjs encoder — no fixture
// files, so these run anywhere.

const test = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');

const {
  decodePng,
  encodePng,
  resizePng,
  diffPng,
  comparePngBuffers,
  diffScoreToVerdict,
} = require('./visualDiff');

// Solid-color 8x8 PNG helper (RGBA). `fn` can tint pixels.
function png8x8(fn) {
  const png = new PNG({ width: 8, height: 8 });
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const idx = (y * 8 + x) * 4;
      const c = fn ? fn(x, y) : [200, 200, 200, 255];
      png.data[idx] = c[0];
      png.data[idx + 1] = c[1];
      png.data[idx + 2] = c[2];
      png.data[idx + 3] = c[3];
    }
  }
  return PNG.sync.write(png);
}

test('round-trips a PNG through encode/decode', () => {
  const buf = png8x8((x, y) => [x * 30, y * 30, 50, 255]);
  const decoded = decodePng(buf);
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 8);
  assert.equal(decoded.data.length, 8 * 8 * 4);
});

test('identical buffers produce a 0.0 diff score', () => {
  const buf = png8x8();
  const res = comparePngBuffers(buf, buf);
  assert.equal(res.diffScore, 0);
  assert.equal(diffScoreToVerdict(res.diffScore), 'identical');
});

test('fully different buffers produce a 1.0 diff score', () => {
  const a = png8x8(() => [0, 0, 0, 255]);
  const b = png8x8(() => [255, 255, 255, 255]);
  const res = comparePngBuffers(a, b);
  assert.equal(res.diffScore, 1);
  assert.equal(diffScoreToVerdict(res.diffScore), 'significant');
});

test('a single changed pixel scores proportionally', () => {
  const a = png8x8(() => [200, 200, 200, 255]);
  const b = png8x8((x, y) => (x === 0 && y === 0 ? [255, 0, 0, 255] : [200, 200, 200, 255]));
  const res = comparePngBuffers(a, b);
  const expected = 1 / 64;
  assert.ok(Math.abs(res.diffScore - expected) < 0.01, `got ${res.diffScore}`);
  assert.equal(diffScoreToVerdict(res.diffScore), 'minor');
});

test('resizes mismatched dimensions before diffing', () => {
  const a = png8x8();
  // 16x8 solid same-color png → after resize the diff should be ~0.
  const big = new PNG({ width: 16, height: 8 });
  for (let i = 0; i < 16 * 8; i += 1) {
    big.data[i * 4] = 200;
    big.data[i * 4 + 1] = 200;
    big.data[i * 4 + 2] = 200;
    big.data[i * 4 + 3] = 255;
  }
  const res = comparePngBuffers(a, PNG.sync.write(big));
  assert.equal(res.width, 8);
  assert.equal(res.height, 8);
  assert.ok(res.diffScore === 0, `expected 0, got ${res.diffScore}`);
});

test('resizePng changes dimensions but keeps layout', () => {
  const buf = png8x8((x, y) => [x * 30, y * 30, 50, 255]);
  const small = resizePng(decodePng(buf), 2, 2);
  assert.equal(small.width, 2);
  assert.equal(small.height, 2);
  assert.equal(small.data.length, 2 * 2 * 4);
});

test('diffPng produces a highlight image with the same dims', () => {
  const a = decodePng(png8x8(() => [200, 200, 200, 255]));
  const b = decodePng(png8x8((x) => (x === 0 ? [255, 0, 0, 255] : [200, 200, 200, 255])));
  const { diffScore, diff } = diffPng(a, b);
  const expected = 8 / 64; // only the first column differs
  assert.ok(Math.abs(diffScore - expected) < 0.01, `expected ~${expected}, got ${diffScore}`);
  assert.equal(diff.length, 8 * 8 * 4);
  // The diff image re-encodes without error.
  const reencoded = encodePng(a.width, a.height, diff);
  assert.ok(reencoded.length > 0);
});

test('diffPng throws on mismatched dimensions', () => {
  const a = decodePng(png8x8());
  const big = decodePng(PNG.sync.write(new PNG({ width: 9, height: 8 })));
  assert.throws(() => diffPng(a, big), /dimension mismatch/);
});