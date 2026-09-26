import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/kontoer', '/kontoer/demo-acc-bruk', '/kontoer/import', '/transaksjoner', '/abonnementer', '/kort', '/kort/demo-card-mc', '/formue', '/bedrift', '/innstillinger'];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.setItem('saldo:demo', '1');
  });
  await page.reload();
  await expect(page.getByText('Samlet kontosaldo')).toBeVisible();
});

test('innloggingssiden vises uten innlogging og slipper inn i demo', async ({ page }) => {
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Logg inn' })).toBeVisible();
  await expect(page.getByLabel('E-post')).toBeVisible();
  await page.getByRole('button', { name: /Utforsk med demodata/ }).click();
  await expect(page.getByText('Samlet kontosaldo')).toBeVisible();
});

test('ingen horisontal scrolling på noen side', async ({ page }) => {
  for (const r of ROUTES) {
    await page.goto(`/#${r}`);
    await page.waitForLoadState('networkidle');
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, `side ${r}`).toBeLessThanOrEqual(w);
  }
});

test('ingen horisontal scrolling på nettbrett', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  for (const r of ROUTES) {
    await page.goto(`/#${r}`);
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, `side ${r}`).toBeLessThanOrEqual(w);
  }
});

test('tastaturnavigasjon: hopp til innhold og åpne nøkkeltall', async ({ page }) => {
  await page.goto('/#/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Hopp til innhold' })).toBeFocused();
  const detail = page.getByRole('button', { name: /Saldo minus kortgjeld/ });
  await detail.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Kontosaldo minus kredittkortgjeld' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(detail).toBeFocused();
});

test('oppdatering beholder data og viser behov for ny tilkobling', async ({ page }) => {
  await page.goto('/#/kontoer');
  await page.getByRole('button', { name: 'Hent nye data fra tilkoblinger' }).click();
  await expect(page.getByRole('status').filter({ hasText: /oppdatert|krever ny tilkobling/ })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Må kobles til på nytt').first()).toBeVisible();
  await expect(page.getByText('Vidde Mastercard').first()).toBeVisible();
});

test('endringer lagres mellom økter', async ({ page }) => {
  await page.goto('/#/innstillinger');
  await page.getByRole('button', { name: 'Korall' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'coral');
});
