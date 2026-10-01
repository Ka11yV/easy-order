import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square, Volume2, LoaderCircle } from 'lucide-react';
import { callVoice, listen, playSpeech } from './speech.js';
import './voice.css';

export default function VoiceOrder() {
  const [phase, setPhase] = useState('idle');
  const [message, setMessage] = useState('');
  const [host, setHost] = useState(document.body);
  const session = useRef(null);
  useEffect(() => {
    // A native modal makes outside controls inert. Keep the same voice session,
    // but render its controls inside the current modal so stop/mic stay usable.
    const update = () => setHost(document.querySelector('dialog[open]') || document.body);
    const observer = new MutationObserver(update);
    observer.observe(document.getElementById('root'), { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    update();
    return () => { observer.disconnect(); session.current?.abort(); session.current?.closeMic?.(); clearTimeout(session.current?.timer); };
  }, []);
  const live = current => session.current === current && !current.signal.aborted;
  function release(current) { current?.closeMic?.(); clearTimeout(current?.timer); }
  async function stop() {
    const current = session.current;
    session.current = null; current?.abort(); release(current);
    setPhase('stopping'); setMessage('음성 주문을 종료하고 있습니다.');
    try { await callVoice('stop'); setPhase('idle'); setMessage(''); }
    catch (error) { setPhase('error'); setMessage(error.message); }
  }
  function fail(current, error) {
    if (!live(current)) return;
    release(current); current.abort(); session.current = null;
    setPhase('error'); setMessage(error.message || '음성 주문에 연결하지 못했습니다.');
  }
  async function hear(current) {
    if (!live(current)) return;
    setPhase('connecting');
    current.timer = setTimeout(() => fail(current, new Error('마이크 연결 또는 음성 입력이 지연되어 종료했습니다. 다시 눌러주세요.')), 45000);
    try {
      const { token } = await callVoice('token');
      if (!live(current)) return;
      current.closeMic = await listen({ token, signal: current.signal,
        onReady: () => { if (live(current)) {
          clearTimeout(current.timer);
          current.timer = setTimeout(() => fail(current, new Error('말씀이 들리지 않아 마이크를 껐습니다. 다시 눌러주세요.')), 45000);
          setPhase('listening'); setMessage('말씀해 주세요.');
        } },
        onPartial: text => { if (live(current)) setMessage(text); },
        onFinal: text => { if (live(current)) void order(current, text); },
        onError: error => fail(current, error),
      });
      if (!live(current)) { release(current); return; }
    } catch (error) { fail(current, error); }
  }
  async function order(current, text) {
    release(current); setPhase('ordering'); setMessage(text);
    let result;
    try {
      try { result = await callVoice('utterance', { text }); }
      catch (error) {
        if (!['CLARIFY', 'UNCERTAIN'].includes(error.code)) throw error;
        result = { message: error.message };
      }
      if (!live(current)) return;
      setPhase('speaking'); setMessage(result.message);
      const audio = await callVoice('speak', { text: result.message });
      if (!live(current)) return;
      await playSpeech(audio, current.signal);
      if (!live(current)) return;
      if (result.orderNumber) { current.abort(); session.current = null; setPhase('idle'); }
      else await hear(current);
    } catch (error) { fail(current, error); }
  }
  async function start() {
    if (session.current || phase === 'stopping') return;
    // Fullscreen requests require the user's click. Dedicated kiosk mode already fills the screen.
    document.documentElement.requestFullscreen?.().catch(() => {});
    const current = new AbortController(); session.current = current;
    setPhase('connecting'); setMessage('음성 주문을 연결하고 있습니다.');
    try {
      const config = await callVoice('config');
      if (!live(current)) return;
      if (!config.configured) throw new Error('JEV API 키를 설정해 주세요.');
      if (!config.speechConfigured) throw new Error('ElevenLabs API 키와 Voice ID 설정이 필요합니다.');
      await hear(current);
    } catch (error) { fail(current, error); }
  }
  const active = !['idle', 'error'].includes(phase);
  const labels = { idle: '음성 주문', error: '다시 시도', connecting: '연결 중', listening: '듣고 있어요', ordering: '주문 중', speaking: '안내 중', stopping: '종료 중' };
  const Icon = phase === 'speaking' ? Volume2 : ['connecting', 'ordering', 'stopping'].includes(phase) ? LoaderCircle : Mic;
  return createPortal(<aside className={`voice-dock ${active ? 'active' : ''}`} aria-label="음성 주문" data-phase={phase}>
    {message && <div className={`voice-message ${phase === 'error' ? 'error' : ''}`} role="status" aria-live="polite">{message}</div>}
    <button className={`voice-button ${phase}`} aria-label={active ? '음성 주문 종료' : '음성 주문 시작'} disabled={phase === 'stopping'} onClick={active ? stop : start}>
      <span className="voice-icon"><Icon size={26} /></span><span>{labels[phase]}</span>{active && <Square className="voice-stop" size={16} fill="currentColor" />}
    </button>
  </aside>, host);
}
