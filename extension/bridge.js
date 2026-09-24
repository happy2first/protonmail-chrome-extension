// Runs only in Chrome's ISOLATED world. Never reads page storage or password fields.
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

export async function readKeySalts(uid) {
  if (location.origin !== 'https://account.proton.me') return {ok:false, error:'KeySalt 重放需要 account.proton.me 同源页面'};
  try {
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
    if (!response.ok) throw new Error(`/core/v4/keys/salts HTTP ${response.status}`);
    const data = await response.json();
    if (data.Code !== 1000) throw new Error(`/core/v4/keys/salts Proton ${Number(data.Code) || '响应异常'}`);
    const keySalts = (data.KeySalts || [])
      .filter(k => k?.ID && k?.KeySalt)
      .map(k => ({id:k.ID, keySalt:k.KeySalt}));
    if (!keySalts.length) throw new Error('未返回可用 KeySalt');
    return {
      ok:true,
      keySalts,
      client:{accountAppVersion:'web-account@5.0.420.1', locale:'zh_CN'}
    };
  } catch (e) {
    return {ok:false, error:e instanceof Error ? e.message : 'KeySalt 重放失败'};
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
