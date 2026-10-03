// A real unpacked MV3 extension, using ONLY intercepted HTTP fixtures and a
// disposable browser profile. No live Proton/MCP requests or credentials.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {sessionFixture} from './session-fixture.js';

const extension = fileURLToPath(new URL('../extension', import.meta.url));
const id = [...createHash('sha256').update(extension).digest('hex').slice(0,32)]
  .map(c => String.fromCharCode(97 + parseInt(c,16))).join('');
const profile = await mkdtemp(join(tmpdir(), 'proton-extension-test-'));
const context = await chromium.launchPersistentContext(profile, {
  channel:'chromium', headless:true,
  ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),
  args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
const requests = [];
let failUsers = false;
let accountsMismatch = false;
let fixture = await sessionFixture(1);
const other = await sessionFixture(2, {uid:'uid-nine',keyPassword:'TEST-ONLY-other-secret'});
const primary = 'seven@proton.me';
const alias = 'alias@proton.me';
const otherEmail = 'nine@proton.me';
const cookieRows = uid => [
  {name:`AUTH-${uid}`,value:`TEST-ONLY-auth-${uid}`,domain:'mail.proton.me',path:'/api/'},
  {name:`REFRESH-${uid}`,value:encodeURIComponent(JSON.stringify({UID:uid,RefreshToken:`TEST-ONLY-refresh-${uid}`})),
    domain:'mail.proton.me',path:'/api/auth/refresh'}
];
const json = (route, data, status = 200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});

try {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (!['https://mail.proton.me','https://account.proton.me','https://mail.mcp.happyfirst.top'].includes(url.origin)) {
      return route.abort();
    }
    const path = url.pathname;
    if (request.isNavigationRequest()) {
      return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="proton-extension-csrf" content="TEST-ONLY-csrf"><p>Offline test fixture</p>'});
    }
    requests.push({path,uid:request.headers()['x-pm-uid'],body:request.postDataJSON()});
    const uid = request.headers()['x-pm-uid'];
    const isOther = uid === 'uid-nine';
    if (path === '/api/core/v4/users') {
      return json(route, failUsers ? {Code:10013} : {Code:1000,User:{ID:isOther?'user-nine':'user-seven',
        Email:isOther?otherEmail:primary,Keys:[{ID:'key-1'}],PasswordMode:1}}, failUsers ? 401 : 200);
    }
    if (path === '/api/core/v4/addresses') {
      return json(route, {Code:1000,Addresses:(isOther?[otherEmail]:[primary,alias]).map((Email,i)=>({ID:`address-${i}`,Email}))});
    }
    if (path === '/api/auth/v4/sessions/local/key') return json(route, {Code:1000,ClientKey:(isOther?other:fixture).clientKey});
    if (path === '/api/core/v4/keys/salts') return json(route, {Code:1000,KeySalts:[{ID:'key-1',KeySalt:'TEST-ONLY-salt'}]});
    if (path === '/proton/import/api/accounts') return json(route, {accounts:[
      {id:'wrong',label:'Wrong account first',email:'wrong@proton.me'},
      ...(!accountsMismatch ? [{id:'alias',label:'Matching alias',email:alias},{id:'nine',label:'Other account',email:otherEmail}] : [])
    ]});
    if (path === '/proton/import/api/extension-pair') return json(route, {token:'TEST-ONLY-pair',expiresAt:Date.now()+300000});
    if (path === '/proton/import/api/extension-import') return json(route, {success:true,refreshTestRequired:true});
    return route.abort();
  });
  await context.addCookies([...cookieRows('uid-seven'),...cookieRows('uid-nine'),
    {name:'Session-Id',value:'TEST-ONLY-session',domain:'.proton.me',path:'/'}]
    .map(c=>({...c,httpOnly:true,secure:true,sameSite:'Lax'})));
  const admin = await context.newPage();
  await admin.goto('https://mail.mcp.happyfirst.top/proton/import');
  const mail = await context.newPage();
  await mail.goto('https://mail.proton.me/u/7/inbox');
  const setSessions = async () => mail.evaluate(({a,b}) => {
    localStorage.setItem('ps-7',JSON.stringify(a));
    localStorage.setItem('ps-9',JSON.stringify(b));
  }, {a:fixture.persisted,b:other.persisted});
  await setSessions();
  const popup = await context.newPage();
  const errors = [];
  popup.on('pageerror', e=>errors.push(e.message));
  const open = async () => {
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForFunction(()=>document.getElementById('logOutput').textContent.includes('启动') &&
      !document.getElementById('detect').disabled);
  };
  const clickAndWait = async selector => {
    await popup.click(selector);
    await popup.waitForFunction(()=>!document.getElementById('detect').disabled);
  };
  const assertReady = async () => {
    assert.equal(await popup.locator('#connect').isEnabled(),true,await popup.locator('#status').textContent());
  };

  for (const version of [1,2,3]) {
    fixture = await sessionFixture(version);
    await setSessions();
    await open();
    await assertReady();
    assert.equal(await popup.locator('#proton').inputValue(),'uid-seven');
    assert.equal(await popup.locator('#account').inputValue(),'alias');
    const writesBefore = requests.filter(r=>r.path.includes('extension-')).length;
    await clickAndWait('#connect');
    const preview = await popup.locator('#previewJson').textContent();
    assert.equal(preview.includes(fixture.keyPassword),false);
    assert.equal(JSON.parse(preview).bundle.email,alias);
    assert.equal(requests.filter(r=>r.path.includes('extension-')).length,writesBefore);
    await clickAndWait('#confirmImport');
    assert.match(await popup.locator('#status').textContent(),/导入成功/);
    assert.equal(await popup.locator('#connect').isEnabled(),false);
    const imported = requests.filter(r=>r.path.endsWith('extension-import')).at(-1).body;
    assert.equal(imported.bundle.keyPassword,fixture.keyPassword);
    assert.equal(imported.bundle.email,alias);
    assert.equal(imported.bundle.uid,'uid-seven');
    assert.equal(imported.bundle.session.cookies.some(c=>c.name.endsWith('uid-nine')),false);
    const sessionId = imported.bundle.session.cookies.find(c=>c.name==='Session-Id');
    assert.equal(sessionId.httpOnly,true);
    assert.equal(sessionId.hostOnly,false);
    assert.equal(requests.some(r=>r.path.endsWith('/keys/salts')),false);
    assert.equal((await popup.locator('#logOutput').textContent()).includes(fixture.keyPassword),false);
    console.log(`PASS: real MV3 injection, HttpOnly parent-domain cookies, v${version} decryption, preview and confirmed import`);
  }

  // Select another UID while the Mail tab URL still has LocalID 7.
  await open();
  await popup.selectOption('#proton','uid-nine');
  await popup.waitForFunction(()=>!document.getElementById('detect').disabled);
  await assertReady();
  assert.equal(await popup.locator('#account').inputValue(),'nine');
  await clickAndWait('#connect');
  await clickAndWait('#confirmImport');
  assert.equal(requests.filter(r=>r.path.endsWith('extension-import')).at(-1).body.bundle.keyPassword,other.keyPassword);
  console.log('PASS: selected UID resolves its own persisted LocalID');

  await open();
  await clickAndWait('#connect');
  const writesBefore = requests.filter(r=>r.path.includes('extension-')).length;
  await context.addCookies([{...cookieRows('uid-seven')[0],value:'TEST-ONLY-rotated',httpOnly:true,secure:true,sameSite:'Lax'}]);
  await clickAndWait('#confirmImport');
  assert.match(await popup.locator('#status').textContent(),/会话已更新/);
  assert.equal(requests.filter(r=>r.path.includes('extension-')).length,writesBefore);
  console.log('PASS: changed credentials rejected before pairing/upload');

  await open();
  failUsers = true;
  await clickAndWait('#detect');
  assert.equal(await popup.locator('#connect').isEnabled(),false);
  failUsers = false;
  accountsMismatch = true;
  await clickAndWait('#detect');
  assert.equal(await popup.locator('#connect').isEnabled(),false);
  assert.match(await popup.locator('#status').textContent(),/没有.*匹配/);
  accountsMismatch = false;
  console.log('PASS: failed detection and account mismatch keep import disabled');

  // Missing local material must reach KeySalt fallback instead of throwing first.
  await mail.evaluate(()=>localStorage.removeItem('ps-7'));
  await open();
  await popup.selectOption('#proton','uid-seven');
  await popup.waitForFunction(()=>!document.getElementById('detect').disabled);
  await assertReady();
  await clickAndWait('#connect');
  assert.match(await popup.locator('#previewSalts').textContent(),/KeySalt/);
  await popup.click('#cancelPreview');
  assert.equal(await popup.locator('#previewJson').textContent(),'');
  console.log('PASS: absent local material falls back; cancellation clears preview');
  assert.deepEqual(errors,[]);
} finally {
  await context.close();
  await rm(profile,{recursive:true,force:true});
}
