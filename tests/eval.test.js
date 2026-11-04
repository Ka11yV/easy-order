import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, scoreRun, summarize } from '../scripts/eval-scenarios.js';
import { menu } from '../server/planner.js';
import { validateOptions } from '../src/options.js';

test('evaluation covers 20 unique scenarios whose expected carts are valid kiosk orders', () => {
  assert.equal(scenarios.length, 20);
  assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, 20);
  for (const scenario of scenarios) for (const line of scenario.expect.cart) {
    const product = menu.find(item => item.name === line.name);
    assert.ok(product, `${scenario.id}: unknown menu ${line.name}`);
    assert.ok(product.temperatures.includes(line.temperature), `${scenario.id}: ${line.name} ${line.temperature}`);
    assert.deepEqual(validateOptions(product, line.temperature, line.options), line.options, scenario.id);
  }
});

test('scoring checks cart, mode, confirmation and the final turn; summaries keep refusals separate', () => {
  const single = scenarios.find(scenario => scenario.id === 'single');
  const cart = [{ name: '아메리카노', temperature: 'ICE', quantity: 2, shot: false, options: {}, price: 2000 }];
  assert.deepEqual(scoreRun(single, { cart, mode: '포장', turns: [{}] }), { pass: true });
  assert.equal(scoreRun(single, { cart: [], mode: '포장', turns: [{}] }).reason, 'cart');
  assert.equal(scoreRun(single, { cart, mode: '매장', turns: [{}] }).reason, 'mode');
  assert.equal(scoreRun(single, { cart, mode: '포장', turns: [{ code: 'VERIFY' }] }).reason, 'last-turn:VERIFY');
  const offTopic = scenarios.find(scenario => scenario.id === 'off-topic');
  assert.ok(scoreRun(offTopic, { cart: [], turns: [{ code: 'CLARIFY' }] }).pass);
  assert.equal(scoreRun(offTopic, { cart: [], turns: [{}] }).reason, 'last-turn:ok');

  const summary = summarize([
    { id: 'a', kind: 'order', pass: true, turns: [{ durationMs: 1000, decisions: 4 }] },
    { id: 'b', kind: 'order', pass: false, reason: 'cart', turns: [{ durationMs: 3000, decisions: 6 }] },
    { id: 'c', kind: 'reject', pass: true, turns: [{ durationMs: 500, decisions: 1 }] },
  ]);
  assert.equal(summary.orderSuccessRate, .5);
  assert.deepEqual(summary.byKind.reject, { runs: 1, passed: 1 });
  assert.deepEqual(summary.failures, { b: ['cart'] });
  assert.deepEqual(summary.turnLatencyMs, { p50: 1000, p95: 3000 });
  assert.equal(summary.avgDecisionsPerTurn, 3.7);
});
