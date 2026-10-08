import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizeMcpOrigin} from '../extension/core.js';

const source = readFileSync(new URL('../extension/background.js',import.meta.url),'utf8')
  .replace("import {normalizeMcpOrigin} from './core.js';",'');

function worker({stored={},request=()=>Promise.resolve(true),failWrite=false}={}) {
  let listener;
  const requested=[],removed=[];
  const chrome={
    runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>{listener=fn;}}},
    permissions:{request:options=>{requested.push(options);return request();},remove:async options=>removed.push(options)},
    storage:{local:{get:async()=>({...stored}),set:async value=>{
      if(failWrite) throw new Error('write failed');
      Object.assign(stored,value);
    }}}
  };
  runInNewContext(source,{chrome,normalizeMcpOrigin});
  const send=(origin,reply,sender={id:'test',url:chrome.runtime.getURL('popup.html')})=>
    listener({type:'saveMcpOrigin',origin},sender,reply);
  return {send,stored,requested,removed};
}

test('approved service is saved after popup reply channel disappears',async()=>{
  let allow;
  const w=worker({request:()=>new Promise(resolve=>{allow=resolve;})});
  let completed;
  const done=new Promise(resolve=>{completed=resolve;});
  assert.equal(w.send('https://new.example',()=>{completed();throw new Error('popup closed');}),true);
  assert.equal(w.requested.length,1,'permission request starts synchronously');
  assert.deepEqual(w.stored,{},'no unapproved address is persisted');
  allow(true);
  await done;
  assert.deepEqual(w.stored,{mcpOrigin:'https://new.example'});
});

test('denial and permission API rejection retain prior configuration',async()=>{
  for(const request of [()=>Promise.resolve(false),()=>Promise.reject(new Error('request failed'))]){
    const w=worker({stored:{mcpOrigin:'https://old.example'},request});
    const result=await new Promise(resolve=>w.send('https://new.example',resolve));
    assert.equal(result.ok,false);
    assert.equal(w.stored.mcpOrigin,'https://old.example');
    assert.equal(w.removed.length,0);
  }
});

test('new address is committed before old permission is removed; failed storage keeps old permission',async()=>{
  for(const failWrite of [false,true]){
    const w=worker({stored:{mcpOrigin:'https://old.example'},failWrite});
    const result=await new Promise(resolve=>w.send('https://new.example/proton/import',resolve));
    assert.equal(result.ok,!failWrite);
    assert.equal(w.stored.mcpOrigin,failWrite?'https://old.example':'https://new.example');
    assert.equal(w.removed.length,failWrite?0:1);
    if(!failWrite) assert.equal(w.removed[0].origins[0],'https://old.example/*');
  }
});

test('untrusted sender, invalid origin and duplicate save never start another permission request',async()=>{
  let allow;
  const w=worker({request:()=>new Promise(resolve=>{allow=resolve;})});
  for(const [origin,sender] of [['http://bad.example',undefined],['https://new.example',{id:'test',url:'https://bad.example'}]]){
    const result=await new Promise(resolve=>w.send(origin,resolve,sender));
    assert.equal(result.ok,false);
  }
  assert.equal(w.requested.length,0);
  const saved=new Promise(resolve=>w.send('https://new.example',resolve));
  const duplicate=await new Promise(resolve=>w.send('https://other.example',resolve));
  assert.equal(duplicate.ok,false);
  assert.equal(w.requested.length,1);
  allow(true);
  assert.equal((await saved).ok,true);
});
