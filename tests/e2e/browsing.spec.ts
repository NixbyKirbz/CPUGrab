import { test, expect } from '@playwright/test';
test('browse, search, add a meal and review transparent checkout', async ({ page }) => {
  await page.goto('/student/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Hello, Centralian!' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'CPUGrab campus banner' })).toBeVisible();
  await expect(page.locator('.dashboard-footer .footer-banner')).toBeVisible();
  await expect(page.getByText('Demo preview')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browse by Location' })).toBeVisible();
  if (process.env.CAPTURE_PREVIEW) {
    await page.locator('img').evaluateAll(async (images) => {
      await Promise.all(
        images.map(async (image) => {
          if (!(image instanceof HTMLImageElement)) return;
          image.loading = 'eager';
          await image.decode();
        }),
      );
    });
    await page.screenshot({ path: test.info().outputPath('home.png'), fullPage: true });
  }
  const search = page.getByRole('textbox', { name: 'Search food, stalls or locations' });
  await search.fill('siomai');
  await expect(page.getByRole('heading', { name: 'Search Results for “siomai”' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Pork Siomai (4 pcs)', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add Pork Siomai (4 pcs) to cart' }).click();
  await page.getByRole('link', { name: 'Cart with 1 items', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Order' })).toBeVisible();
  await expect(page.getByText('₱55', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Choose pickup time' }).click();
  await expect(page.getByRole('link', { name: 'Sign in to reserve' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reserve order', exact: true })).toHaveCount(0);
});
test('location previews and mobile overflow stay usable', async ({ page }) => {
  await page.goto('/student/location/00000000-0000-4000-8000-000000000001', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'Fresh finds in UY Building' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View menu', exact: true })).toHaveCount(3);
  await expect(page.locator('body')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
test('auth rejects invalid input before contacting authentication', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address', { exact: true }).fill('student@example.com');
  await page.getByLabel('Password', { exact: true }).fill('abc');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByText('Use at least 8 characters')).toBeVisible();
});
test('manifest contains installable icons and private navigation is not cached', async ({
  page,
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBeTruthy();
  await page.goto('/student/home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(() => Boolean(localStorage.getItem('cpugrab-public-catalog')));
  await page.goto('/student/orders', { waitUntil: 'domcontentloaded' });
  const cached = await page.evaluate(async () => {
    const results = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        results.push(new URL(request.url).pathname);
    return results;
  });
  expect(cached).not.toContain('/student/orders');
  expect(cached).toContain('/offline.html');
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'A little pause in your day.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Uy Canteen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reserve order', exact: true })).toHaveCount(0);
});
