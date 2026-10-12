import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'src/data/icons');
const out = path.join(root, 'server/artifacts');
await mkdir(path.join(out, 'rasters'), { recursive: true });
const icons = [];
const indexes: Record<string, string> = {};
for (const name of (await readdir(directory)).filter((f) => /^index-.*\.json$/.test(f)).sort()) {
  const bytes = await readFile(path.join(directory, name));
  indexes[name] = createHash('sha256').update(bytes).digest('hex');
  for (const icon of JSON.parse(bytes.toString()).icons) {
    const filename = createHash('sha256').update(icon.id).digest('hex') + '.png';
    await sharp(Buffer.from(icon.svg), { density: 384 }).resize(128, 128, { fit: 'contain', background: '#fff' })
      .flatten({ background: '#fff' }).png().toFile(path.join(out, 'rasters', filename));
    icons.push({ id: icon.id, source: icon.source, image: `rasters/${filename}` });
  }
  console.log(`${name}: model inputs exported`);
}
await writeFile(path.join(out, 'inputs.json'), JSON.stringify({ version: 1, indexes, icons }));
