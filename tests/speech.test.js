import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenSpeech } from '../server/speech.js';

test('speech uses server-only key, one-use STT tokens, Korean ElevenLabs TTS', async () => {
  const requests = [];
  const service = new ElevenSpeech({ apiKey: 'secret-test', voiceId: 'voice-test', fetchImpl: async (url, options) => {
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
  await assert.rejects(new ElevenSpeech({ apiKey: '', voiceId: '' }).token(), { code: 'SPEECH_CONFIG' });
  await assert.rejects(new ElevenSpeech({ apiKey: 'test', voiceId: 'test', fetchImpl: async () => ({ ok: false, status: 401 }) }).token(), { code: 'SPEECH_PROVIDER' });
  const controller = new AbortController(); controller.abort(new Error('stop'));
  await assert.rejects(new ElevenSpeech({ apiKey: 'test', voiceId: 'test', fetchImpl: () => { throw Error('must not call'); } }).token(controller.signal), /stop/);
});
