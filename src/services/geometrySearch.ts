import { cosineSimilarity } from './shapeFeatures';
import { distanceTransform, geometryScore, type GeometryFeature } from './geometry';
import { rankIcons } from './ranking';

const distances = new WeakMap<GeometryFeature, Float32Array>();
export function rerankGeometry<T extends { id: string; feature: Float32Array; geometry?: GeometryFeature }>(
  query: Float32Array, shape: GeometryFeature, icons: T[], limit: number,
) {
  const count = Math.max(200, limit);
  const coarse = rankIcons(query, icons).slice(0, count);
  const multiscale = icons.filter((icon) => icon.geometry).map((icon) => ({ icon, score: cosineSimilarity(shape.density, icon.geometry!.density) }))
    .sort((a, b) => b.score - a.score || a.icon.id.localeCompare(b.icon.id, 'en')).slice(0, count);
  const candidates = new Map([...coarse, ...multiscale].map(({ icon }) => [icon.id, icon]));
  const queryDistance = distanceTransform(shape.points);
  return [...candidates.values()].map((icon) => {
    if (!icon.geometry) return { icon, score: cosineSimilarity(query, icon.feature) };
    let distance = distances.get(icon.geometry);
    if (!distance) {
      distance = distanceTransform(icon.geometry.points);
      // Keep the cache bounded; vectors remain available for later recalculation.
      if (cacheCount >= 512) { for (const geometry of cached) distances.delete(geometry); cached.length = 0; cacheCount = 0; }
      distances.set(icon.geometry, distance); cached.push(icon.geometry); cacheCount++;
    }
    return { icon, score: geometryScore(shape, icon.geometry, queryDistance, distance) };
  }).sort((a, b) => b.score - a.score || a.icon.id.localeCompare(b.icon.id, 'en')).slice(0, limit);
}
let cacheCount = 0;
const cached: GeometryFeature[] = [];
