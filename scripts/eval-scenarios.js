// Evaluation scenarios for the README targets: order success rate >= 90% and p95 latency.
// kind 'order' counts toward the success rate; 'cancel' and 'reject' are reported separately
// so a correct refusal is never mixed into (or hidden inside) the order success rate.
import { optionsKey } from '../src/options.js';

const line = (name, temperature, quantity, extra = {}) => ({ name, temperature, quantity, shot: false, options: {}, ...extra });

export const scenarios = [
  { id: 'single', kind: 'order', turns: ['아이스 아메리카노 두 잔 포장해 줘'], expect: { cart: [line('아메리카노', 'ICE', 2)], mode: '포장' } },
  { id: 'dine-in', kind: 'order', turns: ['따뜻한 카페라떼 한 잔 매장에서 먹을게요'], expect: { cart: [line('카페라떼', 'HOT', 1)], mode: '매장' } },
  { id: 'slang', kind: 'order', turns: ['아아 세 잔 포장'], expect: { cart: [line('아메리카노', 'ICE', 3)] } },
  { id: 'two-items', kind: 'order', turns: ['아이스 아메리카노 한 잔이랑 따뜻한 바닐라라떼 두 잔 포장'],
    expect: { cart: [line('아메리카노', 'ICE', 1), line('바닐라라떼', 'HOT', 2)] } },
  { id: 'three-items', kind: 'order', turns: ['아이스 아메리카노 한 잔, 따뜻한 카페라떼 한 잔, 자몽에이드 두 잔 포장해 주세요'],
    expect: { cart: [line('아메리카노', 'ICE', 1), line('카페라떼', 'HOT', 1), line('자몽에이드', 'ICE', 2)] } },
  { id: 'ask-temperature-quantity', kind: 'order', turns: ['녹차라떼 포장', '아이스', '두 잔'], expect: { cart: [line('녹차라떼', 'ICE', 2)] } },
  { id: 'ask-quantity', kind: 'order', turns: ['아이스 카페라떼 포장', '한 잔이요'], expect: { cart: [line('카페라떼', 'ICE', 1)] } },
  { id: 'ask-mode', kind: 'order', turns: ['아이스 아메리카노 한 잔', '포장이요'], expect: { cart: [line('아메리카노', 'ICE', 1)], mode: '포장' } },
  { id: 'shot', kind: 'order', turns: ['따뜻한 아메리카노 한 잔 샷 추가해서 포장'], expect: { cart: [line('아메리카노', 'HOT', 1, { shot: true })] } },
  { id: 'milk-option', kind: 'order', turns: ['아이스 카페라떼 한 잔 오트밀크로 포장'], expect: { cart: [line('카페라떼', 'ICE', 1, { options: { milk: 'oat' } })] } },
  { id: 'two-options', kind: 'order', turns: ['아이스 아메리카노 한 잔 바닐라 시럽 추가하고 얼음 적게 포장'],
    expect: { cart: [line('아메리카노', 'ICE', 1, { options: { syrup: 'vanilla', ice: 'less' } })] } },
  { id: 'edit-quantity', kind: 'order', turns: ['아이스 아메리카노 세 잔 포장', '아메리카노 한 잔으로 바꿔줘'], expect: { cart: [line('아메리카노', 'ICE', 1)] } },
  { id: 'edit-temperature', kind: 'order', turns: ['아이스 카페라떼 한 잔 포장', '카페라떼 따뜻하게 바꿔줘'], expect: { cart: [line('카페라떼', 'HOT', 1)] } },
  { id: 'remove', kind: 'order', turns: ['아이스 아메리카노 한 잔이랑 아이스 카페라떼 한 잔 포장', '카페라떼 빼줘'], expect: { cart: [line('아메리카노', 'ICE', 1)] } },
  { id: 'one-more', kind: 'order', turns: ['아이스 아메리카노 한 잔 포장', '아이스 아메리카노 한 잔 더 담아줘'], expect: { cart: [line('아메리카노', 'ICE', 2)] } },
  { id: 'change-mode', kind: 'order', turns: ['아이스 아메리카노 한 잔 포장', '매장에서 먹을게요'], expect: { cart: [line('아메리카노', 'ICE', 1)], mode: '매장' } },
  { id: 'checkout', kind: 'order', turns: ['아이스 아메리카노 두 잔 포장', '카드로 결제해 줘', '적립은 건너뛸게요'],
    expect: { cart: [line('아메리카노', 'ICE', 2)], confirmation: '카드' } },
  { id: 'replace-pending', kind: 'order', turns: ['녹차라떼 포장', '아니 그냥 아이스 아메리카노 한 잔 포장할게요'], expect: { cart: [line('아메리카노', 'ICE', 1)] } },
  { id: 'cancel-pending', kind: 'cancel', turns: ['녹차라떼 포장', '취소할게요'], expect: { cart: [] } },
  { id: 'off-topic', kind: 'reject', turns: ['오늘 날씨 어때?'], expect: { cart: [], lastCode: ['CLARIFY', 'UNCERTAIN'] } },
];

const cartKey = cart => cart.map(item => `${item.name}|${item.temperature}|${Boolean(item.shot)}|${optionsKey(item.options)}|${item.quantity}`).sort().join('\n');

// observed: { cart, mode, confirmation, turns: [{ code, durationMs }] }
export function scoreRun(scenario, observed) {
  const { expect } = scenario;
  const last = observed.turns.at(-1);
  if (cartKey(observed.cart) !== cartKey(expect.cart)) return { pass: false, reason: 'cart' };
  if (expect.mode && observed.mode !== expect.mode) return { pass: false, reason: 'mode' };
  if (expect.confirmation && observed.confirmation !== expect.confirmation) return { pass: false, reason: 'confirmation' };
  if (expect.lastCode ? !expect.lastCode.includes(last?.code) : last?.code) return { pass: false, reason: `last-turn:${last?.code ?? 'ok'}` };
  return { pass: true };
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
};

// runs: [{ id, kind, pass, reason, turns: [{ durationMs, decisions }] }]
export function summarize(runs) {
  const byKind = {};
  for (const run of runs) {
    byKind[run.kind] ??= { runs: 0, passed: 0 };
    byKind[run.kind].runs++; if (run.pass) byKind[run.kind].passed++;
  }
  const turns = runs.flatMap(run => run.turns).filter(turn => Number.isFinite(turn.durationMs));
  const failures = {};
  for (const run of runs) if (!run.pass) failures[run.id] = [...(failures[run.id] || []), run.reason];
  return {
    orderSuccessRate: byKind.order ? Number((byKind.order.passed / byKind.order.runs).toFixed(3)) : null,
    byKind, failures,
    turnLatencyMs: { p50: percentile(turns.map(turn => turn.durationMs), .5), p95: percentile(turns.map(turn => turn.durationMs), .95) },
    avgDecisionsPerTurn: turns.length ? Number((turns.reduce((sum, turn) => sum + (turn.decisions || 0), 0) / turns.length).toFixed(1)) : null,
  };
}
