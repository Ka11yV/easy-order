import test from 'node:test';
import assert from 'node:assert/strict';
import { menu, menuMentions, planCommand } from '../server/planner.js';
const americano = String(menu.find(item => item.name === '아메리카노').id);
const latte = String(menu.find(item => item.name === '카페라떼').id);
const snapshot = { screen: '매장 또는 포장 선택', mode: null, cart: [] };
function fixture(overrides = {}, confidence = {}) {
  const calls = [];
  const values = { intent: 'add', mode: '포장', payment: 'unspecified', checkout: 'no', item_count: '1', line: 'none',
    menu1: americano, temperature1: 'ICE', quantity1: '2', shot1: 'unspecified',
    menu2: latte, temperature2: 'HOT', quantity2: '1', shot2: 'unspecified', ...overrides };
  return { calls, threshold: .5, async decide(state, questions) {
    calls.push({ state, questions });
    const answers = Object.fromEntries(Object.keys(questions).map(key => [key, values[key]]));
    return { answers, confidences: Object.fromEntries(Object.keys(questions).map(key => [key, confidence[key] ?? 1])) };
  } };
}
test('two cups of one drink request one item head, never duplicate speculative slots', async () => {
  const client = fixture();
  const plan = await planCommand(client, '아이스 아메리카노 두 잔 포장', snapshot);
  assert.equal(plan.items.length, 1); assert.equal(plan.items[0].quantity, 2);
  assert.equal(client.calls.length, 2);
  assert.ok(!client.calls[0].questions.menu1);
  assert.ok(client.calls[1].questions.menu1); assert.ok(!client.calls[1].questions.menu2);
  assert.equal(client.calls[1].state.orderItemCount, 1);
});
test('two distinct items retain independent temperatures and quantities', async () => {
  const plan = await planCommand(fixture({ item_count: '2' }), '아이스 아메리카노 두 잔과 따뜻한 카페라떼 한 잔 포장', snapshot);
  assert.deepEqual(plan.items.map(({ name, temperature, quantity }) => ({ name, temperature, quantity })), [
    { name: '아메리카노', temperature: 'ICE', quantity: 2 }, { name: '카페라떼', temperature: 'HOT', quantity: 1 },
  ]);
});
test('uncertain item count stops before speculative menu extraction', async () => {
  const client = fixture({}, { item_count: .1 });
  await assert.rejects(planCommand(client, '아메리카노 두 잔 포장', snapshot), { code: 'CLARIFY' });
  assert.equal(client.calls.length, 1);
});
test('missing temperature asks before any UI change; unrelated heads do not block editing', async () => {
  await assert.rejects(planCommand(fixture({ temperature1: 'unspecified' }), '아메리카노 두 잔 포장', snapshot), /아이스/);
  const cart = [{ name: '아메리카노', temperature: 'ICE', quantity: 2, shot: false, price: 2000 }];
  const client = fixture({ intent: 'edit', mode: 'unspecified', item_count: '0', line: 'line_0', quantity1: '1', temperature1: 'unspecified' }, { item_count: 0, menu1: 0 });
  const plan = await planCommand(client, '한 잔으로 바꿔줘', { ...snapshot, mode: '포장', cart });
  assert.equal(plan.items[0].temperature, 'ICE'); assert.equal(plan.items[0].quantity, 1);
});

test('menu grounding prefers full names over overlapping generic menu names', () => {
  assert.deepEqual(menuMentions('디카페인 아메리카노 한 잔과 아아 두 잔').map(m => m.item.name), ['디카페인 아메리카노', '아메리카노']);
});
test('shot omission preserves current shot; explicit removal removes it', async () => {
  const cart = [{ name: '아메리카노', temperature: 'HOT', quantity: 1, shot: true, price: 2500 }];
  const edit = { intent: 'edit', mode: 'unspecified', item_count: '0', line: 'line_0', quantity1: '1', temperature1: 'unspecified' };
  const retained = await planCommand(fixture(edit), '아메리카노 한 잔으로 수정', { ...snapshot, mode: '매장', cart });
  assert.equal(retained.items[0].shot, true);
  const removed = await planCommand(fixture({ ...edit, shot1: 'remove' }), '아메리카노 샷 빼줘', { ...snapshot, mode: '매장', cart });
  assert.equal(removed.items[0].shot, false);
});

test('new drinks ask temperature then quantity; existing edits preserve omitted quantity', async () => {
  const green = String(menu.find(item => item.name === '녹차라떼').id);
  await assert.rejects(planCommand(fixture({ menu1: green, temperature1: 'unspecified', quantity1: 'unspecified' }), '녹차라떼', snapshot), /아이스로 할까요/);
  await assert.rejects(planCommand(fixture({ menu1: green, quantity1: 'unspecified' }), '녹차라떼\n추가 답변: 아이스', snapshot), /녹차라떼는 몇 잔/);
  const plan = await planCommand(fixture({ menu1: green, quantity1: '2' }), '녹차라떼\n추가 답변: 아이스\n추가 답변: 두 잔', snapshot);
  assert.equal(plan.items[0].quantity, 2);
  const cart = [{ name: '아메리카노', temperature: 'ICE', quantity: 3, shot: false, price: 2000 }];
  const edit = await planCommand(fixture({ intent: 'edit', line: 'line_0', quantity1: 'unspecified', shot1: 'add' }), '아메리카노 샷 추가해줘', { ...snapshot, mode: '포장', cart });
  assert.equal(edit.items[0].quantity, 3);
});
