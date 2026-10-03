import 'dotenv/config';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAgentApp } from './app.js';

const port = Number(process.env.PORT || 8787);
const origin = `http://127.0.0.1:${port}`;
const service = createAgentApp({ origin, headless: process.env.BROWSER_HEADLESS === 'true' });
const http = createServer(service.app);
let vite;
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, hmr: { server: http } }, appType: 'spa' });
  service.app.use(vite.middlewares);
} else {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  service.app.use(express.static(dist));
  service.app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
}
http.listen(port, '127.0.0.1', async () => {
  console.log(`음성 키오스크: ${origin}/`);
  try { await service.start(); } catch (error) { console.error('키오스크 실행 실패:', error.message); await service.close(); await vite?.close(); http.close(); process.exitCode = 1; }
});
http.on('error', error => { console.error(`서버를 열 수 없습니다: ${error.code}`); process.exitCode = 1; });
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, async () => {
  // The browser may already be closing when the server receives its shutdown signal.
  await service.close().catch(() => {}); await vite?.close(); http.close(); process.exit(0);
});
