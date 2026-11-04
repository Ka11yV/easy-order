// Scenario evaluation against the real JEV API (spends TypeSafe credits).
//   node scripts/eval-live.js [--repeat 3] [--only single,shot] [--target 0.9] [--list]
// Recognized text is injected into the same-page binding, so this measures JEV + Playwright,
// not microphone/STT/TTS quality. Run `pnpm build` first. JEV_VERIFY_STEPS is honored.
import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { scenarios, scoreRun, summarize } from './eval-scenarios.js';

const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : fallback; };
const repeat = Number(arg('repeat', 3));
const target = Number(arg('target', .9));
const only = arg('only')?.split(',');
const selected = scenarios.filter(scenario => !only || only.includes(scenario.id));
if (process.argv.includes('--list')) {
  for (const scenario of selected) console.log(`${scenario.id.padEnd(26)} ${scenario.kind.padEnd(7)} ${scenario.turns.join(' → ')}`);
  process.exit(0);
}
if (!selected.length || !Number.isInteger(repeat) || repeat < 1) throw new Error('Check --only and --repeat');
if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('Set TYPESAFE_API_KEY in .env first');

const { createAgentApp } = await import('../server/app.js');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const service = createAgentApp({ origin, headless: true });
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
service.app.use(express.static(dist));
service.app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
server.on('request', service.app);

const runs = [];
try {
  await service.start();
  const page = service.browser.page;
  for (let round = 1; round <= repeat; round++) {
    for (const scenario of selected) {
      // A reload resets the kiosk UI and, via the page lifecycle, the runner's conversation state.
      await page.reload(); await page.locator('.start-screen').waitFor();
      const turns = [];
      for (const text of scenario.turns) {
        const result = await page.evaluate(text => window.kioskVoice('utterance', { text }), text);
        const event = service.state().history.at(-1);
        turns.push({ code: result.error ? result.code : undefined, durationMs: event?.durationMs, decisions: event?.decisions });
      }
      const snapshot = await service.browser.snapshot();
      const observed = { cart: snapshot.cart, mode: snapshot.mode, confirmation: service.state().confirmation?.method, turns };
      const score = scoreRun(scenario, observed);
      runs.push({ id: scenario.id, kind: scenario.kind, round, ...score, turns });
      console.log(`${score.pass ? 'PASS' : 'FAIL'} ${round}/${repeat} ${scenario.id}${score.reason ? ` (${score.reason})` : ''} ${turns.map(turn => `${turn.durationMs}ms`).join(' ')}`);
    }
  }
} finally {
  await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

const summary = summarize(runs);
const report = { at: new Date().toISOString(), model: process.env.JEV_MODEL || 'jev-latest', verifySteps: process.env.JEV_VERIFY_STEPS !== 'false', repeat, summary, runs };
await mkdir('artifacts', { recursive: true });
const file = `artifacts/eval-${report.at.replace(/[:.]/g, '-')}.json`;
await writeFile(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`Report: ${file}`);
if (summary.orderSuccessRate !== null && summary.orderSuccessRate < target) {
  console.error(`Order success rate ${summary.orderSuccessRate} is below target ${target}`);
  process.exitCode = 1;
}
