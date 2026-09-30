// Explicit opt-in: this script spends TypeSafe API credits and uses an isolated mock kiosk.
import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
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
const post = async (route, body = {}) => {
  const response = await fetch(`${origin}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Easy-Order': '1' }, body: JSON.stringify(body) });
  if (!response.ok) throw Error(JSON.stringify(await response.json()));
};
const wait = async () => {
  for (let i = 0; i < 200; i++) {
    const state = await (await fetch(`${origin}/api/status`)).json();
    if (!state.busy) {
      if (!['done', 'confirmation'].includes(state.status)) {
        console.log(JSON.stringify(state.history.slice(-5), null, 2));
        throw Error(`Live run stopped: ${state.status}`);
      }
      return state;
    }
    await delay(1000);
  }
  throw Error('Live run timed out');
};
try {
  await post('browser');
  const commands = process.argv.includes('--extended')
    ? ['따뜻한 카페라떼 한 잔과 아이스 아메리카노 두 잔 포장해 줘', '아이스 아메리카노를 한 잔으로 바꿔줘', '따뜻한 카페라떼를 삭제해 줘', '네이버페이로 결제해 줘']
    : ['아이스 아메리카노 두 잔 포장해 줘', '아메리카노 한 잔으로 바꿔줘', '카카오페이로 결제해 줘'];
  for (const text of commands) {
    await post('command', { text });
    const result = await wait();
    console.log(`${result.status}: ${text}`);
  }
  await post('confirm'); await wait();
  const snapshot = await service.browser.snapshot();
  if (!snapshot.orderNumber) throw Error('No order number');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/live-order.json', JSON.stringify({ commands, screen: snapshot.screen, cart: snapshot.cart, receipt: snapshot.receipt, orderNumber: snapshot.orderNumber }, null, 2));
  await service.browser.page.screenshot({ path: 'artifacts/live-order.png' });
  console.log(`Live JEV verified: order ${snapshot.orderNumber}, ${snapshot.receipt}`);
} finally {
  await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
