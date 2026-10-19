/** Isolated real-component browser acceptance; synthetic APIs, no Supabase or live users. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = path.resolve(process.env.KYC_UI_TEST_RUNTIME ?? process.argv[2] ?? '/tmp/mywisata-kyc-ui-runtime');
const { build } = await import(pathToFileURL(path.join(runtime, 'node_modules/esbuild/lib/main.js')).href);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mywisata-kyc-ui-'));
let server;
let browser;
try {
  const translations = {};
  for (const namespace of ['admin', 'common']) translations[namespace] = JSON.parse(await fs.readFile(path.join(repo, `app/i18n/locales/en/${namespace}.json`), 'utf8'));
  const entry = path.join(temporary, 'entry.tsx');
  await fs.writeFile(entry, `import React from 'react'; import {createRoot} from 'react-dom/client'; import Page from ${JSON.stringify(path.join(repo, 'app/admin/kyc/page.tsx'))}; createRoot(document.getElementById('root')!).render(<Page/>);`);
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
    nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'isolated-kyc-boundaries', setup(build) {
      build.onResolve({ filter: /^next\/(navigation|link)$|^react-i18next$/ }, (args) => ({ path: args.path, namespace: 'boundary' }));
      build.onLoad({ filter: /.*/, namespace: 'boundary' }, (args) => {
        if (args.path === 'next/navigation') return { contents: `const router={push:(url)=>window.__navigations.push(url),replace:(url)=>window.__navigations.push(url)}; export const useRouter=()=>router;` };
        if (args.path === 'next/link') return { contents: `import React from 'react'; export default function Link(props){return React.createElement('a',props,props.children)}`, resolveDir: repo };
        return { contents: `const all=${JSON.stringify(translations)};const translators={};for(const ns of Object.keys(all)){translators[ns]=(key,values={})=>{let text=key.split('.').reduce((node,part)=>node?.[part],all[ns]);if(typeof text!=='string')text=key;return text.replace(/{{(\\w+)}}/g,(_,name)=>String(values[name]??''));}}export const useTranslation=(ns='admin')=>({t:translators[ns],i18n:{resolvedLanguage:'en'}});` };
      });
      build.onResolve({ filter: /^@\// }, (args) => {
        const base = path.join(repo, args.path.slice(2));
        const found = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext).find(existsSync);
        if (!found) throw new Error(`Unresolved source ${args.path}`);
        return { path: found };
      });
    } }],
  });
  const script = result.outputFiles[0].contents;
  server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(script); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><div id="root"></div><script>window.__navigations=[]</script><script type="module" src="/bundle.js"></script>'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const queries = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let failQueue = false;
  const userId = '11111111-1111-4111-8111-111111111111';
  const submissionId = '22222222-2222-4222-8222-222222222222';
  await page.route(`${origin}/api/**`, async (route) => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname.endsWith('/submissions')) {
      queries.push(Object.fromEntries(url.searchParams));
      if (failQueue) { await route.fulfill({status:503,json:{error:{code:'KYC_QUEUE_UNAVAILABLE'}}}); return; }
      const pageSize = Number(url.searchParams.get('pageSize'));
      const requested = Number(url.searchParams.get('page'));
      const total = url.searchParams.get('search') ? 2 : 10000;
      const pageNo = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
      data = { submissions: [{ id:submissionId,userId,docType:'national_id',status:'pending',submittedAt:'2026-10-16T00:00:00Z',queuePosition:1,ocr:null,documents:[] }],
        customers:[{id:userId,name:'Synthetic Aina',email:'synthetic@example.test',verificationTier:'profile_complete'}],total,page:pageNo,pageSize,totalPages:Math.ceil(total/pageSize),counts:{pending:10000,infoRequested:7},verifiedCount:5,oldestPendingAt:'2026-10-16T00:00:00Z' };
    } else if (url.pathname.endsWith('/security-status')) data={emailRecipients:1,latestRun:null,monitor:{lastCheckedAt:null},pendingAlerts:0,incidents:[]};
    else if (url.pathname.endsWith('/operations')) data={submittedToday:10000,decidedToday:0,assigned:0,waitingP95Seconds:60,privateOcrConfigured:false,sessions:{recorded:0,closed:0,incomplete:0,recordedSeconds:0,firstReviewMeanSeconds:null,reReviewMeanSeconds:null},precheck:{queued:0,processing:0,failed:0,completedToday:0}};
    else if (url.pathname.endsWith('/work')) data={submissionId};
    else throw new Error(`Unexpected synthetic request ${url.pathname}`);
    await route.fulfill({json:{data,error:null}});
  });
  const { expect } = await import('@playwright/test');
  await page.goto(origin);
  await expect(page.getByText('Synthetic Aina', { exact:true })).toBeVisible();
  assert.equal(queries.at(-1).pageSize, '10');
  await expect(page.getByText('1–10 of 10000 matching cases', { exact:false })).toBeVisible();
  const next = page.getByRole('button',{name:translations.admin.ui.pagination.nextPage,exact:true});
  await next.click();
  await expect.poll(()=>queries.at(-1).page).toBe('2');
  await expect(page.getByText('11–20 of 10000 matching cases',{exact:false})).toBeVisible();
  await page.getByLabel('Rows per page',{exact:true}).selectOption('25');
  await expect.poll(()=>queries.at(-1).pageSize).toBe('25'); assert.equal(queries.at(-1).page,'1');
  await expect(page.getByText('1–25 of 10000 matching cases',{exact:false})).toBeVisible();
  await next.click(); await expect.poll(()=>queries.at(-1).page).toBe('2');
  await page.getByLabel(translations.admin.kyc.filters.status,{exact:true}).selectOption('pending');
  await expect.poll(()=>queries.at(-1).status).toBe('pending'); assert.equal(queries.at(-1).page,'1');
  await expect(page.getByText('Synthetic Aina',{exact:true})).toBeVisible();
  await next.click(); await expect.poll(()=>queries.at(-1).page).toBe('2');
  await page.getByLabel('Assignment',{exact:true}).selectOption('mine');
  await expect.poll(()=>queries.at(-1).assignment).toBe('mine'); assert.equal(queries.at(-1).page,'1');
  await expect(page.getByText('Synthetic Aina',{exact:true})).toBeVisible();
  await next.click(); await expect.poll(()=>queries.at(-1).page).toBe('2');
  await page.getByLabel(translations.admin.kyc.filters.search,{exact:true}).fill('Aina');
  await expect.poll(()=>queries.at(-1).search).toBe('Aina'); assert.equal(queries.at(-1).page,'1');
  await expect(page.getByText('1–2 of 2 matching cases',{exact:false})).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByRole('button',{name:'Next case',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__navigations.at(-1))).toBe(`/admin/kyc/${submissionId}`);
  failQueue=true;
  await page.getByRole('button',{name:'Refresh queue',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:translations.admin.kyc.errors.loadQueue})).toBeVisible();
  await expect(page.getByText(translations.admin.kyc.empty.title,{exact:true})).toHaveCount(0);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS real KYC queue component: default 10, page navigation/range, 25-row size, filter/search/size reset, filtered count, next-case routing, error remains unavailable (synthetic APIs, no live auth/database).');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve)=>server.close(resolve));
  await fs.rm(temporary,{recursive:true,force:true});
}
