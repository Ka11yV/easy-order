import test from 'node:test';
import assert from 'node:assert/strict';
import { menu, expectedCart, cartMatches } from '../server/planner.js';
import { groupsFor, normalizeOptions, validateOptions, optionsKey, unitPrice } from '../src/options.js';
const product = name => menu.find(item => item.name === name);
const groups = (name, temperature = 'ICE') => groupsFor(product(name), temperature).map(g => g.id);
test('recipes match drink types and do not offer incompatible ice, milk or sugar adjustments', () => {
  assert.ok(groups('카페라떼').includes('milk'));
  assert.ok(groups('디카페인 카페라떼').includes('milk'));
  assert.ok(!groups('아메리카노').includes('milk'));
  assert.ok(!groups('라이트 바닐라 아몬드라떼').includes('milk'));
  assert.ok(!groups('카페라떼', 'HOT').includes('ice'));
  assert.ok(!groups('쿠키프라페').includes('ice'));
  assert.ok(!groups('에스프레소').includes('ice'));
  assert.ok(!groups('큐브라떼').includes('ice'));
  assert.ok(!groups('제로 복숭아 아이스티').includes('sweetness'));
  assert.ok(groups('얼그레이').includes('strength'));
  assert.ok(groups('흑당밀크티라떼').includes('pearl'));
  assert.ok(groups('쿠키프라페').includes('cream'));
  assert.ok(groups('쿠키프라페').includes('drizzle'));
  for (const item of menu) for (const temp of item.temperatures) {
    assert.ok(groupsFor(item, temp).length, `${item.name} must offer customization`);
  }
});
test('temperature changes clear incompatible choices, charges are per cup, invalid choices fail closed', () => {
  const latte = product('카페라떼');
  const selected = normalizeOptions(latte, 'HOT', { ice: 'less', milk: 'oat', syrup: 'vanilla' });
  assert.deepEqual(selected, { milk: 'oat', syrup: 'vanilla' });
  assert.equal(unitPrice(latte, true, selected), 4600);
  assert.throws(() => validateOptions(latte, 'HOT', { ice: 'less' }));
  assert.throws(() => validateOptions(latte, 'ICE', { milk: 'invalid' }));
  assert.equal(optionsKey({ milk: 'normal' }), optionsKey({}));
  assert.equal(optionsKey({ milk: 'oat', ice: 'less' }), optionsKey({ ice: 'less', milk: 'oat' }));
});
test('cart identity includes options and verification detects option and price mismatches', () => {
  const base = { name: '카페라떼', temperature: 'ICE', shot: false, quantity: 1, price: 3000, options: {} };
  const oat = { ...base, options: { milk: 'oat' }, price: 3600 };
  assert.equal(expectedCart([base], { intent: 'add', items: [oat] }).length, 2);
  const merged = expectedCart([base, oat], { intent: 'edit', line: oat, items: [base] });
  assert.deepEqual(merged, [{ ...base, quantity: 2 }]);
  assert.equal(cartMatches([base], [oat]), false);
  assert.equal(cartMatches([base], [{ ...base, price: 3600 }]), false);
});
