import test from 'node:test';
import assert from 'node:assert/strict';
import { cupCount, speechText, phoneNumber } from '../server/korean.js';
test('cup counters use natural Korean without changing prices or order numbers', () => {
  assert.deepEqual([1,2,3,4,10,11,20,21,99].map(cupCount), ['한 잔','두 잔','세 잔','네 잔','열 잔','열한 잔','스무 잔','스물한 잔','아흔아홉 잔']);
  assert.equal(speechText('1잔과 2잔, 3 잔. 3,000원. 주문번호 101.'), '한 잔과 두 잔, 세 잔. 3,000원. 주문번호 101.');
});
test('phone recognition accepts complete mobile numbers and rejects ambiguous utterances', () => {
  assert.equal(phoneNumber('010-1234-5678'), '01012345678');
  assert.equal(phoneNumber('공일공 일이삼사 오육칠팔'), '01012345678');
  for (const text of ['0101234', '010123456789', '아니요', '번호 바꿀게요', '11101012345678']) assert.equal(phoneNumber(text), null);
});
