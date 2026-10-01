import { Scribe, RealtimeEvents, CommitStrategy, AudioFormat } from '@elevenlabs/client';

// Own microphone resources explicitly: stopping must also work during async setup.
export async function listen({ token, signal, onReady, onPartial, onFinal, onError }) {
  let closed = false, stream, context, source, processor, connection, socketReady = false;
  const close = () => {
    if (closed) return;
    closed = true; socketReady = false;
    signal.removeEventListener('abort', close);
    stream?.getTracks().forEach(track => track.stop());
    source?.disconnect(); processor?.disconnect();
    void context?.close().catch(() => {}); connection?.close();
  };
  const fail = data => {
    if (closed) return;
    close();
    const messages = { auth_error: '음성 인식 인증에 실패했습니다. ElevenLabs 키와 권한을 확인해 주세요.', quota_exceeded: '음성 인식 사용 한도를 초과했습니다.', rate_limited: '음성 인식 요청이 많습니다. 잠시 후 다시 시도해 주세요.' };
    onError(new Error(messages[data?.message_type] || '마이크 권한과 음성 서비스 연결을 확인해 주세요.'));
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // Permission may finish after the user has already stopped.
    if (closed) { stream.getTracks().forEach(track => track.stop()); return close; }
    context = new AudioContext({ sampleRate: 16000 });
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    if (closed) return close;
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'kiosk-pcm');
    connection = Scribe.connect({ token, modelId: 'scribe_v2_realtime', languageCode: 'ko', commitStrategy: CommitStrategy.VAD,
      vadSilenceThresholdSecs: 1.5, audioFormat: AudioFormat.PCM_16000, sampleRate: 16000 });
    connection.on(RealtimeEvents.OPEN, () => { socketReady = true; });
    connection.on(RealtimeEvents.SESSION_STARTED, () => { if (!closed) onReady(); });
    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, data => { if (!closed) onPartial(data.text); });
    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, data => { if (!closed && data.text.trim()) { close(); onFinal(data.text.trim()); } });
    connection.on(RealtimeEvents.ERROR, fail);
    connection.on(RealtimeEvents.CLOSE, () => { if (!closed) fail(); });
    processor.port.onmessage = event => {
      if (!socketReady || closed) return;
      try { connection.send({ audioBase64: btoa(String.fromCharCode(...new Uint8Array(event.data))) }); }
      catch (error) { fail(error); }
    };
    source.connect(processor); processor.connect(context.destination);
    await context.resume();
  } catch (error) { if (!closed) fail(error); }
  return close;
}

export async function callVoice(operation, payload) {
  if (!window.kioskVoice) throw new Error('서버가 실행한 키오스크에서 음성 주문을 사용할 수 있습니다.');
  const result = await window.kioskVoice(operation, payload);
  if (result.error) { const error = new Error(result.error); error.code = result.code; throw error; }
  return result;
}

export function playSpeech({ audio, mime }, signal) {
  return new Promise((resolve, reject) => {
    const bytes = Uint8Array.from(atob(audio), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const player = new Audio(url);
    const finish = error => {
      player.onended = null; player.onerror = null; player.pause(); player.removeAttribute('src'); player.load();
      clearTimeout(timeout); signal.removeEventListener('abort', abort); URL.revokeObjectURL(url);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new DOMException('중단됨', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('음성 재생 시간이 초과되었습니다.')), 60000);
    player.onended = () => finish();
    player.onerror = () => finish(new Error('음성을 재생하지 못했습니다. 스피커 설정을 확인해 주세요.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else player.play().catch(() => finish(new Error('음성 재생을 허용한 뒤 다시 시도해 주세요.')));
  });
}
