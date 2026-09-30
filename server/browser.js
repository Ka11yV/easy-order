import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { AgentError } from './jev.js';

export class KioskBrowser {
  constructor({ url, headless = false, onFrame = () => {} }) { this.url = url; this.headless = headless; this.onFrame = onFrame; }
  async start() {
    await this.close();
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
    // This isolated browser may only access the local kiosk; no external navigation or fonts.
    await this.context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === new URL(this.url).origin ? route.continue() : route.abort();
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(2500);
    await this.page.goto(this.url);
    await this.page.locator('.start-screen').waitFor();
    await this.frame();
  }
  get ready() { return Boolean(this.page && !this.page.isClosed()); }
  async close() { await this.browser?.close(); this.browser = null; this.page = null; }
  async frame() {
    if (!this.ready) return;
    const image = await this.page.screenshot({ type: 'jpeg', quality: 65, animations: 'disabled' });
    this.onFrame(image); return image;
  }
  async snapshot() {
    if (!this.ready) throw new AgentError('키오스크 창을 먼저 열어주세요.', 'NO_BROWSER');
    if (this.page.url() !== this.url) throw new AgentError('허용된 키오스크 화면을 벗어났습니다.', 'WRONG_PAGE');
    const state = await this.page.evaluate(() => {
      const visible = element => Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden';
      const dialog = document.querySelector('dialog[open]');
      const root = dialog || document.querySelector('main') || document.body;
      const controls = [...root.querySelectorAll('button,input')].filter(visible).map((el, i) => {
        const ref = `e${i}`;
        el.setAttribute('data-easy-ref', ref);
        return { ref, type: el.tagName === 'INPUT' ? 'input' : 'button', name: el.getAttribute('aria-label') || el.labels?.[0]?.textContent.trim() || el.textContent.trim(),
          context: el.closest('.cart-line')?.innerText || null, disabled: el.disabled, pressed: el.getAttribute('aria-pressed'), value: el.tagName === 'INPUT' ? (el.type === 'tel' ? '[private]' : el.value) : undefined };
      });
      const cart = [...document.querySelectorAll('.cart-line')].map(el => ({
        name: el.querySelector('h3').textContent.trim(), temperature: el.querySelector('.edit-options').textContent.includes('HOT') ? 'HOT' : 'ICE',
        shot: el.querySelector('.edit-options').textContent.includes('샷 추가'), quantity: Number(el.querySelector('output').textContent),
        price: Number(el.querySelector('.cart-line-bottom>strong').textContent.replace(/\D/g, '')) / Number(el.querySelector('output').textContent),
      }));
      return { screen: dialog?.getAttribute('aria-label') || (document.querySelector('.start-screen') ? '매장 또는 포장 선택' : '메뉴 선택'),
        mode: document.querySelector('.mode-button strong')?.textContent || null,
        text: root.innerText.slice(0, 12000), controls, cart,
        orderNumber: document.querySelector('.order-number')?.textContent || null,
        receipt: document.querySelector('.payment-receipt')?.textContent || null,
        option: dialog?.querySelector('.options-content') ? { name: dialog.querySelector('h2').textContent,
          temperature: dialog.querySelector('.temperatures .selected')?.textContent.startsWith('HOT') ? 'HOT' : 'ICE',
          shot: Boolean(dialog.querySelector('.shot-option.selected')), quantity: Number(dialog.querySelector('output').textContent) } : null,
      };
    });
    // Toasts and focus are deliberately excluded: they do not change available actions.
    state.fingerprint = createHash('sha256').update(JSON.stringify({ screen: state.screen, mode: state.mode, controls: state.controls, cart: state.cart, option: state.option })).digest('hex');
    return state;
  }
  async execute(action, snapshot, signal) {
    signal.throwIfAborted();
    const fresh = await this.snapshot();
    if (fresh.fingerprint !== snapshot.fingerprint) throw new AgentError('화면이 변경되어 실행을 멈췄습니다. 현재 화면에서 다시 요청해 주세요.', 'STALE');
    const control = fresh.controls.find(el => el.ref === action.ref);
    if (!control || control.disabled) throw new AgentError('현재 사용할 수 없는 버튼입니다.', 'STALE');
    const root = this.page.locator('dialog[open]').or(this.page.locator('body').filter({ hasNot: this.page.locator('dialog[open]') }));
    const target = root.locator(`[data-easy-ref="${action.ref}"]`);
    await target.scrollIntoViewIfNeeded();
    await target.evaluate(el => { el.style.outline = '4px solid #d49a40'; el.style.outlineOffset = '3px'; });
    await this.frame();
    signal.throwIfAborted();
    try {
      if (action.type === 'fill') await target.fill(action.value);
      else await target.click({ timeout: 1800 });
    } finally {
      await target.evaluate(el => { el.style.outline = ''; el.style.outlineOffset = ''; }).catch(() => {});
    }
    await this.frame();
  }
}
