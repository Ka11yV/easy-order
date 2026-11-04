import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenSpeech } from '../server/speech.js';

test('speech uses server-only key, one-use STT tokens, Korean ElevenLabs TTS', async () => {
  const requests = [];
  const service = new ElevenSpeech({ cacheDir: null, apiKey: 'secret-test', voiceId: 'voice-test', fetchImpl: async (url, options) => {
    requests.push({ url, options }); return { ok: true, json: async () => ({ token: 'one-use' }), arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  } });
  assert.deepEqual(await service.token(), { token: 'one-use' });
  const audio = await service.synthesize('주문이 완료되었습니다.');
  assert.equal(audio.mime, 'audio/mpeg');
  assert.equal(requests[0].url, 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
  assert.equal(requests[1].options.headers['xi-api-key'], 'secret-test');
  assert.equal(JSON.parse(requests[1].options.body).language_code, 'ko');
  assert.equal(JSON.parse(requests[1].options.body).model_id, 'eleven_flash_v2_5');
  assert.ok(!JSON.stringify(audio).includes('secret-test'));
});

test('missing credentials, provider failure and abort never produce fake speech', async () => {
  await assert.rejects(new ElevenSpeech({ cacheDir: null, apiKey: '', voiceId: '' }).token(), { code: 'SPEECH_CONFIG' });
  await assert.rejects(new ElevenSpeech({ cacheDir: null, apiKey: 'test', voiceId: 'test', fetchImpl: async () => ({ ok: false, status: 401 }) }).token(), { code: 'SPEECH_PROVIDER' });
  const controller = new AbortController(); controller.abort(new Error('stop'));
  await assert.rejects(new ElevenSpeech({ cacheDir: null, apiKey: 'test', voiceId: 'test', fetchImpl: () => { throw Error('must not call'); } }).token(controller.signal), /stop/);
});

test('provider plan and key-ID errors explain the actual cause without exposing raw details', async () => {
  for (const [detail, expected] of [
    [{ code: 'paid_plan_required', message: 'secret-provider-data' }, 'SPEECH_VOICE_PLAN'],
    [{ status: 'api_key_id_used_as_api_key', code: 'invalid_api_key' }, 'SPEECH_KEY_ID'],
    [{ status: 'quota_exceeded' }, 'SPEECH_QUOTA'],
  ]) {
    const speech = new ElevenSpeech({ cacheDir: null, apiKey: 'test', voiceId: 'test', fetchImpl: async () => ({ ok: false, status: 402, json: async () => ({ detail }) }) });
    await assert.rejects(speech.synthesize('주문 확인'), error => error.code === expected && !error.message.includes('secret-provider-data'));
  }
});

test('non-JSON provider failures retain stage and HTTP status', async () => {
  const speech = new ElevenSpeech({ cacheDir: null, apiKey: 'test', voiceId: 'test', fetchImpl: async () => ({ ok: false, status: 503, json: async () => { throw Error('HTML'); } }) });
  await assert.rejects(speech.synthesize('주문 확인'), /음성 안내\(TTS\).*503/);
});

test('TTS cache survives new instances, normalizes counters and separates voices', async t => {
  const { mkdtemp, rm, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cacheDir = await mkdtemp(join(tmpdir(), 'easy-order-tts-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const settings = { apiKey: 'test', voiceId: 'voice-a', cacheDir, fetchImpl: async (_url, options) => {
    calls++; assert.equal(JSON.parse(options.body).text, '두 잔입니다.');
    return { ok: true, arrayBuffer: async () => Uint8Array.from([1,2,3]).buffer };
  } };
  assert.equal((await new ElevenSpeech(settings).synthesize('2잔입니다.')).cached, false);
  assert.equal((await new ElevenSpeech(settings).synthesize('두 잔입니다.')).cached, true);
  assert.equal(calls, 1);
  assert.equal((await new ElevenSpeech({ ...settings, voiceId: 'voice-b' }).synthesize('2잔입니다.')).cached, false);
  assert.equal(calls, 2);
  assert.equal((await readdir(cacheDir)).length, 2);
  const controller = new AbortController(); controller.abort(new Error('stop'));
  await assert.rejects(new ElevenSpeech(settings).synthesize('두 잔입니다.', controller.signal), /stop/);
  assert.equal(calls, 2);
});

test('TTS cache evicts least-recently-used audio, keeping frequently replayed prompts', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { TtsCache } = await import('../server/tts-cache.js');
  const directory = await mkdtemp(join(tmpdir(), 'tts-lru-'));
  try {
    const cache = new TtsCache(directory, { maxEntries: 2 });
    const key = n => String(n).repeat(64);
    await cache.put(key(1), Buffer.from('greeting'));
    await new Promise(resolve => setTimeout(resolve, 20));
    await cache.put(key(2), Buffer.from('other'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(await cache.get(key(1)), 'reading refreshes recency');
    await new Promise(resolve => setTimeout(resolve, 20));
    await cache.put(key(3), Buffer.from('new'));
    assert.ok(await cache.get(key(1)));
    assert.equal(await cache.get(key(2)), null);
    assert.ok(await cache.get(key(3)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('slow speech lowers the TTS speed and is cached separately from normal speech', async () => {
  const bodies = [];
  const service = new ElevenSpeech({ cacheDir: null, apiKey: 'k', voiceId: 'v', fetchImpl: async (_url, options) => {
    bodies.push(JSON.parse(options.body)); return { ok: true, arrayBuffer: async () => Uint8Array.from([1]).buffer };
  } });
  await service.synthesize('천천히 안내합니다.', undefined, { slow: true });
  await service.synthesize('천천히 안내합니다.');
  assert.equal(bodies[0].voice_settings.speed, .8);
  assert.equal(bodies[1].voice_settings.speed, undefined, 'normal speech keeps existing cache keys');
});
