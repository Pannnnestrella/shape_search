import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { decodeGeometry, GEOMETRY_SIZE, GEOMETRY_VERSION } from '../../src/services/geometry';

test('every geometry index matches its source index and has usable features', async () => {
  const directory = path.resolve(import.meta.dirname, '../../src/data/icons');
  let count = 0;
  for (const name of (await readdir(directory)).filter((f) => /^index-.*\.json$/.test(f))) {
    const bytes = await readFile(path.join(directory, name));
    const raw = JSON.parse(bytes.toString());
    const geometry = JSON.parse(await readFile(path.join(directory, name.replace('index-', 'geometry-')), 'utf8'));
    assert.equal(geometry.version, GEOMETRY_VERSION);
    assert.equal(geometry.size, GEOMETRY_SIZE);
    assert.equal(geometry.indexSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(geometry.count, raw.count);
    assert.deepEqual(geometry.icons.map((i: { id: string }) => i.id), raw.icons.map((i: { id: string }) => i.id));
    for (const entry of geometry.icons) {
      const feature = decodeGeometry(Buffer.from(entry.d, 'base64'), Buffer.from(entry.mask, 'base64'));
      assert.ok(feature.points.length > 0);
      assert.ok(Math.abs(feature.density.reduce((sum, v) => sum + v * v, 0) - 1) < .001);
      count++;
    }
  }
  assert.ok(count > 15000);
});
