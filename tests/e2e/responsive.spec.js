import { expect, test } from '@playwright/test';

test('homepage has no horizontal overflow and keeps citizen navigation focused', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/UrbanFix/i);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  const reportNavLabel = page.viewportSize().width < 1024 ? 'Report' : 'Report Issue';
  await expect(page.getByRole('button', { name: reportNavLabel, exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Community cleanup', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Authority Portal|Admin/ }).click();
  await page.getByRole('button', { name: /Judge demo access/ }).click();
  await expect(page.getByPlaceholder('Admin username')).toHaveValue('admin');
  await expect(page.getByPlaceholder('Password')).toHaveValue('admin');
});

test('judge can inspect the tracking flow without guessing a case ID', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Track a Report' }).first().click();
  await expect(page.getByRole('heading', { name: 'Track a Report' })).toBeVisible();

  await page.getByRole('button', { name: 'See public report' }).click();
  await expect(page.getByText('Why this priority?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View accountability receipt' })).toBeVisible();
});
