import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {normalizeMcpOrigin,normalizePairResponse,makeServerClock,timeFromServerClock} from '../extension/core.js';
import {mcpRequest} from '../extension/bridge.js';

test('configuration accepts HTTPS origin or management URL and rejects unsafe or unrelated forms',()=>{
  assert.equal(normalizeMcpOrigin('https://custom.example/proton/import'),'https://custom.example');
  assert.equal(normalizeMcpOrigin('https://custom.example:8443/'),'https://custom.example:8443');
  for(const url of ['','http://custom.example','https://user:pass@custom.example',
    'https://custom.example/path','https://custom.example/?token=x','https://custom.example/#x',
    'https://mail.proton.me']) assert.throws(()=>normalizeMcpOrigin(url));
});

function inject(result,{origin='https://custom.example',expected='https://custom.example',csrf=true,date='Thu, 08 Oct 2026 03:42:00 GMT'}={}){
  let calls=0;
  const response=runInNewContext(`(${mcpRequest.toString()})('pair',{account:'test'},${JSON.stringify(expected)})`,{
    location:{origin,pathname:'/proton/import'},
    document:{querySelector:()=>csrf?{content:'TEST-CSRF'}:null},AbortSignal,
    fetch:async(url,options)=>{
      calls++;
      assert.equal(url,'/proton/import/api/extension-pair');
      assert.equal(options.headers['x-csrf-token'],'TEST-CSRF');
      assert.equal(options.credentials,'same-origin');
      return {ok:true,status:200,headers:{get:name=>name==='date'?date:null},json:async()=>result};
    }
  });
  return {response,calls:()=>calls};
}

test('serialized MCP bridge normalizes direct and wrapped pair/import responses',async()=>{
  const pair={token:'TEST-TOKEN',expiresAt:String(Date.now()+300000)};
  for(const data of [pair,{ok:true,data:pair}]){
    const r=await inject(data).response;
    assert.equal(r.ok,true);
    assert.equal(normalizePairResponse(r.data).token,'TEST-TOKEN');
    assert.equal(typeof normalizePairResponse(r.data).expiresAt,'number');
  }
  const r=await inject({ok:true,data:{success:true}}).response;
  assert.equal(r.data.success,true);
});

test('HTTP 200 business failures are rejected, not unwrapped as successful pairs',async()=>{
  for(const result of [{ok:false,error:'denied'},{ok:true,data:{success:false,error:'denied'}}]){
    const r=await inject(result).response;
    assert.equal(r.ok,false);
    assert.equal(r.error,'denied');
  }
});

test('configured origin mismatch and missing CSRF never issue a request',async()=>{
  for(const options of [{origin:'https://wrong.example'},{expected:''},{csrf:false}]){
    const run=inject({},options);
    assert.equal((await run.response).ok,false);
    assert.equal(run.calls(),0);
  }
});

test('pair requires nonempty token and future milliseconds, without leaking token in error',()=>{
  for(const pair of [{},{token:'SECRET',expiresAt:1},{token:'',expiresAt:Date.now()+300000}]){
    assert.throws(()=>normalizePairResponse(pair),e=>!e.message.includes('SECRET'));
  }
});


test('authenticated HTTP Date survives serialized injection for clock calibration',async()=>{
  const r=await inject({token:'TEST',expiresAt:1}).response;
  assert.equal(r.serverDateMs,Date.parse('Thu, 08 Oct 2026 03:42:00 GMT'));
  assert.equal((await inject({}, {date:'bad date'}).response).serverDateMs,null);
});

test('fast or slow device clocks cannot invalidate a fresh server token',()=>{
  const epoch=Date.parse('Thu, 08 Oct 2026 03:42:00 GMT');
  const clock=makeServerClock(epoch,1000,50);
  for(const skew of [-600000,600000]){
    const now=timeFromServerClock(clock,1050,epoch+skew);
    assert.equal(now,epoch+3000);
    assert.equal(normalizePairResponse({token:'TEST',expiresAt:epoch+300000},now).token,'TEST');
  }
  assert.throws(()=>normalizePairResponse({token:'TEST',expiresAt:epoch+300000},timeFromServerClock(clock,301050)));
});

test('invalid server Date is not treated as epoch zero',()=>{
  assert.equal(makeServerClock(null,10,20),null);
  assert.equal(makeServerClock(NaN,10,20),null);
});
