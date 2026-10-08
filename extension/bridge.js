// Runs only in Chrome's ISOLATED world. It can recover Proton's derived keyPassword from the current encrypted persisted session; it never reads the user's raw password field.
export async function readProton(uid) {
  if (location.origin !== 'https://mail.proton.me') return {ok:false, error:'请返回 Proton Mail 页面'};
  let requestPath = '';
  let attempt = 0;
  const startedAt = Date.now();
  try {
    const get = async path => {
      requestPath = path;
      for (attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const response = await fetch('/api' + path, {
            credentials:'same-origin', cache:'no-store', redirect:'error',
            headers:{accept:'application/json','x-pm-uid':uid,
              'x-pm-appversion':'web-mail@5.0.133.5','x-pm-locale':'en_US'},
            signal:AbortSignal.timeout(30000)
          });
          if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
          let data;
          try { data = await response.json(); }
          catch (error) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
            throw new Error(`${path} 返回的 JSON 无效`);
          }
          if (data.Code !== 1000) throw new Error(`${path} Proton ${Number(data.Code) || '响应异常'}`);
          return data;
        } catch (error) {
          const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
          if (timedOut && attempt < 2) continue;
          if (timedOut) throw new Error(`${path} 请求超时（每次最多 30 秒，已尝试 ${attempt} 次）；请确认 Proton 页面可正常加载后重新检测`);
          if (error instanceof TypeError) throw new Error(`${path} 网络请求失败；请检查 Proton 页面连接后重新检测`);
          throw error;
        }
      }
    };
    const user = (await get('/core/v4/users')).User;
    const addresses = (await get('/core/v4/addresses')).Addresses;
    const rows = (addresses || []).filter(a => a.Email).map(a => ({id:a.ID, email:a.Email}));
    const email = rows.find(a => a.email === user?.Email)?.email || rows[0]?.email;
    if (!email) throw new Error('未返回邮箱地址');
    return {
      ok:true,
      email,
      user:{
        id:user?.ID,
        keyIds:(user?.Keys || []).map(k => k.ID).filter(Boolean),
        passwordMode:[1,2].includes(Number(user?.PasswordMode)) ? Number(user.PasswordMode) : undefined
      },
      addresses:rows,
      diagnostics:{requestPath,attempt,elapsedMs:Date.now()-startedAt},
      client:{mailAppVersion:'web-mail@5.0.133.5', locale:'en_US'}
    };
  } catch (e) {
    return {ok:false, error:e instanceof Error ? e.message : 'Proton 检测失败',
      diagnostics:{requestPath,attempt,elapsedMs:Date.now()-startedAt}};
  }
}

export function readPersistedSessionUid(localID) {
  try {
    const id = Number(localID);
    if (!Number.isInteger(id) || id < 0) return {ok:false,error:'LocalID 无效'};
    const raw = localStorage.getItem(`ps-${id}`);
    if (!raw) return {ok:false,error:'未找到当前 LocalID 的持久会话'};
    const parsed = JSON.parse(raw);
    const uid = typeof parsed?.UID === 'string' ? parsed.UID.trim() : '';
    if (!uid) return {ok:false,error:'持久会话中没有 UID'};
    return {ok:true,uid};
  } catch (e) {
    return {ok:false,error:e instanceof Error ? e.message : '读取持久会话 UID 失败'};
  }
}

export function readPersistedSessionIndex() {
  try {
    const sessions = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const match = /^ps-(\d+)$/.exec(String(key || ''));
      if (!match) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const uid = typeof parsed?.UID === 'string' ? parsed.UID.trim() : '';
      if (!uid) continue;
      sessions.push({localID:Number(match[1]),uid});
    }
    sessions.sort((a,b)=>a.localID-b.localID);
    return {ok:true,sessions};
  } catch (e) {
    return {ok:false,error:e instanceof Error ? e.message : '读取持久会话索引失败'};
  }
}

export async function readLocalSessions(uid) {
  if (!['https://mail.proton.me','https://account.proton.me'].includes(location.origin)) {
    return {ok:false, error:'本地会话映射需要 Proton 同源页面'};
  }
  try {
    const accountOrigin = location.origin === 'https://account.proton.me';
    const response = await fetch('/api/auth/v4/sessions/local', {
      credentials:'same-origin',
      cache:'no-store',
      redirect:'error',
      headers:{
        accept:'application/json',
        'x-pm-uid':uid,
        'x-pm-appversion':accountOrigin ? 'web-account@5.0.420.1' : 'web-mail@5.0.133.5',
        'x-pm-locale':accountOrigin ? 'zh_CN' : 'en_US'
      },
      signal:AbortSignal.timeout(15000)
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok || data?.Code !== 1000) {
      return {
        ok:false,
        error:`/auth/v4/sessions/local HTTP ${response.status}${data?.Code ? ` / Proton ${data.Code}` : ''}`,
        status:response.status,
        protonCode:Number(data?.Code) || null
      };
    }
    const sessions = (Array.isArray(data.Sessions) ? data.Sessions : [])
      .filter(item => item?.UID && Number.isInteger(Number(item?.LocalID)))
      .map(item => ({
        uid:String(item.UID),
        localID:Number(item.LocalID),
        primaryEmail:typeof item.PrimaryEmail === 'string' ? item.PrimaryEmail : ''
      }));
    return {ok:true, sessions};
  } catch (e) {
    return {ok:false, error:e instanceof Error ? e.message : '读取本地会话映射失败'};
  }
}


export async function readSessionKeyPassword(localID, uid) {
  // executeScript serializes ONLY this function, not its module/closure.
  // Keep every helper inside the injected function.
  function base64Bytes(value) {
    const raw = atob(String(value || ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function binaryBytesToString(bytes) {
    let out = '';
    const step = 0x4000;
    for (let i = 0; i < bytes.length; i += step) {
      out += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return out;
  }

  if (location.origin !== 'https://mail.proton.me') {
    return {ok:false,error:'浏览器解密材料只能从 mail.proton.me 当前会话读取',stage:'origin'};
  }
  let stage = 'local-session';
  try {
    const id = Number(localID);
    if (!Number.isInteger(id) || id < 0) return {ok:false,error:'LocalID 无效',stage:'local-session'};
    const raw = localStorage.getItem(`ps-${id}`);
    if (!raw) return {ok:false,error:'未找到当前 LocalID 的持久会话',stage:'local-session'};
    const persisted = JSON.parse(raw);
    const persistedUid = typeof persisted?.UID === 'string' ? persisted.UID.trim() : '';
    if (!persistedUid || persistedUid !== uid) {
      return {ok:false,error:'持久会话 UID 与当前 Mail 会话不一致',stage:'local-session'};
    }
    const blob = typeof persisted?.blob === 'string' ? persisted.blob.trim() : '';
    if (!blob) return {ok:false,error:'当前持久会话没有可用的加密解密材料',stage:'local-session'};
    const payloadVersion = Number(persisted?.payloadVersion || 1);
    if (![1,2,3].includes(payloadVersion)) {
      return {ok:false,error:`不支持的持久会话 payloadVersion：${payloadVersion}`,stage:'local-session'};
    }

    stage = 'local-key';
    const response = await fetch('/api/auth/v4/sessions/local/key', {
      credentials:'same-origin',
      cache:'no-store',
      redirect:'error',
      headers:{
        accept:'application/json',
        'x-pm-uid':uid,
        'x-pm-appversion':'web-mail@5.0.133.5',
        'x-pm-locale':'en_US'
      },
      signal:AbortSignal.timeout(15000)
    });
    let data = null;
    try { data = await response.json(); } catch {}
    const clientKey = typeof data?.ClientKey === 'string' ? data.ClientKey.trim() : '';
    if (!response.ok || data?.Code !== 1000 || !clientKey) {
      return {
        ok:false,
        error:`/auth/v4/sessions/local/key HTTP ${response.status}${data?.Code ? ` / Proton ${data.Code}` : ''}`,
        stage:'local-key',
        status:response.status,
        protonCode:Number(data?.Code) || null
      };
    }

    stage = 'decrypt';
    const keyBytes = base64Bytes(clientKey);
    if (keyBytes.length !== 32) return {ok:false,error:'ClientKey 长度无效',stage:'decrypt'};
    const key = await crypto.subtle.importKey('raw', keyBytes, {name:'AES-GCM'}, false, ['decrypt']);
    const encrypted = base64Bytes(blob);
    const ivLength = payloadVersion === 3 ? 12 : 16;
    if (encrypted.length <= ivLength + 16) return {ok:false,error:'持久会话 blob 长度无效',stage:'decrypt'};
    const iv = encrypted.slice(0, ivLength);
    const ciphertext = encrypted.slice(ivLength);
    const additionalData = payloadVersion >= 2 ? new TextEncoder().encode('session') : undefined;
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',
      iv,
      ...(additionalData ? {additionalData} : {})
    }, key, ciphertext));
    const plain = payloadVersion === 3
      ? new TextDecoder().decode(decrypted)
      : binaryBytesToString(decrypted);
    stage = 'parse';
    const parsed = JSON.parse(plain);
    const keyPassword = typeof parsed?.keyPassword === 'string' ? parsed.keyPassword : '';
    if (!keyPassword || keyPassword.length > 8192) {
      return {ok:false,error:'持久会话未包含可用 keyPassword',stage:'decrypt'};
    }
    return {
      ok:true,
      keyPassword,
      diagnostics:{
        status:response.status,
        protonCode:Number(data?.Code) || 1000,
        payloadVersion,
        localID:id
      },
      client:{mailAppVersion:'web-mail@5.0.133.5',locale:'en_US'}
    };
  } catch {
    return {
      ok:false,
      // JSON.parse errors may contain part of the secret input. Never return them.
      error:`恢复浏览器解密材料失败（${stage}），请刷新 Proton 页面后重新检测`,
      stage
    };
  }
}

export async function readKeySalts(uid) {
  const isMail = location.origin === 'https://mail.proton.me';
  const isAccount = location.origin === 'https://account.proton.me';
  if (!isMail && !isAccount) {
    return {ok:false, error:'KeySalt 重放需要 Proton 同源页面', stage:'origin', pathname:location.pathname};
  }

  const appVersion = isMail ? 'web-mail@5.0.133.5' : 'web-account@5.0.420.1';
  const locale = isMail ? 'en_US' : 'zh_CN';

  try {
    let lastStatus = 0;
    let lastCode = null;
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch('/api/core/v4/keys/salts', {
        credentials:'same-origin',
        cache:'no-store',
        redirect:'error',
        headers:{
          accept:'application/vnd.protonmail.v1+json',
          'x-pm-uid':uid,
          'x-pm-appversion':appVersion,
          'x-pm-locale':locale
        },
        signal:AbortSignal.timeout(15000)
      });
      lastStatus = response.status;
      let data = null;
      try { data = await response.json(); } catch {}
      lastCode = Number(data?.Code) || null;
      lastError = typeof data?.Error === 'string' ? data.Error : '';

      if (response.ok && data?.Code === 1000) {
        const keySalts = (data.KeySalts || [])
          .filter(k => k?.ID && k?.KeySalt)
          .map(k => ({id:k.ID, keySalt:k.KeySalt}));
        if (!keySalts.length) {
          return {
            ok:false,
            error:'未返回可用 KeySalt',
            stage:'parse',
            status:response.status,
            protonCode:data.Code,
            pathname:location.pathname,
            origin:location.origin
          };
        }
        return {
          ok:true,
          keySalts,
          diagnostics:{
            status:response.status,
            protonCode:data.Code,
            pathname:location.pathname,
            origin:location.origin,
            attempt
          },
          client:isMail
            ? {mailAppVersion:appVersion, locale}
            : {accountAppVersion:appVersion, locale}
        };
      }

      if (response.status !== 401 || attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }

    return {
      ok:false,
      error:`/core/v4/keys/salts HTTP ${lastStatus}${lastCode ? ` / Proton ${lastCode}` : ''}${lastError ? ` · ${lastError}` : ''}`,
      stage:'request',
      status:lastStatus,
      protonCode:lastCode,
      pathname:location.pathname,
      origin:location.origin
    };
  } catch (e) {
    return {
      ok:false,
      error:e instanceof Error ? e.message : 'KeySalt 重放失败',
      stage:'exception',
      pathname:location.pathname,
      origin:location.origin
    };
  }
}

export async function mcpRequest(operation, payload, expectedOrigin) {
  if (!expectedOrigin || location.origin !== expectedOrigin || !expectedOrigin.startsWith('https://') || location.pathname !== '/proton/import') return {ok:false,error:'请登录 MCP 管理页'};
  const routes = {accounts:['GET','accounts'], pair:['POST','extension-pair'], import:['POST','extension-import']};
  if (!Object.hasOwn(routes, operation)) return {ok:false,error:'操作无效'};
  const csrf = document.querySelector('meta[name="proton-extension-csrf"]')?.content;
  if (!csrf) return {ok:false,error:'请部署扩展配对接口并刷新 MCP 管理页'};
  try {
    const [method,path] = routes[operation];
    const r = await fetch('/proton/import/api/' + path, {
      method,
      credentials:'same-origin',
      cache:'no-store',
      redirect:'error',
      headers:{
        accept:'application/json',
        ...(method === 'POST' ? {'content-type':'application/json','x-csrf-token':csrf} : {})
      },
      body:method === 'POST' ? JSON.stringify(payload) : undefined,
      signal:AbortSignal.timeout(operation === 'import' ? 60000 : 30000)
    });
    if (!r.ok) {
      let detail = null;
      try { detail = await r.json(); } catch {}
      return {ok:false,error:detail?.error || `MCP HTTP ${r.status}；请检查 Access 登录、账号匹配与服务端扩展接口`};
    }
    const result = await r.json();
    // Support the direct import-page response and older DO-style envelopes.
    // A HTTP 200 business failure must never be treated as successful pairing.
    if (result?.ok === false || result?.success === false) {
      return {ok:false,error:typeof result.error === 'string' ? result.error : 'MCP 返回业务失败，请检查服务端状态'};
    }
    const data = result?.ok === true && result.data && typeof result.data === 'object' ? result.data : result;
    if (data?.ok === false || data?.success === false) {
      return {ok:false,error:typeof data.error === 'string' ? data.error : 'MCP 返回业务失败，请检查服务端状态'};
    }
    return {ok:true, data};
  } catch {
    return {ok:false,error:'MCP 连接中断或超时。导入结果可能已保存，请先检查管理页状态'};
  }
}

