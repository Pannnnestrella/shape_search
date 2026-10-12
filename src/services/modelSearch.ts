import type { ShapeSearchResult } from '../types';
import type { IconRecord } from './iconSearch';
import { indexFingerprints, searchIcons } from './iconSearch';
import { rerankGeometry } from './geometrySearch';
import type { GeometryFeature } from './geometry';

interface ModelResponse {
  candidates: { id: string; score: number }[];
  indexHashes: Record<string, string>;
}

export async function searchWithModel(image: ImageData, query: Float32Array, geometry: GeometryFeature,
  icons: IconRecord[], sources: string[], limit: number, signal: AbortSignal): Promise<ShapeSearchResult[]> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.putImageData(image, 0, 0);
  const included = searchIcons(query, icons, Math.max(200, limit), geometry);
  const response = await fetch(`${import.meta.env.VITE_MODEL_URL || '/model'}/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ image: canvas.toDataURL('image/png'), sources, limit: Math.min(1000, Math.max(200, limit)), includeIds: included.slice(0, 1000).map((icon) => icon.id) }),
  });
  if (!response.ok) throw new Error('Local model unavailable');
  const result = await response.json() as ModelResponse;
  if (!Array.isArray(result.candidates) || !result.indexHashes) throw new Error('Invalid model response');
  const fingerprints = indexFingerprints();
  for (const source of sources) if (result.indexHashes[`index-${source}.json`] !== fingerprints.get(source)) throw new Error('Local model index is stale');
  const byId = new Map(icons.map((icon) => [icon.id, icon]));
  const candidates: IconRecord[] = [];
  const scores = new Map<string, number>();
  for (const item of result.candidates) {
    const icon = byId.get(item.id);
    if (!icon || !Number.isFinite(item.score) || scores.has(item.id)) throw new Error('Invalid model candidate');
    candidates.push(icon); scores.set(item.id, item.score);
  }
  const ranked = rerankGeometry(query, geometry, candidates, candidates.length);
  return ranked.map(({ icon, score }) => ({ id: icon.id, name: icon.name, source: icon.source, svg: icon.svg, tags: icon.tags,
    score: .5 * score + .5 * Math.max(0, Math.min(1, (scores.get(icon.id)! + 1) / 2)) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en')).slice(0, limit);
}
