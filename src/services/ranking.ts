import { cosineSimilarity } from './shapeFeatures';

export function rankIcons<T extends { id: string; feature: Float32Array }>(
  query: Float32Array,
  icons: T[],
): { icon: T; score: number }[] {
  return icons.map((icon) => ({ icon, score: cosineSimilarity(query, icon.feature) }))
    .sort((a, b) => b.score - a.score || a.icon.id.localeCompare(b.icon.id, 'en'));
}
