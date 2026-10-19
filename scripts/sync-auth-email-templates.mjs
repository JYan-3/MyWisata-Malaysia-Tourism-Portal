#!/usr/bin/env node
/** Hosted Auth configuration is separate from a Next.js deploy. Read-only by default. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function syncAuthEmailTemplates({token,projectRef,write=false,backupDirectory,fetcher=fetch}) {
  if(!token) throw new Error('supabase_management_token_required');
  if(!/^[a-z0-9]{20}$/.test(projectRef??'')) throw new Error('supabase_project_ref_invalid');
  if(write && process.env.AUTH_EMAIL_TEMPLATE_WRITE!=='1') throw new Error('auth_email_template_write_not_authorized');
  const root=new URL('../supabase/templates/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const desired={};
  for(const [key,value] of Object.entries(manifest)) desired[key]=key.startsWith('mailer_templates_')?await readFile(new URL(value,root),'utf8'):value;
  const url=`https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
  const request=async(method,body)=>{
    const response=await fetcher(url,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw new Error('auth_email_configuration_unavailable');
    return response.json();
  };
  const current=await request('GET');
  const supported=Object.keys(desired).filter(key=>Object.hasOwn(current,key));
  if(!supported.length)throw new Error('auth_email_configuration_fields_unavailable');
  const changed=supported.filter(key=>desired[key]!==current[key]);
  if(!write || !changed.length)return{changed,verified:changed.length===0,unsupported:Object.keys(desired).filter(key=>!supported.includes(key))};
  // Do not replace an existing custom confirmation/redirect flow without inspecting it.
  if(changed.some(key=>key.startsWith('mailer_templates_') && /\.TokenHash|\/auth\/confirm|\.RedirectTo/.test(current[key]??''))) {
    throw new Error('auth_email_custom_link_review_required');
  }
  if(!backupDirectory)throw new Error('auth_email_template_backup_required');
  await mkdir(backupDirectory,{recursive:true,mode:0o700});
  const backup=path.join(backupDirectory,`auth-email-templates-${Date.now()}.json`);
  await writeFile(backup,JSON.stringify(Object.fromEntries(supported.map(key=>[key,current[key]])),null,2)+'\n',{mode:0o600,flag:'wx'});
  const patch=Object.fromEntries(changed.map(key=>[key,desired[key]]));
  await request('PATCH',patch);
  const actual=await request('GET');
  if(changed.some(key=>actual[key]!==desired[key]))throw new Error('auth_email_template_verification_failed');
  return{changed,verified:true,backup,unsupported:Object.keys(desired).filter(key=>!supported.includes(key))};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await syncAuthEmailTemplates({token:process.env.SUPABASE_ACCESS_TOKEN,projectRef:process.env.SUPABASE_PROJECT_REF??'ncdlaehknicabzjqskvk',write:process.argv.includes('--write'),backupDirectory:process.env.AUTH_EMAIL_TEMPLATE_BACKUP});
    console.log(JSON.stringify(result,null,2));
  } catch(error) { console.error(error instanceof Error?error.message:'auth_email_template_sync_failed');process.exitCode=1; }
}
