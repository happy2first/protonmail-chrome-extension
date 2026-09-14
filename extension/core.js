export const PROTON = 'https://mail.proton.me';
export const MCP = 'https://mail.mcp.happyfirst.top';
export const ADMIN = MCP + '/proton/import';
export function selectCookies(rows, uid, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(uid)) throw new Error('UID 无效');
  const selected = rows.filter(c => {
    const domain = c.domain.replace(/^\./, '').toLowerCase();
    if (!(domain === 'mail.proton.me' || (domain === 'proton.me' && !c.hostOnly))) return false;
    if (c.expirationDate !== undefined && c.expirationDate * 1000 <= now) return false;
    if (/^(AUTH|REFRESH)-/.test(c.name) && ![`AUTH-${uid}`, `REFRESH-${uid}`].includes(c.name)) return false;
    return true;
  });
  if (selected.some(c => c.partitionKey)) throw new Error('暂不支持分区 Cookie，请使用普通浏览器窗口');
  if (!selected.some(c => c.name === `AUTH-${uid}` && c.value)) throw new Error('未找到所选账号的 AUTH Cookie');
  if (selected.length > 64) throw new Error('Cookie 数量超过 64，未导出');
  return selected.map(c => {
    if (typeof c.value !== 'string' || c.value.length > 8192) throw new Error('Cookie 大小无效');
    return {name:c.name, value:c.value, domain:c.domain, path:c.path,
      hostOnly:c.hostOnly, httpOnly:c.httpOnly, secure:c.secure, sameSite:c.sameSite,
      session:c.session, expirationDate:c.expirationDate ?? null,
      expiresAt:c.expirationDate === undefined ? null : c.expirationDate * 1000};
  });
}
export function refreshAvailable(cookies, uid) {
  const target = '/api/auth/refresh';
  return cookies.some(c => c.name === `AUTH-${uid}` &&
    (target === c.path || (target.startsWith(c.path) && (c.path.endsWith('/') || target[c.path.length] === '/'))));
}
export function bundleFor(uid, cookies, result) {
  if (!result?.ok || !result.user?.ID || !result.addresses?.length || !result.keySalts?.length) throw new Error('账号或 KeySalt 未就绪');
  const keyIds = new Set(result.user.keyIds);
  if (!result.keySalts.some(k => keyIds.has(k.ID))) throw new Error('KeySalt 与用户密钥不匹配');
  const bundle = {version:1, uid, capturedAt:Date.now(), source:PROTON,
    email:result.email, user:result.user, addresses:result.addresses, keySalts:result.keySalts, cookies};
  if (new TextEncoder().encode(JSON.stringify(bundle)).length > 110 * 1024) throw new Error('Session Bundle 超过大小限制');
  return bundle;
}
