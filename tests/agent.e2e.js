import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createAgentApp } from '../server/app.js';
import { menu } from '../server/planner.js';

// A deterministic JEV fixture only exists in tests. Production never falls back to it.
class FixtureJev {
  configured = true; threshold = .5; calls = 0; blockNext = false;
  async decide(state, questions, signal) {
    signal?.throwIfAborted(); this.calls++;
    if (this.blockNext) { this.blockNext = false; await delay(1000, null, { signal }); }
    let answers = {};
    if (questions.intent || questions.menu1 || questions.line) {
      answers = Object.fromEntries(Object.keys(questions).map(key => [key, key.startsWith('menu') ? 'none' : key.startsWith('quantity') || key.startsWith('temperature') || key.startsWith('shot') ? 'unspecified' : 'no']));
      Object.assign(answers, { intent: 'add', mode: '포장', payment: 'unspecified', checkout: 'no', line: 'none', item_count: '1',
        menu1: String(menu.find(item => item.name === '아메리카노').id), temperature1: 'ICE', quantity1: '2', shot1: 'unspecified' });
      if (state.userRequest.includes('수정')) Object.assign(answers, { intent: 'edit', line: 'line_0', quantity1: '1', mode: 'unspecified' });
      if (state.userRequest.includes('결제')) Object.assign(answers, { intent: 'checkout', payment: '카카오페이', checkout: 'yes', mode: 'unspecified' });
      if (state.userRequest.includes('삭제')) Object.assign(answers, { intent: 'remove', line: 'line_0', mode: 'unspecified' });
    } else {
      const task = state.task;
      const entries = Object.entries(questions.action.criteria);
      let found;
      const quoted = task?.match(/^"(.+)" 버튼/);
      if (quoted) found = entries.find(([, value]) => value === `클릭: ${quoted[1]}` || value.startsWith(`클릭: ${quoted[1]} (선택=`));
      else if (task?.includes('메뉴 검색창')) found = entries.find(([, value]) => value.startsWith('입력창 메뉴 검색'));
      else if (task?.includes('메뉴 카드를')) found = entries.find(([, value]) => value.startsWith('클릭: 아메리카노 ') && value.endsWith(' 선택'));
      else if (task?.includes('저장하세요')) found = entries.find(([, value]) => /^클릭: .*원(담기|수정)$/.test(value.replace(/\s+/g, '')) || /^클릭: .*원\s*(담기|수정)$/.test(value));
      else if (task?.includes('옵션 변경')) found = entries.find(([, value]) => value === '클릭: 아메리카노 옵션 수정');
      else if (task?.includes('삭제하세요')) found = entries.find(([, value]) => value === '클릭: 아메리카노 삭제');
      if (!found) throw Error(`Fixture target missing: ${task}\n${JSON.stringify(entries)}`);
      answers = { action: found[0] };
    }
    return { answers, confidences: Object.fromEntries(Object.keys(answers).map(key => [key, 1])) };
  }
}

async function setup(t) {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new FixtureJev();
  const service = createAgentApp({ origin, client, headless: true });
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  service.app.use(express.static(dist)); service.app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
  server.on('request', service.app);
  const post = async (path, body = {}) => {
    const response = await fetch(`${origin}/api/${path}`, { method: 'POST', headers: { 'X-Easy-Order': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const wait = async () => {
    for (let i = 0; i < 160; i++) {
      const state = await (await fetch(`${origin}/api/status`)).json();
      if (!state.busy) return state;
      await delay(100);
    }
    throw Error('Agent timeout');
  };
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  assert.equal((await post('browser')).status, 200);
  return { ...service, origin, post, wait, client };
}

test('real browser: text add, edit, points skip, confirmation, barcode completion', { timeout: 60000 }, async t => {
  const { browser, post, wait, client, origin } = await setup(t);
  const control = await browser.context.newPage();
  const errors = []; control.on('pageerror', error => errors.push(error.message));
  await control.goto(`${origin}/control`);
  await control.getByText('로컬 서버 연결됨', { exact: true }).waitFor();
  await control.getByLabel('주문 입력', { exact: true }).fill('아이스 아메리카노 두 잔 포장');
  await control.getByRole('button', { name: '주문 실행', exact: true }).click();
  await control.getByText('요청', { exact: true }).waitFor();

  let state = await wait();
  assert.equal(state.status, 'done', JSON.stringify(state.history));
  let snap = await browser.snapshot();
  assert.equal(snap.mode, '포장'); assert.equal(snap.cart[0].quantity, 2); assert.equal(snap.cart[0].temperature, 'ICE');
  assert.equal(await browser.page.locator('.product-plus').count(), 0);
  await post('command', { text: '아메리카노 하나로 수정' }); state = await wait();
  assert.equal(state.status, 'done', JSON.stringify(state.history));
  assert.equal((await browser.snapshot()).cart[0].quantity, 1);
  await post('command', { text: '카카오페이 결제' }); state = await wait();
  assert.equal(state.status, 'confirmation', JSON.stringify(state.history));
  assert.equal(state.confirmation.total, 2000);
  assert.equal((await browser.snapshot()).screen, '결제수단 선택');
  assert.ok(state.history.some(event => event.target === '건너뛰기'));
  await post('confirm'); state = await wait();
  assert.equal(state.status, 'done', JSON.stringify(state.history));
  assert.equal((await browser.snapshot()).orderNumber, '101');
  assert.ok(client.calls > 10);
  await control.getByText('모의 결제 완료 · 주문번호 101', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.ok(await control.getByAltText('자동화 중인 키오스크 화면').isVisible());
  await control.close();
});

test('stop cancels in-flight decision; busy requests rejected; wrong origins rejected', { timeout: 30000 }, async t => {
  const { browser, client, post, wait, origin } = await setup(t);
  client.blockNext = true;
  await post('command', { text: '아이스 아메리카노 두 잔 포장' });
  assert.equal((await post('command', { text: '중복' })).status, 409);
  await post('stop'); assert.equal((await wait()).status, 'stopped');
  assert.equal((await browser.snapshot()).screen, '매장 또는 포장 선택');
  const bad = await fetch(`${origin}/api/browser`, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-Easy-Order': '1' } });
  assert.equal(bad.status, 403);
  assert.equal((await fetch(`${origin}/api/browser`, { method: 'POST' })).status, 403);
  assert.equal((await post('command', { text: '' })).status, 400);
});

test('manual screen change invalidates a pending payment', { timeout: 45000 }, async t => {
  const { browser, post, wait } = await setup(t);
  await post('command', { text: '아이스 아메리카노 두 잔 포장' }); assert.equal((await wait()).status, 'done');
  await post('command', { text: '카카오페이 결제' }); assert.equal((await wait()).status, 'confirmation');
  await browser.page.getByRole('button', { name: '돌아가기', exact: true }).click();
  await post('confirm'); const state = await wait();
  assert.equal(state.status, 'error');
  assert.ok(state.history.some(event => event.code === 'STALE'));
  assert.equal((await browser.snapshot()).screen, '번호 적립');
});

test('new window clears confirmation in SSE UI; closing kiosk clears preview and ready state', { timeout: 45000 }, async t => {
  const { chromium } = await import('playwright');
  const { browser, post, wait, origin } = await setup(t);
  const observerBrowser = await chromium.launch({ headless: true });
  t.after(() => observerBrowser.close());
  const control = await observerBrowser.newPage();
  await post('command', { text: '아이스 아메리카노 두 잔 포장' }); assert.equal((await wait()).status, 'done');
  await post('command', { text: '카카오페이 결제' }); assert.equal((await wait()).status, 'confirmation');
  await control.goto(`${origin}/control`);
  await control.getByText('모의 결제 확인', { exact: true }).waitFor();
  await control.getByRole('button', { name: '새 주문 창', exact: true }).click();
  await control.getByText('모의 결제 확인', { exact: true }).waitFor({ state: 'hidden' });
  await control.getByRole('button', { name: '새 주문 창', exact: true }).waitFor();
  assert.equal((await post('confirm')).status, 409);
  await browser.page.close();
  await control.getByText('키오스크 창을 열어주세요.', { exact: true }).waitFor();
  assert.equal(await control.getByAltText('자동화 중인 키오스크 화면').count(), 0);
  const state = await (await fetch(`${origin}/api/status`)).json();
  assert.equal(state.browserReady, false); assert.equal(state.confirmation, null);
});
