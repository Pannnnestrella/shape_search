import { test, expect, type Page } from '@playwright/test';

async function drawCircle(page: Page) {
  const box = (await page.locator('.sketch-canvas').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx + 65, cy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(cx + 65 * Math.cos(i / 40 * Math.PI * 2), cy + 65 * Math.sin(i / 40 * Math.PI * 2));
  await page.mouse.up();
}

test('geometry searches all libraries, exports PNG and clears results', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.panel-footer')).toContainText('16003', { timeout: 30000 });
  await page.getByLabel('检索方式').selectOption('geometry');
  await drawCircle(page);
  await expect(page.locator('.icon-card')).toHaveCount(60);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出草图', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^sketch-.*\.png$/);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('.icon-card')).toHaveCount(0);
});

test('model outage falls back to geometry', async ({ page }) => {
  await page.route('**/model/search', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto('/');
  await expect(page.locator('.panel-footer')).toContainText('16003', { timeout: 30000 });
  await drawCircle(page);
  await expect(page.locator('.panel-status-message')).toContainText('已使用轮廓精排');
  await expect(page.locator('.icon-card')).toHaveCount(60);
});

test('clearing while model request is pending prevents stale results', async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/model/search', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: 'late response' } }).catch(() => {});
  });
  await page.goto('/');
  await expect(page.locator('.panel-footer')).toContainText('16003', { timeout: 30000 });
  const request = page.waitForRequest('**/model/search');
  await drawCircle(page);
  await request;
  await page.getByRole('button', { name: '清空', exact: true }).click();
  release!();
  await expect(page.locator('.icon-card')).toHaveCount(0);
  await expect(page.locator('.panel-status-message')).toContainText('画出你想寻找的形状');
});

test('local model query succeeds through Vite proxy', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.panel-footer')).toContainText('16003', { timeout: 30000 });
  const response = page.waitForResponse((response) => response.url().endsWith('/model/search'));
  await drawCircle(page);
  expect((await response).status()).toBe(200);
  await expect(page.locator('.icon-card')).toHaveCount(60);
  await expect(page.getByText('本地模型未就绪，已使用轮廓精排')).toHaveCount(0);
});
