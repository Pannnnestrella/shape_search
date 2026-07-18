import type { ShapeSearchResult } from '../types';
import { cosineSimilarity, dequantizeFeatures } from './shapeFeatures';

export interface IconRecord {
  id: string;
  name: string;
  source: string;
  svg: string;
  tags: string[];
  feature: Float32Array;
}

interface RawIndex {
  grid: number;
  count: number;
  icons: {
    id: string;
    name: string;
    source: string;
    svg: string;
    tags?: string[];
    f: string; // base64 编码的量化特征
  }[];
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseRaw(raw: RawIndex): IconRecord[] {
  return raw.icons.map((it) => ({
    id: it.id,
    name: it.name,
    source: it.source,
    svg: it.svg,
    tags: it.tags ?? [],
    feature: dequantizeFeatures(base64ToBytes(it.f)),
  }));
}

// 构建阶段由 scripts/buildIconIndex.ts 按库生成 index-<source>.json
const modules = import.meta.glob<{ default: unknown }>('../data/icons/index-*.json');

function sourceOfPath(p: string): string {
  return p.match(/index-([\w-]+)\.json$/)![1];
}

/** 所有已构建索引的图标库 ID */
export function availableSources(): string[] {
  return Object.keys(modules).map(sourceOfPath).sort();
}

const cache = new Map<string, Promise<IconRecord[]>>();

function loadSource(source: string): Promise<IconRecord[]> {
  let p = cache.get(source);
  if (!p) {
    const key = Object.keys(modules).find((k) => sourceOfPath(k) === source);
    p = key
      ? modules[key]().then((mod) => parseRaw(mod.default as RawIndex))
      : Promise.resolve([]);
    cache.set(source, p);
  }
  return p;
}

/** 懒加载并合并指定图标库的索引，默认加载全部 */
export async function loadIconIndex(
  sources: string[] = availableSources(),
): Promise<IconRecord[]> {
  const lists = await Promise.all(sources.map(loadSource));
  return lists.flat();
}

/** 在图标库中检索与草图特征最相似的前 limit 个图标 */
export function searchIcons(
  queryFeature: Float32Array,
  icons: IconRecord[],
  limit: number,
): ShapeSearchResult[] {
  const scored = icons.map((icon) => ({
    icon,
    score: cosineSimilarity(queryFeature, icon.feature),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ icon, score }) => ({
    id: icon.id,
    name: icon.name,
    source: icon.source,
    svg: icon.svg,
    score,
    tags: icon.tags,
  }));
}
