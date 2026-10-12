import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { GRID, dequantizeFeatures, extractFeatures } from '../../src/services/shapeFeatures';
import { imageDataToInk } from '../../src/services/preprocess';
import { rankIcons } from '../../src/services/ranking';
import { percentile, relevanceRank, summarizeRanks } from './metrics';

interface Sample {
  id: string; image: string; kind: 'real' | 'synthetic';
  split: 'dev' | 'test'; author: string; group: string;
  strict: string[]; acceptable: string[]; tags: string[];
}
interface Icon { id: string; name: string; source: string; svg: string; feature: Float32Array }
interface ResultRow extends Sample {
  imageSha256: string; strictRank: number | null; acceptableRank: number | null;
  preprocessMs: number; searchMs: number; totalMs: number; top10: string[];
}
const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
function option(name: string, fallback: string) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function main() {
  const indexDir = path.join(root, 'src/data/icons');
  const icons: Icon[] = [];
  const indexHashes: Record<string, string> = {};
  const loadStart = performance.now();
  for (const filename of (await readdir(indexDir)).filter((f) => /^index-.*\.json$/.test(f)).sort()) {
    const bytes = await readFile(path.join(indexDir, filename));
    const raw = JSON.parse(bytes.toString());
    if (raw.grid !== GRID || raw.count !== raw.icons.length) throw new Error(`Invalid index: ${filename}`);
    indexHashes[filename] = hash(bytes);
    for (const icon of raw.icons) {
      const feature = dequantizeFeatures(Buffer.from(icon.f, 'base64'));
      if (feature.length !== GRID * GRID || !feature.some((v) => v > 0)) throw new Error(`Invalid feature: ${icon.id}`);
      icons.push({ ...icon, feature });
    }
  }
  const loadMs = performance.now() - loadStart;
  const known = new Set(icons.map((icon) => icon.id));
  if (!icons.length || known.size !== icons.length) throw new Error('Empty index or duplicate icon IDs');
  if (args.includes('--catalog')) {
    const directory = path.join(root, 'evaluation');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'catalog.json'), JSON.stringify(icons.map(({ id, name, source }) => ({ id, name, source })), null, 2));
    console.log(`Catalog exported: ${icons.length} icons`);
    return;
  }
  const manifestPath = path.resolve(root, option('--dataset', 'evaluation/dataset.json'));
  const manifestBytes = await readFile(manifestPath);
  const dataset = JSON.parse(manifestBytes.toString());
  if (dataset.version !== 1 || !Number.isInteger(dataset.seed) || !Array.isArray(dataset.samples)) throw new Error('Invalid dataset format');
  const samples: Sample[] = dataset.samples;
  if (!samples.length) throw new Error('No labeled samples. Collect real sketches before running the baseline.');
  const sampleIds = new Set<string>();
  const groupSplits = new Map<string, string>();
  const imageHashes = new Set<string>();
  const rows: ResultRow[] = [];
  let peakObservedRss = process.memoryUsage().rss;
  for (const sample of samples) {
    if (!sample.id || sampleIds.has(sample.id)) throw new Error(`Duplicate/missing sample ID: ${sample.id}`);
    sampleIds.add(sample.id);
    if (!['real', 'synthetic'].includes(sample.kind) || !['dev', 'test'].includes(sample.split) ||
      !sample.author?.trim() || !sample.group?.trim() || !Array.isArray(sample.tags) || !sample.tags.length ||
      sample.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) throw new Error(`Invalid metadata: ${sample.id}`);
    for (const labels of [sample.strict, sample.acceptable]) {
      if (!Array.isArray(labels) || !labels.length || new Set(labels).size !== labels.length || labels.some((id) => !known.has(id))) throw new Error(`Invalid labels: ${sample.id}`);
    }
    if (sample.strict.some((id) => !sample.acceptable.includes(id))) throw new Error(`Acceptable labels must include strict labels: ${sample.id}`);
    const previousSplit = groupSplits.get(sample.group);
    if (previousSplit && previousSplit !== sample.split) throw new Error(`Group leakage between dev and test: ${sample.group}`);
    groupSplits.set(sample.group, sample.split);
    if (typeof sample.image !== 'string' || !sample.image) throw new Error(`Missing image: ${sample.id}`);
    const imagePath = path.resolve(path.dirname(manifestPath), sample.image);
    const relative = path.relative(path.dirname(manifestPath), imagePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Image outside dataset directory: ${sample.id}`);
    const bytes = await readFile(imagePath);
    const digest = hash(bytes);
    if (imageHashes.has(digest)) throw new Error(`Duplicate image: ${sample.id}`);
    imageHashes.add(digest);
    const decoded = await sharp(bytes, { limitInputPixels: 4096 * 4096 }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const start = performance.now();
    const ink = imageDataToInk({ data: decoded.data, width: decoded.info.width, height: decoded.info.height } as unknown as ImageData);
    const feature = extractFeatures(ink.ink, ink.width, ink.height);
    if (!feature) throw new Error(`Blank/invalid sketch: ${sample.id}`);
    const preprocessMs = performance.now() - start;
    const rankStart = performance.now();
    const ranked = rankIcons(feature, icons);
    const searchMs = performance.now() - rankStart;
    const ids = ranked.map(({ icon }) => icon.id);
    rows.push({ ...sample, imageSha256: digest, strictRank: relevanceRank(ids, sample.strict), acceptableRank: relevanceRank(ids, sample.acceptable),
      preprocessMs, searchMs, totalMs: preprocessMs + searchMs, top10: ids.slice(0, 10) });
    peakObservedRss = Math.max(peakObservedRss, process.memoryUsage().rss);
  }
  const summaries = [];
  for (const kind of ['real', 'synthetic']) for (const split of ['dev', 'test']) {
    const subset = rows.filter((r) => r.kind === kind && r.split === split);
    const summarize = (items: typeof rows) => ({ count: items.length,
      strict: summarizeRanks(items.map((r) => r.strictRank)), acceptable: summarizeRanks(items.map((r) => r.acceptableRank)),
      latencyMs: { p50: percentile(items.map((r) => r.totalMs), .5), p95: percentile(items.map((r) => r.totalMs), .95) } });
    summaries.push({ kind, split, ...summarize(subset), byTag: Object.fromEntries([...new Set(subset.flatMap((r) => r.tags))].sort().map((tag) => [tag, summarize(subset.filter((r) => r.tags.includes(tag)))])) });
  }
  const real = rows.filter((r) => r.kind === 'real');
  const gates = {
    realSampleCount: real.length >= 100 && real.length <= 300,
    multipleAuthors: new Set(real.map((r) => r.author)).size >= 2,
    devAndTest: ['dev', 'test'].every((split) => real.some((r) => r.split === split)),
    failureReview: false,
  };
  const sourceHashes: Record<string, string> = {};
  for (const file of ['src/services/preprocess.ts', 'src/services/shapeFeatures.ts', 'src/services/ranking.ts', 'scripts/evaluation/run.ts', 'scripts/evaluation/metrics.ts', 'package-lock.json']) sourceHashes[file] = hash(await readFile(path.join(root, file)));
  const report = { algorithm: 'density-grid-16-cosine', seed: dataset.seed, generatedAt: new Date().toISOString(),
    datasetSha256: hash(manifestBytes), indexHashes, sourceHashes, iconCount: icons.length, loadMs,
    environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, sharp: sharp.versions },
    memory: { featureBytes: icons.reduce((n, icon) => n + icon.feature.byteLength, 0), peakObservedRssBytes: peakObservedRss, gpu: 'not used' },
    timingScope: 'Node CPU: preprocessing + scoring/sorting; excludes image decoding, disk I/O, browser/UI; first query included',
    gates, phaseOneComplete: false, summaries, rows };
  const out = path.resolve(root, option('--out', 'evaluation/reports/baseline.json'));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: out, iconCount: icons.length, samples: rows.length, gates, summaries }, null, 2));
  if (args.includes('--require-ready') && !Object.values(gates).every(Boolean)) process.exitCode = 2;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
