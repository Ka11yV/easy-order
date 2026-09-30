import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, CircleStop, ExternalLink, Monitor, RefreshCw, Terminal, Wifi, WifiOff } from 'lucide-react';
import './control.css';

const statusLabels = { idle: '준비', opening: '키오스크 여는 중', running: '주문 처리 중', confirmation: '결제 확인 대기', done: '완료', clarification: '추가 입력 필요', error: '확인 필요', stopping: '중단 중', stopped: '중단됨' };
const examples = ['아이스 아메리카노 두 잔 포장해 줘', '아메리카노 한 잔으로 바꿔줘', '카카오페이로 결제해 줘'];

export default function Control() {
  const [state, setState] = useState({ configured: false, browserReady: false, busy: false, status: 'idle' });
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [frame, setFrame] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef(null);
  useEffect(() => {
    document.title = '텍스트 주문 · Easy Order';
    const stream = new EventSource('/api/events');
    stream.onopen = () => setConnected(true);
    stream.onerror = () => { setConnected(false); };
    stream.onmessage = message => {
      const event = JSON.parse(message.data);
      if (event.type === 'state') {
        setState(event); setEvents(event.history || []);
        setFrame(event.frameVersion ? `/api/frame?v=${event.frameVersion}` : null);
      } else if (event.type === 'status') setState(previous => ({ ...previous, ...event }));
      else if (event.type === 'frame') setFrame(event.version === null ? null : `/api/frame?v=${event.version}`);
      else setEvents(previous => [...previous, event].slice(-100));
    };
    return () => stream.close();
  }, []);
  useEffect(() => { const pane = bottom.current?.parentElement; if (pane) pane.scrollTop = pane.scrollHeight; }, [events]);
  const busy = state.busy || sending;
  async function request(path, body = {}) {
    setError(''); setSending(true);
    try {
      const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Easy-Order': '1' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '요청에 실패했습니다.');
      return true;
    } catch (error) { setError(error.message); return false; }
    finally { setSending(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !connected || !state.configured || !state.browserReady || !text.trim()) return;
    if (await request('command', { text: text.trim() })) setText('');
  }
  const lastStep = [...events].reverse().find(event => event.type === 'step');
  const messages = events.filter(event => ['command', 'result', 'error'].includes(event.type));
  return <main className="control-app">
    <header className="control-header">
      <div className="control-title"><span className="control-symbol"><Terminal size={23} /></span><div><h1>텍스트 주문</h1><p>JEV + Playwright</p></div></div>
      <span className={`connection ${connected ? 'online' : ''}`}>{connected ? <Wifi size={16} /> : <WifiOff size={16} />}{connected ? '로컬 서버 연결됨' : '서버 연결 중'}</span>
    </header>
    <div className="control-workspace">
      <section className="command-panel" aria-label="텍스트 주문 제어">
        <div className="command-heading"><h2>주문 요청</h2><span className={`agent-status ${state.busy ? 'working' : ''}`} role="status">{statusLabels[state.status] || state.status}</span></div>
        {!state.configured && connected && <div className="setup-notice"><strong>JEV 연결이 필요합니다</strong><p>로컬 .env에 TYPESAFE_API_KEY를 설정한 뒤 서버를 다시 실행해 주세요.</p><small>API 키는 이 입력창에 붙여넣지 마세요.</small></div>}
        <div className="conversation" aria-label="주문 대화" aria-live="polite">
          {!messages.length && <div className="conversation-empty"><span>원하는 주문을 입력하세요.</span><p>메뉴 추가·수정·삭제와 모의 결제를<br />실제 키오스크 화면에서 수행합니다.</p></div>}
          {messages.map((event, i) => <div key={event.id || i} className={`message ${event.type}`}><span className="message-author">{event.type === 'command' ? '요청' : event.type === 'error' ? '확인 필요' : '주문 도우미'}</span><p>{event.message}</p>{event.cart?.length > 0 && <ul>{event.cart.map((line, j) => <li key={j}>{line.name} · {line.temperature} · {line.quantity}잔{line.shot ? ' · 샷 추가' : ''}</li>)}</ul>}</div>)}
          <div ref={bottom} />
        </div>
        {state.confirmation && <div className="payment-confirmation"><strong>모의 결제 확인</strong><p>{state.confirmation.mode} · {state.confirmation.method} · {state.confirmation.total.toLocaleString('ko-KR')}원</p><div><button disabled={busy || !connected} onClick={() => request('stop')}>취소</button><button disabled={busy || !connected} onClick={() => request('confirm')}><Check size={17} />결제 진행</button></div><small>실제 청구되지 않습니다.</small></div>}
        {error && <p className="control-error" role="alert">{error}</p>}
        <form className="command-form" onSubmit={submit}>
          <div className="example-commands">{examples.map(example => <button type="button" key={example} disabled={busy} onClick={() => setText(example)}>{example}</button>)}</div>
          <label htmlFor="order-command">주문 입력</label>
          <div className="command-input"><textarea id="order-command" rows={3} maxLength={1000} value={text} onChange={event => setText(event.target.value)} placeholder="예: 아이스 아메리카노 두 잔 포장해 줘" disabled={busy} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(event); } }} /><button type="submit" aria-label="주문 실행" disabled={busy || !connected || !state.configured || !state.browserReady || !text.trim()}><ArrowUp size={23} /></button></div>
          <div className="input-footer"><span>{text.length}/1,000 · Enter로 실행</span><button type="button" className="stop-control" disabled={!state.busy || !connected} onClick={() => request('stop')}><CircleStop size={15} />중단</button></div>
        </form>
      </section>
      <section className="preview-panel" aria-label="키오스크 실시간 화면">
        <div className="preview-toolbar"><div><Monitor size={19} /><h2>키오스크</h2><span>LIVE</span></div><div className="preview-actions"><button aria-label="화면 새로고침" disabled={busy || !state.browserReady || !connected} onClick={() => request('refresh')}><RefreshCw size={16} /></button><button disabled={busy || !connected} onClick={() => request('browser')}><ExternalLink size={16} />{state.browserReady ? '새 주문 창' : '키오스크 열기'}</button></div></div>
        <div className="preview-screen">{frame ? <img src={frame} alt="자동화 중인 키오스크 화면" /> : <div className="preview-empty"><Monitor size={48} strokeWidth={1} /><p>키오스크 창을 열어주세요.</p><button disabled={busy || !connected} onClick={() => request('browser')}>키오스크 열기 <ExternalLink size={16} /></button></div>}</div>
        <div className="execution-line"><span className={state.busy ? 'pulse-dot' : 'idle-dot'} /><p>{state.busy ? lastStep?.message || '브라우저를 준비하고 있습니다.' : '실제 클릭은 별도로 열린 키오스크 창에 반영됩니다.'}</p></div>
        <details className="execution-log"><summary>실행 기록 <span>{events.filter(event => event.type === 'step' && event.phase === 'executed').length}개 동작</span></summary><ol>{events.filter(event => event.type === 'step').map((event, i) => <li key={event.id || i}><span>{event.phase === 'executed' ? '실행' : event.phase === 'planning' ? '해석' : '판단'}</span>{event.message}</li>)}</ol></details>
      </section>
    </div>
  </main>;
}
