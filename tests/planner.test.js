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
    const answers = Object.fromEntries(Object.keys(questions).map(key => [key, values[key] ?? 'unspecified']));
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

test('voice options are priced and edits preserve omitted choices while clearing explicit defaults', async () => {
  const plan = await planCommand(fixture({ menu1: latte, milk1: 'oat', syrup1: 'vanilla', ice1: 'less' }), '카페라떼 두 잔 오트밀크 바닐라 시럽 얼음 적게 포장', snapshot);
  assert.deepEqual(plan.items[0].options, { ice: 'less', milk: 'oat', syrup: 'vanilla' });
  assert.equal(plan.items[0].price, 4100);
  const cart = plan.items;
  const edit = { intent: 'edit', line: 'line_0', menu1: latte, quantity1: 'unspecified', temperature1: 'HOT', syrup1: 'normal' };
  const changed = await planCommand(fixture(edit), '따뜻하게 수정하고 추가 시럽 빼줘', { ...snapshot, mode: '포장', cart });
  assert.deepEqual(changed.items[0].options, { milk: 'oat' });
  assert.equal(changed.items[0].price, 3600);
  assert.equal(changed.items[0].quantity, 2);
});
test('voice rejects unavailable options and uncertain option choices before execution', async () => {
  await assert.rejects(planCommand(fixture({ milk1: 'oat' }), '아메리카노 오트밀크', snapshot), /우유 변경/);
  await assert.rejects(planCommand(fixture({ ice1: 'less', temperature1: 'HOT' }), '따뜻한 아메리카노 얼음 적게', snapshot), /얼음 양/);
  await assert.rejects(planCommand(fixture({ syrup1: 'unsupported' }), '아메리카노 알 수 없는 시럽', snapshot), /시럽 추가/);
  await assert.rejects(planCommand(fixture({ syrup1: 'vanilla' }, { syrup1: .1 }), '아메리카노 바닐라 시럽', snapshot), { code: 'UNCERTAIN' });
});
