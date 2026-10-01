import express from 'express';
import { JevClient, AgentError, choice } from './jev.js';
import { KioskBrowser } from './browser.js';
import { OrderRunner } from './runner.js';
import { ElevenSpeech } from './speech.js';

export function createAgentApp({ origin, client = new JevClient(), speech = new ElevenSpeech(), headless = false, browserOptions = {} } = {}) {
  const app = express();
  let active = null, status = 'idle', history = [], lastResult = null;
  const speechRequests = new Set();
  const emit = event => { history.push(event); history = history.slice(-100); };
  const resetSession = () => {
    active?.controller.abort(new AgentError('화면 연결이 종료되었습니다.', 'CLOSED'));
    for (const controller of speechRequests) controller.abort();
    runner.pending = null; runner.clarification = null; lastResult = null;
  };
  const browser = new KioskBrowser({ url: `${origin}/`, headless, ...browserOptions, onClosed: resetSession, onRequest: request });
  const runner = new OrderRunner({ browser, client, emit });
  const state = () => ({ configured: client.configured, speechConfigured: speech.configured, browserReady: browser.ready,
    busy: Boolean(active), status, confirmation: runner.pending, history });
  app.use((req, res, next) => {
    if (req.headers.host !== new URL(origin).host) return res.sendStatus(403);
    res.set('Cache-Control', 'no-store'); next();
  });
  app.get('/api/status', (_req, res) => res.json(state()));
  // The old chat, command endpoints, preview, and browser-launch controls are removed.
  app.all('/api/{*path}', (_req, res) => res.status(404).json({ error: '지원하지 않는 API입니다.' }));
  app.get('/control', (_req, res) => res.redirect('/'));

  async function stop() {
    active?.controller.abort(new AgentError('음성 주문을 종료했습니다.', 'STOPPED'));
    for (const controller of speechRequests) controller.abort();
    await active?.promise.catch(() => {});
    await runner.stop(); lastResult = null; status = 'stopped';
    return { message: '음성 주문을 종료했습니다.' };
  }
  async function utterance(text) {
    if (active) throw new AgentError('주문을 처리하고 있습니다.', 'BUSY');
    if (!client.configured) throw new AgentError('JEV API 키를 설정해 주세요.', 'NOT_CONFIGURED');
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new AgentError('주문을 짧게 다시 말씀해 주세요.', 'INPUT');
    const controller = new AbortController();
    const job = { controller }; active = job; status = 'running'; lastResult = null;
    emit({ type: 'utterance', message: text });
    const timer = setTimeout(() => controller.abort(new AgentError('주문 처리 시간이 초과되었습니다.', 'TIMEOUT')), 180000);
    job.promise = (async () => {
      const signal = controller.signal;
      if (runner.pending) {
        const { answers } = await client.decide({ userRequest: text, confirmation: runner.pending }, {
          confirmation: choice('Does this utterance explicitly confirm the pending simulated payment? Choose change for a new order/edit request, cancel for refusal, unclear for uncertainty. Never infer consent from silence.', {
            confirm: '네 / 결제 진행해 주세요 / 명시적 동의', cancel: '아니요 / 취소 / 결제하지 마세요', change: '메뉴 또는 주문 변경 요청', unclear: '동의 여부 불명확',
          }),
        }, signal);
        if (answers.confirmation === 'confirm') return runner.confirm(signal);
        if (answers.confirmation === 'cancel') { await runner.stop(); return { message: '결제를 취소했습니다. 주문 내역은 그대로입니다.' }; }
        if (answers.confirmation === 'unclear') throw new AgentError('결제를 진행할까요? 네 또는 아니요로 말씀해 주세요.', 'CLARIFY');
      }
      return runner.run(text.trim(), signal);
    })();
    try {
      const result = await job.promise; controller.signal.throwIfAborted();
      status = result.confirmation ? 'confirmation' : 'done'; lastResult = result.message;
      emit({ type: 'result', ...result }); return result;
    } catch (error) {
      if (controller.signal.aborted) { await runner.stop().catch(() => {}); status = 'stopped'; throw controller.signal.reason; }
      status = ['CLARIFY', 'UNCERTAIN'].includes(error.code) ? 'clarification' : 'error';
      lastResult = error instanceof AgentError ? error.message : '주문을 처리하지 못했습니다. 다시 말씀해 주세요.';
      emit({ type: 'error', message: lastResult, code: error.code }); throw error;
    } finally { clearTimeout(timer); if (active === job) active = null; }
  }
  // Exposed only to the very same Playwright page that shows the kiosk, never to another tab.
  async function request(operation, payload) {
    try {
      if (operation === 'config') return { configured: client.configured, speechConfigured: speech.configured, stt: 'scribe_v2_realtime' };
      if (operation === 'stop') return await stop();
      if (operation === 'utterance') return await utterance(payload?.text);
      if (operation === 'token' || operation === 'speak') {
        if (operation === 'speak' && payload?.text !== lastResult) throw new AgentError('재생할 안내가 없습니다.', 'SPEECH_INPUT');
        const controller = new AbortController(); speechRequests.add(controller);
        try { return operation === 'token' ? await speech.token(controller.signal) : await speech.synthesize(lastResult, controller.signal); }
        finally { speechRequests.delete(controller); }
      }
      throw new AgentError('지원하지 않는 음성 작업입니다.', 'INPUT');
    } catch (error) {
      return { error: error instanceof AgentError ? error.message : '음성 주문 연결을 확인해 주세요.', code: error.code || 'INTERNAL' };
    }
  }
  return { app, browser, runner, state, start: () => browser.start(), close: async () => { await stop(); await browser.close(); } };
}
