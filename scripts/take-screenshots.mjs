import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(__dirname, '..', 'docs', 'screenshots');

const BASE = 'http://localhost:32354';

async function main() {
  const browser = await chromium.launch();

  // --- Login page ---
  console.log('1/5 Login page...');
  const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const loginPage = await loginCtx.newPage();
  await loginPage.goto(BASE, { waitUntil: 'networkidle' });
  await loginPage.waitForTimeout(1000);
  await loginPage.screenshot({ path: path.join(screenshotDir, 'login.png') });
  await loginCtx.close();
  console.log('  ✓ login.png');

  // --- Authenticated pages ---
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Login
  const usernameInput = page.locator('input[type="text"], input[placeholder*="sername"], input[placeholder*="Username"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  if (await usernameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await usernameInput.fill('admin');
    await passwordInput.fill('YOUR_PASSWORD');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2000);
  }

  // --- Main page ---
  console.log('2/5 Main page...');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(screenshotDir, 'main.png') });
  console.log('  ✓ main.png');

  // --- Files tab ---
  console.log('3/5 Files page...');
  const filesTab = page.locator('button', { hasText: /Files/i }).first();
  if (await filesTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await filesTab.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: path.join(screenshotDir, 'files.png') });
  console.log('  ✓ files.png');

  // --- Admin panel ---
  console.log('4/5 Admin panel...');
  // Click the shield icon in header
  const shieldBtn = page.locator('button[title*="dmin"], header button svg.lucide-shield, header button:has(svg)').first();
  // Try to find admin button more broadly
  const adminBtns = page.locator('header button');
  const count = await adminBtns.count();
  for (let i = 0; i < count; i++) {
    const btn = adminBtns.nth(i);
    const html = await btn.innerHTML().catch(() => '');
    if (html.includes('shield') || html.includes('Shield')) {
      await btn.click();
      await page.waitForTimeout(1000);
      break;
    }
  }
  await page.screenshot({ path: path.join(screenshotDir, 'admin.png') });
  console.log('  ✓ admin.png');

  // Close admin modal if open
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // --- Mobile ---
  console.log('5/5 Mobile page...');
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const mobilePage = await mobileCtx.newPage();

  // Set auth token from desktop session
  const cookies = await ctx.cookies();
  const localStorage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      items[key] = window.localStorage.getItem(key);
    }
    return items;
  });

  await mobileCtx.addCookies(cookies.map(c => ({ ...c, sameSite: 'Lax' })));
  await mobilePage.goto(BASE, { waitUntil: 'networkidle' });

  // Try to set localStorage and reload
  for (const [key, value] of Object.entries(localStorage)) {
    await mobilePage.evaluate(([k, v]) => window.localStorage.setItem(k, v), [key, value]);
  }
  await mobilePage.reload({ waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1500);

  // If we see login, re-login
  const mobileUsernameInput = mobilePage.locator('input[type="text"], input[placeholder*="Username"]').first();
  if (await mobileUsernameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await mobileUsernameInput.fill('admin');
    await mobilePage.locator('input[type="password"]').first().fill('YOUR_PASSWORD');
    await mobilePage.locator('button[type="submit"]').click();
    await mobilePage.waitForTimeout(2000);
  }

  await mobilePage.screenshot({ path: path.join(screenshotDir, 'mobile.png') });
  console.log('  ✓ mobile.png');

  await mobileCtx.close();
  await ctx.close();
  await browser.close();

  console.log('\nAll screenshots saved to docs/screenshots/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
