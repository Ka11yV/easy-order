import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Barcode, Check, ChevronLeft, ChevronRight, Home, Minus, Plus, Search, ShoppingBag, Trash2, UtensilsCrossed, X } from 'lucide-react';
import menu from './menu.json';
import './style.css';

const won = value => `${value.toLocaleString('ko-KR')}원`;
const categories = ['전체', '커피', '논커피', '티', '에이드·주스', '스무디·프라페', '디카페인'];
const featured = ['아메리카노', '카페라떼', '바닐라라떼', '하우스밀크 라떼', '딸기라떼', '녹차라떼'];
const products = [...menu].sort((a, b) => {
  const rank = name => featured.includes(name) ? featured.indexOf(name) : 100;
  return rank(a.name) - rank(b.name);
});
const PAGE_SIZE = 6;
const barcodeMethods = new Set(['kakao', 'naver', 'payco', 'zeropay']);
const paymentMethods = [
  { id: 'card', name: '카드', image: 'card.png' },
  { id: 'payco', name: '페이코', image: 'payco.svg' },
  { id: 'samsung', name: '삼성페이', image: 'samsung.png' },
  { id: 'kakao', name: '카카오페이', image: 'kakao.svg' },
  { id: 'naver', name: '네이버페이', image: 'naver.svg' },
  { id: 'zeropay', name: '제로페이' },
];

function Modal({ label, children, onClose, wide = false, className = '' }) {
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    const cancel = event => { event.preventDefault(); close.current(); };
    element.showModal();
    element.addEventListener('cancel', cancel);
    return () => { element.removeEventListener('cancel', cancel); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''} ${className}`} aria-label={label}>
    <button className="close icon-button" aria-label="닫기" onClick={onClose}><X /></button>
    {children}
  </dialog>;
}

function Stepper({ value, onChange, label }) {
  return <div className="stepper">
    <button aria-label={`${label} 수량 줄이기`} disabled={value <= 1} onClick={() => onChange(value - 1)}><Minus size={20} /></button>
    <output aria-label={`${label} 수량`}>{value}</output>
    <button aria-label={`${label} 수량 늘리기`} disabled={value >= 99} onClick={() => onChange(value + 1)}><Plus size={20} /></button>
  </div>;
}

function App() {
  const [mode, setMode] = useState(null);
  const [category, setCategory] = useState('전체');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [cart, setCart] = useState([]);
  const [selected, setSelected] = useState(null);
  const [temperature, setTemperature] = useState('ICE');
  const [quantity, setQuantity] = useState(1);
  const [shot, setShot] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [phone, setPhone] = useState('');
  const [orderNumber, setOrderNumber] = useState(101);
  const [notice, setNotice] = useState('');
  const grid = useRef(null);
  const filtered = products.filter(item => (category === '전체' || item.category === category) && item.name.includes(query.trim()));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  useEffect(() => {
    if (dialog !== 'barcode') return;
    const timer = setTimeout(() => setDialog(current => current === 'barcode' ? 'complete' : current), 3000);
    return () => clearTimeout(timer);
  }, [dialog]);

  useEffect(() => { grid.current?.scrollTo(0, 0); }, [page, category, query]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  function select(item, line) {
    setSelected(item);
    setTemperature(line?.temperature ?? (item.temperatures.includes('ICE') ? 'ICE' : item.temperatures[0]));
    setQuantity(line?.quantity ?? 1);
    setShot(line?.shot ?? false);
    setEditing(line?.key ?? null);
  }
  function add() {
    const key = `${selected.id}-${temperature}-${shot}`;
    const unitPrice = selected.price + (shot ? 500 : 0);
    const others = cart.filter(item => item.key !== editing);
    const existing = others.find(item => item.key === key);
    if ((existing?.quantity ?? 0) + quantity > 99) {
      setNotice('같은 메뉴는 최대 99개까지 담을 수 있습니다.');
      return;
    }
    setCart(existing
      ? others.map(item => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
      : [...others, { ...selected, key, quantity, temperature, shot, unitPrice }]);
    setSelected(null);
    setNotice(editing ? '수정되었습니다.' : '담았습니다.');
  }
  function reset() {
    setCart([]); setMode(null); setDialog(null); setSelected(null);
    setQuery(''); setCategory('전체'); setPage(0); setNotice(''); setPaymentMethod(null); setPhone('');
  }
  function finish() { reset(); setOrderNumber(number => number + 1); }

  if (!mode) return <main className="start-screen" aria-label="매장 또는 포장 선택">
    <div className="start-options">
      <button className="start-button dine-in" onClick={() => setMode('매장')}>
        <UtensilsCrossed aria-hidden="true" strokeWidth={1.3} /><strong>매장</strong>
      </button>
      <button className="start-button takeout" onClick={() => setMode('포장')}>
        <ShoppingBag aria-hidden="true" strokeWidth={1.3} /><strong>포장</strong>
      </button>
    </div>
  </main>;

  return <div className="kiosk">
    <header className="header">
      <h1>메뉴 선택</h1>
      <div className="header-actions">
        <button className="mode-button" onClick={() => setMode(mode === '매장' ? '포장' : '매장')}>
          {mode === '매장' ? <UtensilsCrossed size={21} /> : <ShoppingBag size={21} />}
          <strong>{mode}</strong><span>변경</span>
        </button>
        <button className="home-button" onClick={() => setDialog('reset')}><Home size={21} /><span>처음으로</span></button>
      </div>
    </header>
    <div className="order-body">
      <section className="catalog" aria-label="음료 메뉴">
        <nav className="category-tabs" aria-label="음료 카테고리">
          {categories.map(value => <button key={value} aria-pressed={category === value} className={category === value ? 'active' : ''} onClick={() => { setCategory(value); setPage(0); }}>{value}</button>)}
        </nav>
        <div className="catalog-tools">
          <span>{category} <b>{filtered.length}</b></span>
          <label className="search"><Search size={20} /><input aria-label="메뉴 검색" placeholder="메뉴 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />{query && <button aria-label="검색 지우기" onClick={() => { setQuery(''); setPage(0); }}><X size={18} /></button>}</label>
        </div>
        <div className="product-grid" ref={grid}>
          {visible.map(item => <button className="product" key={item.id} onClick={() => select(item)} aria-label={`${item.name} ${won(item.price)} 선택`}>
            <div className="product-photo"><img src={item.image} alt={item.name} draggable="false" /></div>
            <h2>{item.name}</h2><strong className="product-price">{won(item.price)}</strong>
          </button>)}
          {!visible.length && <div className="no-results"><Search size={32} /><p>검색 결과가 없습니다.</p><button onClick={() => { setQuery(''); setCategory('전체'); setPage(0); }}>전체 메뉴</button></div>}
        </div>
        <div className="pagination"><button disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="이전 메뉴 페이지"><ChevronLeft size={24} /> 이전</button><span><strong>{page + 1}</strong> / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="다음 메뉴 페이지">다음 <ChevronRight size={24} /></button></div>
      </section>
      <aside className="cart" aria-label="장바구니">
        <div className="cart-heading"><h2>주문 내역 <span>{count}</span></h2><button className="clear-cart" disabled={!cart.length} onClick={() => setDialog('clear')}><Trash2 size={17} /> 전체 삭제</button></div>
        <div className="cart-list">
          {cart.length ? cart.map(item => <article className="cart-line" key={item.key}>
            <img src={item.images?.[item.temperature] || item.image} alt="" />
            <div className="cart-line-content">
              <div className="cart-line-heading"><h3>{item.name}</h3><button className="delete-line" aria-label={`${item.name} 삭제`} onClick={() => setCart(cart.filter(line => line.key !== item.key))}><X size={18} /></button></div>
              <button className="edit-options" aria-label={`${item.name} 옵션 수정`} onClick={() => select(item, item)}>{item.temperature}{item.shot ? ' · 샷 추가' : ''}<span>변경</span></button>
              <div className="cart-line-bottom"><Stepper label={item.name} value={item.quantity} onChange={quantity => setCart(cart.map(line => line.key === item.key ? { ...line, quantity } : line))} /><strong>{won(item.quantity * item.unitPrice)}</strong></div>
            </div>
          </article>) : <div className="empty-cart"><ShoppingBag size={38} strokeWidth={1.2} /><p>메뉴를 선택해주세요.</p></div>}
        </div>
        <div className="cart-checkout"><div className="total"><span>합계</span><strong>{won(total)}</strong></div><button className="primary" disabled={!count} onClick={() => setDialog('review')}>주문하기 <ArrowRight size={23} /></button></div>
      </aside>
    </div>
    {selected && <Modal wide label={`${selected.name} 옵션 선택`} onClose={() => setSelected(null)}>
      <div className="options-layout"><div className="options-photo"><img src={selected.images?.[temperature] || selected.image} alt={selected.name} /></div><div className="options-content">
        <h2>{selected.name}</h2><p className="base-price">{won(selected.price)}</p>
        <fieldset><legend>온도 <span>필수</span></legend><div className="temperatures">{selected.temperatures.map(value => <button key={value} className={temperature === value ? 'selected' : ''} aria-pressed={temperature === value} onClick={() => setTemperature(value)}>{value === 'HOT' ? 'HOT 따뜻하게' : 'ICE 차갑게'}{temperature === value && <Check size={18} />}</button>)}</div></fieldset>
        {selected.category === '커피' && <fieldset><legend>추가 옵션</legend><button className={`shot-option ${shot ? 'selected' : ''}`} aria-pressed={shot} onClick={() => setShot(!shot)}><span>샷 추가 <small>+500원</small></span><span className="check-box">{shot && <Check size={17} />}</span></button></fieldset>}
        <div className="quantity"><span>수량</span><Stepper label="선택" value={quantity} onChange={setQuantity} /></div>
        <button className="primary" onClick={add}><strong>{won((selected.price + (shot ? 500 : 0)) * quantity)}</strong><span>{editing ? '수정' : '담기'} <Plus size={20} /></span></button>
      </div></div>
    </Modal>}
    {dialog === 'review' && <Modal label="주문 확인" onClose={() => setDialog(null)}>
      <h2>주문 확인</h2><p className="review-mode">{mode} · {count}잔</p>
      <div className="review-list">{cart.map(item => <div key={item.key}><div><strong>{item.name} × {item.quantity}</strong><p>{item.temperature}{item.shot ? ' · 샷 추가' : ''}</p></div><strong>{won(item.quantity * item.unitPrice)}</strong></div>)}</div>
      <div className="total"><span>합계</span><strong>{won(total)}</strong></div>
      <p className="demo-note">체험용 가격 · 실제 결제되지 않습니다.</p>
      <button className="primary" onClick={() => { setPaymentMethod(null); setDialog('points'); }}>결제하기 <ArrowRight size={22} /></button><button className="secondary" onClick={() => setDialog(null)}>돌아가기</button>
    </Modal>}
    {dialog === 'points' && <Modal className="points-modal" label="번호 적립" onClose={() => setDialog('review')}>
      <h2>번호 적립</h2>
      <label className="phone-label" htmlFor="points-phone">휴대폰 번호</label>
      <input id="points-phone" className="phone-input" type="tel" inputMode="numeric" autoComplete="off" placeholder="01012345678" maxLength={11} value={phone} onChange={event => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} />
      <div className="number-pad" aria-label="휴대폰 번호 키패드">
        {['1','2','3','4','5','6','7','8','9','전체 지우기','0','지우기'].map(key => <button key={key} onClick={() => setPhone(value => key === '전체 지우기' ? '' : key === '지우기' ? value.slice(0, -1) : (value + key).slice(0, 11))}>{key}</button>)}
      </div>
      <p className="demo-note">체험용 · 실제 적립되지 않습니다.</p>
      <button className="primary" disabled={!/^010\d{8}$/.test(phone)} onClick={() => { setPhone(''); setDialog('payment'); }}>적립하고 결제하기 <ArrowRight size={22} /></button>
      <button className="secondary" onClick={() => { setPhone(''); setDialog('payment'); }}>건너뛰기</button>
    </Modal>}
    {dialog === 'payment'  && <Modal className="payment-modal" label="결제수단 선택" onClose={() => setDialog('points')}>
      <h2>결제수단 선택</h2>
      <div className="payment-methods" role="group" aria-label="결제수단">
        {paymentMethods.map(method => <button key={method.id} className={`payment-method ${paymentMethod?.id === method.id ? 'selected' : ''}`} aria-pressed={paymentMethod?.id === method.id} onClick={() => setPaymentMethod(method)}>
          <span className="payment-logo">{method.image ? <img src={`/images/payments/${method.image}`} alt="" draggable="false" /> : <span className="zeropay-logo" aria-hidden="true" />}</span>
          <strong>{method.name}</strong>
          {paymentMethod?.id === method.id && <Check className="payment-check" size={18} aria-hidden="true" />}
        </button>)}
      </div>
      <div className="total"><span>결제금액</span><strong>{won(total)}</strong></div>
      <p className="demo-note">체험용 · 실제 결제되지 않습니다.</p>
      <button className="primary" disabled={!paymentMethod || !count} onClick={() => { if (paymentMethod && count) setDialog(barcodeMethods.has(paymentMethod.id) ? 'barcode' : 'complete'); }}><span>{paymentMethod ? `${paymentMethod.name} 모의 결제` : '결제수단을 선택해주세요'}</span><ArrowRight size={22} /></button>
      <button className="secondary" onClick={() => setDialog('points')}>돌아가기</button>
    </Modal>}
    {dialog === 'barcode' && <Modal label="바코드 제시" onClose={() => setDialog('payment')}>
      <div className="barcode-prompt">
        <p className="barcode-provider">{paymentMethod?.name}</p>
        <h2>바코드를 보여주세요</h2>
        <div className="barcode-illustration"><Barcode size={100} strokeWidth={1.5} aria-hidden="true" /></div>
        <p>휴대폰의 결제 바코드를<br />스캐너에 보여주세요.</p>
        <p className="demo-note" role="status">모의 결제 · 3초 후 자동으로 완료됩니다.</p>
        <button className="secondary" onClick={() => setDialog('payment')}>취소</button>
      </div>
    </Modal>}
    {dialog === 'complete'  && <Modal label="주문 완료" onClose={finish}>
      <div className="complete"><span className="complete-check"><Check size={36} /></span><h2>주문 완료</h2><p>주문번호</p><strong className="order-number">{orderNumber}</strong><p>{mode} · {count}잔</p><p className="payment-receipt">{paymentMethod?.name} · {won(total)} · 모의 결제 완료</p><button className="primary" onClick={finish}>처음으로 <Home size={21} /></button></div>
    </Modal>}
    {(dialog === 'reset' || dialog === 'clear') && <Modal label={dialog === 'reset' ? '처음으로' : '전체 삭제'} onClose={() => setDialog(null)}>
      <h2>{dialog === 'reset' ? '처음으로 돌아갈까요?' : '모두 삭제할까요?'}</h2><p className="confirm-note">담은 메뉴가 삭제됩니다.</p><button className="primary" onClick={() => { if (dialog === 'reset') reset(); else { setCart([]); setDialog(null); } }}>확인 <Check size={21} /></button><button className="secondary" onClick={() => setDialog(null)}>취소</button>
    </Modal>}
    <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice}</div>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
