import { fileURLToPath } from 'node:url';
import { TtsCache, audioCacheKey } from './tts-cache.js';
import { speechText } from './korean.js';
import { AgentError } from './jev.js';

// Long-lived credentials never leave Node. The browser receives a single-use STT token.
export class ElevenSpeech {
  constructor({ apiKey = process.env.ELEVENLABS_API_KEY, voiceId = process.env.ELEVENLABS_VOICE_ID,
    model = process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5', fetchImpl = fetch, cacheDir = fileURLToPath(new URL('../.cache/tts/', import.meta.url)) } = {}) {
    this.apiKey = apiKey; this.voiceId = voiceId; this.model = model; this.fetch = fetchImpl; this.cache = new TtsCache(cacheDir);
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
      if (!response.ok) {
        // Map known provider codes only; never surface raw responses containing credentials or account data.
        const data = await response.json?.().catch(() => ({})) || {};
        const codes = [data.detail?.code, data.detail?.status];
        if (codes.includes('paid_plan_required')) throw new AgentError('선택한 ElevenLabs 음성은 현재 무료 계정에서 API로 사용할 수 없습니다. 사용 가능한 기본 음성으로 바꾸거나 플랜을 확인해 주세요.', 'SPEECH_VOICE_PLAN');
        if (codes.includes('api_key_id_used_as_api_key')) throw new AgentError('ElevenLabs 키 ID가 입력되어 있습니다. 키 생성 시 표시된 실제 비밀 키로 교체해 주세요.', 'SPEECH_KEY_ID');
        if (codes.includes('quota_exceeded')) throw new AgentError('ElevenLabs 음성 사용량을 모두 소진했습니다. 잔여 크레딧을 확인해 주세요.', 'SPEECH_QUOTA');
        const stage = path.startsWith('text-to-speech/') ? '음성 안내(TTS)' : '음성 인식(STT)';
        const message = ({ 401: 'ElevenLabs API 키를 확인해 주세요.', 402: 'ElevenLabs 플랜과 잔여 크레딧을 확인해 주세요.', 403: 'ElevenLabs 키 권한과 Voice ID를 확인해 주세요.', 404: 'ElevenLabs Voice ID와 사용 가능 여부를 확인해 주세요.', 429: '음성 서비스 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' })[response.status];
        throw new AgentError(message || `${stage} 요청에 실패했습니다. (HTTP ${response.status})`, 'SPEECH_PROVIDER');
      }
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
    if (!this.configured) throw new AgentError('ElevenLabs 음성 설정을 확인해 주세요.', 'SPEECH_CONFIG');
    signal?.throwIfAborted();
    text = speechText(text);
    const settings = { text, model_id: this.model, language_code: 'ko', voice_settings: { stability: .5, similarity_boost: .75 } };
    const key = audioCacheKey({ version: 1, voiceId: this.voiceId, format: 'mp3_44100_128', ...settings });
    const cached = await this.cache.get(key);
    signal?.throwIfAborted();
    if (cached) return { audio: cached.toString('base64'), mime: 'audio/mpeg', cached: true };
    const response = await this.call(`text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`, settings, signal);
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length || audio.length > 8 * 1024 * 1024) throw new AgentError('음성 안내를 받지 못했습니다.', 'SPEECH_RESPONSE');
    signal?.throwIfAborted();
    await this.cache.put(key, audio, signal);
    signal?.throwIfAborted();
    return { audio: audio.toString('base64'), mime: 'audio/mpeg', cached: false };
  }
}
