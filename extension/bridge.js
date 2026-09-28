// Runs only in Chrome's ISOLATED world. Reads only the ps-<LocalID>.UID mapping from Proton storage; never reads password fields.
export async function readProton(uid) {
  if (location.origin !== 'https://mail.proton.me') return {ok:false, error:'请返回 Proton Mail 页面'};
  try {
    const get = async path => {
      const response = await fetch('/api' + path, {
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
      if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
      const data = await response.json();
      if (data.Code !== 1000) throw new Error(`${path} Proton ${Number(data.Code) || '响应异常'}`);
      return data;
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
      client:{mailAppVersion:'web-mail@5.0.133.5', locale:'en_US'}
    };
  } catch (e) {
    return {ok:false, error:e instanceof Error ? e.message : 'Proton 检测失败'};
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

export async function readLocalSessions(uid) {
  if (location.origin !== 'https://mail.proton.me') {
    return {ok:false, error:'本地会话映射需要 mail.proton.me 同源页面'};
  }
  try {
    const response = await fetch('/api/auth/v4/sessions/local', {
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

export async function readKeySalts(uid) {
  if (location.origin !== 'https://account.proton.me') {
    return {ok:false, error:'KeySalt 重放需要 account.proton.me 同源页面', stage:'origin', pathname:location.pathname};
  }
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
          'x-pm-appversion':'web-account@5.0.420.1',
          'x-pm-locale':'zh_CN'
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
          return {ok:false, error:'未返回可用 KeySalt', stage:'parse', status:response.status, protonCode:data.Code, pathname:location.pathname};
        }
        return {
          ok:true,
          keySalts,
          diagnostics:{status:response.status, protonCode:data.Code, pathname:location.pathname, attempt},
          client:{accountAppVersion:'web-account@5.0.420.1', locale:'zh_CN'}
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
      pathname:location.pathname
    };
  } catch (e) {
    return {
      ok:false,
      error:e instanceof Error ? e.message : 'KeySalt 重放失败',
      stage:'exception',
      pathname:location.pathname
    };
  }
}

export async function mcpRequest(operation, payload) {
  if (location.origin !== 'https://mail.mcp.happyfirst.top' || location.pathname !== '/proton/import') return {ok:false,error:'请登录 MCP 管理页'};
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
      signal:AbortSignal.timeout(25000)
    });
    if (!r.ok) {
      let detail = null;
      try { detail = await r.json(); } catch {}
      return {ok:false,error:detail?.error || `MCP HTTP ${r.status}；请检查 Access 登录、账号匹配与服务端扩展接口`};
    }
    const result = await r.json();
    return {ok:true, data:result};
  } catch {
    return {ok:false,error:'MCP 连接中断或超时。导入结果可能已保存，请先检查管理页状态'};
  }
}
