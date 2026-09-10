// Run against the local Vite server configured with the fictitious Supabase URL.
// All non-local traffic is mocked or blocked; no production login is used.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1050 } });
  let pending = false;
  const id = '00000000-0000-0000-0000-000000000004';
  const user = { id, aud: 'authenticated', role: 'authenticated', email: 'colaborador@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const payload = Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated' })).toString('base64url');
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`, refresh_token: 'test-only', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user };
  await context.addInitScript((value) => localStorage.setItem('sb-example-auth-token', JSON.stringify(value)), session);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== 'example.supabase.co') return route.abort();
    let data = [];
    if (url.pathname === '/auth/v1/user') data = user;
    if (url.pathname.endsWith('/profiles')) {
      const profile = { id, active_organization_id: null, theme_preference: 'dark' };
      data = route.request().headers().accept?.includes('vnd.pgrst.object') ? profile : [profile];
    }
    if (url.pathname.endsWith('/search_joinable_organizations')) data = [{ id: 'agency-a', name: 'Femo Agência', slug: 'femo', request_status: pending ? 'pending' : null }];
    if (url.pathname.endsWith('/my_organization_join_requests')) data = pending ? [{ id: 'request-a', organization_id: 'agency-a', organization_name: 'Femo Agência', status: 'pending', created_at: new Date().toISOString() }] : [];
    if (url.pathname.endsWith('/request_organization_access')) { pending = true; data = 'request-a'; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5189/organizations/select', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mkdir('output/organization-access', { recursive: true });
  try {
    await page.getByRole('button', { name: 'Solicitar acesso', exact: true }).waitFor({ timeout: 15000 });
  } catch (error) {
    await page.screenshot({ path: 'output/organization-access/debug.png', fullPage: true });
    console.error(`URL: ${page.url()}\n${await page.locator('body').innerText()}\nPage errors: ${errors.join(' | ')}`);
    throw error;
  }
  await page.screenshot({ path: 'output/organization-access/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Solicitar acesso', exact: true }).click();
  await page.getByText('Esperando autorização da equipe', { exact: true }).waitFor();
  if (!page.url().endsWith('/organizations/select')) throw new Error('Pedido não deve abrir o dashboard');
  await page.screenshot({ path: 'output/organization-access/waiting.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/organization-access/mobile.png', fullPage: true });
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflows) throw new Error('Layout excede a largura do celular');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Visual checks passed: desktop, request waiting screen, mobile, no horizontal overflow or page errors.');
} finally { await browser.close(); }
