import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readProton} from '../extension/bridge.js';
import {matchingAccounts,bundleForAccount} from '../extension/core.js';

const response = url => ({ok:true,status:200,json:async()=>({Code:1000,...(
  url.endsWith('/users') ? {User:{ID:'user',Email:'alias@proton.me',Keys:[{ID:'key'}]}}
    : {Addresses:[{ID:'address',Email:'alias@proton.me'}]}
)})});
const inject = fetch => runInNewContext(`(${readProton.toString()})('fixture-uid')`, {
  location:{origin:'https://mail.proton.me'},fetch,AbortSignal,Date,TypeError
});

test('serialized Mail bridge retries timeout once and completes without external helpers',async()=>{
  const calls=[];
  const result=await inject(async(url,options)=>{
    calls.push(url);
    assert.equal(options.headers['x-pm-uid'],'fixture-uid');
    if(calls.length===1) throw Object.assign(new Error('fixture timeout'),{name:'TimeoutError'});
    return response(url);
  });
  assert.equal(result.ok,true,result.error);
  assert.equal(calls.length,3);
  assert.equal(calls[0],calls[1]);
});

test('repeated timeout reports failing endpoint and attempt count without calling addresses',async()=>{
  let calls=0;
  const result=await inject(async()=>{calls++;throw Object.assign(new Error('fixture timeout'),{name:'TimeoutError'});});
  assert.equal(calls,2);
  assert.equal(result.ok,false);
  assert.equal(result.diagnostics.requestPath,'/core/v4/users');
  assert.equal(result.diagnostics.attempt,2);
  assert.match(result.error,/请求超时/);
});

test('authentication failure is not retried',async()=>{
  let calls=0;
  const result=await inject(async()=>{calls++;return {ok:false,status:401};});
  assert.equal(calls,1);
  assert.match(result.error,/users HTTP 401/);
});

test('address response body timeout is retried and attributed to addresses',async()=>{
  let calls=0;
  const result=await inject(async url=>{
    calls++;
    if(url.endsWith('/users'))return response(url);
    return {ok:true,status:200,json:async()=>{throw Object.assign(new Error('fixture'),{name:'TimeoutError'});}};
  });
  assert.equal(calls,3);
  assert.equal(result.diagnostics.requestPath,'/core/v4/addresses');
  assert.equal(result.diagnostics.attempt,2);
});

test('real server masking resolves an alias while retaining exact email for pairing',()=>{
  const addresses=[{email:'primary@proton.me'},{email:'alias@proton.me'}];
  const result=matchingAccounts([
    {id:'wrong',email:'wr***g@proton.me'},
    {id:'alias',email:'al***s@proton.me'}
  ],addresses);
  assert.equal(result.length,1);
  assert.equal(result[0].email,'alias@proton.me');
  assert.equal(bundleForAccount({addresses},result[0]).email,'alias@proton.me');
});

test('ambiguous masked aliases are never guessed; exact and short addresses work',()=>{
  assert.deepEqual(matchingAccounts([{id:'x',email:'al***s@proton.me'}],[
    {email:'alias@proton.me'},{email:'alters@proton.me'}
  ]),[]);
  assert.equal(matchingAccounts([{email:'a*@proton.me'}],[{email:'ab@proton.me'}])[0].email,'ab@proton.me');
  assert.equal(matchingAccounts([{email:'alias@proton.me'}],[{email:'alias@proton.me'}]).length,1);
});
