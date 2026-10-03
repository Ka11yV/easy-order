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
    if (questions.points) return { answers: { points: state.userRequest.includes('아니') || state.userRequest.includes('건너') ? 'no' : 'yes' }, confidences: { points: 1 } };
    if (questions.confirmation) return { answers: { confirmation: state.userRequest.includes('아니') ? 'cancel' : state.userRequest.includes('글쎄') ? 'unclear' : 'confirm' }, confidences: { confirmation: 1 } };
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

function silentWav() {
  const data = Buffer.alloc(44 + 1600); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(1600, 40);
  return data.toString('base64');
}
async function setup(t, { speechConfigured = true, ttsFails = false } = {}) {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new FixtureJev();
  const spoken = [];
  const speech = { configured: speechConfigured, token: async () => ({ token: 'test-single-use-token' }),
    synthesize: async text => { if (ttsFails && !text.includes('드시고 가시나요')) throw new Error('fixture provider failure'); spoken.push(text); return { audio: silentWav(), mime: 'audio/wav' }; } };
  const service = createAgentApp({ origin, client, speech, headless: true, browserOptions: { launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  } } });
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  service.app.use(express.static(dist)); service.app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
  server.on('request', service.app);
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await service.start();
  const page = service.browser.page;
  const call = (operation, payload) => page.evaluate(([operation, payload]) => window.kioskVoice(operation, payload), [operation, payload]);
  const sockets = []; const chunks = [];
  await page.routeWebSocket('wss://api.elevenlabs.io/**', ws => {
    sockets.push(ws);
    ws.onMessage(message => { const data = JSON.parse(message); if (data.message_type === 'input_audio_chunk') chunks.push(data); });
    ws.send(JSON.stringify({ message_type: 'session_started', session_id: `test-${sockets.length}` }));
  });
  await page.addInitScript(() => {
    window.__testMediaTracks = [];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__testMediaTracks.push(...stream.getTracks()); return stream; };
  });
  await page.reload();
  const say = async text => {
    await page.locator('.voice-dock[data-phase="listening"]').waitFor();
    // Real SDK/microphone/WebSocket path; only the external recognition response is a fixture.
    const previous = sockets.length;
    sockets.at(-1).send(JSON.stringify({ message_type: 'committed_transcript', text }));
    await page.locator('.voice-dock[data-phase="ordering"]').waitFor();
    assert.ok(await page.evaluate(() => window.__testMediaTracks.every(track => track.readyState === 'ended')), 'microphone must stop before ordering/TTS');
    await page.waitForFunction(() => ['listening', 'idle', 'error'].includes(document.querySelector('.voice-dock')?.dataset.phase), null, { timeout: 40000 });
    return { previous, phase: await page.locator('.voice-dock').getAttribute('data-phase') };
  };
  return { ...service, origin, page, call, client, say, spoken, sockets, chunks };
}

test('one kiosk: microphone → STT → JEV clicks → TTS → spoken payment confirmation', { timeout: 90000 }, async t => {
  const { browser, page, say, spoken, sockets, chunks, state } = await setup(t);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { mkdir } = await import('node:fs/promises'); await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/voice-start.png' });
  assert.equal(await page.getByRole('textbox').count(), 0);
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  await page.locator('.voice-dock[data-phase="listening"]').waitFor({ timeout: 10000 }).catch(async error => { console.log(await page.locator('.voice-dock').innerText(), 'sockets', sockets.length); throw error; });
  await delay(500); // Let the fake microphone send audio through the real SDK.
  assert.equal((await say('아이스 아메리카노 두 잔 포장')).phase, 'listening', JSON.stringify(state()));
  assert.equal((await browser.snapshot()).cart[0].quantity, 2);
  await page.screenshot({ path: 'artifacts/voice-menu.png' });
  assert.equal((await say('아메리카노 하나로 수정')).phase, 'listening');
  assert.equal((await browser.snapshot()).cart[0].quantity, 1);
  assert.equal((await say('카카오페이 결제')).phase, 'listening');
  assert.equal((await browser.snapshot()).screen, '번호 적립');
  assert.equal((await say('아니요')).phase, 'listening');
  assert.equal((await browser.snapshot()).screen, '결제수단 선택');
  assert.equal(await page.locator('dialog[open] .voice-dock').count(), 1);
  assert.equal(state().confirmation.total, 2000);
  assert.equal((await say('네 진행해 주세요')).phase, 'idle');
  assert.equal((await browser.snapshot()).orderNumber, '101');
  assert.equal(browser.context.pages().length, 1);
  assert.ok(await page.evaluate(() => window.__testMediaTracks.every(track => track.readyState === 'ended')));
  assert.equal(spoken.length, 6); assert.equal(sockets.length, 5);
  assert.equal(spoken[0], '드시고 가시나요? 아니면 포장하시나요?');
  assert.ok(spoken.some(text => text.includes('두 잔'))); assert.ok(chunks.length > 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'artifacts/voice-complete.png' });
});

test('stop cancels decisions; no text API; another page cannot control the kiosk', { timeout: 30000 }, async t => {
  const { browser, client, call, origin } = await setup(t);
  client.blockNext = true;
  const pending = call('utterance', { text: '아이스 아메리카노 두 잔 포장' });
  await delay(150);
  assert.equal((await call('utterance', { text: '중복' })).code, 'BUSY');
  await call('stop'); assert.equal((await pending).code, 'STOPPED');
  assert.equal((await browser.snapshot()).cart.length, 0);
  for (const route of ['command', 'browser', 'confirm', 'frame', 'events']) assert.equal((await fetch(`${origin}/api/${route}`, { method: 'POST' })).status, 404);
  const other = await browser.context.newPage(); await other.goto(origin);
  assert.equal((await other.evaluate(() => window.kioskVoice('utterance', { text: '포장' }))).code, 'WRONG_PAGE');
  await other.close();
});

test('voice confirmation supports refusal and ambiguity, rejects changed payment screen', { timeout: 60000 }, async t => {
  const { browser, call, state } = await setup(t);
  await call('utterance', { text: '아이스 아메리카노 두 잔 포장' });
  await call('utterance', { text: '카카오페이 결제' });
  await call('utterance', { text: '건너뛰기' });
  assert.equal((await call('utterance', { text: '글쎄요' })).code, 'CLARIFY');
  assert.ok(state().confirmation);
  await call('utterance', { text: '아니요' }); assert.equal(state().confirmation, null);
  await call('utterance', { text: '카카오페이 결제' });
  await call('utterance', { text: '건너뛰기' });
  await browser.page.getByRole('button', { name: '돌아가기', exact: true }).click();
  assert.equal((await call('utterance', { text: '네' })).code, 'STALE');
  assert.equal((await browser.snapshot()).screen, '번호 적립');
});

test('missing speech settings show a recoverable error without opening another window', async t => {
  const { page, browser } = await setup(t, { speechConfigured: false });
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  await page.getByText('ElevenLabs API 키와 Voice ID 설정이 필요합니다.').waitFor();
  assert.equal(await page.locator('.voice-dock').getAttribute('data-phase'), 'error');
  assert.equal(browser.context.pages().length, 1);
  assert.equal(await page.getByRole('button', { name: '매장', exact: true }).isEnabled(), true);
});

test('microphone denial and STT errors stop listening without executing an order', async t => {
  const { page, browser, sockets } = await setup(t);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  await page.locator('.voice-dock[data-phase="error"]').waitFor();
  assert.equal((await browser.snapshot()).cart.length, 0);
  await page.reload();
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  await page.locator('.voice-dock[data-phase="listening"]').waitFor();
  sockets.at(-1).send(JSON.stringify({ message_type: 'quota_exceeded', error: 'fixture quota' }));
  await page.locator('.voice-dock[data-phase="error"]').waitFor();
  assert.equal((await browser.snapshot()).cart.length, 0);
});

test('voice stop remains clickable inside a modal and ends microphone capture', { timeout: 45000 }, async t => {
  const { page, say, state } = await setup(t);
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  await say('아이스 아메리카노 두 잔 포장');
  await say('카카오페이 결제');
  await say('아니요');
  await page.locator('dialog[open]').getByRole('button', { name: '음성 주문 종료' }).click();
  await page.locator('.voice-dock[data-phase="idle"]').waitFor();
  assert.equal(state().confirmation, null);
  assert.ok(await page.evaluate(() => window.__testMediaTracks.every(track => track.readyState === 'ended')));
  assert.equal(await page.locator('.order-number').count(), 0);
});

test('stop during pending microphone permission releases a late microphone stream', async t => {
  const { page, state } = await setup(t);
  await page.evaluate(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = options => new Promise(resolve => {
      window.__grantMicrophone = async () => resolve(await get(options));
    });
  });
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  await page.waitForFunction(() => Boolean(window.__grantMicrophone));
  await page.getByRole('button', { name: '음성 주문 종료' }).click();
  await page.locator('.voice-dock[data-phase="idle"]').waitFor();
  await page.evaluate(() => window.__grantMicrophone());
  await page.waitForFunction(() => window.__testMediaTracks.length > 0 && window.__testMediaTracks.every(track => track.readyState === 'ended'));
  assert.equal(state().history.filter(event => event.type === 'utterance').length, 0);
});

test('TTS failure preserves the completed cart and leaves the microphone off', { timeout: 30000 }, async t => {
  const { page, say, browser } = await setup(t, { ttsFails: true });
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  assert.equal((await say('아이스 아메리카노 두 잔 포장')).phase, 'error');
  assert.equal((await browser.snapshot()).cart[0].quantity, 2);
  assert.ok(await page.evaluate(() => window.__testMediaTracks.every(track => track.readyState === 'ended')));
});

test('menu scrolls to offscreen cards and resets scroll when switching categories', async t => {
  const { page } = await setup(t);
  await page.getByRole('button', { name: '포장', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '다음 메뉴 페이지' }).count(), 0);
  const grid = page.locator('.product-grid');
  assert.ok(await grid.evaluate(el => el.scrollHeight > el.clientHeight));
  const last = grid.locator('.product').last();
  const name = await last.locator('h2').innerText();
  await last.scrollIntoViewIfNeeded();
  assert.ok(await grid.evaluate(el => el.scrollTop > 0));
  await last.click();
  await page.getByRole('dialog', { name: `${name} 옵션 선택`, exact: true }).waitFor();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '커피', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.product-grid').scrollTop === 0);
});

test('points opt-in collects and confirms a phone number before payment, with no number in history', { timeout: 30000 }, async t => {
  const { call, browser, state } = await setup(t);
  await call('utterance', { text: '아이스 아메리카노 두 잔 포장' });
  const checkout = await call('utterance', { text: '카카오페이 결제' });
  assert.equal(checkout.message, '번호 적립하시겠어요?');
  assert.equal((await browser.snapshot()).screen, '번호 적립');
  assert.equal(state().confirmation, null);
  assert.match((await call('utterance', { text: '네' })).message, /휴대폰 번호/);
  await call('utterance', { text: '010123' });
  assert.equal((await browser.snapshot()).screen, '번호 적립');
  const number = '01012345678';
  const entered = await call('utterance', { text: number });
  assert.match(entered.message, /이 번호로 적립/);
  assert.equal(await browser.page.getByRole('textbox', { name: '휴대폰 번호' }).inputValue(), number);
  assert.equal(state().confirmation, null);
  const corrected = '01087654321';
  assert.match((await call('utterance', { text: corrected })).message, /이 번호로 적립/);
  assert.equal(await browser.page.getByRole('textbox', { name: '휴대폰 번호' }).inputValue(), corrected);
  const approved = await call('utterance', { text: '네' });
  assert.equal(approved.confirmation.method, '카카오페이');
  assert.ok(state().history.some(event => event.target === '적립하고 결제하기'));
  assert.ok(!JSON.stringify(state()).includes(number));
  assert.ok(!JSON.stringify(state()).includes(corrected));
  assert.equal(await browser.page.locator('.order-number').count(), 0);
});
