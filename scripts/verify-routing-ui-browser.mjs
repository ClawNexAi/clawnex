/** Real React routing UI + fake HTTP boundary; no application server or agent process. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const browserModule = process.env.CLAWNEX_PLAYWRIGHT_MODULE || require.resolve('playwright');
const { chromium } = await import(pathToFileURL(browserModule).href);
const scenario = process.argv[2] || 'unavailable';
assert(['unavailable','unavailable-with-rows','read-only','route-change','identity-change','refresh-error','stable-refresh','workflow','prerequisites','restore-conflict'].includes(scenario));
const connector = process.argv[3] || 'openclaw';
assert(['openclaw','hermes'].includes(connector));
const title = connector === 'openclaw' ? 'OpenClaw' : 'Hermes';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-routing-component-'));
const bundled = await build({
  absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  stdin: {resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {RoutingWorkflowPanel} from './src/components/dashboard/panels/RoutingWorkflowPanel';
    const summary = connector => ({connector, sourceId:'default', status:'missing', detail:'Fixture configuration absent', items:[], drift:{new:0,removed:0,changed:0,total:0}, selected:0, pendingChanges:0, scannedAt:'2026-10-05T00:00:00Z'});
    const data = {litellmTarget:'http://127.0.0.1:19999/v1',openclaw:{...summary('openclaw'),status:'error',detail:'Configuration could not be read; no route has been confirmed.'},hermes:summary('hermes'),opencode:summary('opencode'),pi:summary('pi'),codex:summary('codex'),claude:summary('claude'),availableModels:[],sessionLaunchers:[],modelReadiness:{},driftTotal:0,scannedAt:'2026-10-05T00:00:00Z',reconciliation:{events:[],lastSnapshotIds:{}}};
    const scenario=${JSON.stringify(scenario)};
    const connector=${JSON.stringify(connector)};
    const item={id:'fixture-model-row',connector,sourceId:'default',itemType:'model',providerId:'fixture',modelId:'fixture-model',displayName:'Fixture provider',baseUrl:'http://127.0.0.1:19999/v1',capability:'provider-routing',currentRoute:'routed',desiredRoute:'routed',present:true,fingerprint:'same-file-fingerprint',metadata:{identityHash:'fixture-owned-hash',identityIntact:true},firstSeenAt:'2026-10-05T00:00:00Z',lastSeenAt:'2026-10-05T00:00:00Z',lastChangedAt:null,updatedAt:'2026-10-05T00:00:00Z'};
    data.openclaw=summary('openclaw');
    data[connector]={...summary(connector),status:'ok',items:[item]};
    if(scenario.startsWith('unavailable'))data[connector]={...summary(connector),status:'error',detail:'Configuration could not be read; no route has been confirmed.',items:scenario==='unavailable-with-rows'?[item]:[]};
    if(scenario==='read-only')data[connector]={...summary(connector),status:'read-only',detail:'Remote configuration is read-only.',items:[item]};
    if(['workflow','prerequisites'].includes(scenario))data[connector].items=[{...item,currentRoute:'direct'}];
    let verified=false,operation='apply';
    window.__fixtureTraffic=false;
    window.__requests=[];
    window.fetch=async (url,init) => {
      const method=init?.method || 'GET'; const body=init?.body?JSON.parse(init.body):null;
      window.__requests.push({url:String(url),method,body});
      if(String(url)==='/api/connector-routing' && method==='GET'){
        if(scenario==='refresh-error' && verified)return Response.json({error:'Fixture routing inventory is temporarily unavailable.'},{status:503});
        if(scenario==='route-change' && verified)data[connector].items=[{...item,currentRoute:'direct'}];
        if(scenario==='identity-change' && verified)data[connector].items=[{...item,metadata:{identityHash:null,identityIntact:null}}];
        return Response.json(data);
      }
      if(String(url)==='/api/connector-routing' && method==='POST' && body.action==='prepare'){
        operation=body.operation;
        return Response.json({ok:true,plan:{id:'fixture-reviewed-plan',connector,sourceId:'default',operation,fingerprint:'fixture-plan',files:{},providers:['fixture'],models:['fixture-model'],exclusions:0,legacyPaths:[],prerequisites:scenario==='prerequisites'?['Test fixture-model in Model Providers first.']:[],restartRequired:true,expiresAt:'2099-01-01T00:00:00Z'}});
      }
      if(String(url)==='/api/connector-routing' && method==='POST' && body.action==='execute-plan'){
        if(scenario==='restore-conflict')return Response.json({ok:false,result:{detail:'Restoration incomplete: edited endpoint preserved; recovery ownership retained.'}},{status:409});
        const currentRoute=operation==='restore'?'direct':'routed';
        data[connector].items=[{...item,currentRoute,desiredRoute:currentRoute,fingerprint:currentRoute+'-configuration'}];
        return Response.json({ok:true,result:{detail:'Fixture connection '+(operation==='restore'?'restored.':'applied.'),restartRequired:true}});
      }
      if(String(url)==='/api/connector-routing' && method==='POST' && body.action==='verify'){
        if(scenario==='workflow' && !window.__fixtureTraffic)return Response.json({ok:true,verification:{status:'pending',detail:'No fresh qualifying agent completion; proof remains pending.'}});
        verified=true;return Response.json({ok:true,verification:{status:'verified',detail:'Fresh qualifying fixture completion for this reviewed route.'}});
      }
      throw Error('Unexpected fixture request; no real network or mutations allowed');
    };
    createRoot(document.getElementById('root')).render(<RoutingWorkflowPanel focusedCard={connector+'Routing'} />);
  `},
});
const html = '<!doctype html><html><meta charset="utf-8"><title>Routing component contract</title><body style="margin:16px;background:#080e18;color:#e5eaf3;font-family:system-ui"><div id="root"></div><script>' + bundled.outputFiles[0].text.replaceAll('</script','<\\/script') + '</script></body></html>';
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url()==='http://clawnex-ui.test/' ? route.fulfill({contentType:'text/html',body:html}) : route.abort());
  await page.goto('http://clawnex-ui.test/');
  await page.getByText(title.toUpperCase()+' ROUTING',{exact:true}).waitFor();
  assert.equal(await page.getByText((connector==='openclaw'?'HERMES':'OPENCLAW')+' ROUTING',{exact:true}).count(),0,'An absent peer must not render duplicate/phantom controls');
  await page.screenshot({path:path.join(output,scenario+'.png'),fullPage:true});
  if(scenario.startsWith('unavailable') || scenario==='read-only'){
    const text=await page.locator('body').innerText();
    assert(text.includes(scenario==='read-only'?'Read-only configuration':'Configuration unavailable'), 'An unavailable configuration must not claim a confirmed route');
    assert(!text.includes('Direct connection'), 'An unreadable configuration must not claim Direct connection');
    if(connector==='openclaw')assert(await page.getByRole('button',{name:'Restart OpenClaw instance',exact:true}).isDisabled());
    assert(await page.getByRole('button',{name:'Verify '+title+' connection',exact:true}).isDisabled());
    assert(await page.getByRole('button',{name:'Restore '+title+' direct connection',exact:true}).isDisabled());
    assert((await page.evaluate(()=>window.__requests)).every(request=>request.method==='GET'));
  }else if(['workflow','prerequisites','restore-conflict'].includes(scenario)){
    const reviewing=page.getByRole('button',{name:(scenario==='restore-conflict'?'Restore '+title+' direct connection':'Review '+title+' connection changes'),exact:true});
    await reviewing.focus();await reviewing.click();
    if(scenario==='prerequisites'){
      await page.getByText('Test fixture-model in Model Providers first.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('dialog').count(),0,'Missing readiness must not offer Apply');
      assert(!(await page.evaluate(()=>window.__requests)).some(r=>r.body?.action==='execute-plan'));
    }else{
      const dialog=page.getByRole('dialog');await dialog.waitFor();
      assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Cancel','Review begins on Cancel');
      for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),'Keyboard focus stays inside review');}
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),await reviewing.getAttribute('aria-label'),'Escape restores focus to the originating action');
      assert(!(await page.evaluate(()=>window.__requests)).some(r=>r.body?.action==='execute-plan'),'Cancel must not apply');
      await reviewing.click();await dialog.waitFor();
      await page.getByRole('button',{name:scenario==='restore-conflict'?'Restore eligible routes':'Apply approved changes',exact:true}).click();
      if(scenario==='restore-conflict'){
        await page.getByText('Restoration incomplete: edited endpoint preserved; recovery ownership retained.',{exact:true}).waitFor();
        assert.equal(await page.getByText('Direct connection',{exact:true}).count(),0,'A restore conflict must not be reported as direct');
      }else{
        await page.getByText('Configured · verification required',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Verify '+title+' connection',exact:true}).click();
        await page.getByText('No fresh qualifying agent completion; proof remains pending.',{exact:true}).waitFor();
        assert.equal(await page.getByText('Routed models verified',{exact:true}).count(),0);
        await page.evaluate(()=>window.__fixtureTraffic=true);
        await page.getByRole('button',{name:'Verify '+title+' connection',exact:true}).click();
        await page.getByText('Routed models verified',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Restore '+title+' direct connection',exact:true}).click();await dialog.waitFor();
        await page.getByRole('button',{name:'Restore eligible routes',exact:true}).click();
        await page.getByText('Direct connection',{exact:true}).waitFor();
        if(connector==='openclaw')assert(await page.getByRole('button',{name:'Restart OpenClaw instance',exact:true}).isEnabled(),'Restart remains available after restoring the final route');
      }
    }
  }else{
    await page.getByRole('button',{name:'Verify '+title+' connection',exact:true}).click();
    await page.getByText('Routed models verified',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Refresh '+title+' configuration',exact:true}).click();
    if(scenario==='route-change')await page.waitForFunction(label=>document.querySelector('button[aria-label="'+label+'"]')?.disabled===false,'Review '+title+' connection changes');
    else if(scenario==='refresh-error')await page.getByText('Fixture routing inventory is temporarily unavailable.',{exact:true}).waitFor();
    else await page.waitForFunction(()=>window.__requests.filter(r=>r.method==='GET').length>=2);
    await page.screenshot({path:path.join(output,scenario+'-after-refresh.png'),fullPage:true});
    assert.equal(await page.getByText('Routed models verified',{exact:true}).count(),scenario==='stable-refresh'?1:0,'Only an unchanged route may retain cached verified status');
    assert.equal(await page.getByText('Fresh qualifying fixture completion for this reviewed route.',{exact:true}).count(),scenario==='stable-refresh'?1:0,'The old proof must not describe a changed route');
    if(scenario==='refresh-error')assert(await page.getByRole('button',{name:'Retry reading configuration',exact:true}).isVisible());
  }
  for(const width of [1440,768,375]){
    await page.setViewportSize({width,height:1000});
    const controls=await page.locator('button:visible').evaluateAll(buttons=>buttons.map(b=>({label:b.getAttribute('aria-label')||b.textContent,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right})));
    for(const control of controls)assert(control.left>=0 && control.right<=width+1,'Routing control clipped at '+width+'px: '+control.label);
    await page.screenshot({path:path.join(output,scenario+'-'+connector+'-'+width+'.png'),fullPage:true});
  }
  const requests=await page.evaluate(()=>window.__requests);
  for(const request of requests.filter(r=>['prepare','verify'].includes(r.body?.action))){
    assert.equal(request.body.connector,connector,'Commands stay bound to the selected tool');
    assert.equal(request.body.sourceId,'default','Commands stay bound to the selected instance');
  }
  for(const request of requests.filter(r=>r.body?.action==='execute-plan')){
    assert.equal(request.body.planId,'fixture-reviewed-plan');
    assert.equal(request.body.approved,true,'Execution requires explicit review confirmation');
  }
  if(scenario!=='refresh-error'){
    const labels=['Review '+title+' connection changes','Refresh '+title+' configuration','Verify '+title+' connection','Restore '+title+' direct connection'];
    if(connector==='openclaw')labels.push('Restart OpenClaw instance');
    assert(await page.evaluate(labels=>{
      const controls=labels.map(label=>document.querySelector('button[aria-label="'+label+'"]'));
      return controls.every(control=>control && control.parentElement===controls[0].parentElement);
    },labels),'Peer commands share one wrapping command row');
  }
  assert.deepEqual(errors,[],'The component must render without browser errors');
  console.log('PASS '+connector+' '+scenario+'; 1440/768/375px, real rendered routing UI, no app server, no live network');
} finally {
  await browser.close(); console.log('Browser evidence: '+output);
}
