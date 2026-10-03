import { readFileSync } from 'node:fs';
import { AgentError, choice } from './jev.js';

export const menu = JSON.parse(readFileSync(new URL('../src/menu.json', import.meta.url), 'utf8'));
export const paymentNames = ['카드', '페이코', '삼성페이', '카카오페이', '네이버페이', '제로페이'];
const ask = message => Object.assign(new AgentError(message, 'CLARIFY'), { awaitsAnswer: true });
const named = values => Object.fromEntries(values.map(value => [value, value]));
const quantities = { unspecified: '수량을 말하지 않음', ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), `${i + 1}잔`])), unsupported: '20잔 초과 또는 범위를 알 수 없음' };
const menuChoices = { none: '해당 순서의 메뉴가 없음', ambiguous: '여러 메뉴 중 어느 것인지 불명확함. 예: 라떼', ...Object.fromEntries(menu.map(item => [String(item.id), `${item.name}${item.name === '아메리카노' ? ' (아아=아이스 아메리카노, 뜨아=따뜻한 아메리카노)' : ''}`])) };

// Ground exact menu mentions in user text, preserving their order. Longer names win
// overlapping matches (e.g. 디카페인 아메리카노 must not become 아메리카노).
export function menuMentions(text) {
  const matches = [];
  for (const item of menu) {
    const names = [item.name, ...(item.name === '아메리카노' ? ['아아', '뜨아'] : [])];
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      for (const match of text.matchAll(new RegExp(escaped, 'g'))) matches.push({ start: match.index, end: match.index + match[0].length, item });
    }
  }
  const longest = matches.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const result = [];
  for (const match of longest) if (!result.some(other => match.start < other.end && other.start < match.end)) result.push(match);
  return result.sort((a, b) => a.start - b.start);
}

export async function planCommand(client, text, snapshot, signal) {
  const questions = {
    intent: choice('What operation does the complete userRequest ask for? If it contains 추가 답변, those lines fill missing details of the ORIGINAL pending request. Do not treat a short temperature/quantity answer as a standalone operation. A drink already existing in the cart does not imply editing it. 담아줘/주문해줘 asks to ADD a new drink. A shot option attached to a new drink order is part of ADD, not an edit.', {
      add: 'Add a NEW drink, even when its name already exists in cart. 담아줘, 주문해줘, 한 잔 더. Example: 따뜻한 아메리카노 한 잔 샷 추가해서 담아줘 adds a NEW HOT drink with an extra shot.', edit: 'Modify an EXISTING cart line: 바꿔줘, 줄여줘, 수정해줘, or a standalone 샷 빼줘/샷 추가해줘 without ordering a new drink. Not a new drink request ending in 담아줘.', remove: '기존 장바구니 메뉴 한 종류 삭제',
      checkout: '현재 주문의 결제 진행', mode: '매장/포장만 변경', ui: '화면의 특정 버튼 클릭 또는 화면 이동', unknown: '해석 불가/키오스크와 무관',
    }),
    mode: choice('명시한 이용 방식은? 말하지 않았으면 unspecified.', { 매장: '매장/먹고 갈게/여기서', 포장: '포장/테이크아웃/가지고 갈게', unspecified: '언급 없음' }),
    payment: choice('명시한 결제수단은?', { ...named(paymentNames), unspecified: '언급 없음' }),
    checkout: choice('메뉴를 담은 뒤 이번 요청 안에서 결제도 하라고 명시했는가?', { yes: '결제까지 명시적으로 요청', no: '담기만 요청 또는 결제 언급 없음' }),
    item_count: choice('새로 추가할 서로 다른 주문 항목의 개수는? 추가 답변이 있으면 원래 주문의 메뉴 개수를 세고, 짧은 추가 답변만 따로 해석하지 않는다. 잔 수가 아니다. 아메리카노 두 잔은 1항목. 아메리카노와 라떼는 2항목. 같은 메뉴의 HOT와 ICE는 서로 다른 항목.', {
      '1': '한 종류 주문: 아메리카노 두 잔, 아아 3잔 등',
      '2': '두 종류 주문: 아메리카노 한 잔과 라떼 한 잔 등', '3': '세 종류 주문', overflow: '네 종류 이상 주문',
    }),

  };
  const state = { userRequest: text, cart: snapshot.cart, currentMode: snapshot.mode, screen: snapshot.screen };
  const result = await client.decide(state, questions, signal, { threshold: 0 });
  const a = result.answers;
  const itemCount = a.intent === 'edit' ? 1 : a.intent === 'add' ? Number(a.item_count) : 0;
  if (a.intent === 'add' && a.item_count === 'overflow') throw new AgentError('한 번에 세 종류까지 말씀해 주세요.', 'CLARIFY');
  if (a.intent === 'add' && (![1, 2, 3].includes(itemCount) || result.confidences.item_count < client.threshold)) throw new AgentError('주문할 메뉴와 각각의 수량을 구체적으로 알려주세요.', 'CLARIFY');
  const mentions = menuMentions(text);
  const grounded = a.intent === 'add' && mentions.length === itemCount ? mentions : [];
  const itemQuestions = {};
  if (['edit', 'remove'].includes(a.intent)) {
    const mentionedNames = new Set(mentions.map(mention => mention.item.name));
    const candidates = snapshot.cart.map((line, index) => ({ ...line, index })).filter(line => !mentionedNames.size || mentionedNames.has(line.name));
    itemQuestions.line = choice('Which EXISTING cart line does the user want to edit/remove? Match its menu and original temperature/shot when specified. Ignore the requested NEW quantity: it is expected to differ from the current quantity. If several lines are plausible, choose ambiguous.', {
      ...Object.fromEntries(candidates.map(line => [`line_${line.index}`, `${line.name} / ${line.temperature} / ${line.shot ? '샷 추가 있음' : '샷 추가 없음'}`])),
      ambiguous: 'The target is unclear or not in the cart',
    });
    if (!candidates.length) throw new AgentError('장바구니에 해당 메뉴가 없습니다.', 'CLARIFY');
  }

  for (let i = 1; i <= itemCount; i++) {
    const known = grounded[i - 1]?.item;
    const focus = `The user requests ${itemCount} order line(s). Focus only on line ${i} in order of mention${known ? `, menu '${known.name}'` : ''}. Number of cups is not the line number. Ignore other lines.`;
    itemQuestions[`menu${i}`] = choice(`${focus} Which menu is requested?`, known ? { [String(known.id)]: known.name, ambiguous: 'Unclear or a different menu', none: 'No such order item' } : menuChoices);
    itemQuestions[`temperature${i}`] = choice(`${focus} What temperature is explicitly requested? 아아 means ICE, 뜨아 means HOT.`, { ICE: '아이스/차갑게', HOT: '핫/뜨겁게/따뜻하게', unspecified: 'Not specified' });
    itemQuestions[`quantity${i}`] = choice(`${focus} How many cups of this menu? 한 잔=1, 두 잔=2. Choose unspecified when no cup count is explicitly stated; never assume one cup from a single menu name or item count. For edits select the final desired quantity.`, quantities);
    itemQuestions[`shot${i}`] = choice(`${focus} Classify ONLY an explicit instruction about an extra espresso shot. If the user does not mention 샷/shot, choose unspecified. Do not infer removal from silence.`, { add: 'Explicit 샷 추가 / add an extra shot', remove: 'Explicit 샷 빼기 / 샷 추가 없이 / remove the extra shot', unspecified: 'No explicit instruction about shots; ordinary drink order' });
  }
  if (Object.keys(itemQuestions).length) {
    const details = await client.decide({ ...state, task: a.intent, orderItemCount: itemCount }, itemQuestions, signal, { threshold: 0 });
    Object.assign(a, details.answers); Object.assign(result.confidences, details.confidences);
  }
  // Only relevant heads should gate execution. Irrelevant speculative heads often have low confidence.
  const plan = { intent: a.intent, mode: a.mode === 'unspecified' ? snapshot.mode : a.mode,
    payment: a.payment === 'unspecified' ? null : a.payment, checkout: a.intent === 'checkout' || a.checkout === 'yes', items: [], text };
  if (a.intent === 'unknown') throw new AgentError('주문할 메뉴나 누를 버튼을 말씀해 주세요.', 'CLARIFY');
  if (['edit', 'remove'].includes(a.intent)) {
    const index = Number(a.line?.replace('line_', ''));
    if (!/^line_\d+$/.test(a.line) || !snapshot.cart[index]) throw new AgentError('어떤 메뉴를 수정할지 메뉴명과 온도를 알려주세요.', 'CLARIFY');
    plan.line = { ...snapshot.cart[index] };
    if (plan.intent === 'edit' && mentions.some(mention => mention.item.name !== plan.line.name)) throw new AgentError('메뉴 종류를 바꾸려면 기존 메뉴를 삭제한 뒤 새 메뉴를 담아주세요.', 'CLARIFY');
  }
  if (['add', 'edit'].includes(a.intent)) {
    for (let i = 1; i <= itemCount; i++) {
      const product = a.intent === 'edit' ? menu.find(item => item.name === plan.line.name) : menu.find(item => String(item.id) === a[`menu${i}`]);
      if (!product) throw new AgentError('정확한 메뉴명을 말씀해 주세요. 예: 카페라떼, 바닐라라떼.', 'CLARIFY');
      const rawTemp = a[`temperature${i}`];
      const temperature = rawTemp === 'unspecified' ? plan.line?.temperature || (product.temperatures.length === 1 ? product.temperatures[0] : null) : rawTemp;
      if (!temperature) throw ask(`${product.name}는 아이스로 할까요, 따뜻하게 할까요?`);
      if (!product.temperatures.includes(temperature)) throw new AgentError(`${product.name}는 ${product.temperatures.map(t => t === 'ICE' ? '아이스' : '따뜻한 음료').join('/')}만 가능합니다. 다른 주문을 말씀해 주세요.`, 'MENU_INFO');
      const q = a[`quantity${i}`];
      if (q === 'unsupported') throw new AgentError('한 번에 1~20잔으로 말씀해 주세요.', 'CLARIFY');
      if (q === 'unspecified' && plan.intent === 'add') throw ask(`${product.name}는 몇 잔 드릴까요?`);
      const quantity = q === 'unspecified' ? plan.line.quantity : Number(q);
      const rawShot = a[`shot${i}`];
      const shot = rawShot === 'unspecified' ? plan.line?.shot || false : rawShot === 'add';
      if (shot && product.category !== '커피') throw new AgentError(`${product.name}에는 샷 추가 옵션이 없습니다.`, 'CLARIFY');
      plan.items.push({ name: product.name, temperature, quantity, shot, price: product.price + (shot ? 500 : 0) });
    }
  }
  if (['add', 'mode'].includes(plan.intent) && !plan.mode) throw ask('매장과 포장 중 어느 쪽인가요?');
  if (plan.checkout && !plan.payment) throw ask('결제수단을 알려주세요. 카드, 페이코, 삼성페이, 카카오페이, 네이버페이, 제로페이를 선택할 수 있습니다.');
  const relevant = ['intent'];
  for (const key of ['mode', 'payment']) if (a[key] !== 'unspecified') relevant.push(key);
  if (plan.checkout && plan.intent !== 'checkout') relevant.push('checkout');
  if (['edit', 'remove'].includes(plan.intent)) relevant.push('line');
  plan.items.forEach((_, index) => {
    const i = index + 1;
    if (plan.intent === 'add') relevant.push(`menu${i}`);
    for (const field of ['temperature', 'quantity', 'shot']) if (a[`${field}${i}`] !== 'unspecified') relevant.push(`${field}${i}`);
  });
  if (relevant.some(key => (result.confidences?.[key] ?? 0) < client.threshold)) throw new AgentError('주문 해석이 불확실합니다. 메뉴·온도·수량을 구체적으로 다시 말씀해 주세요.', 'UNCERTAIN');
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
