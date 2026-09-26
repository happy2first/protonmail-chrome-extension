import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectCookies,sessionState,refreshAvailable,bundleFor} from '../extension/core.js';
import {readProton,readKeySalts,mcpRequest} from '../extension/bridge.js';

const cookie = (name='AUTH-one',extra={}) => ({
  name,
  value:'test-only',
  domain:'mail.proton.me',
  hostOnly:true,
  path:'/api/',
  secure:true,
  httpOnly:true,
  sameSite:'lax',
  session:true,
  ...extra
});

test('select one account and require AUTH, REFRESH and Session-Id',()=>{
  const rows=selectCookies([
    cookie(),
    cookie('REFRESH-one',{path:'/api/auth/refresh'}),
    cookie('Session-Id',{domain:'.proton.me',hostOnly:false,path:'/'}),
    cookie('AUTH-two'),
    cookie('REFRESH-two',{path:'/api/auth/refresh'}),
    cookie('st',{domain:'.proton.me',hostOnly:false,path:'/'}),
    cookie('other',{domain:'.example.com'})
  ],'one');
  assert.deepEqual(rows.map(c=>c.name),['AUTH-one','REFRESH-one','Session-Id','st']);
  const state=sessionState(rows,'one');
  assert.deepEqual(state,{auth:true,refresh:true,sessionId:true,ready:true});
  assert.equal(refreshAvailable(rows,'one'),true);
  assert.equal(rows.find(c=>c.name==='REFRESH-one')?.path,'/api/auth/refresh');
  assert.equal(rows.find(c=>c.name==='Session-Id')?.hostOnly,false);
});

test('selection rejects missing refresh/session, partitioned and expired cookies',()=>{
  const base=[cookie(),cookie('REFRESH-one',{path:'/api/auth/refresh'}),cookie('Session-Id',{domain:'.proton.me',hostOnly:false,path:'/'})];
  assert.throws(()=>selectCookies(base.filter(c=>!c.name.startsWith('REFRESH-')),'one'),/REFRESH/);
  assert.throws(()=>selectCookies(base.filter(c=>c.name!=='Session-Id'),'one'),/Session-Id/);
  assert.throws(()=>selectCookies([cookie('AUTH-one',{partitionKey:{topLevelSite:'https://proton.me'}}),...base.slice(1)],'one'));
  assert.throws(()=>selectCookies([cookie('AUTH-one',{expirationDate:1}),...base.slice(1)],'one',2000));
});

test('bundle v2 requires matching usable KeySalt and structured cookies',()=>{
  const cookies=selectCookies([
    cookie(),
    cookie('REFRESH-one',{path:'/api/auth/refresh'}),
    cookie('Session-Id',{domain:'.proton.me',hostOnly:false,path:'/'})
  ],'one');
  const result={
    ok:true,
    email:'example@proton.me',
    user:{id:'user',keyIds:['k'],passwordMode:1},
    addresses:[{id:'a',email:'example@proton.me'}],
    keySalts:[{id:'k',keySalt:'fixture-salt'}],
    client:{mailAppVersion:'web-mail@test',accountAppVersion:'web-account@test',locale:'en_US'}
  };
  const bundle=bundleFor('one',cookies,result);
  assert.equal(bundle.version,2);
  assert.equal(bundle.source,'proton-browser-session');
  assert.equal(bundle.session.cookies.length,3);
  assert.equal(bundle.user.id,'user');
  assert.throws(()=>bundleFor('one',cookies,{...result,keySalts:[{id:'wrong',keySalt:'fixture'}]}));
});

test('mail bridge reads users/addresses only and never returns private keys',async()=>{
  globalThis.location={origin:'https://mail.proton.me'};
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
    calls.push({url,opts});
    return {
      ok:true,
      json:async()=>({Code:1000,...(
        url.endsWith('/users')
          ? {User:{ID:'u',Email:'test@proton.me',PasswordMode:1,Keys:[{ID:'k',PrivateKey:'MUST_NOT_EXPORT'}]}}
          : {Addresses:[{ID:'a',Email:'test@proton.me',Keys:['MUST_NOT_EXPORT']}]}
      )})
    };
  };
  const result=await readProton('one');
  assert.equal(result.ok,true);
  assert.equal(calls.length,2);
  assert.equal(JSON.stringify(result).includes('MUST_NOT_EXPORT'),false);
  for(const c of calls){
    assert.equal(c.opts.redirect,'error');
    assert.equal(c.opts.credentials,'same-origin');
    assert.equal(c.opts.headers['x-pm-uid'],'one');
  }
});

test('account bridge replays keys/salts with account app headers',async()=>{
  globalThis.location={origin:'https://account.proton.me'};
  let call;
  globalThis.fetch=async(url,opts)=>{
    call={url,opts};
    return {ok:true,json:async()=>({Code:1000,KeySalts:[{ID:'k',KeySalt:'fixture'},{ID:'empty',KeySalt:null}]})};
  };
  const result=await readKeySalts('one');
  assert.equal(result.ok,true);
  assert.equal(result.keySalts.length,1);
  assert.equal(call.url,'/api/core/v4/keys/salts');
  assert.equal(call.opts.credentials,'same-origin');
  assert.equal(call.opts.headers['x-pm-uid'],'one');
  assert.match(call.opts.headers['x-pm-appversion'],/^web-account@/);
});

test('MCP bridge refuses other origins and missing backend support before upload',async()=>{
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('unexpected')};
  globalThis.location={origin:'https://evil.example',pathname:'/proton/import'};
  assert.equal((await mcpRequest('import',{})).ok,false);
  globalThis.location={origin:'https://mail.mcp.happyfirst.top',pathname:'/proton/import'};
  globalThis.document={querySelector:()=>null};
  assert.equal((await mcpRequest('import',{})).ok,false);
  assert.equal(calls,0);
});

test('manifest contains minimal permissions and account origin host permission',()=>{
  const root=new URL('../extension/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.version,'0.3.0');
  assert.deepEqual(manifest.permissions,['cookies','scripting']);
  assert.deepEqual(manifest.host_permissions,[
    'https://mail.proton.me/*',
    'https://account.proton.me/*',
    'https://mail.mcp.happyfirst.top/*'
  ]);
  assert.equal(manifest.background,undefined);
  assert.equal(manifest.content_scripts,undefined);
  for(const file of ['popup.html','popup.css','popup.js','core.js','bridge.js'])assert.ok(readFileSync(new URL(file,root)).length);
  for(const file of ['popup.js','core.js','bridge.js']){
    assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/localStorage|sessionStorage|chrome\.storage|console\.|indexedDB/);
  }
});


test('popup previews exact import payload before upload and supports local JSON export',()=>{
  const root=new URL('../extension/',import.meta.url);
  const html=readFileSync(new URL('popup.html',root),'utf8');
  const js=readFileSync(new URL('popup.js',root),'utf8');
  assert.match(html,/id="previewDialog"/);
  assert.match(html,/id="previewJson"/);
  assert.match(html,/id="exportBundle"/);
  assert.match(html,/id="confirmImport"/);
  assert.match(js,/showPreview\(bundle, account\)/);
  assert.match(js,/JSON\.stringify\(envelope, null, 2\)/);
  assert.match(js,/new Blob\(\[json\], \{type:'application\/json'\}\)/);
  assert.match(js,/a\.download = `proton-session-bundle-/);
  const previewStart=js.indexOf('async function previewImport()');
  const confirmStart=js.indexOf('async function confirmImport()');
  assert.ok(previewStart>=0 && confirmStart>previewStart);
  assert.doesNotMatch(js.slice(previewStart,confirmStart),/callMcp\('pair'|callMcp\('import'/);
  assert.match(js.slice(confirmStart),/callMcp\('pair'/);
  assert.match(js.slice(confirmStart),/callMcp\('import'/);
});
