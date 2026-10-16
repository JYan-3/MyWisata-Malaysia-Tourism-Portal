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
  for (const namespace of ['admin', 'common', 'customer']) translations[namespace] = JSON.parse(await fs.readFile(path.join(repo, `app/i18n/locales/en/${namespace}.json`), 'utf8'));
  const entry = path.join(temporary, 'entry.tsx');
  await fs.writeFile(entry, `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {KycReviewDetail} from ${JSON.stringify(path.join(repo,'components/admin/kyc-review-detail.tsx'))};
import {KycPhotoPreview} from ${JSON.stringify(path.join(repo,'components/customer/kyc-photo-preview.tsx'))};
import {ActionFeedbackProvider} from ${JSON.stringify(path.join(repo,'components/providers/action-feedback.tsx'))};
function Photos(){const [file,setFile]=useState(null);return <><input aria-label="Photo" type="file" onChange={e=>setFile(e.target.files[0]??null)}/><button onClick={()=>setFile(null)}>Clear photo</button><KycPhotoPreview file={file} label="front"/></>}
createRoot(document.getElementById('root')).render(window.location.pathname==='/photos'?<Photos/>:<ActionFeedbackProvider><KycReviewDetail submissionId="22222222-2222-4222-8222-222222222222"/></ActionFeedbackProvider>);`);

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
  const context=await browser.newContext();
  await context.addInitScript(() => {
    window.__created=[]; window.__revoked=[];
    const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{const value=create(blob);window.__created.push(value);return value;};
    URL.revokeObjectURL=(url)=>{window.__revoked.push(url);revoke(url);};
  });
  const page = await context.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const {default:sharp}=await import('sharp');
  const image=await sharp({create:{width:32,height:24,channels:3,background:'#fff'}}).png().toBuffer();
  await page.goto(`${origin}/photos`);
  await page.getByLabel('Photo',{exact:true}).setInputFiles({name:'synthetic-one.png',mimeType:'image/png',buffer:image});
  await page.getByRole('img').waitFor();
  assert.equal(await page.evaluate(()=>window.__created.length),1);
  await page.getByLabel('Photo',{exact:true}).setInputFiles({name:'synthetic-two.png',mimeType:'image/png',buffer:image});
  await page.waitForFunction(()=>window.__revoked.length===1&&window.__created.length===2);
  await page.getByRole('button',{name:'Clear photo'}).click();
  await page.waitForFunction(()=>window.__revoked.length===2);
  assert.equal(await page.getByRole('img').count(),0);

  const submissionId='22222222-2222-4222-8222-222222222222';
  const fixture={customer:{id:'11111111-1111-4111-8111-111111111111',name:'Synthetic Reviewer Test',email:'synthetic@example.test'},submission:{id:submissionId,status:'pending',docType:'national_id',submittedAt:'2026-10-16T00:00:00Z',documents:[{side:'front'},{side:'back'}],ocr:null,legalIdentity:{fullName:'Synthetic Reviewer Test',email:'synthetic@example.test',phone:null},precheck:null},assignment:{canDecide:true,isAssignedToCurrentUser:true,reviewVersion:1},reviewEvents:[]};
  let evidenceReads=0, deny=false, slow=false, pdf=false, workDeny=false, mfa=true;
  await page.route('**/api/admin/kyc/**', async route=>{
    const url=route.request().url();
    if(url.endsWith('/work'))return route.fulfill({status:workDeny?403:200,contentType:'application/json',body:JSON.stringify(workDeny?{error:{code:mfa?'KYC_MFA_REQUIRED':'FORBIDDEN'}}:{data:{sessionId:'synthetic-session'}})});
    if(url.includes('/documents/')){
      evidenceReads++;
      if(deny)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'KYC_MFA_REQUIRED'}})});
      if(pdf)return route.fulfill({contentType:'application/pdf',body:'%PDF-1.4 synthetic only'});
      if(slow&&url.endsWith('/front'))await new Promise(resolve=>setTimeout(resolve,150));
      return route.fulfill({contentType:'image/png',body:image}).catch(()=>{});
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({data:fixture})});
  });
  await page.goto(`${origin}/detail`);
  const front=page.getByRole('button',{name:/front/i}), back=page.getByRole('button',{name:/^Open Back$/i});
  await front.waitFor(); assert.equal(evidenceReads,0);
  await front.click(); await page.getByRole('img').waitFor();
  const first=await page.getByRole('img').getAttribute('src');
  assert.ok(first.startsWith('blob:'));
  await back.click(); await page.waitForFunction(url=>window.__revoked.includes(url),first);
  await page.getByRole('button',{name:'Close document preview'}).click();
  assert.equal(await page.getByRole('img').count(),0);
  slow=true; await front.click(); await back.click();
  await page.getByRole('img',{name:/back/i}).waitFor();
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('img',{name:/front/i}).count(),0);
  pdf=true; await front.click();
  const pdfLink=page.getByRole('link',{name:'Open PDF in browser'});
  await pdfLink.waitFor();
  assert.equal(await pdfLink.getAttribute('href'),`/api/admin/kyc/documents/${submissionId}/front`);
  assert.equal(await pdfLink.getAttribute('rel'),'noopener noreferrer');
  assert.equal(await page.getByRole('img').count(),0);
  pdf=false;
  deny=true; await front.click();
  await page.waitForFunction(()=>window.__navigations.some(url=>url.includes('/admin/kyc/mfa')));
  assert.equal(await page.getByRole('img').count(),0);
  assert.equal(await page.evaluate(()=>window.__created.every(url=>window.__revoked.includes(url))),true);
  deny=false; slow=false;
  for(const action of ['start-mfa','start-forbidden','pause-mfa','auto-pause-mfa']){
    workDeny=false; mfa=action!=='start-forbidden';
    await page.goto(`${origin}/detail`); await front.waitFor();
    if(action.includes('pause'))await page.getByRole('button',{name:translations.admin.kyc.operations.start,exact:true}).click();
    await front.click(); await page.getByRole('img').waitFor(); workDeny=true;
    if(action==='auto-pause-mfa')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    else await page.getByRole('button',{name:action.includes('pause')?translations.admin.kyc.operations.pause:translations.admin.kyc.operations.start,exact:true}).click();
    await page.waitForFunction(()=>window.__navigations.length>0);
    assert.equal(await page.getByRole('img').count(),0);
    assert.equal(await page.evaluate(()=>window.__created.every(url=>window.__revoked.includes(url))),true);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS local photo replacement/removal, explicit inline evidence, stale response fencing, MFA/work permission cleanup, legacy PDF access; synthetic APIs only');
} finally {
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  await fs.rm(temporary,{recursive:true,force:true});
}
