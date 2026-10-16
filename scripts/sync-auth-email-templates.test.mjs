import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncAuthEmailTemplates } from './sync-auth-email-templates.mjs';

test('Auth template comparison is read-only and never outputs or backs up SMTP secrets', async () => {
  const calls=[];
  const result=await syncAuthEmailTemplates({ token:'test-only',projectRef:'ncdlaehknicabzjqskvk',fetcher:async(url,options)=>{calls.push(options.method);return new Response(JSON.stringify({mailer_templates_confirmation_content:'old',mailer_subjects_confirmation:'old',smtp_pass:'private-secret',mailer_notifications_password_changed_enabled:false}));} });
  assert.deepEqual(calls,['GET']);
  assert.equal(result.changed.length,2);
  assert.equal(JSON.stringify(result).includes('private-secret'),false);
});
test('writing needs explicit opt-in, preserves settings and verifies exactly the changed fields', async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mywisata-auth-templates-'));
  let current={mailer_templates_confirmation_content:'{{ .ConfirmationURL }}',mailer_subjects_confirmation:'old',smtp_pass:'secret',mailer_notifications_password_changed_enabled:false};
  const fetcher=async(url,options)=>{ if(options.method==='PATCH'){const patch=JSON.parse(options.body);assert.ok(Object.keys(patch).every(key=>key.startsWith('mailer_templates_')||key.startsWith('mailer_subjects_')));current={...current,...patch};}return new Response(JSON.stringify(current));};
  try {
    delete process.env.AUTH_EMAIL_TEMPLATE_WRITE;
    await assert.rejects(syncAuthEmailTemplates({token:'test-only',projectRef:'ncdlaehknicabzjqskvk',write:true,backupDirectory:directory,fetcher}),/write_not_authorized/);
    process.env.AUTH_EMAIL_TEMPLATE_WRITE='1';
    const result=await syncAuthEmailTemplates({token:'test-only',projectRef:'ncdlaehknicabzjqskvk',write:true,backupDirectory:directory,fetcher});
    assert.equal(result.verified,true);
    assert.equal(current.smtp_pass,'secret');
    assert.equal(current.mailer_notifications_password_changed_enabled,false);
    const backup=await readFile(result.backup,'utf8');assert.equal(backup.includes('smtp_pass'),false);
    assert.equal(backup.includes('secret'),false);
  } finally { delete process.env.AUTH_EMAIL_TEMPLATE_WRITE;await rm(directory,{recursive:true,force:true}); }
});
