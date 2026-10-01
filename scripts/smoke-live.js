// Explicit opt-in: this script spends TypeSafe API credits and uses an isolated mock kiosk.
import 'dotenv/config';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createAgentApp } from '../server/app.js';
if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('Set TYPESAFE_API_KEY in .env first');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const service = createAgentApp({ origin, headless: true });
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
service.app.use(express.static(dist));
service.app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
server.on('request', service.app);
// Internal QA only: recognized speech is injected into the same-page binding.
// This checks real JEV + Playwright, not microphone/STT/TTS quality.
const utterance = text => service.browser.page.evaluate(text => window.kioskVoice('utterance', { text }), text);
try {
  await service.start();
  const options = process.argv.includes('--options');
  const commands = options ? ['아메리카노 한 잔 포장해 줘', '아이스로 해줘', '따뜻한 아메리카노 한 잔 샷 추가해서 담아줘', '따뜻한 아메리카노 샷 빼줘', '따뜻한 아메리카노 삭제해줘', '카드로 결제해줘'] : process.argv.includes('--extended')
    ? ['따뜻한 카페라떼 한 잔과 아이스 아메리카노 두 잔 포장해 줘', '아이스 아메리카노를 한 잔으로 바꿔줘', '따뜻한 카페라떼를 삭제해 줘', '네이버페이로 결제해 줘']
    : ['아이스 아메리카노 두 잔 포장해 줘', '아메리카노 한 잔으로 바꿔줘', '카카오페이로 결제해 줘'];
  const americano = quantity => ({ name: '아메리카노', temperature: 'ICE', shot: false, quantity, price: 2000 });
  const latte = { name: '카페라떼', temperature: 'HOT', shot: false, quantity: 1, price: 3000 };
  const hot = shot => ({ name: '아메리카노', temperature: 'HOT', quantity: 1, shot, price: shot ? 2500 : 2000 });
  const expected = options ? [[], [americano(1)], [americano(1), hot(true)], [americano(1), hot(false)], [americano(1)], [americano(1)]] : process.argv.includes('--extended')
    ? [[latte, americano(2)], [latte, americano(1)], [americano(1)], [americano(1)]]
    : [[americano(2)], [americano(1)], [americano(1)]];
  for (const [index, text] of commands.entries()) {
    const result = await utterance(text);
    if (result.error && !(options && index === 0 && result.code === 'CLARIFY')) throw Error(result.error);
    assert.deepEqual((await service.browser.snapshot()).cart, expected[index], `Wrong cart after: ${text}`);
    console.log(`${service.state().status}: ${text} (장바구니 일치)`);
  }
  const confirmed = await utterance('네, 결제 진행해 주세요');
  if (confirmed.error) throw Error(confirmed.error);
  const snapshot = await service.browser.snapshot();
  if (!snapshot.orderNumber) throw Error('No order number');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/live-order.json', JSON.stringify({ commands, screen: snapshot.screen, cart: snapshot.cart, receipt: snapshot.receipt, orderNumber: snapshot.orderNumber }, null, 2));
  await service.browser.page.screenshot({ path: 'artifacts/live-order.png' });
  console.log(`Live JEV verified: order ${snapshot.orderNumber}, ${snapshot.receipt}`);
} finally {
  await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
