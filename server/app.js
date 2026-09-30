import express from 'express';
import { randomUUID } from 'node:crypto';
import { JevClient, AgentError } from './jev.js';
import { KioskBrowser } from './browser.js';
import { OrderRunner } from './runner.js';

export function createAgentApp({ origin, client = new JevClient(), headless = false } = {}) {
  const app = express();
  const streams = new Set();
  let frame = null, sequence = 0, active = null, opening = false, stopping = false;
  let status = 'idle', history = [], confirmation = null;
  const allowed = new Set([new URL(origin).host, `localhost:${new URL(origin).port}`, `127.0.0.1:${new URL(origin).port}`]);
  const publish = event => {
    const data = { ...event, id: ++sequence, time: Date.now() };
    if (event.type !== 'frame') { history.push(data); history = history.slice(-100); }
    for (const stream of streams) stream.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const browser = new KioskBrowser({ url: `${origin}/`, headless, onClosed: () => {
    active?.controller.abort(new AgentError('키오스크 창이 닫혔습니다.', 'CLOSED'));
    confirmation = null; runner.pending = null; runner.clarification = null; frame = null;
    status = 'idle'; publish({ type: 'frame', version: null });
    publish({ type: 'status', status, busy: Boolean(active), browserReady: false, confirmation: null });
  }, onFrame: image => { frame = image; publish({ type: 'frame', version: sequence + 1 }); } });
  const runner = new OrderRunner({ browser, client, emit: publish });
  app.use((req, res, next) => {
    if (!allowed.has(req.headers.host)) return res.status(403).json({ error: '로컬 주소에서만 사용할 수 있습니다.' });
    if (req.path.startsWith('/api/')) {
      res.set('Cache-Control', 'no-store');
      if (req.headers.origin && !allowed.has(new URL(req.headers.origin).host)) return res.status(403).json({ error: '허용되지 않은 출처입니다.' });
      if (req.method === 'POST' && req.headers['x-easy-order'] !== '1') return res.status(403).json({ error: '제어 화면에서 요청해 주세요.' });
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  const state = () => ({ configured: client.configured, browserReady: browser.ready, busy: Boolean(active) || opening || stopping, status, confirmation, history, frameVersion: frame ? sequence : null });
  app.get('/api/status', (_req, res) => res.json(state()));
  app.get('/api/frame', (_req, res) => frame ? res.type('jpg').send(frame) : res.sendStatus(204));
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'state', ...state() })}\n\n`);
    streams.add(res);
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
  });
  app.post('/api/browser', async (_req, res, next) => {
    if (active || opening || stopping) return res.status(409).json({ error: '현재 작업이 끝난 뒤 새 창을 열어주세요.' });
    opening = true; status = 'opening'; confirmation = null; runner.pending = null; runner.clarification = null; frame = null;
    publish({ type: 'frame', version: null });
    publish({ type: 'status', status, busy: true, confirmation: null, browserReady: false });
    try {
      await browser.start(); status = 'idle';
      publish({ type: 'status', status, busy: false, browserReady: true });
      res.json({ ok: true });
    } catch (error) { next(error); }
    finally { opening = false; status = browser.ready ? 'idle' : 'error'; publish({ type: 'status', status, busy: false, browserReady: browser.ready, confirmation: null }); }
  });
  function launch(res, task) {
    const controller = new AbortController();
    const runId = randomUUID();
    active = { controller, runId }; confirmation = null; status = 'running';
    publish({ type: 'status', status, busy: true, runId, confirmation: null });
    res.status(202).json({ runId });
    const timer = setTimeout(() => controller.abort(new AgentError('작업 시간이 초과되었습니다.', 'TIMEOUT')), 180000);
    (async () => {
      try {
        const result = await task(controller.signal);
        controller.signal.throwIfAborted();
        confirmation = result.confirmation || null;
        status = confirmation ? 'confirmation' : 'done';
        publish({ type: 'result', ...result });
      } catch (error) {
        if (controller.signal.aborted) {
          await runner.stop().catch(() => {}); status = 'stopped';
          publish({ type: 'result', message: '작업을 중단했습니다. 이미 반영된 주문은 화면에서 확인해 주세요.' });
        } else {
          status = ['CLARIFY', 'UNCERTAIN'].includes(error.code) ? 'clarification' : 'error';
          publish({ type: 'error', message: error instanceof AgentError ? error.message : '화면 조작에 실패했습니다. 현재 화면을 확인한 뒤 다시 요청해 주세요.', code: error.code || 'BROWSER' });
        }
      } finally {
        clearTimeout(timer);
        await browser.frame().catch(() => {});
        active = null;
        publish({ type: 'status', status, busy: false, confirmation, browserReady: browser.ready });
      }
    })();
  }
  function ready(req, res, next) {
    if (active || opening || stopping) return res.status(409).json({ error: '다른 요청을 처리 중입니다. 중단하거나 완료 후 입력해 주세요.' });
    if (!client.configured) return res.status(503).json({ error: '.env에 TYPESAFE_API_KEY를 설정하고 서버를 다시 시작해 주세요.' });
    if (!browser.ready) return res.status(409).json({ error: '키오스크 창을 먼저 열어주세요.' });
    next();
  }
  app.post('/api/command', ready, (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) return res.status(400).json({ error: '1~1,000자의 주문을 입력해 주세요.' });
    publish({ type: 'command', message: text.trim() });
    launch(res, signal => runner.run(text.trim(), signal));
  });
  app.post('/api/confirm', ready, (_req, res) => {
    if (!runner.pending) return res.status(409).json({ error: '확인할 결제가 없습니다.' });
    launch(res, signal => runner.confirm(signal));
  });
  app.post('/api/stop', async (_req, res, next) => {
    if (stopping || opening) return res.status(409).json({ error: '현재 중단 또는 창 열기를 처리 중입니다.' });
    stopping = true;
    try {
      active?.controller.abort(new AgentError('사용자가 중단했습니다.', 'STOPPED'));
      confirmation = null;
      await runner.stop();
      status = active ? 'stopping' : 'stopped';
      publish({ type: 'status', status, busy: Boolean(active), confirmation: null });
      res.json({ ok: true });
    } catch (error) { next(error); }
    finally { stopping = false; }
  });
  app.post('/api/refresh', async (_req, res, next) => {
    try { if (active || opening || stopping) return res.status(409).json({ error: '작업 중입니다.' }); await browser.frame(); res.json({ ok: true }); } catch (error) { next(error); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '없는 API입니다.' }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error instanceof AgentError ? error.message : '서버 처리에 실패했습니다. 브라우저 설치와 실행 환경을 확인해 주세요.' }));
  return { app, browser, runner, close: async () => { active?.controller.abort(); for (const stream of streams) stream.end(); await browser.close(); } };
}
