import assert from 'node:assert/strict';
import test from 'node:test';
import { findVerifiedOrder, type PairMatch } from '../src/engine/index.ts';

function graph(edges: [number, number, number, number?][]) {
  const matches = new Map(edges.map(([from, to, overlap, confidence = 0.95]) =>
    [`${from}:${to}`, { overlap, confidence, status: 'matched', topTrim: 0, bottomTrim: 0,
      reason: 'Verified fixture alignment.' } satisfies PairMatch]));
  return (from: number, to: number): PairMatch => matches.get(`${from}:${to}`) ??
    { overlap: 0, confidence: 0, status: 'unrelated', topTrim: 0, bottomTrim: 0, reason: 'No match.' };
}
const height = () => 1000;

test('a short repeated-label reverse edge cannot destroy the correct complete chain', () => {
  const pair = graph([[0, 1, 450], [1, 2, 390], [2, 3, 430], [1, 0, 27]]);
  for (const indexes of [[3, 0, 2, 1], [1, 0, 3, 2], [2, 3, 1, 0]]) {
    assert.deepEqual(findVerifiedOrder(indexes, pair, height), [0, 1, 2, 3]);
  }
});

test('the complete chain can resolve a weak closing edge without discarding any image', () => {
  const pair = graph([[0, 1, 500], [1, 2, 450], [2, 3, 400], [3, 0, 20, 1]]);
  assert.deepEqual(findVerifiedOrder([2, 0, 3, 1], pair, height), [0, 1, 2, 3]);
});

test('two near-equal complete histories with the same final image remain ambiguous', () => {
  const pair = graph([[0, 1, 500], [1, 2, 450], [2, 3, 400], [1, 0, 450], [0, 2, 470]]);
  // Both 0→1→2→3 and 1→0→2→3 reach the same full-set/end state.
  assert.equal(findVerifiedOrder([3, 2, 1, 0], pair, height), null);
});

test('equal complete orders and disconnected selections preserve manual ordering', () => {
  const all: [number, number, number][] = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) all.push([a, b, 400]);
  assert.equal(findVerifiedOrder([0, 1, 2, 3], graph(all), height), null);
  assert.equal(findVerifiedOrder([0, 1, 2, 3], graph([[0, 1, 500], [2, 3, 500]]), height), null);
});

test('uncertain pair evidence never completes an otherwise missing chain', () => {
  const base = graph([[0, 1, 400]]);
  const pair = (a: number, b: number): PairMatch => a === 1 && b === 2 ?
    { overlap: 900, confidence: 1, status: 'uncertain', topTrim: 0, bottomTrim: 0, reason: 'Repeated content.' } : base(a, b);
  assert.equal(findVerifiedOrder([2, 1, 0], pair, height), null);
});

test('ordering is bounded to twelve inputs and evaluates each directed pair once', () => {
  const pair = graph(Array.from({ length: 11 }, (_, i) => [i, i + 1, 400]));
  const counts = new Map<string, number>();
  const counted = (a: number, b: number) => {
    const key = `${a}:${b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return pair(a, b);
  };
  assert.deepEqual(findVerifiedOrder(Array.from({ length: 12 }, (_, i) => 11 - i), counted, height),
    Array.from({ length: 12 }, (_, i) => i));
  assert.equal(counts.size, 132);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(findVerifiedOrder(Array.from({ length: 13 }, (_, i) => i), () => {
    throw new Error('Large input should not enumerate edges.');
  }, height), null);
  assert.deepEqual(findVerifiedOrder([], pair, height), []);
  assert.deepEqual(findVerifiedOrder([7], pair, height), [7]);
});
