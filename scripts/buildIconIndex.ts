/**
 * 离线构建图标索引（多图标库）：
 * 每个图标库一个适配器，读取 npm 包内的 SVG → 用 sharp 栅格化为灰度位图 →
 * 用与浏览器端相同的 extractFeatures 计算特征 → 量化后按库写入
 * src/data/icons/index-<source>.json。
 *
 * 运行：npm run build:icons
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { extractFeatures, quantizeFeatures } from '../src/services/shapeFeatures';

const RASTER_SIZE = 128;

const root = path.resolve(import.meta.dirname, '..');
const nm = (...p: string[]) => path.join(root, 'node_modules', ...p);
const outDir = path.join(root, 'src', 'data', 'icons');

interface Library {
  source: string;
  dir: string;
  /** 返回 false 则跳过该文件（例如排除 -fill 变体） */
  include?: (file: string) => boolean;
  /** 图标名 → 标签 */
  tags?: Record<string, string[]>;
}

function loadJsonIf(file: string): Record<string, string[]> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const libraries: Library[] = [
  {
    source: 'lucide',
    dir: nm('lucide-static', 'icons'),
    tags: loadJsonIf(nm('lucide-static', 'tags.json')),
  },
  {
    source: 'tabler',
    dir: nm('@tabler', 'icons', 'icons', 'outline'),
  },
  {
    source: 'heroicons',
    dir: nm('heroicons', '24', 'outline'),
  },
  {
    source: 'material',
    dir: nm('@material-symbols', 'svg-400', 'outlined'),
    include: (f) => !f.endsWith('-fill.svg'),
  },
];

/** SVG 自然尺寸：优先 width/height 属性，其次 viewBox */
function naturalSize(svg: string): number {
  const w = svg.match(/<svg[^>]*\bwidth="([\d.]+)(?:px)?"/);
  const h = svg.match(/<svg[^>]*\bheight="([\d.]+)(?:px)?"/);
  if (w && h) return Math.max(parseFloat(w[1]), parseFloat(h[1]));
  const vb = svg.match(/viewBox="([\d.\s+-]+)"/);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4) return Math.max(p[2], p[3]);
  }
  return 24;
}

async function rasterizeSvg(svg: string): Promise<Float32Array> {
  const size = naturalSize(svg);
  const density = Math.min(2400, Math.max(1, (RASTER_SIZE / size) * 72));
  const raw = await sharp(Buffer.from(svg), { density })
    .resize(RASTER_SIZE, RASTER_SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .raw()
    .toBuffer();
  const ink = new Float32Array(RASTER_SIZE * RASTER_SIZE);
  for (let i = 0; i < ink.length; i++) ink[i] = 1 - raw[i] / 255;
  return ink;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

interface IconEntry {
  id: string;
  name: string;
  source: string;
  svg: string;
  tags?: string[];
  f: string;
}

async function buildLibrary(lib: Library): Promise<void> {
  if (!existsSync(lib.dir)) {
    console.warn(`[${lib.source}] 未找到 ${lib.dir}，跳过（请先 npm install）`);
    return;
  }
  const files = readdirSync(lib.dir).filter(
    (f) => f.endsWith('.svg') && (lib.include?.(f) ?? true),
  );
  console.log(`[${lib.source}] 共 ${files.length} 个图标…`);

  let skipped = 0;
  const entries = await mapPool(files, 8, async (file): Promise<IconEntry | null> => {
    const name = file.replace(/\.svg$/, '');
    const svg = readFileSync(path.join(lib.dir, file), 'utf8').trim();
    try {
      const ink = await rasterizeSvg(svg);
      const feat = extractFeatures(ink, RASTER_SIZE, RASTER_SIZE);
      if (!feat) {
        skipped++;
        return null;
      }
      return {
        id: `${lib.source}:${name}`,
        name,
        source: lib.source,
        svg,
        tags: lib.tags?.[name],
        f: Buffer.from(quantizeFeatures(feat)).toString('base64'),
      };
    } catch (err) {
      console.warn(`  跳过 ${name}: ${(err as Error).message}`);
      skipped++;
      return null;
    }
  });

  const icons = entries.filter((e): e is IconEntry => e !== null);
  const outFile = path.join(outDir, `index-${lib.source}.json`);
  writeFileSync(outFile, JSON.stringify({ grid: 16, count: icons.length, icons }), 'utf8');
  console.log(
    `[${lib.source}] 完成：${icons.length} 个图标写入 ${path.relative(root, outFile)}（跳过 ${skipped}）`,
  );
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  for (const lib of libraries) {
    await buildLibrary(lib);
  }
}

main();
