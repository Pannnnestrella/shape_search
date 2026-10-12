import { cosineSimilarity, dequantizeFeatures, quantizeFeatures } from './shapeFeatures';

export const GEOMETRY_SIZE = 48;
export const GEOMETRY_VERSION = 1;
export interface GeometryFeature { density: Float32Array; points: Uint16Array }

/** Same canonical coordinates for sketches and SVGs, with a 4-pixel margin. */
export function extractGeometry(ink: Float32Array, width: number, height: number): GeometryFeature | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (ink[y * width + x] <= .15) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < 0 || (right - left < 2 && bottom - top < 2)) return null;
  const side = Math.max(right - left + 1, bottom - top + 1);
  const originX = (left + right + 1 - side) / 2;
  const originY = (top + bottom + 1 - side) / 2;
  const size = GEOMETRY_SIZE;
  const mask = new Uint8Array(size * size);
  // Forward mapping retains thin marks even when the input is larger than the canonical grid.
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (ink[y * width + x] <= .15) continue;
    const gx = Math.min(size - 5, 4 + Math.floor((x - originX) / side * (size - 8)));
    const gy = Math.min(size - 5, 4 + Math.floor((y - originY) / side * (size - 8)));
    mask[gy * size + gx] = 1;
  }
  thin(mask, size);
  const density = new Float32Array(8 * 8 + 16 * 16);
  let offset = 0;
  for (const grid of [8, 16]) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      density[offset + Math.floor(y / size * grid) * grid + Math.floor(x / size * grid)] += mask[y * size + x];
    }
    let norm = 0;
    for (let i = offset; i < offset + grid * grid; i++) { density[i] = Math.sqrt(density[i]); norm += density[i] ** 2; }
    for (let i = offset; i < offset + grid * grid; i++) density[i] /= Math.sqrt(norm * 2);
    offset += grid * grid;
  }
  const points: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) points.push(i);
  return { density, points: Uint16Array.from(points) };
}

/** Zhang–Suen thinning reduces line-width differences without closing holes. */
function thin(mask: Uint8Array, size: number) {
  let changed = true;
  let remaining = mask.reduce((sum, value) => sum + value, 0);
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      const remove: number[] = [];
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        const p = y * size + x;
        if (!mask[p]) continue;
        const n = [mask[p - size], mask[p - size + 1], mask[p + 1], mask[p + size + 1], mask[p + size], mask[p + size - 1], mask[p - 1], mask[p - size - 1]];
        const count = n.reduce((sum, value) => sum + value, 0);
        let transitions = 0;
        for (let i = 0; i < 8; i++) if (!n[i] && n[(i + 1) % 8]) transitions++;
        const a = pass === 0 ? n[0] * n[2] * n[4] : n[0] * n[2] * n[6];
        const b = pass === 0 ? n[2] * n[4] * n[6] : n[0] * n[4] * n[6];
        if (count >= 2 && count <= 6 && transitions === 1 && !a && !b) remove.push(p);
      }
      // A tiny filled component must not disappear when all its pixels qualify in one pass.
      if (remove.length === remaining) remove.pop();
      if (remove.length) changed = true;
      for (const p of remove) mask[p] = 0;
      remaining -= remove.length;
    }
  }
}

/** Two-pass chamfer distance transform, with diagonal cost sqrt(2). */
export function distanceTransform(points: Uint16Array): Float32Array {
  const size = GEOMETRY_SIZE;
  const distance = new Float32Array(size * size).fill(size * 2);
  for (const point of points) distance[point] = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * size + x;
    if (x) distance[p] = Math.min(distance[p], distance[p - 1] + 1);
    if (y) {
      distance[p] = Math.min(distance[p], distance[p - size] + 1);
      if (x) distance[p] = Math.min(distance[p], distance[p - size - 1] + Math.SQRT2);
      if (x < size - 1) distance[p] = Math.min(distance[p], distance[p - size + 1] + Math.SQRT2);
    }
  }
  for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
    const p = y * size + x;
    if (x < size - 1) distance[p] = Math.min(distance[p], distance[p + 1] + 1);
    if (y < size - 1) {
      distance[p] = Math.min(distance[p], distance[p + size] + 1);
      if (x) distance[p] = Math.min(distance[p], distance[p + size - 1] + Math.SQRT2);
      if (x < size - 1) distance[p] = Math.min(distance[p], distance[p + size + 1] + Math.SQRT2);
    }
  }
  return distance;
}

function directed(points: Uint16Array, distance: Float32Array, dx: number, dy: number) {
  let sum = 0;
  for (const point of points) {
    const x = point % GEOMETRY_SIZE + dx;
    const y = Math.floor(point / GEOMETRY_SIZE) + dy;
    sum += x < 0 || y < 0 || x >= GEOMETRY_SIZE || y >= GEOMETRY_SIZE ? GEOMETRY_SIZE : distance[y * GEOMETRY_SIZE + x];
  }
  return sum / Math.max(points.length, 1);
}

export function chamferSimilarity(a: GeometryFeature, b: GeometryFeature, da = distanceTransform(a.points), db = distanceTransform(b.points)) {
  if (!a.points.length || !b.points.length) return 0;
  let best = Infinity;
  for (const dy of [-2, 0, 2]) for (const dx of [-2, 0, 2]) {
    best = Math.min(best, (directed(a.points, db, dx, dy) + directed(b.points, da, -dx, -dy)) / 2);
  }
  return Math.exp(-best / (GEOMETRY_SIZE * .08));
}

export function geometryScore(query: GeometryFeature, candidate: GeometryFeature, queryDistance?: Float32Array, candidateDistance?: Float32Array) {
  return .65 * chamferSimilarity(query, candidate, queryDistance, candidateDistance) + .35 * cosineSimilarity(query.density, candidate.density);
}

export function encodeGeometry(feature: GeometryFeature): { d: Uint8Array; mask: Uint8Array } {
  const mask = new Uint8Array(GEOMETRY_SIZE * GEOMETRY_SIZE / 8);
  for (const point of feature.points) mask[point >> 3] |= 1 << (point & 7);
  return { d: quantizeFeatures(feature.density), mask };
}

export function decodeGeometry(density: Uint8Array, mask: Uint8Array): GeometryFeature {
  if (density.length !== 320 || mask.length !== GEOMETRY_SIZE * GEOMETRY_SIZE / 8) throw new Error('Invalid geometry index dimensions');
  const points: number[] = [];
  for (let i = 0; i < GEOMETRY_SIZE * GEOMETRY_SIZE; i++) if (mask[i >> 3] & (1 << (i & 7))) points.push(i);
  if (!points.length) throw new Error('Empty geometry index feature');
  return { density: dequantizeFeatures(density), points: Uint16Array.from(points) };
}
