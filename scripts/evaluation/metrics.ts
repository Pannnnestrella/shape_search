export const CUTS = [1, 10, 50, 200] as const;

export function relevanceRank(ids: string[], relevant: string[]): number | null {
  const accepted = new Set(relevant);
  const index = ids.findIndex((id) => accepted.has(id));
  return index < 0 ? null : index + 1;
}

export function summarizeRanks(ranks: (number | null)[]) {
  if (!ranks.length) return { count: 0, mrr: null, recall: null };
  return {
    count: ranks.length,
    mrr: ranks.reduce<number>((sum, rank) => sum + (rank === null ? 0 : 1 / rank), 0) / ranks.length,
    recall: Object.fromEntries(CUTS.map((k) => [k,
      ranks.filter((rank) => rank !== null && rank <= k).length / ranks.length])),
  };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
