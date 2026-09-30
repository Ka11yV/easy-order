import test from 'node:test';
import assert from 'node:assert/strict';
import { JevClient, choice, validateAnswers } from '../server/jev.js';
import { expectedCart, cartMatches } from '../server/planner.js';
const questions = { action: choice('Pick', { click: 'Click', blocked: 'Stop' }) };
const answer = (selection = 'click', confidence = 1) => ({ answers: { action: { type: 'choice', choice: selection, confidence } } });
test('reject invalid choices and uncertain decisions', () => {
  assert.throws(() => validateAnswers(answer('delete'), questions, .5), /허용되지/);
  assert.throws(() => validateAnswers(answer('click', .2), questions, .5), /명확하지/);
  assert.throws(() => validateAnswers(answer('click', NaN), questions, .5), /허용되지/);
  assert.deepEqual(validateAnswers(answer(), questions, .5), { action: 'click' });
});
test('Jev request uses server-side authorization and typed choice contract', async () => {
  let request;
  const client = new JevClient({ apiKey: 'test-only-key', fetchImpl: async (url, options) => {
    request = { url, options }; return { ok: true, json: async () => answer() };
  } });
  await client.decide({ task: '포장' }, questions);
  assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(request.options.headers.Authorization, 'Bearer test-only-key');
  assert.equal(JSON.parse(request.options.body).questions.action.type, 'choice');
  assert.equal(JSON.parse(request.options.body).model, 'jev-latest');
});
test('missing key and provider failure never execute a fallback decision', async () => {
  await assert.rejects(new JevClient({ apiKey: '' }).decide({}, questions), { code: 'NOT_CONFIGURED' });
  await assert.rejects(new JevClient({ apiKey: 'test', fetchImpl: async () => ({ ok: false, status: 429 }) }).decide({}, questions), { code: 'PROVIDER' });
});
test('aborted requests cannot proceed', async () => {
  const controller = new AbortController(); controller.abort(new Error('stop'));
  await assert.rejects(new JevClient({ apiKey: 'test', fetchImpl: () => { throw Error('must not call'); } }).decide({}, questions, controller.signal), /stop/);
});
test('cart verifier detects duplicates, wrong temperatures and quantities', () => {
  const before = [{ name: '아메리카노', temperature: 'ICE', quantity: 1, shot: false }];
  const plan = { intent: 'add', items: [{ ...before[0], quantity: 2 }] };
  assert.equal(expectedCart(before, plan)[0].quantity, 3);
  assert.equal(cartMatches(before, expectedCart(before, plan)), false);
  assert.equal(cartMatches([{ ...before[0], temperature: 'HOT' }], before), false);
  assert.equal(cartMatches([...before, ...before], before), false);
  assert.throws(() => expectedCart(before, { ...plan, items: [{ ...before[0], quantity: 99 }] }), /99/);
});
