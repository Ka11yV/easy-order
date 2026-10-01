// AudioContext resamples microphone input to 16 kHz. Only silent output is routed
// to the speakers; 100 ms PCM16 chunks go to the STT WebSocket.
class KioskPCM extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(1600); this.offset = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const value of input) {
      const sample = Math.max(-1, Math.min(1, value));
      this.samples[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1600); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('kiosk-pcm', KioskPCM);
