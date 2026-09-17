// utils/visualDiff.js — pixel-level screenshot diffing for Feature 3.
//
// Pure functions over PNG buffers; no DB, no filesystem. The executor and
// the visual routes both call into here, and unit tests synthesize tiny
// PNGs with the pngjs encoder so no fixture files are needed.
//
// API:
//   decodePng(buffer)                       → { width, height, data } PNG object
//   encodePng(width, height, rgba)          → PNG buffer
//   resizePng(png, width, height)           → nearest-neighbour resample
//   diffPng(a, b)                           → { diffScore, diff } (0..1)
//   comparePngBuffers(bufA, bufB)           → decode + resize + diffPng
//   diffScoreToVerdict(score)               → 'identical' | 'minor' | 'significant'
//
// diffScore semantics: 0.0 = pixel-perfect match, 1.0 = every pixel
// differs (pixelmatch's ratio).

const { PNG } = require('pngjs');
const pixelmatchMod = require('pixelmatch');
const pixelmatch = typeof pixelmatchMod === 'function' ? pixelmatchMod : pixelmatchMod.default;

const decodePng = (buffer) => PNG.sync.read(buffer);

// Re-encode an RGBA buffer (as pngjs decodes: 4 bytes/pixel, w*h stride).
const encodePng = (width, height, rgba) => {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  return PNG.sync.write(png);
};

// Nearest-neighbour resize so two screenshots with different dimensions can
// still be compared. Returns a new { width, height, data } PNG-like object.
const resizePng = (png, width, height) => {
  const out = new PNG({ width, height });
  const { data: src, width: sw, height: sh } = png;
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(sh - 1, Math.round((y * sh) / height));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(sw - 1, Math.round((x * sw) / width));
      const sp = (srcY * sw + srcX) * 4;
      const dp = (y * width + x) * 4;
      out.data[dp] = src[sp];
      out.data[dp + 1] = src[sp + 1];
      out.data[dp + 2] = src[sp + 2];
      out.data[dp + 3] = src[sp + 3];
    }
  }
  return out;
};

// Compare two same-size RGBA buffers. Returns { diffScore, diff } where
// `diff` is a Buffer of the highlight image (red = changed pixels).
const diffPng = (a, b) => {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`dimension mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.1,
    includeAA: true,
  });
  const total = a.width * a.height;
  return { diffScore: total === 0 ? 1 : n / total, diff: diff.data };
};

// Convenience: decode both buffers, resize the second to the first's
// dimensions when they differ, then diff. Throws if either input isn't a
// decodable PNG.
const comparePngBuffers = (bufA, bufB) => {
  const a = decodePng(bufA);
  const b = decodePng(bufB);
  const resized = a.width === b.width && a.height === b.height ? b : b.width > 0 ? resizePng(b, a.width, a.height) : b;
  return {
    width: a.width,
    height: a.height,
    ...diffPng(a, resized),
  };
};

// Thresholds mirror what teams typically consider "catching a regression":
// pixel-perfect or sub-1% drift is noise, >10% is a real change.
const diffScoreToVerdict = (score) => {
  if (score === 0) return 'identical';
  if (score <= 0.05) return 'minor';
  return 'significant';
};

module.exports = {
  decodePng,
  encodePng,
  resizePng,
  diffPng,
  comparePngBuffers,
  diffScoreToVerdict,
};