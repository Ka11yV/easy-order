import { AgentError } from './jev.js';

// Long-lived credentials never leave Node. The browser receives a single-use STT token.
export class ElevenSpeech {
  constructor({ apiKey = process.env.ELEVENLABS_API_KEY, voiceId = process.env.ELEVENLABS_VOICE_ID,
    model = process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5', fetchImpl = fetch } = {}) {
    this.apiKey = apiKey; this.voiceId = voiceId; this.model = model; this.fetch = fetchImpl;
  }
  get configured() { return Boolean(this.apiKey?.trim() && this.voiceId?.trim()); }
  async call(path, body, signal) {
    if (!this.configured) throw new AgentError('음성 설정이 필요합니다. ElevenLabs API 키와 Voice ID를 설정해 주세요.', 'SPEECH_CONFIG');
    signal?.throwIfAborted();
    try {
      const response = await this.fetch(`https://api.elevenlabs.io/v1/${path}`, {
        method: 'POST', headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new AgentError(({ 401: 'ElevenLabs API 키를 확인해 주세요.', 403: 'ElevenLabs 키 권한과 Voice ID를 확인해 주세요.', 429: '음성 서비스 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' })[response.status] || '음성 서비스에 연결하지 못했습니다.', 'SPEECH_PROVIDER');
      return response;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof AgentError) throw error;
      throw new AgentError('음성 서비스 연결 시간이 초과되었거나 네트워크가 끊겼습니다.', 'SPEECH_NETWORK');
    }
  }
  async token(signal) {
    const response = await this.call('single-use-token/realtime_scribe', null, signal);
    const data = await response.json();
    if (typeof data.token !== 'string' || !data.token) throw new AgentError('음성 인식 연결 정보를 받지 못했습니다.', 'SPEECH_RESPONSE');
    return { token: data.token };
  }
  async synthesize(text, signal) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1500) throw new AgentError('음성 안내 길이가 올바르지 않습니다.', 'SPEECH_INPUT');
    const response = await this.call(`text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`, {
      text, model_id: this.model, language_code: 'ko', voice_settings: { stability: .5, similarity_boost: .75 },
    }, signal);
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length || audio.length > 8 * 1024 * 1024) throw new AgentError('음성 안내를 받지 못했습니다.', 'SPEECH_RESPONSE');
    return { audio: audio.toString('base64'), mime: 'audio/mpeg' };
  }
}
