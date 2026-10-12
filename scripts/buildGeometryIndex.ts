import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { GEOMETRY_SIZE, GEOMETRY_VERSION, encodeGeometry, extractGeometry } from '../src/services/geometry';

const directory = path.resolve(import.meta.dirname, '../src/data/icons');
for (const file of (await readdir(directory)).filter((name) => /^index-.*\.json$/.test(name)).sort()) {
  const bytes = await readFile(path.join(directory, file));
  const raw = JSON.parse(bytes.toString());
  const icons: { id: string; d: string; mask: string }[] = [];
  for (const icon of raw.icons) {
    const pixels = await sharp(Buffer.from(icon.svg), { density: 384 }).resize(128, 128, { fit: 'contain', background: '#fff' })
      .flatten({ background: '#fff' }).greyscale().raw().toBuffer();
    const ink = Float32Array.from(pixels, (v) => 1 - v / 255);
    const geometry = extractGeometry(ink, 128, 128);
    if (!geometry) throw new Error(`Cannot build geometry for ${icon.id}`);
    const encoded = encodeGeometry(geometry);
    icons.push({ id: icon.id, d: Buffer.from(encoded.d).toString('base64'), mask: Buffer.from(encoded.mask).toString('base64') });
  }
  await writeFile(path.join(directory, file.replace('index-', 'geometry-')), JSON.stringify({ version: GEOMETRY_VERSION, size: GEOMETRY_SIZE,
    indexSha256: createHash('sha256').update(bytes).digest('hex'), count: icons.length, icons }));
  console.log(`${file}: ${icons.length} geometry features`);
}
