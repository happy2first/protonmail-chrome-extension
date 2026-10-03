import {webcrypto} from 'node:crypto';

// Mirrors Proton WebClients persistedSessionStorage/sessionBlobCryptoHelper:
// v1: 16-byte IV, binary string; v2: adds "session" AAD; v3: 12-byte IV + UTF-8.
export async function sessionFixture(version = 1, options = {}) {
  const keyPassword = options.keyPassword || 'TEST-ONLY-derived-secret-é';
  const keyBytes = webcrypto.getRandomValues(new Uint8Array(32));
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(version === 3 ? 12 : 16));
  const text = options.plain ?? JSON.stringify({keyPassword});
  const plain = version === 3 ? new TextEncoder().encode(text)
    : Uint8Array.from(text, c => c.charCodeAt(0));
  const aad = options.aad ?? (version >= 2 ? 'session' : null);
  const encrypted = await webcrypto.subtle.encrypt({name:'AES-GCM',iv,
    ...(aad ? {additionalData:new TextEncoder().encode(aad)} : {})}, key, plain);
  return {
    keyPassword,
    clientKey:Buffer.from(keyBytes).toString('base64'),
    persisted:{UID:options.uid || 'uid-seven',payloadVersion:version,
      blob:Buffer.concat([iv, new Uint8Array(encrypted)]).toString('base64')}
  };
}
