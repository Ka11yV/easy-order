import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../server/app.js';

test('metrics summarize outcomes, p50/p95 latency and decisions over a rolling window', () => {
  const metrics = createMetrics(20);
  assert.deepEqual(metrics.summary(), { utterances: 0, outcomes: {}, p50Ms: null, p95Ms: null, avgDecisions: null });
  for (let i = 1; i <= 25; i++) metrics.record({ outcome: i % 5 ? 'done' : 'clarification', durationMs: i * 100, decisions: 4 });
  const summary = metrics.summary();
  assert.equal(summary.utterances, 20);
  assert.deepEqual(summary.outcomes, { done: 16, clarification: 4 });
  assert.equal(summary.p50Ms, 1500);
  assert.equal(summary.p95Ms, 2400);
  assert.equal(summary.avgDecisions, 4);
});
