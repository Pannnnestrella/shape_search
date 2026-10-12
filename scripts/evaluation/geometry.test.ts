import test from 'node:test';
import assert from 'node:assert/strict';
import { chamferSimilarity, decodeGeometry, encodeGeometry, extractGeometry, distanceTransform, geometryScore, GEOMETRY_SIZE } from '../../src/services/geometry';
import { extractFeatures } from '../../src/services/shapeFeatures';
import { rerankGeometry } from '../../src/services/geometrySearch';

function line(width: number, offset: number, thickness: number, vertical = false) {
  const image = new Float32Array(width * width);
  for (let p = offset; p < width - offset; p++) for (let t = 0; t < thickness; t++) {
    image[vertical ? p * width + Math.floor(width / 2) + t : (Math.floor(width / 2) + t) * width + p] = 1;
  }
  return image;
}
test('geometry handles empty images, scale and stroke width', () => {
  assert.equal(extractGeometry(new Float32Array(64 * 64), 64, 64), null);
  const a = extractGeometry(line(64, 8, 1), 64, 64)!;
  const b = extractGeometry(line(128, 16, 3), 128, 128)!;
  const c = extractGeometry(line(64, 8, 1, true), 64, 64)!;
  assert.ok(geometryScore(a, b) > .9);
  assert.ok(geometryScore(a, b) > geometryScore(a, c));
  assert.ok(Math.abs(a.density.reduce((sum, v) => sum + v * v, 0) - 1) < 1e-5);
});
test('packed index roundtrip and distance transform preserve points', () => {
  const feature = extractGeometry(line(64, 8, 2), 64, 64)!;
  const encoded = encodeGeometry(feature);
  const decoded = decodeGeometry(encoded.d, encoded.mask);
  assert.deepEqual(decoded.points, feature.points);
  assert.equal(chamferSimilarity(feature, decoded), 1);
  const d = distanceTransform(Uint16Array.of(10 * GEOMETRY_SIZE + 10));
  assert.equal(d[10 * GEOMETRY_SIZE + 10], 0);
  assert.equal(d[10 * GEOMETRY_SIZE + 11], 1);
  assert.ok(Math.abs(d[11 * GEOMETRY_SIZE + 11] - Math.SQRT2) < 1e-5);
  assert.throws(() => decodeGeometry(new Uint8Array(1), encoded.mask));
});
test('thinning keeps tiny filled marks instead of producing an empty index', () => {
  const image = new Float32Array(16 * 16);
  for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) image[y * 16 + x] = 1;
  const feature = extractGeometry(image, 16, 16)!;
  assert.ok(feature.points.length > 0);
  const encoded = encodeGeometry(feature);
  assert.ok(decodeGeometry(encoded.d, encoded.mask).points.length > 0);
});
test('candidate union and geometry reranking prefer matching structure', () => {
  const ink = line(64, 8, 1);
  const query = extractFeatures(ink, 64, 64)!;
  const geometry = extractGeometry(ink, 64, 64)!;
  const vertical = extractGeometry(line(64, 8, 1, true), 64, 64)!;
  const icons = [{ id: 'wrong', feature: query, geometry: vertical }, { id: 'right', feature: query, geometry }];
  assert.equal(rerankGeometry(query, geometry, icons, 2)[0].icon.id, 'right');
});
