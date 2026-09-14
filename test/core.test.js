import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectCookies,refreshAvailable,bundleFor} from '../extension/core.js';
import {readProton,mcpRequest} from '../extension/bridge.js';
const cookie = (name='AUTH-one',extra={}) => ({name,value:'test-only',domain:'.proton.me',hostOnly:false,path:'/api/',secure:true,httpOnly:true,sameSite:'lax',session:true,...extra});
test('select one account, retain path-restricted HttpOnly cookies and attributes',()=>{
 const rows=selectCookies([cookie(),cookie('REFRESH-one',{path:'/api/auth'}),cookie('AUTH-two'),cookie('REFRESH-two'),cookie('st',{path:'/'}),cookie('other',{domain:'.example.com'})],'one');
 assert.deepEqual(rows.map(c=>c.name),['AUTH-one','REFRESH-one','st']);
 assert.equal(rows[0].httpOnly,true);assert.equal(rows[0].path,'/api/');assert.equal(rows[0].domain,'.proton.me');assert.equal(rows[0].expiresAt,null);
 assert.equal(refreshAvailable(rows,'one'),true);
});
test('expiry units, wrong hostOnly, partitioned and expired cookies',()=>{
 const rows=selectCookies([cookie(),cookie('st',{session:false,expirationDate:2000}),cookie('gone',{expirationDate:1}),cookie('wrong',{hostOnly:true,domain:'proton.me'})],'one',1000);
 assert.equal(rows.length,2);assert.equal(rows[1].expiresAt,2000000);
 assert.throws(()=>selectCookies([cookie('AUTH-one',{partitionKey:{topLevelSite:'https://proton.me'}})],'one'));
 assert.throws(()=>selectCookies([cookie('AUTH-two')],'one'));
 assert.equal(refreshAvailable([cookie('AUTH-one',{path:'/api/auth/refresh-other'})],'one'),false);
});
test('bundle requires keys belonging to detected user',()=>{
 const result={ok:true,email:'example@proton.me',user:{ID:'user',keyIds:['k']},addresses:[{ID:'a',Email:'example@proton.me'}],keySalts:[{ID:'k',KeySalt:'fixture-salt'}]};
 assert.equal(bundleFor('one',selectCookies([cookie()],'one'),result).version,1);
 assert.throws(()=>bundleFor('one',[],{...result,keySalts:[{ID:'wrong',KeySalt:'fixture'}]}));
});
test('Proton bridge requests only three read endpoints, never returns private keys',async()=>{
 globalThis.location={origin:'https://mail.proton.me'};
 const calls=[];
 globalThis.fetch=async(url,opts)=>{
   calls.push({url,opts});
   return {ok:true,json:async()=>({Code:1000,...(url.endsWith('/users') ? {User:{ID:'u',Keys:[{ID:'k',PrivateKey:'MUST_NOT_EXPORT'}]}} : url.endsWith('/addresses') ? {Addresses:[{ID:'a',Email:'test@proton.me',Keys:['MUST_NOT_EXPORT']}]} : {KeySalts:[{ID:'k',KeySalt:'fixture'}]})})};
 };
 const result=await readProton('one');assert.equal(result.ok,true);assert.equal(calls.length,3);
 assert.equal(JSON.stringify(result).includes('MUST_NOT_EXPORT'),false);
 for(const c of calls){assert.equal(c.opts.redirect,'error');assert.equal(c.opts.credentials,'same-origin');assert.equal(c.opts.headers['x-pm-uid'],'one');}
});
test('MCP bridge refuses other origins and missing backend support before upload',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected')};
 globalThis.location={origin:'https://evil.example',pathname:'/proton/import'};
 assert.equal((await mcpRequest('import',{})).ok,false);
 globalThis.location={origin:'https://mail.mcp.happyfirst.top',pathname:'/proton/import'};
 globalThis.document={querySelector:()=>null};
 assert.equal((await mcpRequest('import',{})).ok,false);assert.equal(calls,0);
});
test('manifest contains minimal permissions and all loading resources exist',()=>{
 const root=new URL('../extension/',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
 assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions,['cookies','scripting']);
 assert.equal(manifest.host_permissions.length,2);assert.equal(manifest.background,undefined);assert.equal(manifest.content_scripts,undefined);
 for(const file of ['popup.html','popup.css','popup.js','core.js','bridge.js'])assert.ok(readFileSync(new URL(file,root)).length);
 for(const file of ['popup.js','core.js','bridge.js'])assert.doesNotMatch(readFileSync(new URL(file,root),'utf8'),/localStorage|sessionStorage|chrome\.storage|console\.|indexedDB/);
});
