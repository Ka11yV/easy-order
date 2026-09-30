import { readFileSync } from 'node:fs';
import { AgentError, choice } from './jev.js';

export const menu = JSON.parse(readFileSync(new URL('../src/menu.json', import.meta.url), 'utf8'));
export const paymentNames = ['카드', '페이코', '삼성페이', '카카오페이', '네이버페이', '제로페이'];
const named = values => Object.fromEntries(values.map(value => [value, value]));
const quantities = { unspecified: '수량을 말하지 않음', ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), `${i + 1}잔`])), unsupported: '20잔 초과 또는 범위를 알 수 없음' };
const menuChoices = { none: '해당 순서의 메뉴가 없음', ambiguous: '여러 메뉴 중 어느 것인지 불명확함. 예: 라떼', ...Object.fromEntries(menu.map(item => [String(item.id), `${item.name}${item.name === '아메리카노' ? ' (아아=아이스 아메리카노, 뜨아=따뜻한 아메리카노)' : ''}`])) };

export async function planCommand(client, text, snapshot, signal) {
  const questions = {
    intent: choice('사용자가 지금 요청하는 주된 작업은? 단순 버튼 클릭 지시는 ui. 메뉴를 새로 담기는 add. 수정은 edit. 결제는 checkout.', {
      add: '메뉴를 새로 주문/추가', edit: '기존 장바구니 메뉴의 온도/수량/샷 수정', remove: '기존 장바구니 메뉴 한 종류 삭제',
      checkout: '현재 주문의 결제 진행', mode: '매장/포장만 변경', ui: '화면의 특정 버튼 클릭 또는 화면 이동', unknown: '해석 불가/키오스크와 무관',
    }),
    mode: choice('명시한 이용 방식은? 말하지 않았으면 unspecified.', { 매장: '매장/먹고 갈게/여기서', 포장: '포장/테이크아웃/가지고 갈게', unspecified: '언급 없음' }),
    payment: choice('명시한 결제수단은?', { ...named(paymentNames), unspecified: '언급 없음' }),
    checkout: choice('메뉴를 담은 뒤 이번 요청 안에서 결제도 하라고 명시했는가?', { yes: '결제까지 명시적으로 요청', no: '담기만 요청 또는 결제 언급 없음' }),
    overflow: choice('요청에 서로 다른 메뉴 항목이 3개를 초과하는가?', { yes: '4개 이상', no: '3개 이하' }),
    line: choice('수정/삭제 대상 장바구니 행은? 하나뿐이고 그거/방금 것으로 지칭하면 그 행. 여러 후보면 ambiguous.', {
      none: '수정/삭제 요청이 아님', ambiguous: '어느 행인지 불명확/존재하지 않음',
      ...Object.fromEntries(snapshot.cart.map((line, i) => [String(i), `${line.name} ${line.temperature} ${line.shot ? '샷 추가' : ''} ${line.quantity}잔`])),
    }),
  };
  for (let i = 1; i <= 3; i++) {
    questions[`menu${i}`] = choice(`요청에 나오는 ${i}번째 주문 항목의 메뉴. 같은 메뉴라도 서로 다른 온도이면 별도 항목. 없는 항목은 none. 수정/삭제일 때 첫 항목만 사용.`, menuChoices);
    questions[`temperature${i}`] = choice(`${i}번째 항목의 명시된 온도. 아아는 ICE, 뜨아는 HOT. 말하지 않았으면 unspecified.`, { ICE: '아이스/차갑게', HOT: '핫/뜨겁게/따뜻하게', unspecified: '언급 없음' });
    questions[`quantity${i}`] = choice(`${i}번째 항목의 목표 수량. 한 잔=1, 두 잔=2. 수정 시 최종 수량을 골라라. 말하지 않았으면 unspecified.`, quantities);
    questions[`shot${i}`] = choice(`${i}번째 항목의 샷 추가 요청은?`, { yes: '샷 추가', no: '샷 빼기/샷 추가 없이', unspecified: '언급 없음' });
  }
  const result = await client.decide({ userRequest: text, cart: snapshot.cart, currentMode: snapshot.mode, screen: snapshot.screen }, questions, signal, { threshold: 0 });
  const a = result.answers;
  // Only relevant heads should gate execution. Irrelevant speculative heads often have low confidence.
  const plan = { intent: a.intent, mode: a.mode === 'unspecified' ? snapshot.mode : a.mode,
    payment: a.payment === 'unspecified' ? null : a.payment, checkout: a.intent === 'checkout' || a.checkout === 'yes', items: [], text };
  if (a.intent === 'unknown') throw new AgentError('주문할 메뉴나 누를 버튼을 입력해 주세요.', 'CLARIFY');
  if (a.overflow === 'yes' && a.intent === 'add') throw new AgentError('한 번에 세 종류까지 입력해 주세요.', 'CLARIFY');
  if (['edit', 'remove'].includes(a.intent)) {
    const index = Number(a.line);
    if (!/^\d+$/.test(a.line) || !snapshot.cart[index]) throw new AgentError('어떤 메뉴를 수정할지 메뉴명과 온도를 알려주세요.', 'CLARIFY');
    plan.line = { ...snapshot.cart[index] };
  }
  if (['add', 'edit'].includes(a.intent)) {
    for (let i = 1; i <= (a.intent === 'edit' ? 1 : 3); i++) {
      const product = a.intent === 'edit' ? menu.find(item => item.name === plan.line.name) : menu.find(item => String(item.id) === a[`menu${i}`]);
      if (a.intent === 'add' && a[`menu${i}`] === 'none' && i > 1) break;
      if (!product) throw new AgentError('정확한 메뉴명을 입력해 주세요. 예: 카페라떼, 바닐라라떼.', 'CLARIFY');
      const rawTemp = a[`temperature${i}`];
      const temperature = rawTemp === 'unspecified' ? plan.line?.temperature || (product.temperatures.length === 1 ? product.temperatures[0] : null) : rawTemp;
      if (!temperature) throw new AgentError(`${product.name}는 아이스로 할까요, 따뜻하게 할까요?`, 'CLARIFY');
      if (!product.temperatures.includes(temperature)) throw new AgentError(`${product.name}는 ${product.temperatures.join('/')}만 가능합니다.`, 'CLARIFY');
      const q = a[`quantity${i}`];
      if (q === 'unsupported') throw new AgentError('한 번에 1~20잔으로 입력해 주세요.', 'CLARIFY');
      const quantity = q === 'unspecified' ? plan.line?.quantity || 1 : Number(q);
      const rawShot = a[`shot${i}`];
      const shot = rawShot === 'unspecified' ? plan.line?.shot || false : rawShot === 'yes';
      if (shot && product.category !== '커피') throw new AgentError(`${product.name}에는 샷 추가 옵션이 없습니다.`, 'CLARIFY');
      plan.items.push({ name: product.name, temperature, quantity, shot, price: product.price + (shot ? 500 : 0) });
    }
  }
  if (['add', 'mode'].includes(plan.intent) && !plan.mode) throw new AgentError('매장과 포장 중 어느 쪽인가요?', 'CLARIFY');
  if (plan.checkout && !plan.payment) throw new AgentError('결제수단을 알려주세요. 카드, 페이코, 삼성페이, 카카오페이, 네이버페이, 제로페이를 선택할 수 있습니다.', 'CLARIFY');
  const relevant = ['intent'];
  for (const key of ['mode', 'payment']) if (a[key] !== 'unspecified') relevant.push(key);
  if (plan.checkout && plan.intent !== 'checkout') relevant.push('checkout');
  if (['edit', 'remove'].includes(plan.intent)) relevant.push('line');
  plan.items.forEach((_, index) => {
    const i = index + 1;
    if (plan.intent === 'add') relevant.push(`menu${i}`);
    for (const field of ['temperature', 'quantity', 'shot']) if (a[`${field}${i}`] !== 'unspecified') relevant.push(`${field}${i}`);
  });
  if (relevant.some(key => (result.confidences?.[key] ?? 0) < client.threshold)) throw new AgentError('주문 해석이 불확실합니다. 메뉴·온도·수량을 구체적으로 다시 입력해 주세요.', 'UNCERTAIN');
  return plan;
}

export function expectedCart(before, plan) {
  let result = before.map(line => ({ ...line }));
  const same = (a, b) => a.name === b.name && a.temperature === b.temperature && a.shot === b.shot;
  if (['edit', 'remove'].includes(plan.intent)) result = result.filter(line => !same(line, plan.line));
  for (const item of plan.items) {
    const existing = result.find(line => same(line, item));
    if (existing) existing.quantity += item.quantity;
    else result.push({ ...item });
  }
  if (result.some(line => line.quantity > 99)) throw new AgentError('같은 메뉴는 최대 99잔까지 담을 수 있습니다.', 'CLARIFY');
  return result;
}

export function cartMatches(actual, expected) {
  const normalize = list => list.map(({ name, temperature, quantity, shot }) => `${name}|${temperature}|${shot}|${quantity}`).sort();
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}
