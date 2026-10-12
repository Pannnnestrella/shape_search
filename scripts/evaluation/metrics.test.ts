import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, relevanceRank, summarizeRanks } from './metrics';
import { rankIcons } from '../../src/services/ranking';

test('strict and acceptable relevance use first relevant result', () => {
  const ids = ['equivalent', 'other', 'target'];
  assert.equal(relevanceRank(ids, ['target']), 3);
  assert.equal(relevanceRank(ids, ['target', 'equivalent']), 1);
  assert.equal(relevanceRank(ids, ['missing']), null);
});

test('recall boundaries, misses and MRR have explicit denominators', () => {
  const result = summarizeRanks([1, 10, 50, 200, 201, null]);
  assert.deepEqual(result.recall, { 1: 1 / 6, 10: 2 / 6, 50: 3 / 6, 200: 4 / 6 });
  assert.equal(result.mrr, (1 + .1 + .02 + .005 + 1 / 201) / 6);
  assert.deepEqual(summarizeRanks([]), { count: 0, mrr: null, recall: null });
});

test('nearest-rank percentile is deterministic and does not mutate input', () => {
  const values = [30, 10, 20];
  assert.equal(percentile(values, .5), 20);
  assert.equal(percentile(values, .95), 30);
  assert.equal(percentile([], .95), null);
  assert.deepEqual(values, [30, 10, 20]);
});

test('score ties use stable icon IDs regardless of input ordering', () => {
  const vector = new Float32Array([1, 0]);
  const icons = [{ id: 'b', feature: vector }, { id: 'a', feature: vector }];
  assert.deepEqual(rankIcons(vector, icons).map((r) => r.icon.id), ['a', 'b']);
});
