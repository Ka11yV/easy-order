// Shared demo-kiosk recipes. Prices are per cup, independent of quantity.
const value = (id, label, price = 0) => ({ id, label, price });
export const optionGroups = [
  { id: 'ice', label: '얼음 양', values: [value('normal', '기본 얼음'), value('less', '얼음 적게'), value('more', '얼음 많이'), value('none', '얼음 없이')] },
  { id: 'milk', label: '우유 변경', values: [value('normal', '기본 우유'), value('oat', '오트밀크', 600), value('soy', '두유', 500), value('lactoseFree', '락토프리 우유', 500)] },
  { id: 'sweetness', label: '당도', values: [value('normal', '기본 당도'), value('less', '덜 달게'), value('more', '더 달게')] },
  { id: 'syrup', label: '시럽 추가', values: [value('normal', '시럽 추가 안 함'), value('vanilla', '바닐라 시럽', 500), value('hazelnut', '헤이즐넛 시럽', 500), value('caramel', '카라멜 시럽', 500)] },
  { id: 'cream', label: '휘핑 추가', values: [value('normal', '휘핑 추가 안 함'), value('add', '휘핑크림 추가', 500)] },
  { id: 'pearl', label: '펄 추가', values: [value('normal', '펄 추가 안 함'), value('add', '타피오카 펄 추가', 700)] },
  { id: 'drizzle', label: '드리즐 추가', values: [value('normal', '드리즐 추가 안 함'), value('chocolate', '초코 드리즐', 300), value('caramel', '카라멜 드리즐', 300)] },
  { id: 'strength', label: '차 진하기', values: [value('normal', '기본 진하기'), value('light', '연하게 우려내기'), value('strong', '진하게 우려내기')] },
];
const plainTeas = new Set(['녹차', '얼그레이', '캐모마일', '페퍼민트']);
export function groupsFor(product, temperature) {
  const name = product.name;
  const coffee = ['커피', '디카페인'].includes(product.category);
  const blended = product.category === '스무디·프라페';
  const espresso = name.includes('에스프레소');
  const plainTea = plainTeas.has(name);
  const milk = /라떼|카푸치노|마끼아또|카페모카|핫초코|아이스초코|대용량 초코/.test(name)
    && !/아몬드|믹스|젤라또/.test(name);
  const creamy = /프라페|초코|모카|마끼아또|밀크쉐이크|퐁크러쉬/.test(name);
  const allowed = {
    ice: temperature === 'ICE' && !blended && !espresso && !name.includes('큐브'),
    milk,
    sweetness: !plainTea && !/제로|저당|에스프레소/.test(name) && (!coffee || /바닐라|헤이즐넛|꿀|연유|모카|마끼아또|믹스|젤라또/.test(name)),
    syrup: coffee && !/젤라또|믹스/.test(name),
    cream: creamy,
    pearl: temperature === 'ICE' && /밀크티|흑당|딸기라떼|녹차라떼/.test(name),
    drizzle: creamy,
    strength: plainTea,
  };
  return optionGroups.filter(group => allowed[group.id]);
}
// Store only non-default choices: omitted/default choices have the same identity.
export function normalizeOptions(product, temperature, selected = {}) {
  const allowed = groupsFor(product, temperature);
  const result = {};
  for (const group of allowed) {
    const id = selected[group.id];
    if (id && id !== 'normal' && group.values.some(value => value.id === id)) result[group.id] = id;
  }
  return result;
}
export function validateOptions(product, temperature, selected = {}) {
  const normalized = normalizeOptions(product, temperature, selected);
  for (const [key, id] of Object.entries(selected)) {
    if (id !== 'normal' && normalized[key] !== id) throw new Error(`${product.name}에는 요청한 ${optionGroups.find(g => g.id === key)?.label || key} 옵션을 적용할 수 없습니다.`);
  }
  return normalized;
}
export function optionsKey(selected = {}) {
  return Object.entries(selected).filter(([, value]) => value !== 'normal').sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}`).join(',');
}
export function selectedOptions(selected = {}) {
  return optionGroups.flatMap(group => {
    const chosen = group.values.find(value => value.id === selected[group.id] && value.id !== 'normal');
    return chosen ? [{ ...chosen, group: group.id }] : [];
  });
}
export const optionsSummary = selected => selectedOptions(selected).map(value => value.label).join(' · ');
export const optionPrice = selected => selectedOptions(selected).reduce((sum, value) => sum + value.price, 0);
export const unitPrice = (product, shot, selected) => product.price + (shot ? 500 : 0) + optionPrice(selected);
export const optionButtonLabel = value => `${value.label}${value.price ? ` +${value.price.toLocaleString('ko-KR')}원` : ''}`;
