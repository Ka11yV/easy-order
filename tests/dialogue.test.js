import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderRunner } from '../server/runner.js';
import { menu } from '../server/planner.js';
const cube = menu.find(m => m.name === '큐브라떼');
const green = menu.find(m => m.name === '녹차라떼');
function setup() {
  const requests = [];
  const client = { threshold: .5, async decide(state, questions) {
    let a;
    if (questions.relation) a = { relation: state.userRequest.includes('취소') ? 'cancel' : state.userRequest.includes('라떼') ? 'replacement' : 'answer' };
    else {
      requests.push(state.userRequest);
      const isCube = state.userRequest.includes('큐브');
      a = { intent: 'add', mode: '포장', payment: 'unspecified', checkout: 'no', item_count: '1', menu1: String((isCube ? cube : green).id),
        temperature1: isCube ? 'HOT' : state.userRequest.includes('아이스') ? 'ICE' : 'unspecified', quantity1: 'unspecified', shot1: 'unspecified' };
    }
    const answers = Object.fromEntries(Object.keys(questions).map(k => [k, a[k]]));
    return { answers, confidences: Object.fromEntries(Object.keys(questions).map(k => [k, 1])) };
  } };
  const runner = new OrderRunner({ client, emit: () => {}, browser: { snapshot: async () => ({ cart: [], mode: '포장', screen: '메뉴 선택' }) } });
  return { runner, requests, signal: new AbortController().signal };
}
test('unsupported cube temperature is a completed answer, never poisons the next drink request', async () => {
  const { runner, requests, signal } = setup();
  assert.match((await runner.run('큐브라떼 뜨거운건 없어?', signal)).message, /아이스만 가능/);
  assert.equal(runner.clarification, null);
  await assert.rejects(runner.run('녹차라떼', signal), /아이스로 할까요/);
  assert.ok(!requests.at(-1).includes('큐브'));
  await assert.rejects(runner.run('아이스로', signal), /몇 잔/);
  assert.ok(requests.at(-1).includes('녹차라떼\n추가 답변: 아이스로'));
});
test('a new menu replaces a pending question; cancellation clears only pending context', async () => {
  const { runner, requests, signal } = setup();
  await assert.rejects(runner.run('녹차라떼', signal), /아이스로 할까요/);
  await runner.run('큐브라떼 뜨거운건 없어?', signal);
  assert.equal(requests.at(-1), '큐브라떼 뜨거운건 없어?');
  assert.equal(runner.clarification, null);
  await assert.rejects(runner.run('녹차라떼', signal), /아이스로 할까요/);
  assert.match((await runner.run('취소', signal)).message, /취소/);
  assert.equal(runner.clarification, null);
});
