/** Real component/pagination; synthetic loopback API, no private data or new packages. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { chromium } from '@playwright/test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(repo, 'package.json'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mywisata-recommendation-ui-'));
let server, browser, bundle;
try {
  const translations = {};
  for (const ns of ['customer', 'common']) translations[ns] = JSON.parse(await fs.readFile(path.join(repo, `app/i18n/locales/en/${ns}.json`), 'utf8'));
  const mocks = {
    '@/components/providers/auth': `const user={id:'synthetic-customer'};export const useAuth=()=>({currentUser:user});`,
    '@/components/providers/action-feedback': `export const useActionFeedback=()=>({showFeedback:()=>{}});`,
    '@/components/providers/app-dialog': `export const useAppDialog=()=>({confirm:async()=>true});`,
    '@/components/customer/use-customer-capability-gate': `export const useCustomerCapabilityGate=()=>()=>true;`,
    '@/components/customer/recommendation-earnings-panel': `export const RecommendationEarningsPanel=()=>null;`,
    '@/components/recommendations/google-place-picker': `export const GooglePlacePicker=()=>null;`,
    '@/lib/supabase/client': `export const createClient=()=>({from:()=>({select:()=>({eq:()=>({order:async()=>({data:[]})})})})});`,
    'next/link': `import React from 'react';export default props=>React.createElement('a',props,props.children);`,
    'react-i18next': `const all=${JSON.stringify(translations)}; const translators={}; for(const ns of Object.keys(all))translators[ns]=(key,values={})=>{const text=key.split('.').reduce((node,part)=>node?.[part],all[ns]);return (typeof text==='string'?text:key).replace(/{{([a-zA-Z0-9_]+)}}/g,(_,name)=>String(values[name]??''));};export const useTranslation=(ns='customer')=>({t:translators[ns],i18n:{resolvedLanguage:'en',language:'en'}});`,
  };
  bundle = await rolldown({ input: 'virtual:entry', platform: 'browser', onLog(level, log, fallback) { if (log.code !== 'MODULE_LEVEL_DIRECTIVE') fallback(level, log); }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': '"production"' } },
    plugins: [{ name: 'isolated-recommendation-boundaries',
      resolveId(source) {
        if (source === 'virtual:entry') return '\0entry';
        if (Object.hasOwn(mocks, source)) return `\0mock:${source}`;
        if (source.startsWith('@/')) {
          const base = path.join(repo, source.slice(2));
          return ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext).find(existsSync);
        }
        if (!source.startsWith('.') && !source.startsWith('\0') && !path.isAbsolute(source)) return require.resolve(source);
      },
      load(id) {
        if (id === '\0entry') return `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '@/app/customer/recommendations/page';createRoot(document.getElementById('root')).render(React.createElement(Page));`;
        if (id.startsWith('\0mock:')) return mocks[id.slice(6)];
      },
    }],
  });
  const result = await bundle.generate({ format: 'esm' });
  const script = result.output.find((entry) => entry.type === 'chunk').code;
  server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(script); }
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><div id="root"></div><script type="module" src="/bundle.js"></script>'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [], queries = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let fail = false;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { await route.abort(); return; }
    if (url.pathname === '/api/recommendations') {
      queries.push(Object.fromEntries(url.searchParams));
      if (fail) { await route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }); return; }
      const current = Number(url.searchParams.get('page'));
      const pending = url.searchParams.get('status') === 'pending';
      await route.fulfill({ json: { data: {
        items: [{ id: `synthetic-${current}`, vendor_name: current === 2 ? 'Second vendor' : 'First vendor', status: pending ? 'pending' : 'approved', categories: null, state: 'Penang', author: null }],
        total: pending ? 2 : 38, totalPages: pending ? 1 : 2, page: current, pageSize: 25,
      } } }); return;
    }
    await route.continue();
  });
  await page.goto(origin);
  await page.getByText('First vendor', { exact: true }).waitFor();
  await page.getByText('38 recommendations', { exact: true }).waitFor();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByText('Second vendor', { exact: true }).waitFor();
  await page.getByRole('combobox').selectOption('pending');
  await page.getByText('First vendor', { exact: true }).waitFor();
  await page.getByText('2 recommendations', { exact: true }).waitFor();
  assert.deepEqual(queries.at(-1), { page: '1', status: 'pending' });
  fail = true;
  await page.getByRole('combobox').selectOption('all');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('You have not recommended any vendors yet.', { exact: true }).count(), 0);
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('First vendor', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS real recommendation component: DB page query, 25 default, filtered total, page reset, retry/error state');
} finally {
  await browser?.close(); await bundle?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
