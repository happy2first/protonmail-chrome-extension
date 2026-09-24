export const PROTON = 'https://mail.proton.me';
export const ACCOUNT = 'https://account.proton.me';
export const MCP = 'https://mail.mcp.happyfirst.top';
export const ADMIN = MCP + '/proton/import';

function pathCovers(cookiePath, requestPath) {
  const path = String(cookiePath || '/');
  if (path === requestPath) return true;
  if (!requestPath.startsWith(path)) return false;
  return path.endsWith('/') || requestPath[path.length] === '/';
}

export function selectCookies(rows, uid, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(uid)) throw new Error('UID 无效');
  const selected = rows.filter(c => {
    const domain = String(c.domain || '').replace(/^\./, '').toLowerCase();
    if (!(domain === 'mail.proton.me' || (domain === 'proton.me' && !c.hostOnly))) return false;
    if (c.expirationDate !== undefined && c.expirationDate !== null && c.expirationDate * 1000 <= now) return false;
    if (/^(AUTH|REFRESH)-/.test(c.name) && ![`AUTH-${uid}`, `REFRESH-${uid}`].includes(c.name)) return false;
    return true;
  });
  if (selected.some(c => c.partitionKey)) throw new Error('暂不支持分区 Cookie，请使用普通浏览器窗口');
  if (selected.length > 64) throw new Error('Cookie 数量超过 64，未导出');

  const out = selected.map(c => {
    if (typeof c.value !== 'string' || c.value.length > 8192) throw new Error('Cookie 大小无效');
    return {
      name:c.name,
      value:c.value,
      domain:c.domain,
      path:c.path,
      hostOnly:c.hostOnly,
      httpOnly:c.httpOnly,
      secure:c.secure,
      sameSite:c.sameSite,
      session:c.session,
      expirationDate:c.expirationDate ?? null,
      expiresAt:c.expirationDate === undefined || c.expirationDate === null ? null : c.expirationDate * 1000
    };
  });

  const state = sessionState(out, uid);
  if (!state.auth) throw new Error('未找到所选账号的 AUTH Cookie');
  if (!state.refresh) throw new Error('未找到所选账号的 REFRESH Cookie');
  if (!state.sessionId) throw new Error('未找到 Proton Session-Id Cookie');
  return out;
}

export function sessionState(cookies, uid) {
  const auth = cookies.some(c => c.name === `AUTH-${uid}` && c.value &&
    pathCovers(c.path, '/api/core/v4/addresses'));
  const refresh = cookies.some(c => c.name === `REFRESH-${uid}` && c.value &&
    pathCovers(c.path, '/api/auth/refresh'));
  const sessionId = cookies.some(c => c.name === 'Session-Id' && c.value);
  return {auth, refresh, sessionId, ready:auth && refresh && sessionId};
}

export function refreshAvailable(cookies, uid) {
  return sessionState(cookies, uid).ready;
}

export function bundleFor(uid, cookies, result) {
  if (!result?.ok || !result.user?.id || !result.addresses?.length || !result.keySalts?.length) throw new Error('账号或 KeySalt 未就绪');
  const state = sessionState(cookies, uid);
  if (!state.ready) throw new Error('AUTH / REFRESH / Session-Id 材料不完整');
  const keyIds = new Set(result.user.keyIds || []);
  if (!result.keySalts.some(k => k?.id && k?.keySalt && keyIds.has(k.id))) throw new Error('KeySalt 与用户密钥不匹配');
  const bundle = {
    version:2,
    source:'proton-browser-session',
    uid,
    capturedAt:Date.now(),
    email:result.email,
    session:{cookies},
    user:result.user,
    addresses:result.addresses,
    keySalts:result.keySalts,
    client:result.client || null
  };
  if (new TextEncoder().encode(JSON.stringify(bundle)).length > 110 * 1024) throw new Error('Session Bundle 超过大小限制');
  return bundle;
}
