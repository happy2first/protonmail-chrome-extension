import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readSessionKeyPassword} from '../extension/bridge.js';
import {sessionFixture} from './session-fixture.js';

function inject(fixture, {uid='uid-seven', code=1000, raw, source=readSessionKeyPassword.toString()} = {}) {
  let calls = 0;
  const result = runInNewContext(`(${source})(7, ${JSON.stringify(uid)})`, {
    location:{origin:'https://mail.proton.me'},
    localStorage:{getItem:key => key === 'ps-7' ? raw ?? JSON.stringify(fixture.persisted) : null},
    fetch:async (url, options) => {
      calls++;
      assert.equal(url, '/api/auth/v4/sessions/local/key');
      assert.equal(options.headers['x-pm-uid'], uid);
      return {ok:true,status:200,json:async () => ({Code:code,ClientKey:fixture.clientKey})};
    },
    crypto:webcrypto, atob, TextEncoder, TextDecoder, AbortSignal
  });
  return {result, calls:() => calls};
}

for (const version of [1,2,3]) {
  test(`serialized injection decrypts Proton persisted-session v${version} without module helpers`, async () => {
    const fixture = await sessionFixture(version);
    const call = inject(fixture);
    const result = await call.result;
    assert.equal(result.ok, true, result.error);
    assert.equal(result.keyPassword, fixture.keyPassword);
    assert.equal(result.diagnostics.payloadVersion, version);
    assert.equal(call.calls(), 1);
    assert.equal(JSON.stringify(result).includes(fixture.clientKey), false);
    assert.equal(JSON.stringify(result).includes(fixture.persisted.blob), false);
  });
}

test('wrong UID is rejected before fetching the local key', async () => {
  const call = inject(await sessionFixture(), {uid:'another-uid'});
  assert.equal((await call.result).ok, false);
  assert.equal(call.calls(), 0);
});

test('HTTP 200 with Proton failure code cannot provide key material', async () => {
  const result = await inject(await sessionFixture(), {code:9101}).result;
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'local-key');
  assert.equal(result.protonCode, 9101);
});

test('AES-GCM rejects a blob with incorrect authenticated context', async () => {
  const result = await inject(await sessionFixture(2, {aad:'fork'})).result;
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'decrypt');
});

test('malformed plaintext and persisted JSON never leak input in diagnostics', async () => {
  const secret = 'TEST-SECRET-MUST-NOT-APPEAR';
  const fixture = await sessionFixture(3, {plain:`{"keyPassword":"${secret}"`});
  for (const result of [await inject(fixture).result,
    await inject(fixture, {raw:`{"blob":"${secret}"`}).result]) {
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
