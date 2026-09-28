import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectCookies,sessionState,sessionCandidates,refreshAvailable,bundleFor} from '../extension/core.js';
import {readProton,readPersistedSessionUid,readPersistedSessionIndex,readLocalSessions,readKeySalts,mcpRequest} from '../extension/bridge.js';

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
  assert.equal(manifest.version,'0.3.7');
  assert.deepEqual(manifest.permissions,['cookies','scripting']);
  assert.deepEqual(manifest.host_permissions,[
    'https://proton.me/*',
    'https://mail.proton.me/*',
    'https://account.proton.me/*',
    'https://mail.mcp.happyfirst.top/*'
  ]);
  assert.equal(manifest.background,undefined);
  assert.equal(manifest.content_scripts,undefined);
  for(const file of ['popup.html','popup.css','popup.js','core.js','bridge.js'])assert.ok(readFileSync(new URL(file,root)).length);
  for(const file of ['popup.js','core.js']){
    assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/localStorage|sessionStorage|chrome\.storage|console\.|indexedDB/);
  }
  const bridge=readFileSync(new URL('bridge.js',root),'utf8');
  assert.doesNotMatch(bridge,/sessionStorage|chrome\.storage|console\.|indexedDB/);
  assert.match(bridge,/localStorage\.getItem\(\`ps-\$\{id\}\`\)/);
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


test('session candidates default to newest complete AUTH/REFRESH session',()=>{
  const rows=[
    cookie('AUTH-old',{expirationDate:200,path:'/api/'}),
    cookie('REFRESH-old',{expirationDate:200,path:'/api/auth/refresh'}),
    cookie('AUTH-new',{expirationDate:500,path:'/api/'}),
    cookie('REFRESH-new',{expirationDate:500,path:'/api/auth/refresh'}),
    cookie('AUTH-incomplete',{expirationDate:900,path:'/api/'}),
    cookie('Session-Id',{domain:'.proton.me',hostOnly:false,path:'/'})
  ];
  const candidates=sessionCandidates(rows,1000);
  assert.deepEqual(candidates.map(x=>x.uid),['new','old']);
  assert.equal(candidates[0].state.ready,true);
});

test('popup reads cookies by Proton API URLs and auto-selects newest session',()=>{
  const root=new URL('../extension/',import.meta.url);
  const js=readFileSync(new URL('popup.js',root),'utf8');
  assert.match(js,/\/api\/core\/v4\/addresses/);
  assert.match(js,/\/api\/auth\/refresh/);
  assert.match(js,/sessionCandidates\(rows\)/);
  assert.match(js,/最新会话/);
  assert.match(js,/candidates\[0\]\.uid/);
  assert.doesNotMatch(js,/请选择会话并核对邮箱/);
});


test('manifest includes parent proton.me permission for Session-Id domain cookie',()=>{
  const root=new URL('../extension/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  assert.ok(manifest.host_permissions.includes('https://proton.me/*'));
});


test('popup resolves Account-side LocalID by UID and exposes sanitized logs',()=>{
  const root=new URL('../extension/',import.meta.url);
  const html=readFileSync(new URL('popup.html',root),'utf8');
  const js=readFileSync(new URL('popup.js',root),'utf8');
  assert.match(html,/id="diagnostics"/);
  assert.match(html,/id="logOutput"/);
  assert.match(html,/id="copyLog"/);
  assert.match(js,/readPersistedSessionIndex/);
  assert.match(js,/index\.sessions\.find\(item => item\.uid === expectedUid\)/);
  assert.match(js,/Account UID 匹配/);
  assert.match(js,/AUTH-\$\{expectedUid\}/);
  assert.match(js,/protonCode/);
  assert.match(js,/diagnosticLog/);
  assert.doesNotMatch(js,/logEvent\([^)]*RefreshToken/i);
  assert.doesNotMatch(js,/logEvent\([^)]*cookie\.value/i);
  assert.doesNotMatch(js,/logEvent\([^)]*keySalts?\s*:/i);
});

test('KeySalt bridge returns structured HTTP diagnostics without secrets',async()=>{
  globalThis.location={origin:'https://account.proton.me',pathname:'/u/4/mail'};
  let attempts=0;
  globalThis.fetch=async()=>{
    attempts++;
    return {
      ok:false,
      status:401,
      json:async()=>({Code:10013,Error:'Invalid session'})
    };
  };
  const result=await readKeySalts('uid-demo');
  assert.equal(result.ok,false);
  assert.equal(result.status,401);
  assert.equal(result.protonCode,10013);
  assert.equal(result.pathname,'/u/4/mail');
  assert.equal(attempts,3);
  assert.equal(JSON.stringify(result).includes('uid-demo'),false);
});


test('mail bridge returns LocalID to UID session mapping without secret fields',async()=>{
  globalThis.location={origin:'https://mail.proton.me'};
  let call;
  globalThis.fetch=async(url,opts)=>{
    call={url,opts};
    return {
      ok:true,
      status:200,
      json:async()=>({
        Code:1000,
        Sessions:[
          {UID:'uid-4',LocalID:4,PrimaryEmail:'four@proton.me',AccessToken:'MUST_NOT_EXPORT'},
          {UID:'uid-7',LocalID:7,PrimaryEmail:'seven@proton.me'}
        ]
      })
    };
  };
  const result=await readLocalSessions('bootstrap-uid');
  assert.equal(result.ok,true);
  assert.deepEqual(result.sessions,[
    {uid:'uid-4',localID:4,primaryEmail:'four@proton.me'},
    {uid:'uid-7',localID:7,primaryEmail:'seven@proton.me'}
  ]);
  assert.equal(call.url,'/api/auth/v4/sessions/local');
  assert.equal(call.opts.headers['x-pm-uid'],'bootstrap-uid');
  assert.equal(JSON.stringify(result).includes('MUST_NOT_EXPORT'),false);
});

test('popup maps current URL LocalID to exact UID before falling back to newest session',()=>{
  const root=new URL('../extension/',import.meta.url);
  const js=readFileSync(new URL('popup.js',root),'utf8');
  assert.match(js,/readLocalSessions/);
  assert.match(js,/mapping\.sessions\.find\(item => String\(item\.localID\) === String\(mailLocalId\)\)/);
  assert.match(js,/当前页面会话/);
  assert.match(js,/latest-fallback/);
  assert.match(js,/\$\('copyLog'\)\.disabled = false/);
  assert.match(js,/\$\('clearLog'\)\.disabled = false/);
});


test('persisted LocalID mapping returns only UID and does not expose Proton session blob',()=>{
  const previous=globalThis.localStorage;
  globalThis.localStorage={
    getItem:key=>key==='ps-5'
      ? JSON.stringify({UID:'uid-five',UserID:'user-five',blob:'MUST_NOT_EXPORT',persistent:true})
      : null
  };
  const result=readPersistedSessionUid(5);
  assert.deepEqual(result,{ok:true,uid:'uid-five'});
  assert.equal(JSON.stringify(result).includes('MUST_NOT_EXPORT'),false);
  globalThis.localStorage=previous;
});

test('popup uses Mail ps-LocalID UID then finds a possibly different Account LocalID for that UID',()=>{
  const root=new URL('../extension/',import.meta.url);
  const js=readFileSync(new URL('popup.js',root),'utf8');
  assert.match(js,/ps-LocalID 精确匹配 UID/);
  assert.match(js,/selectionMode = 'persisted-localid'/);
  assert.match(js,/withAccountTab\(uid,/);
  assert.match(js,/accountLocalID:match\.localID/);
  assert.match(js,/\$\{ACCOUNT\}\/u\/\$\{match\.localID\}\/mail/);
  assert.doesNotMatch(js,/withAccountTab\(localId, uid,/);
});


test('persisted session index enumerates only ps-* LocalID and UID metadata',()=>{
  const previous=globalThis.localStorage;
  const data={
    'ps-6':JSON.stringify({UID:'uid-mail',blob:'SECRET-A'}),
    'ps-2':JSON.stringify({UID:'uid-account',blob:'SECRET-B'}),
    'unrelated':'ignore'
  };
  globalThis.localStorage={
    length:Object.keys(data).length,
    key:i=>Object.keys(data)[i] ?? null,
    getItem:key=>data[key] ?? null
  };
  const result=readPersistedSessionIndex();
  assert.deepEqual(result,{
    ok:true,
    sessions:[
      {localID:2,uid:'uid-account'},
      {localID:6,uid:'uid-mail'}
    ]
  });
  assert.equal(JSON.stringify(result).includes('SECRET-'),false);
  globalThis.localStorage=previous;
});


test('mail origin can replay key salts with mail app headers',async()=>{
  globalThis.location={origin:'https://mail.proton.me',pathname:'/u/7/inbox'};
  let call;
  globalThis.fetch=async(url,opts)=>{
    call={url,opts};
    return {ok:true,status:200,json:async()=>({Code:1000,KeySalts:[{ID:'k-mail',KeySalt:'fixture-mail'}]})};
  };
  const result=await readKeySalts('uid-mail');
  assert.equal(result.ok,true);
  assert.deepEqual(result.keySalts,[{id:'k-mail',keySalt:'fixture-mail'}]);
  assert.equal(call.url,'/api/core/v4/keys/salts');
  assert.equal(call.opts.credentials,'same-origin');
  assert.equal(call.opts.headers['x-pm-uid'],'uid-mail');
  assert.match(call.opts.headers['x-pm-appversion'],/^web-mail@/);
  assert.equal(result.diagnostics.origin,'https://mail.proton.me');
});

test('popup tries Mail-origin key salts before Account fallback',()=>{
  const root=new URL('../extension/',import.meta.url);
  const js=readFileSync(new URL('popup.js',root),'utf8');
  const mailReplay=js.indexOf("runIn(selectedTab, readKeySalts, [uid])");
  const accountFallback=js.indexOf("withAccountTab(uid, tabId => runIn(tabId, readKeySalts, [uid]))");
  assert.ok(mailReplay>=0);
  assert.ok(accountFallback>mailReplay);
});
