import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const longMessage = '음성 주문 연결을 확인해 주세요. 서버가 실행한 키오스크에서 음성 주문을 사용할 수 있습니다. 현재 담긴 주문은 유지되며 화면을 눌러 계속 주문할 수 있습니다.';

test('captions reserve space across portrait sizes, resizing and modal transitions', { timeout: 60000 }, async t => {
  const app = express(); app.use(express.static('dist'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.addInitScript(message => {
    Element.prototype.requestFullscreen = async () => {};
    window.layoutMessage = message;
    window.kioskVoice = async () => ({ error: window.layoutMessage });
  }, longMessage);
  await mkdir('artifacts', { recursive: true });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: '포장', exact: true }).click();
  await page.getByRole('button', { name: '음성 주문 시작' }).click();
  await page.locator('.voice-dock[data-phase="error"]').waitFor();

  for (const [width, height] of [[1080, 1920], [864, 1536], [720, 1280], [540, 960], [390, 844], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => {
      const dock = document.querySelector('.voice-dock').getBoundingClientRect();
      const cart = document.querySelector('.cart').getBoundingClientRect();
      return cart.bottom <= dock.top + 1;
    });
    // Exercise height changes at the same viewport as well as resizing.
    for (const message of [longMessage.repeat(8), longMessage]) {
      await page.evaluate(value => { window.layoutMessage = value; }, message);
      await page.getByRole('button', { name: '음성 주문 시작' }).click();
      await page.locator('.voice-dock[data-phase="error"]').waitFor();
      await page.waitForFunction(() => document.querySelector('.cart').getBoundingClientRect().bottom <= document.querySelector('.voice-dock').getBoundingClientRect().top + 1);
    }
    const dock = await page.locator('.voice-dock').boundingBox();
    const checkout = await page.locator('.cart-checkout').boundingBox();
    const mic = await page.locator('.voice-button').boundingBox();
    assert.ok(checkout.y + checkout.height <= dock.y + 1, `${width}: checkout overlaps caption`);
    assert.ok(mic.y >= dock.y && mic.y + mic.height <= height, `${width}: voice control clipped`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: /^카페라떼 .* 선택$/ }).click();
    await page.locator('dialog .voice-dock').waitFor();
    const add = page.locator('.options-content > .primary');
    await add.scrollIntoViewIfNeeded();
    const action = await add.boundingBox();
    const modalDock = await page.locator('.voice-dock').boundingBox();
    assert.ok(action.y >= 0 && action.y + action.height <= modalDock.y + 1, `${width}: option action overlaps caption`);
    if (width === 1080) await page.screenshot({ path: 'artifacts/voice-layout-options.png' });
    await add.click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    if (width === 1080 || width === 390) await page.screenshot({ path: `artifacts/voice-layout-${width}.png` });
  }
});
