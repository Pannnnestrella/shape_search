import type { ShapeSearchResult } from '../types';
import { dequantizeFeatures } from './shapeFeatures';
import { rankIcons } from './ranking';
import { decodeGeometry, GEOMETRY_SIZE, GEOMETRY_VERSION, type GeometryFeature } from './geometry';
import { rerankGeometry } from './geometrySearch';

export interface IconRecord {
  id: string;
  name: string;
  source: string;
  svg: string;
  tags: string[];
  feature: Float32Array;
  geometry?: GeometryFeature;
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
const geometryModules = import.meta.glob<{ default: unknown }>('../data/icons/geometry-*.json');

function sourceOfPath(p: string): string {
  return p.match(/index-([\w-]+)\.json$/)![1];
}

/** 所有已构建索引的图标库 ID */
export function availableSources(): string[] {
  return Object.keys(modules).map(sourceOfPath).sort();
}

const cache = new Map<string, Promise<IconRecord[]>>();
const fingerprints = new Map<string, string>();
export function indexFingerprints(): ReadonlyMap<string, string> { return fingerprints; }

function loadSource(source: string): Promise<IconRecord[]> {
  let p = cache.get(source);
  if (!p) {
    const key = Object.keys(modules).find((k) => sourceOfPath(k) === source);
    p = key
      ? modules[key]().then(async (mod) => {
          const icons = parseRaw(mod.default as RawIndex);
          const geometryKey = Object.keys(geometryModules).find((path) => path.endsWith(`/geometry-${source}.json`));
          if (!geometryKey) return icons;
          const geometry = (await geometryModules[geometryKey]()).default as {
            version: number; size: number; count: number; indexSha256: string; icons: { id: string; d: string; mask: string }[];
          };
          if (geometry.version !== GEOMETRY_VERSION || geometry.size !== GEOMETRY_SIZE || geometry.count !== icons.length) throw new Error('Geometry index version/count mismatch');
          fingerprints.set(source, geometry.indexSha256);
          if (globalThis.crypto?.subtle) {
            const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(mod.default)));
            const hex = Array.from(new Uint8Array(fingerprint), (byte) => byte.toString(16).padStart(2, '0')).join('');
            if (hex !== geometry.indexSha256) throw new Error('Geometry index is stale; rebuild geometry');
          }
          const byId = new Map(geometry.icons.map((item) => [item.id, item]));
          if (byId.size !== icons.length) throw new Error('Geometry index IDs mismatch');
          for (const icon of icons) {
            const item = byId.get(icon.id);
            if (!item) throw new Error(`Missing geometry: ${icon.id}`);
            icon.geometry = decodeGeometry(base64ToBytes(item.d), base64ToBytes(item.mask));
          }
          return icons;
        })
      : Promise.resolve([]);
    cache.set(source, p);
    p.catch(() => cache.delete(source));
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
  geometry?: GeometryFeature,
): ShapeSearchResult[] {
  const scored = geometry ? rerankGeometry(queryFeature, geometry, icons, limit) : rankIcons(queryFeature, icons);
  return scored.slice(0, limit).map(({ icon, score }) => ({
    id: icon.id,
    name: icon.name,
    source: icon.source,
    svg: icon.svg,
    score,
    tags: icon.tags,
  }));
}
